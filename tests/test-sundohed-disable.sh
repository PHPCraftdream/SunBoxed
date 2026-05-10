#!/usr/bin/env bash
# Verify that sundohed correctly skips DoH bootstrap when the proxy is
# disabled by config. We exercise the network=host case end-to-end:
#
#   1. Create a container with --host-network (persists network=host
#      into config.ktav).
#   2. Run sundohed against the same dir; expect "DNS proxy: skipped"
#      with the host-network reason — no /opt/sundocked, no resolv.conf
#      rewrite.

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
        echo "FAIL: expected '$2' in:" >&2
        echo "$1" >&2
        exit 1
    fi
}

assert_not_contains() {
    if echo "$1" | grep -qF "$2"; then
        echo "FAIL: did NOT expect '$2' in:" >&2
        echo "$1" >&2
        exit 1
    fi
}

# Wipe any prior state, then create the container in host-network mode.
node "$SUNDOCKED" --image "$IMAGE" reset >/dev/null 2>&1 || true
node "$SUNDOCKED" --image "$IMAGE" --host-network exec -- echo bootstrap >/dev/null

# Now run sundohed — bootstrap should report the skip reason.
out=$(node "$SUNDOHED" --image "$IMAGE" exec -- echo ok 2>&1)
assert_contains "$out" "DNS proxy: skipped"
assert_contains "$out" "network=host"

# /opt/sundocked must NOT exist (proxy was skipped, not silently broken).
files=$(node "$SUNDOHED" --image "$IMAGE" exec -- sh -c 'ls /opt/sundocked 2>&1 || echo MISSING')
assert_contains "$files" "MISSING"

# resolv.conf must NOT have been rewritten to 127.0.0.1.
resolv=$(node "$SUNDOHED" --image "$IMAGE" exec -- cat /etc/resolv.conf)
assert_not_contains "$resolv" "nameserver 127.0.0.1"

echo "test-sundohed-disable: passed (host-network correctly skips DoH bootstrap)"
