FROM nginx:alpine

# Copy static files
COPY static/ /usr/share/nginx/html

# Copy the backend executable, which is built locally
# and located in the 'backend' directory.
COPY backend/roadbook-api /usr/local/bin/roadbook-api

# Create a directory for the backend data
RUN mkdir -p /app/data && chown nginx:nginx /app/data

# Copy backend config
RUN mkdir -p /app/configs
COPY backend/configs/config.json /app/configs/config.json

# Copy the custom Nginx configuration
COPY nginx.prod.conf /etc/nginx/nginx.conf

# Copy the entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port 80 for Nginx
EXPOSE 80

# Run the entrypoint script
CMD ["/docker-entrypoint.sh"]