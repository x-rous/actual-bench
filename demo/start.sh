#!/bin/sh
set -e

# Reset to the baked seed on every boot → clean demo each restart.
rm -rf /data
cp -r /seed-data /data

# Sync server (holds both demo budgets) in the background. Paths are set
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

# Open every budget once the REST wrapper is answering. Two reasons, and the
# second is why it exists: it warms the API's budget cache so the first visitor
# does not pay for the download, and it puts "can this budget actually be
# opened?" in the boot log. A backend can list a budget it cannot serve - that is
# precisely how the Tracking demo stayed broken from one deploy to the next while
# the Envelope demo worked - and nothing said so until someone clicked it.
#
# Never blocks the boot: it runs in the background and --warm always exits 0, so
# a budget that fails cannot stop the ones that work from being served.
(node /check-budgets.mjs --warm || true) &

# REST wrapper in the foreground, exposed on 7860.
cd /usr/src/app
exec ./entrypoint.sh
