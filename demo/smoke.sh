#!/usr/bin/env bash
set -euo pipefail
image=actual-bench-demo
name=actual-bench-demo
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then docker logs "$name" 2>&1 || true; fi
  docker rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --cpus=2 --memory=16g -p 127.0.0.1:17860:7860 \
  -e API_KEY=ci-demo-key -e ACTUAL_SERVER_PASSWORD=demo-budget-public "$image"
wait_ready() {
  for _ in $(seq 1 180); do
    if curl -fsS http://127.0.0.1:17860/api/health >/dev/null; then return; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then docker logs "$name"; return 1; fi
    sleep 1
  done
  docker logs "$name"
  return 1
}
check() {
  wait_ready
  curl -fsS http://127.0.0.1:17860/api/demo | node -e '
    let s=""; process.stdin.on("data", c => s+=c).on("end", () => {
      const d=JSON.parse(s); if(d.budgets?.length !== 2 || d.baseUrl !== "http://127.0.0.1:5007") process.exit(1);
    });'
  docker exec "$name" node /check-budgets.mjs --url http://127.0.0.1:5007 --timeout 120000
  # Exercise the same Bench proxy and queue used by the browser for each budget.
  for id in 7d243b3e-d2dc-4863-be75-b1fd85b77c2b 5e48dea9-96ef-4f5e-ba26-10a5af1e4da2; do
    curl -fsS http://127.0.0.1:17860/api/proxy -H 'content-type: application/json' \
      --data "{\"connection\":{\"baseUrl\":\"http://127.0.0.1:5007\",\"apiKey\":\"ci-demo-key\",\"budgetSyncId\":\"$id\"},\"path\":\"/accounts\"}" |
      node -e 'let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{if(!JSON.parse(s).data?.length) process.exit(1)})'
  done
  node demo/check-metadata.mjs http://127.0.0.1:17860
  docker exec "$name" sh -c 'test -n "$(find /data/backups -type f -name "*.sqlite" -print -quit)"'
}
check
if [ "${DEMO_BROWSER_SMOKE:-0}" = 1 ]; then node demo/browser-smoke.cjs; fi
# Write a real transaction and a committed SQLite marker before restarting.
reset_marker="demo-reset-$(date +%s)-$$"
node demo/check-reset.mjs write "$reset_marker"
docker exec "$name" sh -c 'touch /data/backups/demo-reset-marker'
docker exec "$name" sh -c 'cd /bench && /opt/bench-node/node -e "const D=require(\"better-sqlite3\"); const d=new D(process.env.ACTUAL_BENCH_DB_PATH); d.exec(\"CREATE TABLE poc_reset_marker (id INTEGER)\"); d.close()"'
docker restart -t 20 "$name" >/dev/null
check
node demo/check-reset.mjs verify "$reset_marker"
docker exec "$name" sh -c 'test ! -e /data/backups/demo-reset-marker'
docker exec "$name" sh -c 'cd /bench && /opt/bench-node/node -e "const D=require(\"better-sqlite3\"); const d=new D(process.env.ACTUAL_BENCH_DB_PATH); if(d.prepare(\"SELECT name FROM sqlite_master WHERE name = ?\").get(\"poc_reset_marker\")) process.exit(1); d.close()"'
docker stats --no-stream "$name"
