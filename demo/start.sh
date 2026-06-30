#!/bin/sh
set -e

# Reset to the baked seed on every boot → clean demo each restart.
rm -rf /data
cp -r /seed-data /data

# Sync server (holds the demo budget) in the background. Paths are set
# explicitly to match how the seed was generated (generate-seed.mjs), so the
# baked budget is found regardless of default-path derivation.
echo "seed contents:" && ls -R /data 2>/dev/null | head -40
export ACTUAL_PORT=5006
export ACTUAL_DATA_DIR=/data
export ACTUAL_SERVER_FILES=/data/server-files
export ACTUAL_USER_FILES=/data/user-files
actual-server &

# Wait until it accepts connections (IPv4, matching ACTUAL_SERVER_URL).
until wget -qO- http://127.0.0.1:5006/ >/dev/null 2>&1; do
  echo "waiting for actual-server..."
  sleep 1
done
echo "actual-server is up"

# REST wrapper in the foreground, exposed on 7860.
cd /usr/src/app
exec ./entrypoint.sh
