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

# --- Version info (for -ldflags -X injection) ---
VERSION=$(git describe --tags --always 2>/dev/null || echo dev)
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
BUILDTIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)

LD_FLAGS="-s -w \
  -X main.Version=${VERSION} \
  -X main.Commit=${COMMIT} \
  -X main.BuildTime=${BUILDTIME} \
  -X github.com/chenxuan520/roadmap/backend/internal/handler.Version=${VERSION} \
  -X github.com/chenxuan520/roadmap/backend/internal/handler.Commit=${COMMIT} \
  -X github.com/chenxuan520/roadmap/backend/internal/handler.BuildTime=${BUILDTIME}"

CGO_ENABLED=0 go build -ldflags "$LD_FLAGS" -o roadbook-api ./cmd/roadbook-api

echo "Static binary created at $(pwd)/roadbook-api"