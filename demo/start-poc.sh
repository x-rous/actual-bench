#!/bin/sh
set -eu

: "${API_KEY:?API_KEY is required}"
: "${ACTUAL_SERVER_PASSWORD:?ACTUAL_SERVER_PASSWORD is required}"
export DEMO_API_KEY="$API_KEY"

# The POC only uses image-owned data; never point this at a real data mount.
rm -rf /data
mkdir -p /data/actual /data/bench
cp -R /seed-data/actual/. /data/actual/
# A future generated Bench seed can be baked alongside the Actual seed.
if [ -f /seed-data/bench.sqlite ]; then
  cp /seed-data/bench.sqlite "$ACTUAL_BENCH_DB_PATH"
fi

pids=""
cleanup() {
  trap - EXIT TERM INT
  [ -z "$pids" ] || kill $pids 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM INT

export ACTUAL_PORT=5006 ACTUAL_DATA_DIR=/data/actual
export ACTUAL_SERVER_FILES=/data/actual/server-files ACTUAL_USER_FILES=/data/actual/user-files
actual-server &
pids="$pids $!"

wait_http() {
  url="$1"
  i=0
  until wget -qO /dev/null "$url"; do
    for pid in $pids; do
      kill -0 "$pid" 2>/dev/null || { echo "service exited during startup" >&2; exit 1; }
    done
    i=$((i + 1))
    [ "$i" -lt 120 ] || { echo "timed out waiting for $url" >&2; exit 1; }
    sleep 1
  done
}
wait_http http://127.0.0.1:5006/

(cd /usr/src/app && PORT=5007 exec ./entrypoint.sh) &
pids="$pids $!"
# This performs a real authenticated open of each budget, serially.
node /check-budgets.mjs --url http://127.0.0.1:5007 --timeout 120000

(cd /bench && PORT=7860 HOSTNAME=0.0.0.0 exec /opt/bench-node/node server.js) &
pids="$pids $!"
wait_http http://127.0.0.1:7860/api/health
printf '%s\n' 'Demo services ready'
# Fail the container if any child dies; the platform can then restart all three.
while :; do
  for pid in $pids; do
    kill -0 "$pid" 2>/dev/null || { echo "demo service exited" >&2; exit 1; }
  done
  sleep 2
done
