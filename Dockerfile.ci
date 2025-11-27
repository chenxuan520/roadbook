# Dockerfile for CI/CD - includes the Go build environment.
# This file compiles the Go binary and then packages it into a final nginx image.

# ---- Builder Stage ----
# Use a specific Go version on Alpine for a smaller build image.
FROM golang:1.21-alpine AS builder

# Set the working directory inside the container
WORKDIR /src

# Copy go.mod and go.sum to leverage Docker cache
COPY backend/go.mod backend/go.sum ./
# Download dependencies
RUN go mod download

# Copy the entire backend source code
COPY backend/ ./

# Build the Go binary.
# CGO_ENABLED=0 creates a static binary without C dependencies.
# -w -s flags strip debug info, reducing the binary size.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/roadbook-api ./cmd/roadbook-api/main.go


# ---- Final Stage ----
# Use the same nginx:alpine base as the local Dockerfile.
FROM nginx:alpine

# Copy static files from the build context
COPY static/ /usr/share/nginx/html

# Copy the compiled backend executable from the builder stage
COPY --from=builder /app/roadbook-api /usr/local/bin/roadbook-api

# Create a directory for backend data and set ownership to the nginx user
RUN mkdir -p /app/data && chown nginx:nginx /app/data

# Create a directory for backend configs
RUN mkdir -p /app/configs
# Copy the config files from the build context
COPY backend/configs/config.json /app/configs/config.json
COPY backend/configs/airports.json /app/configs/airports.json
COPY backend/configs/station_geo.json /app/configs/station_geo.json

# Copy the custom Nginx configuration
COPY nginx.prod.conf /etc/nginx/nginx.conf

# Copy the entrypoint script and make it executable
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port 80 for Nginx
EXPOSE 80

# Set the default command to run the entrypoint script
CMD ["/docker-entrypoint.sh"]
