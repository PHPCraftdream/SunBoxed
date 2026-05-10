#!/usr/bin/env bash
# Integration test for the sundohed wrapper (sundocked + DoH proxy).
# Needs Docker.
#
# Covers:
#   1. Fresh container gets /opt/sundocked/{init.sh,sundocked-dns-linux-*}
#   2. /etc/resolv.conf is rewritten to nameserver 127.0.0.1
#   3. Real DNS resolves through the proxy (api.anthropic.com → public IP, not 127.x)
#   4. Bootstrap is idempotent: calling sundohed exec twice doesn't break anything
#      and the second call uses the fast path

set -euo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
to_native() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || echo "$1"; }
SUNDOHED="$(to_native "$ROOT/bin/sundohed.js")"
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

assert_contains() {
    if ! echo "$1" | grep -qF "$2"; then
        echo "FAIL: expected output to contain '$2', got:" >&2
        echo "$1" >&2
        exit 1
    fi
}

assert_not_contains() {
    if echo "$1" | grep -qF "$2"; then
        echo "FAIL: expected output NOT to contain '$2', got:" >&2
        echo "$1" >&2
        exit 1
    fi
}

# Start clean
node "$SUNDOCKED" --image "$IMAGE" reset >/dev/null 2>&1 || true

# 1+2. Fresh bootstrap should print the proxy ready line and install the binary.
out=$(node "$SUNDOHED" --image "$IMAGE" exec -- sh -c 'cat /etc/resolv.conf; echo ===; ls /opt/sundocked/' 2>&1)
assert_contains "$out" "DNS proxy:"
assert_contains "$out" "nameserver 127.0.0.1"
assert_contains "$out" "init.sh"
assert_contains "$out" "sundocked-dns-linux-"

# 3. Real DNS — getent ahosts shouldn't return 127.x synthetic addresses.
resolved=$(node "$SUNDOHED" --image "$IMAGE" exec -- getent ahosts api.anthropic.com 2>&1 || true)
assert_not_contains "$resolved" "127.0.0."
assert_not_contains "$resolved" "127.128."
# Must contain SOMETHING (real IP)
if [[ -z "$resolved" ]]; then
    echo "FAIL: api.anthropic.com did not resolve through DoH proxy" >&2
    exit 1
fi

# 4. Idempotent: second call should also succeed and report ready (fast path).
out2=$(node "$SUNDOHED" --image "$IMAGE" exec -- echo second-ok 2>&1)
assert_contains "$out2" "DNS proxy:"
assert_contains "$out2" "second-ok"

echo "test-sundohed: passed (resolved api.anthropic.com via DoH)"
