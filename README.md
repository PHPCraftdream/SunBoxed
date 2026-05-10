# sundocked / sundohed

Per-directory Docker isolation for AI coding agents and humans. One long-lived container per `(directory, image)` pair; CWD bind-mounted as `/work`, persistent home as `/root`. Built so that running `claude --dangerously-skip-permissions` is safe — the agent can only write inside the project directory.

Four entry points, same engine:

| Command | What it does |
|---|---|
| `sundocked` | Bare Docker wrapper. No DNS modifications inside the container. |
| `sundocked-cc` | `sundocked cc` with the `cc` subcommand auto-injected. One-shot Claude Code launcher. |
| `sundohed` | `sundocked` + an in-container DoH proxy auto-installed on every container start. Bypasses kernel-level UDP:53 hijacks by corporate VPN endpoint security drivers (Cisco Secure Client, Zscaler, Umbrella, etc.). |
| `sundohed-cc` | `sundohed cc` with the `cc` subcommand auto-injected. |

All four accept the same subcommands and flags.

## Why

AI coding agents like Claude Code spend tokens on permission requests. With `--dangerously-skip-permissions` the agent works autonomously — but that's risky on a bare system. Running inside a Docker container with only the project directory bind-mounted means:

- **No permission prompts** — agent doesn't waste tokens asking "can I write this file?"
- **No MCP/tool overhead** — no safety-wrapper tools loaded into context
- **Faster iterations** — agent acts immediately
- **Safe to experiment** — `sundocked reset` wipes the container, project files survive

## Quick start

```bash
cd /path/to/your/project
sundocked --image node:22-slim     # creates a container, drops you in a shell
npm install && npm test            # ...inside the container, /work == your CWD

# For one-shot non-TTY commands (agents, scripts):
sundocked --image node:22-slim exec npm test

# Claude Code, one-liner:
sundocked-cc --image node:22-slim    # or sundohed-cc on hijacked DNS networks
```

If your network filters DNS at the kernel level (corporate VPN — symptoms: `npm install` fails with `ECONNREFUSED 127.x.x.x`), use `sundohed` / `sundohed-cc` instead of `sundocked`. They're identical except sundohed installs a DoH proxy inside the container that resolves everything via HTTPS, transparently.

## Architecture

```
host                                              container
─────────────────                                 ────────────────────
sundohed-cc.js  ─── argv prepended "cc" ───►  sundohed.js
                                                ↓ require
                                              sundocked.js
                                                ↓ docker run / docker exec
                                                ↓ afterContainerStart hook
                                              sundohed-proxy.js
                                                ↓ docker cp init.sh + binary
                                                ↓ docker exec init.sh
                                                                            ┌─────────────────┐
                                                                            │ /opt/sundocked/ │
                                                                            │   init.sh       │
                                                                            │   sundocked-dns │ ◄── 6 MB Go binary
                                                                            └─────────────────┘
                                                                                     ↓
                                                                            UDP/TCP :53 (127.0.0.1)
                                                                                     ↓
                                                                            HTTPS :443 (DoH)
                                                                                     ↓
                                                                            Cloudflare / Google /
                                                                            Quad9 / AdGuard /
                                                                            Mullvad / AliDNS
                                                                            (11 hostname-based
                                                                             upstreams, ranked by
                                                                             availability stats)
```

The DoH proxy uses **hostname-based** URLs (`https://cloudflare-dns.com/dns-query`, etc.) with hardcoded IPs in a custom `net.Dialer` — TLS SNI matches the real provider hostname (which corporate MITM stacks usually let through), but no DNS lookup is needed, avoiding the chicken-and-egg of "we ARE the DNS resolver". Mozilla's CA bundle is embedded in the binary, so it works on minimal images (slim/distroless/alpine) that ship without `ca-certificates`.

## Common commands

```bash
sundocked --image NAME                    # create container, drop into shell
sundocked --image NAME exec CMD ...       # one-shot non-TTY command
sundocked --image NAME cc                 # launch Claude Code
sundocked install pkg1 pkg2               # apt/apk/dnf/yum/pacman/zypper auto-detect
sundocked status [--json]                 # container state
sundocked start | stop | restart          # lifecycle
sundocked reset                           # destroy + recreate from base image
sundocked list [--json]                   # all sundocked containers on this host
sundocked recipes                         # built-in stack presets
sundocked recipe nginx-php                # apply a preset
sundocked service add NAME -- CMD         # register a long-running service
sundocked wait-for HOST:PORT              # block until a service is reachable
```

For the full help with workflows, agent playbooks, troubleshooting, and config reference:

```bash
sundocked --detailed-help
```

## Install

### Via npm

```bash
npm install -g sundocked
```

This installs `sundocked`, `sundocked-cc`, `sundohed`, and `sundohed-cc` globally.

### From source

```bash
git clone https://github.com/PHPCraftdream/sundocked.git
cd sundocked
npm install
# add ./scripts/ to PATH, or invoke ./bin/*.js directly via node
```

### Requirements

- Node.js 18+
- Docker — Docker Desktop on Windows/Mac, or `docker` daemon on Linux
- Linux containers (default; the Docker daemon's WSL2 backend on Windows is fine)

## Configuration

Per-directory `config.ktav` (Ktav 0.3.0 format) lives at `..\.sundocked\<dirname>\config.ktav`. Stores image, ports, env, services, network mode. Hand-editable.

```
defaultImage: node:22-slim
ports: [
    8080:80
    5432:5432
]
env: [
    NODE_ENV=development
]
services: [
    { name: php-fpm   cmd: php-fpm -F }
    { name: nginx     cmd: nginx -g 'daemon off;' }
]
```

## License

[GPL-3.0](LICENSE).
