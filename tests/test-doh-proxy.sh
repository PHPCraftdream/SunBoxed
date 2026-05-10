#!/usr/bin/env bash
# Tests the standalone Go DoH proxy without Docker. Runs the Linux amd64
# binary on a non-privileged port, sends raw DNS wire-format queries via
# /dev/udp, and verifies a valid DNS response comes back.
#
# Skipped automatically when there is no usable amd64 binary (e.g. on
# arm64 hosts without local cross-build).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/dns-proxy-bin/sundocked-dns-linux-amd64"
PORT=15353
LOGFILE="$(mktemp)"

if [[ "$(uname -m)" != "x86_64" || "$(uname -s)" != "Linux" ]]; then
    echo "skip: this test runs only on linux/amd64 hosts (got $(uname -s)/$(uname -m))"
    exit 0
fi
if [[ ! -x "$BIN" ]]; then
    chmod +x "$BIN" 2>/dev/null || true
fi
if [[ ! -x "$BIN" ]]; then
    echo "skip: $BIN not executable or missing"
    exit 0
fi

cleanup() {
    [[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null || true
    rm -f "$LOGFILE"
}
trap cleanup EXIT

# Use Cloudflare-only and a fast stats interval so the log shows outcomes quickly.
SUNDOCKED_DNS_BIND=127.0.0.1:$PORT \
SUNDOCKED_STATS_INTERVAL=1s \
"$BIN" >"$LOGFILE" 2>&1 &
PROXY_PID=$!

# Wait until the listener is up
for i in $(seq 1 30); do
    if awk -v port=$(printf '%04X' "$PORT") '$2 ~ ":"port"$" { found=1 } END { exit !found }' /proc/net/udp; then
        break
    fi
    sleep 0.2
done

# Send raw UDP DNS query for example.com via Node (already required for tests).
PORT="$PORT" node -e '
  const dgram = require("dgram");
  const s = dgram.createSocket("udp4");
  const q = Buffer.from("123401000001000000000000076578616d706c6503636f6d0000010001", "hex");
  s.send(q, parseInt(process.env.PORT, 10), "127.0.0.1");
  s.on("message", m => {
    if (m.length <= 12) { console.error("response too short:", m.length); process.exit(2); }
    const ancount = m.readUInt16BE(6);
    if (ancount === 0) { console.error("no answer records"); process.exit(3); }
    console.log(`OK: response_len=${m.length} answer_rrs=${ancount}`);
    s.close();
  });
  s.on("error", e => { console.error("socket error:", e.message); process.exit(4); });
  setTimeout(() => { console.error("query timeout"); process.exit(5); }, 8000);
'

echo "test-doh-proxy: passed"
