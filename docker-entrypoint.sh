#!/bin/sh

# Start nginx in the background
nginx -g 'daemon off;' &

# Start the backend API in the foreground
cd /app
/usr/local/bin/roadbook-api

