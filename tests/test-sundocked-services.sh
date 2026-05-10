#!/usr/bin/env bash
# Service supervisor integration test. Covers: add, start, status, stop,
# restart, list, logs, remove. The supervisor is implemented via shell
# scripts (svcStartScript / svcStopScript / svcStatusScript) inside the
# container, with PID files in /var/run/sundocked/ and logs in
# /var/log/sundocked/.

set -euo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
to_native() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || echo "$1"; }
SUNDOCKED="$(to_native "$ROOT/bin/sundocked.js")"
IMAGE="alpine:3.20"

if ! command -v docker >/dev/null; then
    echo "skip: docker not installed"
    exit 0
fi
if ! docker info >/dev/null 2>&1; then
    echo "skip: docker daemon not running"
    exit 0
fi

WORK="$(mktemp -d)"
cd "$WORK"

cleanup() {
    node "$SUNDOCKED" --image "$IMAGE" reset >/dev/null 2>&1 || true
    cd /
    rm -rf "$WORK"
}
trap cleanup EXIT

assert_eq() {
    if [[ "$1" != "$2" ]]; then
        echo "FAIL: expected '$2', got '$1'" >&2
        exit 1
    fi
}

assert_contains() {
    if ! echo "$1" | grep -qF "$2"; then
        echo "FAIL: expected '$2' in:" >&2
        echo "$1" >&2
        exit 1
    fi
}

node "$SUNDOCKED" --image "$IMAGE" reset >/dev/null 2>&1 || true
node "$SUNDOCKED" --image "$IMAGE" exec -- echo bootstrap >/dev/null

# Service supervisor stores cmd as a space-joined string and re-runs it
# via "sh -c '<cmd>'", so passing complex shell syntax via argv loses
# quoting. The clean way (and the way recipes do it) is to ship a script
# file inside the container and reference it by path. The script writes
# to stdout — the supervisor pipes that into /var/log/sundocked/<name>.log
# which is what "service logs" reads.
node "$SUNDOCKED" --image "$IMAGE" exec -- sh -c 'cat > /usr/local/bin/sd-ticker.sh <<SCRIPT
#!/bin/sh
while :; do echo tick; sleep 1; done
SCRIPT
chmod +x /usr/local/bin/sd-ticker.sh' >/dev/null

# 1. Register the service with a single-token cmd.
node "$SUNDOCKED" service add ticker -- /usr/local/bin/sd-ticker.sh >/dev/null

# 2. List shows it as registered (--json stable interface).
list=$(node "$SUNDOCKED" service list --json)
echo "$list" | node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  if (!Array.isArray(r) || r.length !== 1) { console.error("expected 1 service, got", r); process.exit(1); }
  if (r[0].name !== "ticker") { console.error("wrong name:", r[0]); process.exit(2); }
'

# 3. Start.
node "$SUNDOCKED" service start ticker >/dev/null

# Give the service a moment to actually fork + write its PID + spin up.
sleep 2

# 4. Status shows running.
status_json=$(node "$SUNDOCKED" service status ticker --json)
state=$(echo "$status_json" | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  const r = Array.isArray(d) ? d[0] : d;
  process.stdout.write(String(r.state || ""));
')
assert_eq "$state" "running"

# 5. Logs subcommand returns recent stdout. We slept long enough above
#    that at least one "tick" line should be in there.
logs=$(node "$SUNDOCKED" service logs ticker 2>/dev/null | head -5 || true)
assert_contains "$logs" "tick"

# 7. Restart — PID changes.
pid1=$(echo "$status_json" | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  const r = Array.isArray(d) ? d[0] : d;
  process.stdout.write(String(r.pid || ""));
')
node "$SUNDOCKED" service restart ticker >/dev/null
sleep 1
pid2=$(node "$SUNDOCKED" service status ticker --json | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  const r = Array.isArray(d) ? d[0] : d;
  process.stdout.write(String(r.pid || ""));
')
if [[ -z "$pid1" || -z "$pid2" || "$pid1" == "$pid2" ]]; then
    echo "FAIL: restart should change PID; pid1=$pid1 pid2=$pid2" >&2
    exit 1
fi

# 8. Stop.
node "$SUNDOCKED" service stop ticker >/dev/null
sleep 1
state_after=$(node "$SUNDOCKED" service status ticker --json | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  const r = Array.isArray(d) ? d[0] : d;
  process.stdout.write(String(r.state || ""));
')
assert_eq "$state_after" "stopped"

# 9. Remove unregisters from config (and from list output).
node "$SUNDOCKED" service remove ticker >/dev/null
list_after=$(node "$SUNDOCKED" service list --json)
echo "$list_after" | node -e '
  const r = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  if (Array.isArray(r) && r.length !== 0) { console.error("expected 0 services after remove, got", r); process.exit(1); }
'

echo "test-sundocked-services: passed (9 assertions)"
