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

# 1) UDP wire-format query → valid response.
PORT="$PORT" node -e '
  const dgram = require("dgram");
  const s = dgram.createSocket("udp4");
  const q = Buffer.from("123401000001000000000000076578616d706c6503636f6d0000010001", "hex");
  s.send(q, parseInt(process.env.PORT, 10), "127.0.0.1");
  s.on("message", m => {
    if (m.length <= 12) { console.error("UDP response too short:", m.length); process.exit(2); }
    if (m.readUInt16BE(6) === 0) { console.error("UDP: no answer records"); process.exit(3); }
    console.log("UDP OK");
    s.close();
  });
  s.on("error", e => { console.error("UDP socket error:", e.message); process.exit(4); });
  setTimeout(() => { console.error("UDP query timeout"); process.exit(5); }, 8000);
'

# 2) TCP DNS query (RFC 1035 §4.2.2: 2-byte length prefix + DNS message).
PORT="$PORT" node -e '
  const net = require("net");
  const q = Buffer.from("ab1201000001000000000000076578616d706c6503636f6d0000010001", "hex");
  const framed = Buffer.concat([Buffer.from([0, q.length]), q]);
  const c = net.connect(parseInt(process.env.PORT, 10), "127.0.0.1");
  let buf = Buffer.alloc(0);
  c.on("connect", () => c.write(framed));
  c.on("data", d => {
    buf = Buffer.concat([buf, d]);
    if (buf.length < 2) return;
    const len = buf.readUInt16BE(0);
    if (buf.length < 2 + len) return;
    const msg = buf.slice(2, 2 + len);
    if (msg.readUInt16BE(6) === 0) { console.error("TCP: no answer records"); process.exit(2); }
    console.log("TCP OK");
    c.destroy();
  });
  c.on("error", e => { console.error("TCP error:", e.message); process.exit(3); });
  setTimeout(() => { console.error("TCP timeout"); process.exit(4); }, 8000);
'

# Stop the single-purpose proxy used above.
kill "$PROXY_PID" 2>/dev/null || true
wait "$PROXY_PID" 2>/dev/null || true

# 3) Stats reordering: spin up a new proxy with one bad upstream first
#    (192.0.2.1, RFC 5737 documentation prefix — guaranteed unroutable)
#    and Cloudflare second. After several queries, the stats line in the
#    log should show the bad upstream with negative score.
SUNDOCKED_DNS_BIND=127.0.0.1:$PORT \
SUNDOCKED_DOH_URLS="https://192.0.2.1/dns-query,https://cloudflare-dns.com/dns-query" \
SUNDOCKED_STATS_INTERVAL=1s \
"$BIN" >"$LOGFILE" 2>&1 &
PROXY_PID=$!
for i in $(seq 1 30); do
    if awk -v port=$(printf '%04X' "$PORT") '$2 ~ ":"port"$" { found=1 } END { exit !found }' /proc/net/udp; then
        break
    fi
    sleep 0.2
done

PORT="$PORT" node -e '
  const dgram = require("dgram");
  const q = Buffer.from("123401000001000000000000076578616d706c6503636f6d0000010001", "hex");
  let done = 0;
  for (let i = 0; i < 3; i++) {
    const s = dgram.createSocket("udp4");
    s.send(q, parseInt(process.env.PORT, 10), "127.0.0.1");
    s.on("message", () => { s.close(); if (++done === 3) process.exit(0); });
    s.on("error", () => { s.close(); if (++done === 3) process.exit(0); });
  }
  setTimeout(() => process.exit(0), 12000);
'

# Wait for the stats logger to fire at least once after the queries.
sleep 2
if ! grep -E 'upstreams: .*192\.0\.2\.1.*-' "$LOGFILE" >/dev/null; then
    echo "FAIL: expected 192.0.2.1 to have a negative score in stats line" >&2
    echo "---log---" >&2
    cat "$LOGFILE" >&2
    exit 1
fi
echo "STATS REORDERING OK"

echo "test-doh-proxy: passed (UDP + TCP + stats reordering)"
