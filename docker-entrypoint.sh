#!/bin/sh
set -e

# Fix permissions on /data directory to ensure bun user can write to it
# Docker volumes are mounted as root:root at runtime, overriding Dockerfile permissions
if [ -d "/data" ]; then
  chown -R bun:bun /data
fi

# Switch to bun user and execute the main command
exec su-exec bun "$@"
