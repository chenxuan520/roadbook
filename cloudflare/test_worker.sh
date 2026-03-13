#!/bin/bash

# test_worker.sh - Test the Cloudflare Worker backend using the common backend test suite.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
if [ -z "$API_BASE_URL" ]; then
    if [ -n "$1" ]; then
        API_BASE_URL="$1"
    else
        read -p "Enter Cloudflare Worker URL (e.g., https://your-worker.workers.dev): " API_BASE_URL
    fi
fi

# Remove trailing slash if present
API_BASE_URL=${API_BASE_URL%/}

if [ -z "$API_BASE_URL" ]; then
    echo "Error: API_BASE_URL is required."
    exit 1
fi

echo "Testing Cloudflare Worker at: $API_BASE_URL"

# Set environment variables for the test script
export API_BASE_URL
export SKIP_LOCAL_SERVER=true
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="password" # Default password for CF worker

# Determine script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Run the backend test script from the project root
cd "$PROJECT_ROOT"
./backend/scripts/backend_test.sh
