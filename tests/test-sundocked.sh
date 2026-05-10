#!/usr/bin/env bash
# Integration test for the bare sundocked CLI. Needs a working Docker daemon.
#
# Covers:
#   1. Fresh container creation from alpine:3.20
#   2. exec returns stdout and propagates exit codes
#   3. /work bind-mount visible inside container
#   4. /root persistence between restarts
#   5. status --json structure
#   6. reset cleans up

set -euo pipefail

# Disable Git Bash / MSYS path conversion so /work-style paths inside docker
# arguments are passed through as-is (otherwise MSYS rewrites "/work" to
# "C:/Program Files/Git/work/..."). No effect on Linux CI runners.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Native paths for Windows (when running under MSYS / Git Bash) so node.exe
# can find the script. cygpath is a no-op on real Linux.
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

# 1. Fresh creation
node "$SUNDOCKED" --image "$IMAGE" reset >/dev/null 2>&1 || true
out=$(node "$SUNDOCKED" --image "$IMAGE" exec -- echo hello)
assert_eq "$out" "hello"

# 2. Exit code propagation
set +e
node "$SUNDOCKED" --image "$IMAGE" exec -- sh -c 'exit 42' >/dev/null 2>&1
code=$?
set -e
assert_eq "$code" "42"

# 3. /work bind-mount
echo "host-content" > host-file.txt
got=$(node "$SUNDOCKED" --image "$IMAGE" exec -- cat /work/host-file.txt)
assert_eq "$got" "host-content"

# 4. /root persistence: write file, stop, start, read back
node "$SUNDOCKED" --image "$IMAGE" exec -- sh -c 'echo persisted > /root/marker' >/dev/null
node "$SUNDOCKED" --image "$IMAGE" stop >/dev/null
node "$SUNDOCKED" --image "$IMAGE" start >/dev/null
got=$(node "$SUNDOCKED" --image "$IMAGE" exec -- cat /root/marker)
assert_eq "$got" "persisted"

# 5. status --json is valid JSON with expected keys
status=$(node "$SUNDOCKED" --image "$IMAGE" status --json)
echo "$status" | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  if (d.state !== "running") { console.error("state=" + d.state); process.exit(1); }
  if (!d.mounts.some(m => m.container === "/work")) { console.error("no /work mount"); process.exit(2); }
'

# 6. Reset removes the container
node "$SUNDOCKED" --image "$IMAGE" reset >/dev/null
state=$(node "$SUNDOCKED" --image "$IMAGE" status --json | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf-8"));
  process.stdout.write(d.state);
')
assert_eq "$state" "missing"

echo "test-sundocked: passed (6 assertions)"
