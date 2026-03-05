#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}
GROUPNAME=cineforge
USERNAME=cineforge

if ! getent group "$PGID" >/dev/null 2>&1; then
    addgroup -g "$PGID" "$GROUPNAME"
else
    GROUPNAME=$(getent group "$PGID" | cut -d: -f1)
fi

if ! id "$USERNAME" >/dev/null 2>&1; then
    adduser -D -u "$PUID" -G "$GROUPNAME" -h /app "$USERNAME"
else
    usermod -u "$PUID" "$USERNAME" 2>/dev/null || true
fi

chown -R "$PUID:$PGID" /data

exec su-exec "$PUID:$PGID" "$@"
