#!/bin/bash
# =============================================================================
# Nimbus iOS Auto-Fix Pipeline
# Fetches pending fixes → applies to iCloud project → builds with Xcode → reports
# Runs as a macOS LaunchAgent (automated) or manually
# =============================================================================

set -e

NIMBUS_IOS_PATH="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Nimbus"
NIMBUS_XCODEPROJ="$NIMBUS_IOS_PATH/Nimbus.xcodeproj"
API_URL="${VERCEL_APP_URL:-https://nimbus-web-xi.vercel.app}"
LOG_FILE="$HOME/.nimbus-auto-fix.log"
SCHEME="Nimbus"
SIMULATOR="iPhone 17 Pro"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" | tee -a "$LOG_FILE"
}

log "🌩️ Nimbus iOS Auto-Fix starting..."

# 1. Fetch pending iOS fixes from the API
log "📥 Fetching pending fixes..."
FIXES=$(curl -s "$API_URL/api/changelog?status=pending_ios" 2>/dev/null)

if [ -z "$FIXES" ] || [ "$FIXES" = "[]" ]; then
  log "✅ No pending iOS fixes. Done."
  exit 0
fi

# 2. Count pending fixes
PENDING_COUNT=$(echo "$FIXES" | python3 -c "
import json, sys
fixes = json.load(sys.stdin)
pending = [f for f in fixes if isinstance(f, dict) and f.get('status') == 'pending_ios']
print(len(pending))
" 2>/dev/null || echo "0")

if [ "$PENDING_COUNT" = "0" ]; then
  log "✅ No pending iOS fixes. Done."
  exit 0
fi

log "📋 Found $PENDING_COUNT pending iOS fix(es)"

# 3. Backup current state
BACKUP_BRANCH="pre-autofix-$(date '+%Y%m%d-%H%M%S')"
if [ -d "$NIMBUS_IOS_PATH/.git" ]; then
  cd "$NIMBUS_IOS_PATH"
  git stash 2>/dev/null || true
  log "📦 Git state saved"
fi

# 4. Apply each fix
APPLIED=0
FAILED=0

echo "$FIXES" | python3 -c "
import json, sys, os

fixes = json.load(sys.stdin)
if not isinstance(fixes, list):
    sys.exit(0)

pending = [f for f in fixes if isinstance(f, dict) and f.get('status') == 'pending_ios']
ios_path = os.path.expanduser('~/Library/Mobile Documents/com~apple~CloudDocs/Nimbus')

applied_ids = []
failed_ids = []

for fix in pending:
    fix_id = fix.get('id', 'unknown')
    summary = fix.get('summary', 'unknown fix')
    diff_data = fix.get('diff', '')

    if not diff_data:
        print(f'SKIP:{fix_id}:No diff data')
        continue

    try:
        changes = json.loads(diff_data)
    except:
        print(f'SKIP:{fix_id}:Could not parse diff')
        continue

    all_applied = True
    for change in changes:
        filepath = os.path.join(ios_path, change['filePath'])
        if not os.path.exists(filepath):
            print(f'MISS:{fix_id}:{change[\"filePath\"]}:File not found')
            all_applied = False
            continue

        with open(filepath, 'r') as f:
            content = f.read()

        old_content = change['oldContent']
        new_content = change['newContent']

        if old_content not in content:
            print(f'MISS:{fix_id}:{change[\"filePath\"]}:Old content not found')
            all_applied = False
            continue

        content = content.replace(old_content, new_content, 1)
        with open(filepath, 'w') as f:
            f.write(content)

        print(f'OK:{fix_id}:{change[\"filePath\"]}:{change.get(\"description\", \"applied\")}')

    if all_applied:
        applied_ids.append(str(fix_id))
    else:
        failed_ids.append(str(fix_id))

# Write results for shell to read
with open('/tmp/nimbus-fix-applied.txt', 'w') as f:
    f.write(','.join(applied_ids))
with open('/tmp/nimbus-fix-failed.txt', 'w') as f:
    f.write(','.join(failed_ids))
" 2>&1 | while read -r line; do
  log "  $line"
done

APPLIED_IDS=$(cat /tmp/nimbus-fix-applied.txt 2>/dev/null || echo "")
FAILED_IDS=$(cat /tmp/nimbus-fix-failed.txt 2>/dev/null || echo "")

# 5. Build with Xcode to verify
log "🔨 Building Nimbus with Xcode..."
BUILD_OUTPUT=$(xcodebuild build \
  -project "$NIMBUS_XCODEPROJ" \
  -scheme "$SCHEME" \
  -destination "platform=iOS Simulator,name=$SIMULATOR" \
  -quiet \
  2>&1) || BUILD_FAILED=1

if [ -z "$BUILD_FAILED" ]; then
  log "✅ Xcode build SUCCEEDED"
  BUILD_STATUS="success"
else
  log "❌ Xcode build FAILED"
  log "Build output (last 20 lines):"
  echo "$BUILD_OUTPUT" | tail -20 | while read -r line; do log "  $line"; done
  BUILD_STATUS="failed"

  # Revert changes if build failed
  log "⏪ Reverting changes due to build failure..."
  if [ -d "$NIMBUS_IOS_PATH/.git" ]; then
    cd "$NIMBUS_IOS_PATH"
    git checkout -- . 2>/dev/null || true
    git stash pop 2>/dev/null || true
    log "  Reverted via git"
  fi
fi

# 6. Report results back to the API
log "📤 Reporting results..."

# Update fix statuses via API
if [ "$BUILD_STATUS" = "success" ] && [ -n "$APPLIED_IDS" ]; then
  # Mark applied fixes as completed
  curl -s -X POST "$API_URL/api/changelog" \
    -H "Content-Type: application/json" \
    -d "{
      \"action\": \"update_status\",
      \"ids\": \"$APPLIED_IDS\",
      \"status\": \"applied_ios\",
      \"buildResult\": \"success\"
    }" > /dev/null 2>&1 || true
  log "  Marked fixes as applied_ios: $APPLIED_IDS"
fi

if [ "$BUILD_STATUS" = "failed" ] && [ -n "$APPLIED_IDS" ]; then
  curl -s -X POST "$API_URL/api/changelog" \
    -H "Content-Type: application/json" \
    -d "{
      \"action\": \"update_status\",
      \"ids\": \"$APPLIED_IDS\",
      \"status\": \"build_failed\",
      \"buildResult\": \"failed\",
      \"buildOutput\": $(echo "$BUILD_OUTPUT" | tail -20 | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
    }" > /dev/null 2>&1 || true
  log "  Marked fixes as build_failed: $APPLIED_IDS"
fi

log "🏁 Done. Build: $BUILD_STATUS | Applied: $(echo "$APPLIED_IDS" | tr ',' ' ' | wc -w | tr -d ' ') | Failed: $(echo "$FAILED_IDS" | tr ',' ' ' | wc -w | tr -d ' ')"
