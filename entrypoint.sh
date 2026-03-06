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

# Grant access to DRI render devices for VAAPI hardware acceleration
for dev in /dev/dri/renderD* /dev/dri/card*; do
    if [ -e "$dev" ]; then
        DEV_GID=$(stat -c '%g' "$dev")
        if [ "$DEV_GID" != "0" ] && [ "$DEV_GID" != "$PGID" ]; then
            DEV_GRPNAME=$(getent group "$DEV_GID" | cut -d: -f1)
            if [ -z "$DEV_GRPNAME" ]; then
                DEV_GRPNAME="devgid_${DEV_GID}"
                addgroup -g "$DEV_GID" "$DEV_GRPNAME" 2>/dev/null || true
            fi
            addgroup "$USERNAME" "$DEV_GRPNAME" 2>/dev/null || true
        fi
    fi
done

# Only fix /data ownership if the directory itself has wrong ownership.
# Avoids expensive recursive walk on large data volumes during every restart.
DATA_OWNER=$(stat -c '%u:%g' /data 2>/dev/null || echo "")
if [ "$DATA_OWNER" != "$PUID:$PGID" ]; then
    chown -R "$PUID:$PGID" /data
else
    # Ensure key files are owned correctly without a full recursive walk
    find /data -maxdepth 1 ! -user "$PUID" -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
fi

exec su-exec "$PUID:$PGID" "$@"
