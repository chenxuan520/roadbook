#!/bin/bash
set -e

# --- Detect execution directory and cd to backend if needed ---
if [ -d "backend" ] && [ -f "build.sh" ]; then
  # We are in the project root
  echo "Running from project root. Changing to backend directory..."
  cd backend
elif [ -f "go.mod" ] && [ -d "cmd" ]; then
  # We are in the backend directory, no change needed.
  echo "Running from backend directory."
else
  echo "Error: This script must be run from the project root or the 'backend' directory."
  exit 1
fi

# --- Build ---
# At this point, we are guaranteed to be inside the 'backend' directory.
echo "--- Building backend Go binary ---"
CGO_ENABLED=0 go build -o roadbook-api ./cmd/roadbook-api/main.go
echo "Static binary created at $(pwd)/roadbook-api"