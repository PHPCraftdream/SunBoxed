#!/usr/bin/env node
const { spawnSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const http = require("http");
const https = require("https");
const dns = require("dns");
const path = require("path");
const readline = require("readline");
const ktav = require("@ktav-lang/ktav");

// ---- Image catalog ----
const IMAGES = [
  { group: "Minimal" },
  { name: "busybox:latest",                              size: "~4 MB"   },
  { name: "alpine:3.20",                                 size: "~7 MB"   },

  { group: "Slim Linux" },
  { name: "debian:bookworm-slim",                        size: "~75 MB"  },
  { name: "ubuntu:24.04",                                size: "~78 MB"  },
  { name: "rockylinux:9-minimal",                        size: "~80 MB"  },

  { group: "Full Linux" },
  { name: "debian:bookworm",                             size: "~120 MB" },
  { name: "ubuntu:22.04",                                size: "~77 MB"  },
  { name: "archlinux:latest",                            size: "~155 MB" },
  { name: "fedora:40",                                   size: "~165 MB" },
  { name: "opensuse/leap:15.6",                          size: "~110 MB" },

  { group: "Node.js" },
  { name: "node:22-alpine",                              size: "~140 MB" },
  { name: "node:22-slim",                                size: "~215 MB" },
  { name: "node:22-bookworm",                            size: "~1.1 GB" },
  { name: "node:20-alpine",                              size: "~135 MB" },
  { name: "node:20-slim",                                size: "~210 MB" },

  { group: "Python" },
  { name: "python:3.12-alpine",                          size: "~50 MB"  },
  { name: "python:3.12-slim",                            size: "~130 MB" },
  { name: "python:3.12-bookworm",                        size: "~1.0 GB" },
  { name: "python:3.11-slim",                            size: "~130 MB" },

  { group: "PHP" },
  { name: "php:8.3-fpm",                                 size: "~110 MB" },
  { name: "php:8.3-cli",                                 size: "~110 MB" },
  { name: "php:8.3-fpm-alpine",                          size: "~50 MB"  },

  { group: "Other languages" },
  { name: "golang:1.23-alpine",                          size: "~250 MB" },
  { name: "rust:1-alpine",                               size: "~580 MB" },
  { name: "rust:1-slim",                                 size: "~830 MB" },
  { name: "ruby:3.3-alpine",                             size: "~75 MB"  },
  { name: "eclipse-temurin:21-jre-alpine",               size: "~190 MB" },

  { group: "Dev kitchen sink" },
  { name: "mcr.microsoft.com/devcontainers/universal:2", size: "~3.5 GB" },
];

const PKG_MGR_DETECT = `if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y --no-install-recommends "$@"
elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache "$@"
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y "$@"
elif command -v yum >/dev/null 2>&1; then
  yum install -y "$@"
elif command -v pacman >/dev/null 2>&1; then
  pacman -Sy --noconfirm "$@"
elif command -v zypper >/dev/null 2>&1; then
  zypper --non-interactive install "$@"
else
  echo "ERROR: no supported package manager (apt/apk/dnf/yum/pacman/zypper) found in image" >&2
  exit 1
fi`;

// ---- Helpers ----
function sanitize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function containerName(dirname, image) {
  return `sundocked-${sanitize(dirname)}-${sanitize(image)}`.slice(0, 63);
}

function imageStateDir(stateDir, image) { return path.join(stateDir, sanitize(image)); }
function homeDirFor(stateDir, image)    { return path.join(imageStateDir(stateDir, image), "home"); }

function getHostDns() {
  try {
    const servers = (dns.getServers() || [])
      .map(s => String(s).split("%")[0])
      .filter(s => s && s !== "::1" && s !== "127.0.0.1" && !s.startsWith("fe80:"));
    return servers.length ? servers : ["1.1.1.1", "8.8.8.8"];
  } catch { return ["1.1.1.1", "8.8.8.8"]; }
}

// Hostnames that frequently get hijacked by enterprise DNS filters
// (Cisco Umbrella, Zscaler, etc.). When system DNS returns 127.x for
// public hostnames, these are resolved via DoH and added to the
// container's /etc/hosts via --add-host.
const DEFAULT_BYPASS_HOSTS = [
  // package registries
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "files.pythonhosted.org",
  "deb.debian.org",
  "security.debian.org",
  "archive.ubuntu.com",
  "security.ubuntu.com",
  "dl-cdn.alpinelinux.org",
  "repo.maven.apache.org",
  "crates.io",
  "static.crates.io",
  "packagist.org",
  "repo.packagist.org",
  "proxy.golang.org",
  "sum.golang.org",
  // AI providers — anthropic / claude code
  "api.anthropic.com",
  "console.anthropic.com",
  "statsig.anthropic.com",
  "claude.ai",
  // AI providers — OpenAI / codex
  "api.openai.com",
  "openai.com",
  "chat.openai.com",
  // AI providers — Google Gemini
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
  "gemini.google.com",
  // AI providers — xAI Grok
  "api.x.ai",
  "grok.com",
  // AI providers — Qwen (Alibaba DashScope)
  "dashscope.aliyuncs.com",
  "dashscope-intl.aliyuncs.com",
  // AI providers — DeepSeek
  "api.deepseek.com",
  "chat.deepseek.com",
  // AI providers — GLM / Zhipu
  "open.bigmodel.cn",
  "api.bigmodel.cn",
  "api.zhipuai.cn",
  // github (used by many installers and AI agents)
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
];

function dohResolve(name, type = "A") {
  const url = `https://1.1.1.1/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "Accept": "application/dns-json" } }, res => {
      let body = "";
      res.on("data", c => body += c);
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          const wantType = type === "A" ? 1 : 28;
          const ips = (data.Answer || []).filter(a => a.type === wantType).map(a => a.data);
          resolve(ips);
        } catch { resolve([]); }
      });
    });
    req.setTimeout(5000, () => { req.destroy(); resolve([]); });
    req.on("error", () => resolve([]));
  });
}

function isHijackedAnswer(addrs) {
  return Array.isArray(addrs) && addrs.length > 0 &&
    addrs.every(a => /^127\./.test(a) || /^0\./.test(a) || a === "0.0.0.0");
}

function detectDnsHijack() {
  return new Promise(resolve => {
    // Use a globally well-known hostname unlikely to be classified by filters
    dns.resolve4("cloudflare.com", (err, addrs) => {
      if (err) return resolve(false);
      resolve(isHijackedAnswer(addrs));
    });
  });
}

async function buildAddHostFlags(extraHosts = []) {
  const hijacked = await detectDnsHijack();
  if (!hijacked) return { flags: [], hijacked: false, mappings: [] };
  const hosts = [...new Set([...DEFAULT_BYPASS_HOSTS, ...extraHosts])];
  const flags = [];
  const mappings = [];
  const results = await Promise.all(hosts.map(h => dohResolve(h, "A")));
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i];
    const ips = results[i];
    if (ips.length) {
      const ip = ips[0];
      flags.push("--add-host", `${host}:${ip}`);
      mappings.push({ host, ip });
    }
  }
  return { flags, hijacked: true, mappings };
}

function detectOS() {
  const platform = process.platform;
  const info = { platform, isWin: platform === "win32", isMac: platform === "darwin", isLinux: platform === "linux" };
  if (info.isWin) {
    const r = spawnSync("wsl.exe", ["--status"], { encoding: "utf-8", windowsHide: true });
    info.hasWsl = r.status === 0;
  }
  return info;
}

function docker(args, opts = {}) {
  return spawnSync("docker", args, { encoding: "utf-8", windowsHide: true, ...opts });
}

function dockerInherit(args) {
  return spawnSync("docker", args, { stdio: "inherit", windowsHide: true });
}

function dockerCheck() {
  const ver = spawnSync("docker", ["--version"], { encoding: "utf-8", windowsHide: true });
  if (ver.status !== 0) {
    console.error("ERROR: docker CLI not found in PATH.");
    if (process.platform === "win32") console.error("  Install Docker Desktop: winget install Docker.DockerDesktop");
    if (process.platform === "darwin") console.error("  Install Docker Desktop: brew install --cask docker");
    if (process.platform === "linux")  console.error("  curl -fsSL https://get.docker.com | sudo sh");
    process.exit(1);
  }
  const info = spawnSync("docker", ["info"], { encoding: "utf-8", windowsHide: true });
  if (info.status !== 0) {
    const err = (info.stderr || "") + (info.stdout || "");
    if (/cannot connect|daemon|pipe|socket/i.test(err)) {
      console.error("ERROR: Docker daemon is not running (CLI installed, but server unreachable).");
      if (process.platform === "win32") console.error("  Launch Docker Desktop from the Start menu.");
      if (process.platform === "darwin") console.error("  Launch Docker Desktop from Applications.");
      if (process.platform === "linux")  console.error("  sudo systemctl start docker  (or launch Docker Desktop)");
    } else {
      console.error("ERROR: docker info failed:");
      console.error(err.trim());
    }
    process.exit(1);
  }
}

function containerState(name) {
  const r = docker(["container", "inspect", "--format", "{{.State.Status}}", name]);
  if (r.status !== 0) return "missing";
  return (r.stdout || "").trim();
}

function containerInspect(name) {
  const r = docker(["container", "inspect", name]);
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout)[0]; } catch { return null; }
}

function imagePresent(image) { return docker(["image", "inspect", image]).status === 0; }

function imageSizeReal(image) {
  const r = docker(["image", "inspect", "--format", "{{.Size}}", image]);
  if (r.status !== 0) return null;
  const bytes = parseInt((r.stdout || "").trim(), 10);
  if (!bytes) return null;
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  if (bytes >= 1024 * 1024)        return (bytes / 1024 / 1024).toFixed(0) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function selectImage() {
  console.log("\nSelect a base image (container will persist changes across runs):\n");
  let n = 0;
  const map = [];
  for (const item of IMAGES) {
    if (item.group) {
      console.log(`  --- ${item.group} ---`);
    } else {
      n++;
      map[n] = item;
      const tag = imagePresent(item.name) ? " [installed]" : "";
      console.log(`  ${String(n).padStart(2)}. ${item.name.padEnd(50)} ${item.size}${tag}`);
    }
  }
  console.log(`  ${String(n + 1).padStart(2)}. Custom (type manually)`);
  console.log("");
  while (true) {
    const ans = await ask(`Number [1-${n + 1}] or image name: `);
    if (!ans) continue;
    if (/^\d+$/.test(ans)) {
      const idx = parseInt(ans, 10);
      if (idx >= 1 && idx <= n) return map[idx].name;
      if (idx === n + 1) {
        const custom = await ask("Image name (e.g. debian:trixie): ");
        if (custom) return custom;
      }
    } else if (ans.includes(":") || ans.includes("/")) {
      return ans;
    }
    console.log("  Couldn't parse that, please try again.");
  }
}

// ---- Config (Ktav 0.3.0; legacy JSON read kept for migration) ----
function loadConfig(stateDir) {
  const ktavFile = path.join(stateDir, "config.ktav");
  if (fs.existsSync(ktavFile)) {
    try { return ktav.loads(fs.readFileSync(ktavFile, "utf-8")) || {}; }
    catch (e) { console.error(`WARNING: ${ktavFile} parse failed: ${e.message}`); return {}; }
  }
  const jsonFile = path.join(stateDir, "config.json");
  if (fs.existsSync(jsonFile)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
      // migrate to .ktav silently on next save
      return cfg;
    } catch { return {}; }
  }
  return {};
}

function saveConfig(stateDir, config) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "config.ktav"), ktav.dumps(config));
  // remove legacy JSON if it existed (one-shot migration)
  const jsonFile = path.join(stateDir, "config.json");
  if (fs.existsSync(jsonFile)) { try { fs.unlinkSync(jsonFile); } catch {} }
}

// ---- Container lifecycle ----
const BASE_ENV = [
  "-e", "LANG=C.UTF-8",
  "-e", "LC_ALL=C.UTF-8",
  "-e", "TERM=xterm-256color",
  "-e", "HTTP_PROXY=", "-e", "HTTPS_PROXY=",
  "-e", "http_proxy=", "-e", "https_proxy=",
  "-e", "NO_PROXY=*",  "-e", "no_proxy=*",
];

function envFlagsFromConfig(config) {
  const out = [];
  for (const e of (config.env || [])) { out.push("-e", e); }
  return out;
}

function portFlagsFromConfig(config) {
  const out = [];
  for (const p of (config.ports || [])) { out.push("-p", p); }
  return out;
}

function networkFlagsFromConfig(config) {
  if (config.network === "host") return ["--network", "host"];
  return [];
}

async function ensureContainer({ name, image, cwd, homeDir, config, opts = {} }) {
  const state = containerState(name);
  if (state === "running") return;
  if (state === "exited" || state === "created" || state === "paused") {
    if (state === "paused") docker(["unpause", name]);
    const r = docker(["start", name]);
    if (r.status !== 0) {
      console.error(`Failed to start container ${name}:`);
      console.error(r.stderr);
      process.exit(1);
    }
    return;
  }
  if (!imagePresent(image)) {
    console.log(`Pulling image ${image}...`);
    const r = dockerInherit(["pull", image]);
    if (r.status !== 0) process.exit(r.status || 1);
    const sz = imageSizeReal(image);
    if (sz) console.log(`Image installed, on-disk size: ${sz}`);
  }
  fs.mkdirSync(homeDir, { recursive: true });
  const networkFlags = networkFlagsFromConfig(config);
  const dnsFlags = [];
  if (!networkFlags.length) {
    for (const d of getHostDns()) dnsFlags.push("--dns", d);
  }
  const { flags: addHostFlags, hijacked, mappings } = await buildAddHostFlags(config.extraHosts || []);
  if (hijacked && !opts.quiet) {
    console.log(`Host DNS appears hijacked (returns 127.x for public hosts).`);
    console.log(`Resolved ${mappings.length} hosts via DoH and pinned them via --add-host.`);
  }
  const args = [
    "run", "-d", "--name", name,
    "-v", `${cwd}:/work`,
    "-v", `${homeDir}:/root`,
    "-w", "/work",
    ...networkFlags,
    ...dnsFlags,
    ...addHostFlags,
    ...BASE_ENV,
    ...envFlagsFromConfig(config),
    ...portFlagsFromConfig(config),
    "--entrypoint", "/bin/sh",
    image,
    "-c", "tail -f /dev/null 2>/dev/null || sleep 999999d",
  ];
  const r = docker(args);
  if (r.status !== 0) {
    console.error(`Failed to create container ${name}:`);
    console.error((r.stderr || "").trim() || (r.stdout || "").trim());
    if (/EOF|connection|pipe/i.test((r.stderr || "") + (r.stdout || ""))) {
      console.error("\nDocker Desktop appears to have lost the connection. Try: tray → Restart Docker.");
    }
    process.exit(1);
  }
}

function destroyContainer(name) {
  if (containerState(name) !== "missing") {
    docker(["rm", "-f", name]);
  }
}

function checkPortsMatch(name, configuredPorts) {
  const inspect = containerInspect(name);
  if (!inspect) return true;
  const cur = (inspect.HostConfig?.PortBindings) || {};
  const curMapped = [];
  for (const [containerPort, bindings] of Object.entries(cur)) {
    for (const b of (bindings || [])) {
      const cp = containerPort.split("/")[0];
      curMapped.push(`${b.HostPort}:${cp}`);
    }
  }
  const want = (configuredPorts || []).slice().sort();
  const have = curMapped.slice().sort();
  return JSON.stringify(want) === JSON.stringify(have);
}

// ---- Exec helpers ----
function buildExecArgs({ name, env, workdir, user, tty }) {
  const args = ["exec"];
  if (tty) args.push("-it"); else args.push("-i");
  args.push(...BASE_ENV);
  for (const e of (env || [])) args.push("-e", e);
  args.push("-w", workdir || "/work");
  if (user) args.push("--user", user);
  args.push(name);
  return args;
}

function runIn({ name, env, workdir, user, tty, cmd }) {
  const args = [...buildExecArgs({ name, env, workdir, user, tty }), ...cmd];
  const r = dockerInherit(args);
  return r.status === null ? 1 : r.status;
}

// ---- Service supervisor (in-container PID-file based) ----
const SVC_DIRS = "mkdir -p /var/run/sundocked /var/log/sundocked";

function findService(config, name) {
  return (config.services || []).find(s => s.name === name);
}

function setService(config, svc) {
  config.services = config.services || [];
  const i = config.services.findIndex(s => s.name === svc.name);
  if (i >= 0) config.services[i] = svc; else config.services.push(svc);
}

function removeService(config, name) {
  config.services = (config.services || []).filter(s => s.name !== name);
}

function svcStartScript(svc) {
  // shell-quote single-quoted CMD
  const cmdQ = svc.cmd.replace(/'/g, `'\\''`);
  return `${SVC_DIRS}
NAME='${svc.name}'
PIDFILE=/var/run/sundocked/$NAME.pid
LOGFILE=/var/log/sundocked/$NAME.log
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "[$NAME] already running (pid $(cat "$PIDFILE"))"
  exit 0
fi
nohup sh -c '${cmdQ}' >>"$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"
echo "[$NAME] started (pid $!)"`;
}

function svcStopScript(name) {
  return `NAME='${name}'
PIDFILE=/var/run/sundocked/$NAME.pid
if [ ! -f "$PIDFILE" ]; then echo "[$NAME] not running"; exit 0; fi
PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null
  for i in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.3
  done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null
  echo "[$NAME] stopped (pid $PID)"
else
  echo "[$NAME] dead (stale pidfile)"
fi
rm -f "$PIDFILE"`;
}

function svcStatusScript(names) {
  const list = names.map(n => `'${n}'`).join(" ");
  return `${SVC_DIRS}
for NAME in ${list}; do
  PIDFILE=/var/run/sundocked/$NAME.pid
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "$NAME running pid=$(cat "$PIDFILE")"
  else
    echo "$NAME stopped"
  fi
done`;
}

// ---- wait-for (host-side, uses mapped ports) ----
function probeTcp(host, port, timeoutMs) {
  return new Promise(resolve => {
    const sock = net.createConnection({ host, port });
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, timeoutMs);
    sock.once("connect", () => { clearTimeout(t); sock.end(); resolve(true); });
    sock.once("error",   () => { clearTimeout(t); resolve(false); });
  });
}

function probeHttp(url, timeoutMs) {
  return new Promise(resolve => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, res => { res.resume(); resolve(res.statusCode < 500); });
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
    req.once("error", () => resolve(false));
  });
}

async function waitFor(target, { timeoutMs = 30000, intervalMs = 500 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    let ok;
    if (/^https?:\/\//.test(target)) {
      ok = await probeHttp(target, Math.min(2000, timeoutMs));
    } else {
      const m = target.match(/^(?:tcp:)?(.+):(\d+)$/);
      if (!m) throw new Error(`Cannot parse target: ${target} (use URL or host:port)`);
      ok = await probeTcp(m[1], parseInt(m[2], 10), Math.min(2000, timeoutMs));
    }
    if (ok) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

// ---- Recipes ----
const RECIPES = {
  "nginx-php": {
    description: "nginx + php-fpm with /work/public as document root (FastCGI on 127.0.0.1:9000)",
    image: "php:8.3-fpm",
    install: ["nginx"],
    files: {
      "/etc/nginx/sites-available/default": `server {
    listen 80 default_server;
    root /work/public;
    index index.php index.html;
    location / { try_files $uri $uri/ /index.php?$query_string; }
    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
}
`,
    },
    services: [
      { name: "php-fpm", cmd: "php-fpm -F" },
      { name: "nginx",   cmd: "nginx -g 'daemon off;'" },
    ],
    ports: ["8080:80"],
    waitFor: "http://localhost:8080/",
  },
  "postgres": {
    description: "PostgreSQL 16 with persistent /root/pgdata",
    image: "postgres:16-alpine",
    env: ["POSTGRES_PASSWORD=postgres", "POSTGRES_DB=app", "PGDATA=/root/pgdata"],
    ports: ["5432:5432"],
    services: [
      { name: "postgres", cmd: "su postgres -c 'postgres -D /root/pgdata' || postgres -D /root/pgdata" },
    ],
    waitFor: "tcp:localhost:5432",
  },
  "redis": {
    description: "Redis 7 with append-only persistence in /root/redis",
    image: "redis:7-alpine",
    ports: ["6379:6379"],
    services: [
      { name: "redis", cmd: "mkdir -p /root/redis && redis-server --appendonly yes --dir /root/redis" },
    ],
    waitFor: "tcp:localhost:6379",
  },
};

function applyRecipeToConfig(recipe, ctx) {
  if (recipe.image && !ctx.opts.image) ctx.config.defaultImage = recipe.image;
  if (recipe.ports) {
    const set = new Set(ctx.config.ports || []);
    for (const p of recipe.ports) set.add(p);
    ctx.config.ports = [...set];
  }
  if (recipe.env) {
    const set = new Set(ctx.config.env || []);
    for (const e of recipe.env) set.add(e);
    ctx.config.env = [...set];
  }
  if (recipe.services) {
    for (const svc of recipe.services) setService(ctx.config, svc);
  }
}

// ---- Subcommands ----
async function cmdShell(ctx) {
  await prepare(ctx);
  const code = runIn({
    name: ctx.name, env: ctx.config.env, workdir: ctx.workdir, user: ctx.user, tty: true,
    cmd: ["sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"],
  });
  process.exit(code);
}

async function cmdExec(ctx, userArgs) {
  if (userArgs.length === 0) {
    console.error("ERROR: 'exec' requires a command. Example: sundocked exec ls /work");
    process.exit(2);
  }
  await prepare(ctx);
  const code = runIn({
    name: ctx.name, env: ctx.config.env, workdir: ctx.workdir, user: ctx.user, tty: ctx.tty,
    cmd: userArgs,
  });
  process.exit(code);
}

async function cmdInstall(ctx, packages) {
  if (packages.length === 0) {
    console.error("ERROR: 'install' requires a package list. Example: sundocked install nginx curl");
    process.exit(2);
  }
  await prepare(ctx);
  if (!ctx.opts.quiet) console.log(`Installing: ${packages.join(" ")}`);
  const code = runIn({
    name: ctx.name, env: ctx.config.env, workdir: "/", user: "root", tty: false,
    cmd: ["sh", "-c", PKG_MGR_DETECT, "sh", ...packages],
  });
  process.exit(code);
}

async function cmdCc(ctx, userArgs) {
  await prepare(ctx);
  const script = `set -e
if ! command -v claude >/dev/null 2>&1; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found. Pick a Node.js image (node:22-slim / node:22-alpine)." >&2
    echo "  sundocked switch  # pick another image" >&2
    exit 127
  fi
  echo "Installing @anthropic-ai/claude-code (one-time setup)..." >&2
  npm install -g @anthropic-ai/claude-code >&2
fi
exec claude --dangerously-skip-permissions "$@"`;
  // Inside the sundocked container we are intentionally root; Claude Code
  // refuses --dangerously-skip-permissions as root unless IS_SANDBOX=1 is set.
  const ccEnv = [...(ctx.config.env || []), "IS_SANDBOX=1"];
  const code = runIn({
    name: ctx.name, env: ccEnv, workdir: ctx.workdir, user: ctx.user, tty: true,
    cmd: ["sh", "-c", script, "sh", ...userArgs],
  });
  process.exit(code);
}

function cmdStatus(ctx) {
  const inspect = containerInspect(ctx.name);
  const info = {
    name: ctx.name,
    image: ctx.image,
    state: inspect ? inspect.State.Status : "missing",
    started: inspect?.State?.StartedAt || null,
    ports: ctx.config.ports || [],
    env: ctx.config.env || [],
    mounts: inspect ? inspect.Mounts.map(m => ({ host: m.Source, container: m.Destination, mode: m.Mode })) : [],
    cwd: ctx.cwd,
    stateDir: ctx.stateDir,
    homeDir: ctx.homeDir,
  };
  if (ctx.opts.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log(`Container:    ${info.name}`);
  console.log(`Image:        ${info.image}`);
  console.log(`State:        ${info.state}${info.started ? ` (since ${info.started})` : ""}`);
  console.log(`CWD:          ${info.cwd}`);
  console.log(`State dir:    ${info.stateDir}`);
  console.log(`Home (root):  ${info.homeDir}`);
  if (info.ports.length) console.log(`Ports:        ${info.ports.join(", ")}`);
  if (info.env.length)   console.log(`Env:          ${info.env.join(", ")}`);
  if (info.mounts.length) {
    console.log(`Mounts:`);
    for (const m of info.mounts) console.log(`  ${m.host} → ${m.container} (${m.mode})`);
  }
}

function cmdStart(ctx) {
  const r = docker(["start", ctx.name]);
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  if (!ctx.opts.quiet) console.log(`Started: ${ctx.name}`);
}

function cmdStop(ctx) {
  const r = docker(["stop", ctx.name]);
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  if (!ctx.opts.quiet) console.log(`Stopped: ${ctx.name}`);
}

function cmdRestart(ctx) {
  const r = docker(["restart", ctx.name]);
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  if (!ctx.opts.quiet) console.log(`Restarted: ${ctx.name}`);
}

function cmdLogs(ctx, extra) {
  const args = ["logs", ...extra, ctx.name];
  const r = dockerInherit(args);
  process.exit(r.status === null ? 1 : r.status);
}

function cmdReset(ctx) {
  destroyContainer(ctx.name);
  const dir = imageStateDir(ctx.stateDir, ctx.image);
  if (fs.existsSync(dir)) {
    if (!ctx.opts.quiet) console.log(`Removing state dir: ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!ctx.opts.quiet) console.log("Reset complete.");
}

async function cmdService(ctx, sub, rest) {
  if (!sub) {
    console.error("ERROR: 'service' requires a sub-subcommand: add | remove | start | stop | restart | status | list | logs");
    process.exit(2);
  }
  if (sub === "list") return cmdServiceList(ctx);
  if (sub === "add")     return cmdServiceAdd(ctx, rest);
  if (sub === "remove" || sub === "rm") return cmdServiceRemove(ctx, rest);
  if (sub === "start")   return cmdServiceStart(ctx, rest);
  if (sub === "stop")    return cmdServiceStop(ctx, rest);
  if (sub === "restart") { await cmdServiceStop(ctx, rest); return cmdServiceStart(ctx, rest); }
  if (sub === "status")  return cmdServiceStatus(ctx, rest);
  if (sub === "logs")    return cmdServiceLogs(ctx, rest);
  console.error(`ERROR: unknown 'service' sub-subcommand: ${sub}`);
  process.exit(2);
}

function cmdServiceList(ctx) {
  const list = ctx.config.services || [];
  if (ctx.opts.json) { console.log(JSON.stringify(list, null, 2)); return; }
  if (!list.length) { console.log("No services registered."); return; }
  console.log("NAME\tCMD");
  for (const s of list) console.log(`${s.name}\t${s.cmd}`);
}

function cmdServiceAdd(ctx, rest) {
  // expected: NAME -- CMD ARGS...   OR   NAME CMD ARGS...
  if (rest.length < 2) {
    console.error("ERROR: service add NAME -- CMD ARGS...");
    process.exit(2);
  }
  const name = rest[0];
  let cmd;
  const dashIdx = rest.indexOf("--");
  if (dashIdx === 0 && rest[1] === name) cmd = rest.slice(2).join(" ");
  else if (dashIdx >= 1) cmd = rest.slice(dashIdx + 1).join(" ");
  else cmd = rest.slice(1).join(" ");
  if (!name || !cmd) { console.error("ERROR: bad service definition"); process.exit(2); }
  setService(ctx.config, { name, cmd });
  saveConfig(ctx.stateDir, ctx.config);
  if (!ctx.opts.quiet) console.log(`Service '${name}' registered: ${cmd}`);
}

function cmdServiceRemove(ctx, rest) {
  if (!rest[0]) { console.error("ERROR: service remove NAME"); process.exit(2); }
  removeService(ctx.config, rest[0]);
  saveConfig(ctx.stateDir, ctx.config);
  if (!ctx.opts.quiet) console.log(`Service '${rest[0]}' removed.`);
}

async function cmdServiceStart(ctx, rest) {
  await prepare(ctx);
  const list = ctx.config.services || [];
  const targets = rest.length ? rest.map(n => findService(ctx.config, n)).filter(Boolean) : list;
  if (!targets.length) {
    console.error("ERROR: no services to start (use 'service add' first or 'recipe NAME')");
    process.exit(2);
  }
  let failed = 0;
  for (const svc of targets) {
    const code = runIn({
      name: ctx.name, env: ctx.config.env, workdir: "/", user: "root", tty: false,
      cmd: ["sh", "-c", svcStartScript(svc)],
    });
    if (code !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}

async function cmdServiceStop(ctx, rest) {
  await prepare(ctx);
  const list = ctx.config.services || [];
  const targets = rest.length ? rest : list.map(s => s.name);
  for (const name of targets.reverse()) {
    runIn({
      name: ctx.name, env: ctx.config.env, workdir: "/", user: "root", tty: false,
      cmd: ["sh", "-c", svcStopScript(name)],
    });
  }
}

async function cmdServiceStatus(ctx, rest) {
  await prepare(ctx);
  const list = ctx.config.services || [];
  const names = rest.length ? rest : list.map(s => s.name);
  if (!names.length) {
    if (ctx.opts.json) console.log("[]"); else console.log("No services registered.");
    return;
  }
  const r = docker(["exec", "-i", "-u", "root", ctx.name, "sh", "-c", svcStatusScript(names)]);
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
  const parsed = lines.map(ln => {
    const m = ln.match(/^(\S+)\s+(\S+)(?:\s+pid=(\d+))?/);
    return m ? { name: m[1], state: m[2], pid: m[3] ? parseInt(m[3], 10) : null } : { raw: ln };
  });
  if (ctx.opts.json) { console.log(JSON.stringify(parsed, null, 2)); return; }
  console.log("NAME\tSTATE\tPID");
  for (const p of parsed) console.log(`${p.name}\t${p.state}\t${p.pid || ""}`);
}

async function cmdServiceLogs(ctx, rest) {
  if (!rest[0]) { console.error("ERROR: service logs NAME [-f]"); process.exit(2); }
  await prepare(ctx);
  const name = rest[0];
  const follow = rest.includes("-f") || rest.includes("--follow");
  const cmd = follow ? ["tail", "-n", "100", "-f", `/var/log/sundocked/${name}.log`]
                     : ["cat",  `/var/log/sundocked/${name}.log`];
  const code = runIn({
    name: ctx.name, env: ctx.config.env, workdir: "/", user: "root", tty: follow,
    cmd,
  });
  process.exit(code);
}

async function cmdWaitFor(ctx, rest) {
  let timeoutSec = 30;
  const targets = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--timeout" || a === "-t") { timeoutSec = parseInt(rest[++i], 10); continue; }
    targets.push(a);
  }
  if (!targets.length) {
    console.error("ERROR: wait-for URL_OR_HOST:PORT [--timeout SEC]");
    process.exit(2);
  }
  for (const t of targets) {
    if (!ctx.opts.quiet) process.stdout.write(`Waiting for ${t} (timeout ${timeoutSec}s)... `);
    const ok = await waitFor(t, { timeoutMs: timeoutSec * 1000 });
    if (!ctx.opts.quiet) console.log(ok ? "OK" : "TIMEOUT");
    if (!ok) process.exit(1);
  }
}

async function cmdRecipe(ctx, rest) {
  if (!rest[0]) { console.error("ERROR: recipe NAME (see 'sundocked recipes')"); process.exit(2); }
  const recipe = RECIPES[rest[0]];
  if (!recipe) { console.error(`ERROR: unknown recipe '${rest[0]}' (see 'sundocked recipes')`); process.exit(2); }

  // 1. Apply image/ports/env to config
  applyRecipeToConfig(recipe, ctx);
  saveConfig(ctx.stateDir, ctx.config);

  // 2. If image changed, recompute name + recreate
  const targetImage = ctx.opts.image || ctx.config.defaultImage;
  if (targetImage !== ctx.image) {
    ctx.image = targetImage;
    ctx.name = containerName(ctx.dirname, ctx.image);
    ctx.homeDir = homeDirFor(ctx.stateDir, ctx.image);
  }
  // If container exists with different ports, force reset
  const existing = containerInspect(ctx.name);
  if (existing && !checkPortsMatch(ctx.name, ctx.config.ports)) {
    if (!ctx.opts.quiet) console.log("Recreating container to apply ports...");
    destroyContainer(ctx.name);
  }
  await prepare(ctx);

  // 3. Install packages
  if (recipe.install?.length) {
    if (!ctx.opts.quiet) console.log(`Installing: ${recipe.install.join(" ")}`);
    runIn({
      name: ctx.name, env: ctx.config.env, workdir: "/", user: "root", tty: false,
      cmd: ["sh", "-c", PKG_MGR_DETECT, "sh", ...recipe.install],
    });
  }

  // 4. Drop config files
  for (const [pathInside, content] of Object.entries(recipe.files || {})) {
    if (!ctx.opts.quiet) console.log(`Writing ${pathInside}`);
    const r = spawnSync("docker", ["exec", "-i", "-u", "root", ctx.name, "sh", "-c", `mkdir -p "$(dirname '${pathInside}')" && cat > '${pathInside}'`],
      { input: content, windowsHide: true });
    if (r.status !== 0) {
      console.error(`Failed to write ${pathInside}`);
      process.exit(1);
    }
  }

  // 5. Start services
  if (recipe.services?.length) {
    if (!ctx.opts.quiet) console.log("Starting services...");
    for (const svc of recipe.services) {
      runIn({
        name: ctx.name, env: ctx.config.env, workdir: "/", user: "root", tty: false,
        cmd: ["sh", "-c", svcStartScript(svc)],
      });
    }
  }

  // 6. wait-for
  if (recipe.waitFor) {
    if (!ctx.opts.quiet) process.stdout.write(`Waiting for ${recipe.waitFor}... `);
    const ok = await waitFor(recipe.waitFor, { timeoutMs: 30000 });
    if (!ctx.opts.quiet) console.log(ok ? "OK" : "TIMEOUT");
    if (!ok) process.exit(1);
  }

  if (!ctx.opts.quiet) {
    console.log(`\nRecipe '${rest[0]}' applied.`);
    if (ctx.config.ports?.length) {
      console.log(`Ports: ${ctx.config.ports.join(", ")}`);
    }
  }
}

function cmdRecipes(ctx) {
  if (ctx.opts.json) {
    const out = {};
    for (const [k, r] of Object.entries(RECIPES)) {
      out[k] = { description: r.description, image: r.image, ports: r.ports || [], services: (r.services || []).map(s => s.name) };
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  console.log("Available recipes:\n");
  for (const [k, r] of Object.entries(RECIPES)) {
    console.log(`  ${k}`);
    console.log(`    ${r.description}`);
    if (r.image) console.log(`    image: ${r.image}`);
    if (r.ports?.length) console.log(`    ports: ${r.ports.join(", ")}`);
    if (r.services?.length) console.log(`    services: ${r.services.map(s => s.name).join(", ")}`);
    console.log("");
  }
}

function cmdList(ctx) {
  const r = docker(["ps", "-a", "--filter", "name=sundocked-", "--format",
    "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"]);
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
  if (ctx.opts.json) {
    const out = lines.map(ln => {
      const [name, image, status, ports] = ln.split("\t");
      return { name, image, status, ports };
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (!lines.length) { console.log("No sundocked containers found."); return; }
  console.log("NAME\tIMAGE\tSTATUS\tPORTS");
  for (const ln of lines) console.log(ln);
}

// ---- Prepare (ensure container is ready) ----
async function prepare(ctx) {
  if (ctx.image && ctx.opts.image && ctx.image !== ctx.opts.image) {
    // image was overridden via --image; recompute name and home
  }
  // Apply --port / --env additions to config (idempotent: dedupe, persist)
  let configChanged = false;
  if (ctx.opts.ports?.length) {
    const set = new Set(ctx.config.ports || []);
    for (const p of ctx.opts.ports) if (!set.has(p)) { set.add(p); configChanged = true; }
    ctx.config.ports = [...set];
  }
  if (ctx.opts.env?.length) {
    const set = new Set(ctx.config.env || []);
    for (const e of ctx.opts.env) if (!set.has(e)) { set.add(e); configChanged = true; }
    ctx.config.env = [...set];
  }
  if (ctx.opts.hostNetwork && ctx.config.network !== "host") {
    ctx.config.network = "host"; configChanged = true;
  }
  if (configChanged) saveConfig(ctx.stateDir, ctx.config);

  const existing = containerInspect(ctx.name);
  if (existing && configChanged) {
    if (!checkPortsMatch(ctx.name, ctx.config.ports)) {
      console.error(`WARNING: ports in config changed, but the container already exists with different mappings.`);
      console.error(`  To apply — run: sundocked reset`);
    }
  }

  await ensureContainer({
    name: ctx.name, image: ctx.image, cwd: ctx.cwd,
    homeDir: ctx.homeDir, config: ctx.config, opts: ctx.opts,
  });
}

// ---- Help ----
function shortHelp() {
  console.log(`sundocked — Docker-based command isolation with one long-lived container per directory.

USAGE:
  sundocked [GLOBAL-OPTS] [SUBCOMMAND] [ARGS...]
  sundocked [GLOBAL-OPTS] CMD ARGS...      # no subcommand: TTY shell or one-off command

SUBCOMMANDS:
  shell                        interactive shell (default when no command given)
  exec CMD ARGS...             run command non-TTY (for scripts/agents)
  install PKG1 [PKG2...]       install packages (auto-detects apt/apk/dnf/yum/pacman/zypper)
  cc [ARGS...]                 launch claude-code (--dangerously-skip-permissions)
  status                       show container state (use --json for agents)
  start | stop | restart       lifecycle
  logs [-f]                    docker logs of the container
  reset                        destroy and recreate (wipes /root and installed packages)
  list                         list all sundocked containers on this host
  switch                       pick a new default image
  service SUB [ARGS]           manage in-container background services
                                 add NAME -- CMD       register a service
                                 remove NAME           unregister
                                 start [NAME]          start one or all
                                 stop [NAME]           stop one or all
                                 restart [NAME]        stop+start
                                 status [NAME]         show running state (--json)
                                 list                  list registered services (--json)
                                 logs NAME [-f]        tail service log
  wait-for URL|HOST:PORT       wait until target accepts connections (--timeout SEC)
  recipe NAME                  apply a preset (image+install+files+services+wait-for)
  recipes                      list available recipes (--json)

GLOBAL FLAGS:
  --image NAME                 base image (e.g. node:22-slim)
  --port HOST:CONTAINER        publish port (repeatable, persisted to config)
  --env KEY=VAL                env var for the container (repeatable, persisted)
  --user USER                  run exec as USER (default: root)
  --workdir DIR                working directory inside container (default: /work)
  --tty                        force TTY for exec (default: non-TTY)
  --host-network               run container with --network=host (bypasses Docker
                               bridge & DNS; persisted to config; needs reset)
  --json                       machine-readable output (for status/list)
  --quiet                      suppress decorative messages
  --help, -h                   short help
  --detailed-help              long help with examples and agent-oriented notes

For full help: sundocked --detailed-help`);
}

function detailedHelp() {
  console.log(`sundocked — DETAILED HELP

═══════════════════════════════════════════════════════════════════════════════
WHAT
═══════════════════════════════════════════════════════════════════════════════

Sundocked is a thin wrapper around Docker that runs commands in an isolated
container with access to the current directory. One long-lived container per
(directory, image) — installed packages, /etc tweaks and /root configs persist
between runs. Built for humans and AI agents: one CLI, no Dockerfile, no
docker-compose.yml, no per-language template gymnastics.

═══════════════════════════════════════════════════════════════════════════════
WHY
═══════════════════════════════════════════════════════════════════════════════

1. Sandbox AI agents (Claude Code) — they can only write to the current dir
2. Project-scoped dev envs — no node_modules / .venv / global package conflicts
3. Disposable test stacks (nginx+php-fpm, postgres, redis) in one command
4. Reproducible: one config.ktav file → same environment for everyone

═══════════════════════════════════════════════════════════════════════════════
QUICK START (30 seconds)
═══════════════════════════════════════════════════════════════════════════════

  cd /path/to/project
  sundocked --image node:22-slim     # pick image once, container is created
  npm install && npm test            # you're now in a shell inside it

  # OR for agents (no interactive shell):
  sundocked --image node:22-slim exec npm test

═══════════════════════════════════════════════════════════════════════════════
HOW IT WORKS
═══════════════════════════════════════════════════════════════════════════════

On first run inside /path/to/myproj:
  • State directory: ../.sundocked/myproj/<image-safe>/home/
  • Base image picked interactively or via --image
  • Long-lived container: sundocked-myproj-<image-safe>
    running "tail -f /dev/null" (idle keeper)
  • CWD bind-mounted as /work; ${'$'}HOME (state/home/) bind-mounted as /root
  • Your command runs via "docker exec"

Subsequent runs:
  • running → "docker exec" right away
  • stopped → "docker start" + exec
  • Installed packages (apt install ...) live in container's writable layer
  • /root (configs, shell history) survives on host between recreations

═══════════════════════════════════════════════════════════════════════════════
NAMING & PATHS
═══════════════════════════════════════════════════════════════════════════════

  CWD:               /path/to/myproj
  Container:         sundocked-myproj-<image-safe>     (one per dir × image)
  State dir:         ../.sundocked/myproj/<image-safe>/
  /work:             bind-mount of /path/to/myproj
  /root:             bind-mount of ../.sundocked/myproj/<image-safe>/home/
  Config:            ../.sundocked/myproj/config.ktav

═══════════════════════════════════════════════════════════════════════════════
WORKFLOWS — by language / use case
═══════════════════════════════════════════════════════════════════════════════

──────────────── Node.js project ────────────────
  sundocked --image node:22-slim
  npm ci
  npm test
  npm run build
  # Dev server with port mapped to host:
  sundocked --image node:22-slim --port 3000:3000
  npm run dev   # browser: http://localhost:3000

──────────────── Python project ────────────────
  sundocked --image python:3.12-slim
  pip install -r requirements.txt
  pytest
  # Or with poetry:
  sundocked --image python:3.12-slim install curl
  sundocked exec sh -c 'curl -sSL https://install.python-poetry.org | python3 -'
  sundocked exec poetry install
  sundocked exec poetry run pytest

──────────────── PHP project ────────────────
  sundocked --image php:8.3-cli install unzip git
  sundocked exec sh -c 'curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer'
  sundocked exec composer install
  sundocked exec ./vendor/bin/phpunit

──────────────── Rust / Go ────────────────
  sundocked --image rust:1-slim
  cargo build --release
  cargo test

  sundocked --image golang:1.23-alpine
  go mod download
  go test ./...

──────────────── Test stack with database ────────────────
  cd /your/api/project
  sundocked recipe postgres                     # spins up postgres on :5432
  sundocked exec npm test                        # tests connect to localhost:5432

──────────────── Web stack (nginx + php-fpm) for E2E ────────────────
  cd /your/php/project
  sundocked recipe nginx-php                     # image+nginx config+services
  curl http://localhost:8080/                    # smoke test from host
  sundocked exec ./vendor/bin/phpunit            # tests run inside

──────────────── Watching / live reload ────────────────
  sundocked --image node:22-slim --port 3000:3000 install watchexec
  sundocked exec watchexec -e ts,tsx -- npm run dev

──────────────── Switching images mid-project ────────────────
  # Each image has its OWN container and /root state.
  sundocked --image node:22-alpine npm test       # runs in alpine container
  sundocked --image node:22-bookworm npm test     # runs in different container
  sundocked switch                                # change default for next run
  sundocked list                                  # see both containers

──────────────── Resetting state ────────────────
  sundocked reset                  # for the current default image
  sundocked --image alpine:3.20 reset
  sundocked --image node:22-slim status --json   # confirm state

═══════════════════════════════════════════════════════════════════════════════
SERVICE PATTERNS
═══════════════════════════════════════════════════════════════════════════════

──────────────── One background service ────────────────
  sundocked service add api -- node server.js
  sundocked service start
  sundocked service status
  sundocked exec curl -s http://localhost:3000/health
  sundocked service logs api -f
  sundocked service stop api

──────────────── Multi-service stack (manual) ────────────────
  sundocked --image debian:bookworm install postgresql-15 redis-server nginx
  sundocked service add postgres -- su postgres -c 'pg_ctlcluster 15 main start --foreground'
  sundocked service add redis    -- redis-server
  sundocked service add api      -- /work/bin/start
  sundocked service start                   # starts in declared order
  sundocked wait-for tcp:localhost:5432
  sundocked wait-for tcp:localhost:6379
  sundocked wait-for http://localhost:8080/ready
  sundocked exec ./run-e2e-tests.sh

──────────────── Restarting one service after code change ────────────────
  sundocked service restart api

──────────────── Inspect logs without entering container ────────────────
  sundocked service logs api          # full log
  sundocked service logs api -f       # tail -f

═══════════════════════════════════════════════════════════════════════════════
AGENT PLAYBOOKS (parseable, deterministic)
═══════════════════════════════════════════════════════════════════════════════

──────────────── Run tests, get exit code & output ────────────────
  sundocked exec --quiet npm test > out.log 2>&1
  RC=$?
  jq -n --arg log "$(cat out.log)" --argjson rc $RC '{exitCode:$rc, log:$log}'

──────────────── Bring up env, verify, run tests, tear down ────────────────
  sundocked recipe nginx-php
  sundocked wait-for http://localhost:8080/ --timeout 30 || exit 1
  sundocked exec ./run-tests.sh
  RC=$?
  sundocked service stop
  exit $RC

──────────────── Reset to clean state, rerun ────────────────
  sundocked reset
  sundocked recipe postgres
  sundocked exec npm run db:migrate
  sundocked exec npm test

──────────────── Probe service health before depending on it ────────────────
  sundocked service start
  sundocked wait-for tcp:localhost:5432 --timeout 30 \\
    || { sundocked service logs postgres; exit 1; }

──────────────── Inspect container for a JSON status ────────────────
  sundocked status --json | jq '{state, ports, mounts: (.mounts | length)}'

──────────────── List all sundocked containers programmatically ────────────────
  sundocked list --json | jq '.[] | select(.status | test("Up"))'

═══════════════════════════════════════════════════════════════════════════════
RECIPES (built-in presets)
═══════════════════════════════════════════════════════════════════════════════

  sundocked recipes               # list with descriptions
  sundocked recipes --json        # machine-readable

  sundocked recipe nginx-php      # PHP-FPM + nginx, /work/public root, :8080
  sundocked recipe postgres       # PostgreSQL 16, persistent /root/pgdata, :5432
  sundocked recipe redis          # Redis 7 with appendonly persistence, :6379

A recipe is a single command that does:
  1. Sets image (and reset container if image changed)
  2. Sets ports (recreates container if ports changed)
  3. Installs packages
  4. Writes config files into the container
  5. Registers + starts services
  6. wait-for to verify the stack is up

═══════════════════════════════════════════════════════════════════════════════
CLAUDE CODE WORKFLOW
═══════════════════════════════════════════════════════════════════════════════

  cd /path/to/project
  sundocked --image node:22-slim cc        # auto-installs claude on first run
  # Claude Code now runs inside the container with /work as CWD; it can ONLY
  # write inside the project — host files outside the dir are unreachable.

  # Resume a previous Claude session:
  sundocked cc --resume

  # Use "node:22-slim" or "node:22-alpine" so npm is present;
  # "node:22-bookworm" if you need glibc-based native modules.

═══════════════════════════════════════════════════════════════════════════════
NOTES FOR AI AGENTS
═══════════════════════════════════════════════════════════════════════════════

• "exec" is non-TTY by default — designed for scripting; "shell" or no-arg is TTY
• Exit codes propagate from the inner command unmodified
• "status --json", "list --json", "service status --json", "service list --json",
  "recipes --json" are stable machine-readable interfaces
• "install" auto-detects apt/apk/dnf/yum/pacman/zypper — don't pre-detect
• "wait-for" lets you avoid sleep-races against services
• /work is the host CWD bind-mount — changes propagate both ways immediately
• /root is bind-mounted from ../.sundocked/<dir>/<image>/home/ on host
• Changing --port / --env warns and requires "sundocked reset" to take effect
• Image, ports, env, services persist in config.ktav (next to state-dir)

═══════════════════════════════════════════════════════════════════════════════
FILE: config.ktav (Ktav 0.3.0)
═══════════════════════════════════════════════════════════════════════════════

../.sundocked/<dirname>/config.ktav — shared across images for that directory.
(Legacy config.json is read once and migrated to .ktav on next save.)

  defaultImage: node:22-slim
  ports: [
      8080:80
      5432:5432
  ]
  env: [
      NODE_ENV=development
      TZ=UTC
  ]
  services: [
      { name: php-fpm   cmd: php-fpm -F }
      { name: nginx     cmd: nginx -g 'daemon off;' }
  ]

You can hand-edit this file. Lists are whitespace-separated, no commas, no
quotes. Comments start with #. See https://github.com/ktav-lang/spec.

═══════════════════════════════════════════════════════════════════════════════
EXIT CODES
═══════════════════════════════════════════════════════════════════════════════

  0           ok / command succeeded
  1           internal failure (Docker not running, container can't be created)
  2           CLI usage error
  127         command not found inside container (for install: no pkg manager)
  <other>     exit code of the inner command, propagated verbatim

═══════════════════════════════════════════════════════════════════════════════
TROUBLESHOOTING
═══════════════════════════════════════════════════════════════════════════════

• "docker daemon is not running"
    → launch Docker Desktop, wait for "Engine running" indicator

• "ECONNREFUSED registry.npmjs.org" / "127.x.x.x" hijacked DNS
    → Docker Desktop "Hub Proxy" is intercepting; Settings → Resources →
      Proxies → set "No proxy", or settings-store.json → "WslEngineEnabled": true

• "EOF on docker pipe"
    → Docker Desktop hung; tray → Restart Docker

• Cyrillic / non-ASCII shows as escape codes on Windows cmd.exe
    → run "chcp 65001" once; the .cmd wrapper does this automatically;
      container env is already UTF-8

• "Can't change ports on existing container"
    → sundocked reset (will lose /etc tweaks and installed packages,
      but config.ktav is preserved so service definitions survive)

• "service start" says "already running" but service isn't responding
    → sundocked service logs NAME; sundocked service restart NAME

• Native modules fail in alpine/musl images
    → switch to a glibc base: --image node:22-bookworm (or python:3.12-bookworm)

• Need a TTY inside exec (e.g. running interactive scripts)
    → sundocked --tty exec ./interactive.sh

═══════════════════════════════════════════════════════════════════════════════
COMPARISON
═══════════════════════════════════════════════════════════════════════════════

vs raw "docker run"
  + No -v / -w / --name / -p / --dns boilerplate per command
  + Long-lived container — apt installs persist between exec calls
  + Auto-detect package manager
  + Built-in service supervisor (PID files, logs)
  + Ktav config persists ports / env / services

vs docker-compose
  + No YAML, single command
  - Single container per (dir × image), not multi-container networks
  + Recipes give you a one-line equivalent for common stacks
  + Better for ad-hoc dev / agent scripting; compose is better for prod

vs devcontainers (.devcontainer/)
  + No JSON template, no editor lock-in (works from CLI alone)
  + Simpler mental model — just CWD bind-mount + persistent /root
  - No automatic editor integration; use Claude Code via "sundocked cc"

═══════════════════════════════════════════════════════════════════════════════
SEE ALSO
═══════════════════════════════════════════════════════════════════════════════

  sundocked --help                # short usage summary
  sundocked recipes               # list built-in stack presets
  sundocked recipes --json        # machine-readable recipe catalog
  sundocked status --json         # current container state
  sundocked list --json           # all sundocked containers on this host
`);
}

// ---- Arg parser ----
const SUBCOMMANDS = new Set([
  "shell", "exec", "install", "cc", "status", "start", "stop", "restart",
  "logs", "reset", "list", "switch", "help",
  "service", "wait-for", "recipe", "recipes",
]);

const FLAGS_WITH_VALUE = new Set(["--image", "--port", "--env", "--user", "--workdir"]);
const FLAGS_BOOL = new Set(["--tty", "--json", "--quiet", "--help", "-h", "--detailed-help", "--host-network"]);

function parseArgs(argv) {
  const opts = {
    image: null, ports: [], env: [], user: null, workdir: null,
    tty: false, json: false, quiet: false, hostNetwork: false,
    help: false, detailedHelp: false,
  };
  let subcommand = null;
  const rest = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      // explicit separator — everything after is user-command
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (FLAGS_BOOL.has(a)) {
      if (a === "--help" || a === "-h") opts.help = true;
      else if (a === "--detailed-help") opts.detailedHelp = true;
      else if (a === "--tty") opts.tty = true;
      else if (a === "--json") opts.json = true;
      else if (a === "--quiet") opts.quiet = true;
      else if (a === "--host-network") opts.hostNetwork = true;
      i++;
    } else if (FLAGS_WITH_VALUE.has(a)) {
      const val = argv[++i];
      if (a === "--image") opts.image = val;
      else if (a === "--port") opts.ports.push(val);
      else if (a === "--env") opts.env.push(val);
      else if (a === "--user") opts.user = val;
      else if (a === "--workdir") opts.workdir = val;
      i++;
    } else if (subcommand === null) {
      if (SUBCOMMANDS.has(a)) {
        subcommand = a;
        i++;
      } else {
        // legacy: first arg is part of command
        subcommand = "_legacy";
        rest.push(...argv.slice(i));
        break;
      }
    } else {
      // user-command starts here — take everything verbatim
      rest.push(...argv.slice(i));
      break;
    }
  }
  return { opts, subcommand, rest };
}

// ---- Main ----
async function main() {
  const cwd = process.cwd();
  const dirname = path.basename(cwd);
  const parentDir = path.dirname(cwd);
  const stateDir = path.join(parentDir, ".sundocked", dirname);

  const { opts, subcommand, rest } = parseArgs(process.argv.slice(2));

  if (opts.help)         { shortHelp(); return; }
  if (opts.detailedHelp) { detailedHelp(); return; }
  if (subcommand === "help") { detailedHelp(); return; }

  dockerCheck();

  // For "list" we don't need image/container resolution
  if (subcommand === "list") {
    return cmdList({ opts });
  }

  fs.mkdirSync(stateDir, { recursive: true });
  const config = loadConfig(stateDir);

  let image = opts.image || (subcommand === "switch" ? null : config.defaultImage);
  if (!image) {
    image = await selectImage();
    config.defaultImage = image;
    saveConfig(stateDir, config);
  } else if (!config.defaultImage && !opts.image) {
    config.defaultImage = image;
    saveConfig(stateDir, config);
  }

  if (subcommand === "switch") {
    config.defaultImage = image;
    saveConfig(stateDir, config);
    if (!opts.quiet) console.log(`Default image set to ${image}.`);
    return;
  }

  const name = containerName(dirname, image);
  const homeDir = homeDirFor(stateDir, image);
  const ctx = {
    cwd, dirname, stateDir, name, image, homeDir, config, opts,
    workdir: opts.workdir || "/work",
    user: opts.user, tty: opts.tty,
  };

  switch (subcommand) {
    case null:
    case "_legacy":
    case "shell":
      if (rest.length > 0 && subcommand !== "shell") {
        // legacy: sundocked CMD args... — TTY exec
        await prepare(ctx);
        const code = runIn({
          name, env: config.env, workdir: ctx.workdir, user: ctx.user, tty: true, cmd: rest,
        });
        process.exit(code);
      }
      return cmdShell(ctx);
    case "exec":     return cmdExec(ctx, rest);
    case "install":  return cmdInstall(ctx, rest);
    case "cc":       return cmdCc(ctx, rest);
    case "status":   return cmdStatus(ctx);
    case "start":    return cmdStart(ctx);
    case "stop":     return cmdStop(ctx);
    case "restart":  return cmdRestart(ctx);
    case "logs":     return cmdLogs(ctx, rest);
    case "reset":    return cmdReset(ctx);
    case "service":  return cmdService(ctx, rest[0], rest.slice(1));
    case "wait-for": return cmdWaitFor(ctx, rest);
    case "recipe":   return cmdRecipe(ctx, rest);
    case "recipes":  return cmdRecipes(ctx);
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      process.exit(2);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
