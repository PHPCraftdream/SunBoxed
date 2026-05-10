# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-05-10

Initial Docker-based release. Four CLI entry points sharing one engine:

- **`sundocked`** — bare Docker wrapper. One long-lived container per `(directory, image)`; CWD bind-mounted as `/work`, persistent home as `/root`. Subcommands: `shell` / `exec` / `cc` / `install` / `start` / `stop` / `restart` / `reset` / `list` / `status` / `service add|remove|start|stop|status|list|logs` / `wait-for` / `recipe` / `recipes`. Recipe presets for nginx+php-fpm, postgres, redis.
- **`sundocked-cc`** — one-shot Claude Code launcher; `sundocked cc` with `cc` auto-injected.
- **`sundohed`** — `sundocked` + an in-container DoH proxy bootstrapped on every container start. Bypasses kernel-level UDP:53 hijacks (Cisco Secure Client, Zscaler, etc.) transparently — no per-domain `--add-host` whitelist.
- **`sundohed-cc`** — one-shot Claude Code launcher with the DoH proxy.

### DoH proxy (`dns-proxy/main.go`)

Tiny Go binary, ~250 lines, ships static `linux-amd64` and `linux-arm64` (~6 MB each):

- Listens UDP:53 + TCP:53 on 127.0.0.1, forwards via HTTPS to 11 hostname-based upstreams (Cloudflare / Google / Quad9 / AdGuard / Mullvad / AliDNS).
- Hardcoded IPs in a custom `net.Dialer` so TLS SNI matches the real provider hostname (corporate MITM stacks usually pass through SNI=hostname but intercept SNI=IP-literal); no DNS lookup needed, avoiding chicken-and-egg with us being the system resolver.
- Mozilla CA bundle embedded via `golang.org/x/crypto/x509roots/fallback` — works on minimal images (slim/distroless/alpine) without `ca-certificates`.
- HTTP/1.1 only — some MITM stacks reject HTTP/2 framing.
- Per-upstream availability stats with stable-sort reordering: chronically-failing servers drift to the bottom but stay retried as fallback.

### Hook API in `bin/sundocked.js`

`setHooks` + `module.exports` — wrappers extend container lifecycle without forking. `bin/sundohed.js` registers an `afterContainerStart` hook that bootstraps the DoH proxy on every container creation/restart.
