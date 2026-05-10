# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Per-directory Docker isolation for AI coding agents. Four CLI entry points sharing one engine:

- **sundocked** — bare Docker wrapper. No DNS modifications inside the container.
- **sundocked-cc** — sundocked with the `cc` subcommand auto-injected. One-shot Claude Code launcher (no DoH proxy).
- **sundohed** — sundocked + an in-container DoH proxy bootstrapped on every container start. Bypasses kernel-level UDP:53 hijacks (Cisco Secure Client, Zscaler, etc.).
- **sundohed-cc** — sundohed with the `cc` subcommand auto-injected. One-shot Claude Code launcher with the DoH proxy.

Primary use case: running `claude --dangerously-skip-permissions` safely. The container's CWD is bind-mounted as `/work`; the agent can only write inside the project directory.

## Structure

```
bin/
├── sundocked.js              — main engine: arg parsing, ensureContainer, subcommands
├── sundocked-cc.js           — entry point: argv.splice(2,0,"cc") then require sundocked
├── sundohed.js               — entry point: requires sundocked, registers DNS hook, runs main()
├── sundohed-cc.js            — entry point: argv.splice(2,0,"cc") then require sundohed
├── sundohed-proxy.js         — DoH proxy bootstrap: docker cp + init.sh, isEnabled()/disabledReason()
└── dns-proxy-bin/
    ├── sundocked-dns-linux-amd64    — 6 MB static Go binary
    └── sundocked-dns-linux-arm64

dns-proxy/
├── go.mod, go.sum
└── main.go                   — Go DoH proxy source (~250 lines)

scripts/
├── sundocked, sundocked.cmd          — bash + Windows launchers (just `node bin/sundocked.js`)
├── sundocked-cc, sundocked-cc.cmd
├── sundohed, sundohed.cmd
├── sundohed-cc, sundohed-cc.cmd
└── sundohed-init.sh          — runs INSIDE container; rewrites /etc/resolv.conf, starts proxy
```

## Architecture

### Hook-based extension

`bin/sundocked.js` exposes a small hook API so wrappers extend container lifecycle without forking:

```js
const sundocked = require("./sundocked.js");
const proxy = require("./sundohed-proxy.js");

sundocked.setHooks({
  afterContainerStart: proxy.bootstrap,   // ({name, image, config, opts, fresh}) => {...}
});

sundocked.main().catch(...);
```

`afterContainerStart` is called every time `ensureContainer` returns successfully — both on fresh creation (`fresh: true`) and on re-using/restarting an existing container (`fresh: false`). Hooks are responsible for being **idempotent and cheap** when nothing needs doing.

`bin/sundocked.js` only auto-runs `main()` when invoked directly:
```js
module.exports = { main, setHooks };
if (require.main === module) {
  main().catch(...);
}
```

### DoH proxy bootstrap (`bin/sundohed-proxy.js`)

On every `afterContainerStart`:

1. **Disable check** — `disabledReason(config, opts)` returns a human-readable reason string when proxy must be skipped (`network=host`, `--no-dns-proxy`, `dnsProxy: false` in config). Returns `null` otherwise.
2. **Fast path** (when `fresh === false`) — `docker exec NAME sh -c 'test -x /opt/sundocked/init.sh && /opt/sundocked/init.sh'`. If init.sh exists and exits 0, proxy is alive (or just got revived); skip docker cp.
3. **Full bootstrap** (fresh container OR fast path failed):
    - `docker exec NAME uname -m` → pick `sundocked-dns-linux-amd64` or `-arm64`
    - `docker cp` binary + init.sh into `/opt/sundocked/`
    - `docker exec sh -c 'chmod +x ... && /opt/sundocked/init.sh'`

`scripts/sundohed-init.sh` (running inside container):
- Reads PID file, checks `/proc/$pid` to detect already-running proxy
- Rewrites `/etc/resolv.conf` to `nameserver 127.0.0.1` (Docker regenerates it on every `start`)
- `nohup` launches the binary with PID file in `/var/run/sundocked/`, log in `/var/log/sundocked/`
- Polls `/proc/net/udp` for port 0035 on local 7f000001 to confirm bind succeeded

### DoH proxy itself (`dns-proxy/main.go`)

Listens UDP:53 + TCP:53 on 127.0.0.1; forwards every query verbatim (RFC 8484 wire format) over HTTPS to a public DoH endpoint.

Key design choices:

- **Hostname URLs, hardcoded IPs.** URLs are `https://cloudflare-dns.com/dns-query` etc. — TLS SNI matches a real hostname (corporate MITM stacks usually let SNI=hostname through but intercept SNI=IP-literal). A custom `DialContext` maps `host:port → IP:port` so no DNS lookup is needed, avoiding chicken-and-egg with us being the system resolver.
- **Embedded CA bundle.** `golang.org/x/crypto/x509roots/fallback` ships Mozilla roots compiled into the binary; required because slim/distroless images have no `ca-certificates`, leaving Go's TLS trust store empty.
- **HTTP/1.1 only.** Some MITM stacks reject HTTP/2 framing. `Transport.ForceAttemptHTTP2 = false` + empty `TLSNextProto`.
- **Per-upstream availability stats.** Atomic success/failure counters; on each outcome, stable-sort orders working servers first, chronically-failing ones drift to the bottom but stay retried as fallback. Periodic stats line to log every `SUNDOCKED_STATS_INTERVAL` (default 60s).

11 default upstreams: Cloudflare ×1, Google ×1, Quad9 ×2 (filtered + unfiltered), AdGuard ×2, Mullvad ×4 (base/adblock/family/all), AliDNS ×1.

Env overrides:
- `SUNDOCKED_DOH_URLS=...` — comma-separated, fully replaces defaults (URLs only; if hostname not in our IP map, falls back to system DNS which inside the container loops back to us).
- `SUNDOCKED_DOH_EXTRA=...` — prepended to defaults (tried first).
- `SUNDOCKED_DEBUG=1` — log every upstream failure with the underlying error.

### Container lifecycle in `ensureContainer`

```
state == "running"        → callHook(afterContainerStart, fresh: false); return
state == "exited" / "created" / "paused"  → docker start + callHook(fresh: false); return
state == "missing"        → docker run -d ... + callHook(fresh: true)
```

The `running` branch existed primarily so wrappers like sundohed can re-verify their setup on every `exec` against an already-running container — Docker regenerates `/etc/resolv.conf` on every `start`, so init.sh must run after `start` even though the proxy process itself survived.

### `cc` subcommand specifics

`cmdCc`:
- Runs `prepare(ctx)` → `ensureContainer` → bootstrap proxy (if sundohed)
- npm self-update via **corepack** (`corepack prepare npm@latest --activate && corepack enable npm`) — `npm install -g npm@latest` famously corrupts itself mid-replace (loses `promise-retry` from arborist).
- Falls back to disabling `update-notifier` on older nodes.
- Installs `@anthropic-ai/claude-code` once, gated by `/var/lib/sundocked/cc-installed`.
- `IS_SANDBOX=1` env so claude allows root + `--dangerously-skip-permissions`.

## Common gotchas

- **`config.network === "host"`** disables the DoH proxy unconditionally (host-network shares the host's `/etc/resolv.conf` — overriding it would leak to host). If a user has `network: host` left over from a past experiment, `sundohed` silently does nothing useful — `disabledReason()` exists to print why.
- **`MSYS2 path munging`** — Git Bash rewrites paths like `/dns-query` to `C:/Program Files/Git/dns-query` when passed to native binaries. Always wrap multi-arg commands through a `.cmd` file or PowerShell.
- **`require.main` check is per-module** — when sundohed.js requires sundocked.js, `require.main` in sundocked.js is the entry script (sundohed-cc.js or whatever invoked node), NOT sundocked. So `require.main === module` is false there, and main() doesn't auto-run. sundohed.js calls `sundocked.main()` explicitly.
- **`docker exec` failures are silent in `spawnSync`** — always check `r.status` AND log `r.stderr` on non-zero. The bootstrap function does this for every step.
- **The Go binary needs HTTP/1.1 + embedded CA + hostname SNI** all three to work through Cisco — drop any one and TLS handshake fails.

## Adding a new image

Append to `IMAGES` in `bin/sundocked.js`. Group with `{ group: "Name" }` markers. Size string is human-readable; `imageSizeReal()` overrides at runtime.

## Adding a new recipe

Append to `RECIPES` in `bin/sundocked.js`. Each recipe is `{ image, install: [pkgs], files: { path: content }, services: [{name, cmd}], waitFor: "host:port" }`. Applied via `sundocked recipe NAME`.

## Building the Go DoH proxy

```bash
cd dns-proxy
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../bin/dns-proxy-bin/sundocked-dns-linux-amd64 .
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../bin/dns-proxy-bin/sundocked-dns-linux-arm64 .
```

Binaries are committed to the repo so users don't need a Go toolchain. ~6 MB each, statically linked.

Test in WSL:
```bash
SUNDOCKED_DNS_BIND=127.0.0.1:5353 ./bin/dns-proxy-bin/sundocked-dns-linux-amd64 &
# then send a UDP query via dig +short @127.0.0.1 -p 5353 example.com
# or via raw bytes through python socket
```
