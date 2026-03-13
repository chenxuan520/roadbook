#!/bin/bash

# backend_test.sh - Integration test script for the Roadbook backend.
# This script should be run from the project root directory.

# --- Pre-flight Check ---
if [ ! -f "./build.sh" ] || [ ! -d "./backend" ]; then
    echo -e "\e[31m[ERROR]\e[0m This script must be run from the project root directory."
    echo "Please 'cd' to the root of the 'roadbook' project and run again:"
    echo "  ./backend/scripts/backend_test.sh"
    exit 1
fi

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
: "${API_BASE_URL:=http://localhost:5436}"
: "${ADMIN_USERNAME:=admin}"
: "${ADMIN_PASSWORD:=password}"
: "${CONFIG_FILE:=/tmp/roadbook_test_config.json}"
: "${SKIP_LOCAL_SERVER:=false}"

# --- Helper Functions ---
# Utility for colored output
print_info() { echo -e "\e[34m[INFO]\e[0m $1"; }
print_pass() { echo -e "\e[32m[PASS]\e[0m $1"; }
print_fail() { echo -e "\e[31m[FAIL]\e[0m $1"; }
print_step() { echo -e "\n\e[36m--- $1 ---\e[0m"; }

# Cross-platform sha256 helper (macOS: shasum, Linux: sha256sum)
sha256_hex() {
    if command -v sha256sum >/dev/null 2>&1; then
        echo -n "$1" | sha256sum | cut -d ' ' -f 1
        return
    fi
    if command -v shasum >/dev/null 2>&1; then
        echo -n "$1" | shasum -a 256 | cut -d ' ' -f 1
        return
    fi
    print_fail "Missing sha256 tool: install 'sha256sum' (coreutils) or ensure 'shasum' exists."
    exit 1
}

# Cleanup function to be called on script exit
cleanup() {
    print_info "Cleaning up..."
    if [ -n "$SERVER_PID" ]; then
        print_info "Stopping backend server (PID: $SERVER_PID)..."
        kill "$SERVER_PID" 2>/dev/null || print_info "Server was not running."
        # Wait a bit for graceful shutdown, then force kill if needed
        for _ in 1 2 3 4 5; do
            if kill -0 "$SERVER_PID" 2>/dev/null; then
                sleep 0.2
            else
                break
            fi
        done
        if kill -0 "$SERVER_PID" 2>/dev/null; then
            print_info "Server did not exit in time, sending SIGKILL..."
            kill -9 "$SERVER_PID" 2>/dev/null || true
        fi
        # Remove wait command to prevent hanging if process is already zombie/gone
        # wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# --- Main Test Logic ---

# 1. Setup Environment
print_step "Setting up test environment"

if [ "$SKIP_LOCAL_SERVER" != "true" ]; then
    # Generate a salted SHA256 hash for the password
    print_info "Generating password hash for '${ADMIN_PASSWORD}'..."
    SALT=$(openssl rand -hex 16)
    HASHED_PASSWORD=$(sha256_hex "${SALT}${ADMIN_PASSWORD}")
    JWT_SECRET=$(openssl rand -hex 32)

    # Create config directory if it doesn't exist
    mkdir -p "$(dirname "$CONFIG_FILE")"

    # Create a temporary config file
    print_info "Creating temporary config file at ${CONFIG_FILE}"
    cat > "$CONFIG_FILE" << EOL
{
  "port": 5436,
  "allowed_origins": ["*"],
  "allow_null_origin_for_dev": true,
  "jwtSecret": "${JWT_SECRET}",
  "users": {
    "${ADMIN_USERNAME}": {
      "salt": "${SALT}",
      "hash": "${HASHED_PASSWORD}"
    }
  }
}
EOL
    print_info "Config file created."

    # Build the backend
    print_step "Building backend binary"
    if [ -f "./backend/scripts/build.sh" ]; then
        ./backend/scripts/build.sh
    else
        print_fail "Dedicated backend build script not found at ./backend/scripts/build.sh. Cannot proceed."
        exit 1
    fi

    # Start the server in the background
    print_step "Starting backend server"
    # Export CONFIG_FILE environment variable for the backend process
    (cd backend && export CONFIG_FILE="$CONFIG_FILE" && GIN_MODE=release ./roadbook-api) &
    SERVER_PID=$!
    print_info "Backend server started with PID: $SERVER_PID"

    # Wait for the server to be ready
    print_info "Waiting for server to initialize..."
    sleep 2 # Increased sleep for stability
else
    print_info "SKIP_LOCAL_SERVER is set to true. Skipping local server setup."
    print_info "Testing against external URL: $API_BASE_URL"
    print_info "Ensure the target server has user '${ADMIN_USERNAME}' with password '${ADMIN_PASSWORD}' configured."
fi

# 2. Run Tests
print_step "Running API tests"
FAIL_COUNT=0
JWT_TOKEN=""

# Test 1: Get Traffic Pos (Public API)
print_info "Test 1: Testing GET /api/trafficpos..."
TRAFFICPOS_RESPONSE_FULL=$(curl -s -w "\n%{http_code}" "${API_BASE_URL}/api/trafficpos?lat=34.0522&lon=-118.2437")
TRAFFICPOS_BODY=$(echo "$TRAFFICPOS_RESPONSE_FULL" | head -n -1)
TRAFFICPOS_STATUS=$(echo "$TRAFFICPOS_RESPONSE_FULL" | tail -n 1)

if [ "$TRAFFICPOS_STATUS" -eq 200 ]; then
    if echo "$TRAFFICPOS_BODY" | jq -e '.input.lat == 34.0522' > /dev/null; then
        print_pass "Test 1: Get traffic pos successful."
    else
        print_fail "Test 1: Get traffic pos successful, but body content incorrect. Body: $TRAFFICPOS_BODY"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
else
    print_fail "Test 1: Get traffic pos failed with status code ${TRAFFICPOS_STATUS}. Body: $TRAFFICPOS_BODY"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 2: Login
print_info "Test 2: Testing POST /api/v1/login..."
FULL_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/api/v1/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"${ADMIN_USERNAME}\", \"password\": \"${ADMIN_PASSWORD}\"}")
LOGIN_BODY=$(echo "$FULL_RESPONSE" | head -n -1)
LOGIN_RESPONSE=$(echo "$FULL_RESPONSE" | tail -n 1)

if [ "$LOGIN_RESPONSE" -eq 200 ]; then
    JWT_TOKEN=$(echo "$LOGIN_BODY" | jq -r '.token')
    if [ -n "$JWT_TOKEN" ] && [ "$JWT_TOKEN" != "null" ]; then
        print_pass "Test 2: Login successful. Token received."
    else
        print_fail "Test 2: Login response is OK, but token is missing from body. Body: $LOGIN_BODY"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
else
    print_fail "Test 2: Login failed with status code ${LOGIN_RESPONSE}. Body: $LOGIN_BODY"
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Test 3: Refresh Token (Unauthorized)
print_info "Test 3: Testing POST /api/v1/refresh without token (should be 401)..."
REFRESH_NOAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE_URL}/api/v1/refresh")
if [ "$REFRESH_NOAUTH_STATUS" -eq 401 ]; then
    print_pass "Test 3: Refresh without token correctly rejected (401)."
else
    print_fail "Test 3: Expected 401 for refresh without token, but got ${REFRESH_NOAUTH_STATUS}."
    FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# Run authenticated tests only if login was successful
if [ -n "$JWT_TOKEN" ]; then
    PLAN_ID=""

    # Test 4: Refresh Token (Authorized)
    print_info "Test 4: Testing POST /api/v1/refresh with token..."
    REFRESH_FULL_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/api/v1/refresh" \
        -H "Authorization: Bearer ${JWT_TOKEN}")
    REFRESH_BODY=$(echo "$REFRESH_FULL_RESPONSE" | head -n -1)
    REFRESH_STATUS=$(echo "$REFRESH_FULL_RESPONSE" | tail -n 1)

    if [ "$REFRESH_STATUS" -eq 200 ]; then
        REFRESHED_TOKEN=$(echo "$REFRESH_BODY" | jq -r '.token')
        if [ -n "$REFRESHED_TOKEN" ] && [ "$REFRESHED_TOKEN" != "null" ]; then
            JWT_TOKEN="$REFRESHED_TOKEN"
            print_pass "Test 4: Refresh token successful. New token received and will be used for subsequent tests."
        else
            print_fail "Test 4: Refresh response is OK, but token is missing from body. Body: $REFRESH_BODY"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    else
        print_fail "Test 4: Refresh token failed with status code ${REFRESH_STATUS}. Body: $REFRESH_BODY"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi

    # Test 5: Create Plan
    print_info "Test 5: Testing POST /api/v1/plans..."
    CREATE_FULL_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/api/v1/plans" \
        -H "Authorization: Bearer ${JWT_TOKEN}" \
        -H "Content-Type: application/json" \
        -d '{"name": "Test Plan", "description": "A plan for testing"}')

    CREATE_BODY=$(echo "$CREATE_FULL_RESPONSE" | head -n -1)
    CREATE_STATUS=$(echo "$CREATE_FULL_RESPONSE" | tail -n 1)

    if [ "$CREATE_STATUS" -eq 201 ]; then
        PLAN_ID=$(echo "$CREATE_BODY" | jq -r '.id')
        if [ -n "$PLAN_ID" ] && [ "$PLAN_ID" != "null" ]; then
            print_pass "Test 5: Create plan successful. Got ID: ${PLAN_ID}"
        else
            print_fail "Test 5: Create plan returned 201, but ID was missing in response body. Body: $CREATE_BODY"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    else
        print_fail "Test 5: Create plan failed with status code ${CREATE_STATUS}. Body: $CREATE_BODY"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi

    if [ -n "$PLAN_ID" ]; then
        # Test 6: List Plans
        print_info "Test 6: Testing GET /api/v1/plans (structure and content)..."
        FULL_LIST_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/api/v1/plans" \
            -H "Authorization: Bearer ${JWT_TOKEN}")
        LIST_BODY=$(echo "$FULL_LIST_RESPONSE" | head -n -1)
        LIST_RESPONSE_CODE=$(echo "$FULL_LIST_RESPONSE" | tail -n 1)

        if [ "$LIST_RESPONSE_CODE" -eq 200 ]; then
            if echo "$LIST_BODY" | jq -e '.plans | (type == "array" and length > 0)' > /dev/null; then
                print_pass "Test 6: List plans successful and returned correct structure."
            else
                print_fail "Test 6: List plans response is OK, but '.plans' is not a non-empty array. Body: $LIST_BODY"
                FAIL_COUNT=$((FAIL_COUNT + 1))
            fi
        else
            print_fail "Test 6: List plans failed with status code ${LIST_RESPONSE_CODE}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # Test 7: Get Plan Details
        print_info "Test 7: Testing GET /api/v1/plans/${PLAN_ID}..."
        GET_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${API_BASE_URL}/api/v1/plans/${PLAN_ID}" \
            -H "Authorization: Bearer ${JWT_TOKEN}")
        if [ "$GET_RESPONSE" -eq 200 ]; then
            print_pass "Test 7: Get plan details successful."
        else
            print_fail "Test 7: Get plan details failed with status code ${GET_RESPONSE}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # Test 8: Share Plan (Public)
        print_info "Test 8: Testing GET /api/v1/share/plans/${PLAN_ID}..."
        SHARE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${API_BASE_URL}/api/v1/share/plans/${PLAN_ID}")
        if [ "$SHARE_RESPONSE" -eq 200 ]; then
            print_pass "Test 8: Share plan successful."
        else
            print_fail "Test 8: Share plan failed with status code ${SHARE_RESPONSE}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # Test 9: Update Plan
        print_info "Test 9: Testing PUT /api/v1/plans/${PLAN_ID}..."
        UPDATE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${API_BASE_URL}/api/v1/plans/${PLAN_ID}" \
            -H "Authorization: Bearer ${JWT_TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{"name": "Updated Test Plan", "data": "updated-data"}')
        if [ "$UPDATE_RESPONSE" -eq 200 ]; then
            print_pass "Test 9: Update plan successful."
        else
            print_fail "Test 9: Update plan failed with status code ${UPDATE_RESPONSE}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # Test 10: Delete Plan
        print_info "Test 10: Testing DELETE /api/v1/plans/${PLAN_ID}..."
        DELETE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${API_BASE_URL}/api/v1/plans/${PLAN_ID}" \
            -H "Authorization: Bearer ${JWT_TOKEN}")
        if [ "$DELETE_RESPONSE" -eq 200 ]; then
            print_pass "Test 10: Delete plan successful."
        else
            print_fail "Test 10: Delete plan failed with status code ${DELETE_RESPONSE}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # Test 11: Verify Deletion
        print_info "Test 11: Verifying deletion of plan ${PLAN_ID}..."
        VERIFY_DELETE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${API_BASE_URL}/api/v1/plans/${PLAN_ID}" \
            -H "Authorization: Bearer ${JWT_TOKEN}")
        if [ "$VERIFY_DELETE_RESPONSE" -eq 404 ]; then
            print_pass "Test 11: Plan correctly deleted (received 404 Not Found)."
        else
            print_fail "Test 11: Verification of deletion failed. Expected 404, but got ${VERIFY_DELETE_RESPONSE}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # Test 12: AI Session Management
        print_step "AI Session Tests"

        # 12.1 Set Session
        print_info "Test 12.1: POST /api/v1/ai/session..."
        SESSION_PAYLOAD='{"messages":[{"role":"user","content":"Hello"},{"role":"assistant","content":"Hi"}]}'
        SET_SESSION_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_BASE_URL}/api/v1/ai/session" \
            -H "Authorization: Bearer ${JWT_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$SESSION_PAYLOAD")
        SET_SESSION_STATUS=$(echo "$SET_SESSION_RESPONSE" | tail -n 1)

        if [ "$SET_SESSION_STATUS" -eq 200 ]; then
            print_pass "Test 12.1: Session saved successfully."
        else
            print_fail "Test 12.1: Failed to save session. Status: $SET_SESSION_STATUS"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi

        # 12.2 Get Session
        print_info "Test 12.2: GET /api/v1/ai/session..."
        GET_SESSION_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${API_BASE_URL}/api/v1/ai/session" \
            -H "Authorization: Bearer ${JWT_TOKEN}")
        GET_SESSION_BODY=$(echo "$GET_SESSION_RESPONSE" | head -n -1)
        GET_SESSION_STATUS=$(echo "$GET_SESSION_RESPONSE" | tail -n 1)

        if [ "$GET_SESSION_STATUS" -eq 200 ]; then
            # Verify content using jq
            MESSAGE_COUNT=$(echo "$GET_SESSION_BODY" | jq '.messages | length')
            FIRST_ROLE=$(echo "$GET_SESSION_BODY" | jq -r '.messages[0].role')

            if [ "$MESSAGE_COUNT" -eq 2 ] && [ "$FIRST_ROLE" = "user" ]; then
                print_pass "Test 12.2: Session retrieved successfully with correct content."
            else
                print_fail "Test 12.2: Session retrieved but content mismatch. Body: $GET_SESSION_BODY"
                FAIL_COUNT=$((FAIL_COUNT + 1))
            fi
        else
            print_fail "Test 12.2: Failed to get session. Status: $GET_SESSION_STATUS"
            FAIL_COUNT=$((FAIL_COUNT + 1))
        fi
    fi
fi

# 3. Final Report
print_step "Test summary"
if [ "$FAIL_COUNT" -eq 0 ]; then
    print_pass "All tests passed successfully!"
    exit 0
else
    print_fail "${FAIL_COUNT} test(s) failed."
    exit 1
fi
