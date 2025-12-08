#!/bin/bash

# --- Check if running from project root ---
if [ ! -f "scripts/update_version.sh" ] || [ ! -d "backend" ] || [ ! -d "static" ]; then
    echo "Error: This script must be run from the project root directory."
    echo "Please 'cd' to the root of the 'roadbook' project and run again:"
    echo "  ./scripts/update_version.sh"
    exit 1
fi

INDEX_FILE="static/index.html"
ORIGINAL_SPAN='<span id="version-display"></span>'

# 检测操作系统类型，用于sed兼容性处理
OS_TYPE=$(uname -s)

# Function to display help message
display_help() {
    echo "Usage: $0 [OPTION]"
    echo ""
    echo "Update the version string in index.html with the current Git commit hash or tag."
    echo ""
    echo "Options:"
    echo "  reset     Revert index.html to its original state (no version displayed)."
    echo "  -h, --help  Display this help message."
    echo ""
    echo "If no option is provided, the script will update the version string."
    exit 0
}

# Argument parsing
if [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
    display_help
fi

# Reset mode: if the first argument is 'reset', revert the span to its original state
if [ "$1" == "reset" ]; then
    # This sed command finds the version span (regardless of its content or class)
    # and replaces it with the original, empty, class-less span.
    # Using '#' as a delimiter to avoid issues with '/' or '>' in HTML tags
    if [ "$OS_TYPE" = "Darwin" ]; then
        # macOS需要特殊的sed语法 -i ''
        sed -i '' -E 's#<span id="version-display"[^>]*>.*</span>#<span id="version-display"></span>#g' "$INDEX_FILE"
    else
        # Linux和其他系统
        sed -i -E 's#<span id="version-display"[^>]*>.*</span>#<span id="version-display"></span>#g' "$INDEX_FILE"
    fi
    echo "Version display has been reset in $INDEX_FILE"
    exit 0
fi

# Default mode: Update version
# Get the git version string using describe for a more readable version
GIT_VERSION=$(git describe --tags --always)
if [ -z "$GIT_VERSION" ]; then
    echo "Error: Not a git repository or no commits yet."
    exit 1
fi

# The version string is the git version itself, no 'v' prefix needed here
VERSION_STRING="$GIT_VERSION"

# Check if the index file exists
if [ ! -f "$INDEX_FILE" ]; then
    echo "Error: $INDEX_FILE not found."
    exit 1
fi

# Use sed to update the version and add the visibility class.
# This works by finding the empty version-display span and replacing its outer HTML
# with the version string and the class attribute.
if [ "$OS_TYPE" = "Darwin" ]; then
    # macOS需要特殊的sed语法 -i ''
    sed -i '' -E 's#<span id="version-display"></span>#<span id="version-display" class="version-visible">'${VERSION_STRING}'</span>#g' "$INDEX_FILE"
else
    # Linux和其他系统
    sed -i -E 's#<span id="version-display"></span>#<span id="version-display" class="version-visible">'${VERSION_STRING}'</span>#g' "$INDEX_FILE"
fi

echo "Successfully updated version in $INDEX_FILE to $VERSION_STRING"

# A small check to see if it worked.
if ! grep -q "version-visible" "$INDEX_FILE"; then
    echo "Warning: Failed to make version visible. The span tag might not have been found correctly."
fi
