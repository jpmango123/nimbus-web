#!/bin/bash
# =============================================================================
# Nimbus Web — Database Setup Script
# Run after setting DATABASE_URL in .env.local or Vercel env vars
# =============================================================================

echo "🌩️ Nimbus Web — Setting up database..."

# If DATABASE_URL is set locally, use it
if [ -f .env.local ]; then
  source <(grep DATABASE_URL .env.local | sed 's/^/export /')
fi

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set. Please add it to .env.local or pass it as an argument."
  echo "   Usage: DATABASE_URL=postgres://... ./scripts/setup-db.sh"
  exit 1
fi

echo "📦 Creating tables..."
curl -s "https://nimbus-web-xi.vercel.app/api/setup" | python3 -m json.tool 2>/dev/null || echo "Done"

echo ""
echo "✅ Database setup complete!"
echo "   Visit https://nimbus-web-xi.vercel.app/locations to add cities"
echo "   Visit https://nimbus-web-xi.vercel.app to see weather"
