#!/bin/bash
set -e

echo "=== Migration Test Script ==="
echo ""

# Set required environment variables
export HULY_URL="http://localhost:8080"
export HULY_WORKSPACE="test-workspace"
export TELEGRAM_BOT_TOKEN="test-token"
export TELEGRAM_USER_ID="123456"

# Database path for testing
export DB_PATH="./test-migration.db"

echo "1. Setting up test database..."
rm -f "$DB_PATH"

echo "2. Running database migrations..."
bun run src/db/migrate.ts

echo "3. Inserting test user with Linear credentials..."
bun -e "
const { getDb } = require('./src/db/index.js');
const db = getDb();

// Insert test user config
const userId = 123456;
db.run(\`INSERT INTO user_config (user_id, key, value) VALUES (\${userId}, 'linear_key', '\${process.env.LINEAR_API_KEY}')\`);
db.run(\`INSERT INTO user_config (user_id, key, value) VALUES (\${userId}, 'linear_team_id', 'team-test')\`);
db.run(\`INSERT INTO user_config (user_id, key, value) VALUES (\${userId}, 'huly_email', 'test@example.com')\`);
db.run(\`INSERT INTO user_config (user_id, key, value) VALUES (\${userId}, 'huly_password', 'test-password')\`);
db.run(\`INSERT INTO user_config (user_id, key, value) VALUES (\${userId}, 'openai_key', 'test-openai-key')\`);
db.run(\`INSERT INTO user_config (user_id, key, value) VALUES (\${userId}, 'openai_base_url', 'https://api.openai.com')\`);
db.run(\`INSERT INTO user_config (user_id, key, value) VALUES (\${userId}, 'openai_model', 'gpt-4')\`);

console.log('Test user created with ID:', userId);
"

echo "4. Checking migration status..."
bun -e "
const { getMigrationStatus } = require('./src/db/migration-status.js');
const status = getMigrationStatus('linear_to_huly');
console.log('Current migration status:', status);
"

echo ""
echo "5. Running migration (dry-run simulation)..."
echo "Note: Full migration requires Huly to be running at http://localhost:8080"
echo ""

# Check if Huly is running
if curl -s http://localhost:8080/healthz > /dev/null 2>&1; then
    echo "Huly is running! Executing full migration..."
    bun run scripts/migrate.ts
else
    echo "Huly is NOT running at http://localhost:8080"
    echo "To test full migration:"
    echo "  1. Start Huly: cd huly && docker compose up -d"
    echo "  2. Run this script again"
    echo ""
    echo "Running unit tests instead..."
    bun test tests/migration/
fi

echo ""
echo "=== Test Complete ==="
