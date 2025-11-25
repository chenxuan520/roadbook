#!/bin/sh

# Start the backend API in the background
/usr/local/bin/roadbook-api &

# Start nginx in the foreground
nginx -g 'daemon off;'
