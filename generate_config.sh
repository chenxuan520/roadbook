#!/bin/bash

# This script interactively generates a config.json file for the backend.

# --- Helper Functions ---
function print_info() {
    echo "--- Roadbook Config Generator ---"
    echo "This script will help you create a 'config.json' for the backend service."
    echo
}

# --- Default values ---
DEFAULT_PORT="5436"
DEFAULT_USERNAME="admin"
CONFIG_FILE_PATH="backend/configs/config.json"

# --- Main Script ---
print_info

# 1. Get Port
read -p "Enter the port number for the server [${DEFAULT_PORT}]: " port
port=${port:-$DEFAULT_PORT}

# 2. Get Username
read -p "Enter the admin username [${DEFAULT_USERNAME}]: " username
username=${username:-$DEFAULT_USERNAME}

# 3. Get Password
read -s -p "Enter the admin password (will not be displayed): " password
echo
if [ -z "$password" ]; then
    echo "Error: Password cannot be empty."
    exit 1
fi

# 4. Get Allowed Origins
read -p "Enter allowed origins, separated by commas (e.g., http://localhost:3000,https://my-domain.com): " origins_input
IFS=',' read -r -a origins_array <<< "$origins_input"
origins_json_array=""
for i in "${!origins_array[@]}"; do
    # Trim whitespace
    origin=$(echo "${origins_array[$i]}" | xargs)
    if [ -n "$origin" ]; then
        if [ -n "$origins_json_array" ]; then
            origins_json_array+=', '
        fi
        origins_json_array+="\"$origin\""
    fi
done

# 5. Allow Null Origin for Dev
read -p "Allow 'null' origin for local file testing (file://...)? (y/n) [n]: " allow_null_input
allow_null_bool="false"
if [[ "$allow_null_input" =~ ^[Yy]$ ]]; then
    allow_null_bool="true"
fi

# --- Generate Values ---
echo
echo "Generating secure values..."

# Generate JWT Secret
echo " - Generating random JWT secret..."
jwt_secret=$(openssl rand -hex 32)
if [ $? -ne 0 ]; then
    echo "Error: Failed to generate JWT secret. Please ensure 'openssl' is installed."
    exit 1
fi

# Generate salt and hash the password
echo " - Hashing password with salted SHA256..."
salt=$(openssl rand -hex 16)
hashed_password=$(echo -n "${salt}${password}" | sha256sum | head -c 64)
if [ $? -ne 0 ]; then
    echo "Error: Failed to hash password. Please ensure 'sha256sum' is installed."
    exit 1
fi

# --- Create JSON and Write to File ---
echo " - Creating JSON configuration..."

# Create directory if it doesn't exist
mkdir -p "$(dirname "$CONFIG_FILE_PATH")"

# Write the config file
generated_json_content=$(cat << JSON_EOL
{
  "port": ${port},
  "allowed_origins": [${origins_json_array}],
  "allow_null_origin_for_dev": ${allow_null_bool},
  "jwtSecret": "${jwt_secret}",
  "users": {
    "${username}": {
      "salt": "${salt}",
      "hash": "${hashed_password}"
    }
  }
}
JSON_EOL
)

echo "--- Generated config.json content ---"
echo "${generated_json_content}"
echo "-------------------------------------"

echo "${generated_json_content}" > "$CONFIG_FILE_PATH"

echo
echo "Success! Configuration file written to '${CONFIG_FILE_PATH}'."
echo "You can now start the backend server."
