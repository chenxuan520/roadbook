#!/bin/bash

# cloudflare/test_local.sh - Run integration tests against a local Cloudflare Worker instance.

# Ensure we are in the cloudflare directory
cd "$(dirname "$0")"
PROJECT_ROOT="$(dirname "$(pwd)")"

PORT=8787
BASE_URL="http://127.0.0.1:$PORT"

echo "=== Starting local Worker environment (Wrangler) ==="
# Start wrangler dev in background
# --local forces local simulation (no connection to Cloudflare)
# --persist keeps KV data (optional, but good for testing persistence if needed)
# Note: wrangler v3 uses `wrangler dev` which runs locally by default now, but --local is still good to be explicit or if using older version.
npx wrangler dev --port $PORT > wrangler.log 2>&1 &
WRANGLER_PID=$!

echo "Waiting for Worker to start (PID: $WRANGLER_PID)..."
MAX_RETRIES=30
count=0
while ! curl -s "$BASE_URL/api/ping" > /dev/null; do
    sleep 1
    count=$((count+1))
    if [ $count -ge $MAX_RETRIES ]; then
        echo "Worker failed to start! Check wrangler.log:"
        echo "--- wrangler.log ---"
        cat wrangler.log
        echo "--------------------"
        kill $WRANGLER_PID
        exit 1
    fi
    echo -n "."
done
echo " Worker is ready!"

# Cleanup function
cleanup() {
    echo
    echo "=== Cleaning up ==="
    if kill -0 $WRANGLER_PID 2>/dev/null; then
        kill $WRANGLER_PID
        echo "Wrangler stopped."
    fi
}
trap cleanup EXIT

echo
echo "=== Running shared backend tests against local Worker ==="

# Set environment variables for the shared test script
export API_BASE_URL="$BASE_URL"
export SKIP_LOCAL_SERVER=true
# Default credentials for Cloudflare Worker local dev
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="password"

# Make sure the backend test script is executable
chmod +x "$PROJECT_ROOT/backend/scripts/backend_test.sh"

# Run the backend test script
cd "$PROJECT_ROOT"
./backend/scripts/backend_test.sh
