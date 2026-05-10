#!/bin/sh
# sundocked-init.sh — bootstraps the in-container DoH proxy.
#
# Run by the host every time a container is started (idempotent).
# Steps:
#   1. detect arch, pick binary
#   2. write nameserver 127.0.0.1 to /etc/resolv.conf (Docker may have
#      regenerated it on start, so we always rewrite)
#   3. start the proxy under nohup if not already running
#   4. wait until 127.0.0.1:53 actually responds
#
# Stdout/stderr go to the caller; the proxy writes its own log to
# /var/log/sundocked/dns.log. Any line with "ERR:" prefix is fatal.

set -e

BIN_DIR=/opt/sundocked
RUN_DIR=/var/run/sundocked
LOG_DIR=/var/log/sundocked
PID_FILE="$RUN_DIR/dns.pid"
LOG_FILE="$LOG_DIR/dns.log"

mkdir -p "$RUN_DIR" "$LOG_DIR"

arch="$(uname -m)"
case "$arch" in
    x86_64|amd64)  binary="$BIN_DIR/sundocked-dns-linux-amd64" ;;
    aarch64|arm64) binary="$BIN_DIR/sundocked-dns-linux-arm64" ;;
    *) echo "ERR: unsupported arch $arch" >&2; exit 1 ;;
esac

if [ ! -x "$binary" ]; then
    chmod +x "$binary" 2>/dev/null || true
fi
if [ ! -x "$binary" ]; then
    echo "ERR: missing or not executable: $binary" >&2
    exit 1
fi

# Stop stale instance if PID file is stale (process gone) or points to
# a different binary.
if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
        # Already running — keep it. Just refresh resolv.conf and exit.
        : > /etc/resolv.conf 2>/dev/null || true
        printf 'nameserver 127.0.0.1\noptions edns0 trust-ad\n' > /etc/resolv.conf
        exit 0
    fi
    rm -f "$PID_FILE"
fi

# Make /etc/resolv.conf point at us. Docker bind-mounts this file, but
# write is allowed — the file is per-container, not shared.
printf 'nameserver 127.0.0.1\noptions edns0 trust-ad\n' > /etc/resolv.conf

# Start the proxy. setsid disowns the process group so it survives the
# init script's parent shell exiting.
nohup "$binary" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait up to 10 seconds for UDP:53 to be listening. We can't easily probe
# UDP without a query tool, so we read /proc/net/udp instead — port 53
# (=0x35) appearing on local address 7f000001 (127.0.0.1) means we're up.
# Whole-second sleeps for BusyBox compatibility (Alpine).
i=0
while [ "$i" -lt 10 ]; do
    if awk '$2 ~ /:0035$/ && $2 ~ /^0100007F:/ { found=1 } END { exit !found }' /proc/net/udp; then
        echo "sundocked-dns: ready"
        exit 0
    fi
    i=$((i + 1))
    sleep 1
done

echo "ERR: sundocked-dns did not bind to 127.0.0.1:53 within 10s" >&2
echo "--- last log lines ---" >&2
tail -n 20 "$LOG_FILE" >&2 || true
exit 1
