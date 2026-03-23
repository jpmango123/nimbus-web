#!/bin/bash
# =============================================================================
# Apply pending iOS fixes from the AI changelog to the iCloud Nimbus project
# Run this locally when you want to pull AI-suggested changes into the iOS app
# =============================================================================

NIMBUS_IOS_PATH="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Nimbus"
API_URL="${VERCEL_APP_URL:-https://nimbus-web-xi.vercel.app}"

echo "🌩️ Nimbus — Applying pending iOS fixes"
echo "   iOS path: $NIMBUS_IOS_PATH"
echo ""

# Fetch pending iOS fixes from changelog
FIXES=$(curl -s "$API_URL/api/changelog?status=pending_ios" 2>/dev/null)

if [ -z "$FIXES" ] || [ "$FIXES" = "[]" ]; then
  echo "✅ No pending iOS fixes to apply."
  exit 0
fi

echo "$FIXES" | python3 -c "
import json, sys, os

fixes = json.load(sys.stdin)
if not isinstance(fixes, list):
    print('No fixes found')
    sys.exit(0)

pending = [f for f in fixes if f.get('status') == 'pending_ios']
print(f'Found {len(pending)} pending iOS fixes')

ios_path = os.path.expanduser('~/Library/Mobile Documents/com~apple~CloudDocs/Nimbus')

for fix in pending:
    print(f'')
    print(f'📋 {fix[\"summary\"]}')
    print(f'   Category: {fix[\"category\"]}')

    diff_data = fix.get('diff', '')
    if not diff_data:
        print('   ⚠️  No diff data, skipping')
        continue

    try:
        changes = json.loads(diff_data)
    except:
        print('   ⚠️  Could not parse diff data')
        continue

    for change in changes:
        filepath = os.path.join(ios_path, change['filePath'])
        if not os.path.exists(filepath):
            print(f'   ⚠️  File not found: {filepath}')
            continue

        with open(filepath, 'r') as f:
            content = f.read()

        old_content = change['oldContent']
        new_content = change['newContent']

        if old_content not in content:
            print(f'   ⚠️  Old content not found in {change[\"filePath\"]} (may have already been applied)')
            continue

        content = content.replace(old_content, new_content, 1)
        with open(filepath, 'w') as f:
            f.write(content)

        print(f'   ✅ Applied: {change[\"description\"]}')
        print(f'      File: {change[\"filePath\"]}')

print('')
print('Done! Open Xcode to review and build.')
"

echo ""
echo "💡 Tip: The changes are now in your iCloud Nimbus folder."
echo "   Open Xcode → Build to verify the changes compile correctly."
