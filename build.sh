#!/bin/bash
# Exit immediately if a command exits with a non-zero status.
set -e

# --- Check if running from project root ---
if [ ! -f "build.sh" ] || [ ! -d "backend" ] || [ ! -d "static" ]; then
    echo "Error: This script must be run from the project root directory."
    echo "Please 'cd' to the root of the 'roadbook' project and run again:"
    echo "  ./build.sh"
    exit 1
fi

echo "--- Building statically linked Go binary ---"
# Build the static binary inside the backend directory
# CGO_ENABLED=0 is crucial for creating a static binary that works in Alpine
(cd backend && CGO_ENABLED=0 go build -o roadbook-api ./cmd/roadbook-api/main.go)
echo "Static binary created at backend/roadbook-api"

echo ""
echo "--- Building Docker image ---"
docker build -f./Dockerfile.local -t roadbook .

echo ""
echo "--- Build complete! ---"
echo "You can now run your application with:"
echo "docker run -d -p 5215:80 roadbook"
