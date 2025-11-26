#!/bin/bash
# Exit immediately if a command exits with a non-zero status.
set -e

echo "--- Building statically linked Go binary ---"
# Build the static binary inside the backend directory
# CGO_ENABLED=0 is crucial for creating a static binary that works in Alpine
(cd backend && CGO_ENABLED=0 go build -o roadbook-api ./cmd/roadbook-api/main.go)
echo "Static binary created at backend/roadbook-api"

echo ""
echo "--- Building Docker image ---"
docker build -t roadbook .

echo ""
echo "--- Build complete! ---"
echo "You can now run your application with:"
echo "docker run -d -p 5215:80 roadbook"
