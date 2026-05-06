#!/usr/bin/env node
const { execSync, spawn, spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---- Detect Sandboxie ----
const SBIE_PATHS = [
  "C:\\Program Files\\Sandboxie-Plus",
  "C:\\Program Files (x86)\\Sandboxie-Plus",
];
const SBIE = SBIE_PATHS.find(p => fs.existsSync(path.join(p, "Start.exe")));
if (!SBIE) {
  console.log("ERROR: Sandboxie-Plus not found. Install from https://sandboxie-plus.com/");
  process.exit(1);
}
const SBIE_INI = path.join(SBIE, "SbieIni.exe");
const SBIE_START = path.join(SBIE, "Start.exe");

let hasPty = false;
try { require("node-pty"); hasPty = true; } catch (_) {}

const cwd = process.cwd();
const dirname = path.basename(cwd);
const parentDir = path.dirname(cwd);
const overlay = path.join(parentDir, ".sbox", dirname);
const hash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 16).toUpperCase();
const box = `_SB_${hash}`;

// ---- Helpers ----
function sbie(cmd, ...args) {
  try {
    spawnSync(SBIE_INI, [cmd, ...args], { stdio: "pipe", windowsHide: true });
  } catch (_) {}
}

function sbiQuery(setting) {
  try {
    const r = spawnSync(SBIE_INI, ["query", box, setting], { encoding: "utf-8", windowsHide: true });
    return (r.stdout || "").trim().split("\r\n").filter(Boolean);
  } catch (_) { return []; }
}

function sbiDel(setting) {
  for (const v of sbiQuery(setting)) {
    sbie("delete", box, setting, v);
  }
}

function startExe(...args) {
  return spawnSync(SBIE_START, args, { stdio: "pipe", windowsHide: true });
}

function startExeRun(...args) {
  // Start.exe must be called from cmd.exe context to sandbox correctly
  const cmdLine = args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
  const batFile = path.join(overlay, "__run.cmd");
  fs.mkdirSync(path.dirname(batFile), { recursive: true });
  fs.writeFileSync(batFile, `@"${SBIE_START}" ${cmdLine}\r\n`);
  const r = spawnSync("cmd.exe", ["/c", batFile], { stdio: "pipe", windowsHide: true, cwd });
  try { fs.unlinkSync(batFile); } catch (_) {}
  return r;
}


// ---- Parse args ----
const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
  usage();
  process.exit(1);
}

if (rawArgs[0] === "/reset") {
  doReset();
  process.exit(0);
}

if (rawArgs[0] === "/snap") {
  doSnap(rawArgs.slice(1));
  process.exit(0);
}

const flags = { tty: false, show: false, netBlock: false, readonly: false, noPty: false, allow: [], deny: [] };
let cmdArgs = [];
let i = 0;
while (i < rawArgs.length) {
  const a = rawArgs[i];
  if (a === "--") { i++; break; }
  if (a.toLowerCase() === "/tty") { flags.tty = true; i++; continue; }
  if (a.toLowerCase() === "/show") { flags.show = true; i++; continue; }
  if (a.toLowerCase() === "/net-block") { flags.netBlock = true; i++; continue; }
  if (a.toLowerCase() === "/no-pty") { flags.noPty = true; i++; continue; }
  if (a.toLowerCase() === "/readonly") { flags.readonly = true; i++; continue; }
  const lower = a.toLowerCase();
  if (lower.startsWith("/allow:")) { flags.allow.push(a.substring(7)); i++; continue; }
  if (lower.startsWith("/deny:")) { flags.deny.push(a.substring(6)); i++; continue; }
  break;
}
cmdArgs = rawArgs.slice(i);

if (cmdArgs.length === 0) {
  usage();
  process.exit(1);
}

// ---- Configure sandbox ----
harden();
configurePaths();

if (flags.tty) {
  runTty(cmdArgs);
} else if (flags.show) {
  runShow(cmdArgs);
} else if (hasPty && !flags.noPty) {
  runRelay(cmdArgs);
} else {
  runHidden(cmdArgs);
}

// ---- Functions ----

function harden() {
  sbie("set", box, "Enabled", "y");
  sbie("set", box, "FileRootPath", overlay);
  sbie("set", box, "ConfigLevel", "99");
  sbie("set", box, "BlockNetworkFiles", "y");
  sbie("set", box, "Template", "BlockPorts");
  sbie("append", box, "OpenIpcPath", "*");
}

function configurePaths() {
  sbiDel("OpenFilePath");
  sbiDel("ClosedFilePath");
  sbiDel("OpenPipePath");
  sbiDel("BlockNetworkConnect");

  if (!flags.readonly) {
    if (flags.allow.length === 0) {
      sbie("set", box, "OpenFilePath", cwd);
    } else {
      for (const p of flags.allow) {
        sbie("append", box, "OpenFilePath", path.join(cwd, p));
      }
    }
  }

  for (const p of flags.deny) {
    sbie("append", box, "ClosedFilePath", path.join(cwd, p));
  }

  if (flags.netBlock) {
    sbie("set", box, "BlockNetworkConnect", "y");
  }

  startExe("/reload");
}

function removeBoxConfig() {
  sbie("set", box, "Enabled", "n");
}

function detectTermSize() {
  // 1. Native Node.js (works when stdout is a real TTY)
  if (process.stdout.columns && process.stdout.rows) {
    return [process.stdout.columns, process.stdout.rows];
  }
  // 2. Environment variables (set by some shells)
  if (process.env.COLUMNS && process.env.LINES) {
    return [parseInt(process.env.COLUMNS), parseInt(process.env.LINES)];
  }
  // 3. stty (works in MSYS2/Git Bash)
  try {
    const out = execSync("stty size", { encoding: "utf-8", stdio: ["pipe","pipe","pipe"], windowsHide: true, timeout: 2000 }).trim();
    const [r, c] = out.split(/\s+/).map(Number);
    if (c > 0 && r > 0) return [c, r];
  } catch (_) {}
  // 4. PowerShell (works in cmd.exe and most Windows terminals)
  try {
    const out = execSync("powershell -NoProfile -Command \"[Console]::WindowWidth,[Console]::WindowHeight -join ','\"",
      { encoding: "utf-8", stdio: ["pipe","pipe","pipe"], windowsHide: true, timeout: 3000 }).trim();
    const [c, r] = out.split(",").map(Number);
    if (c > 0 && r > 0) return [c, r];
  } catch (_) {}
  return [80, 24];
}

function resolveCommand(args) {
  const cmd = args[0];
  try {
    const resolved = execSync(`where ${cmd}`, { encoding: "utf-8", windowsHide: true, stdio: ["pipe","pipe","pipe"] }).trim().split("\n")[0].trim();
    return [resolved, ...args.slice(1)];
  } catch (_) {
    return args;
  }
}

function runHidden(args) {
  args = resolveCommand(args);
  const r = startExeRun("/box:" + box, "/hide_window", "/wait", ...args);
  startExe("/box:" + box, "/silent", "/terminate");
  removeBoxConfig();
  process.exit(r.status || 0);
}

function runShow(args) {
  args = resolveCommand(args);
  const r = startExeRun("/box:" + box, "/wait", ...args);
  startExe("/box:" + box, "/silent", "/terminate");
  process.exit(r.status || 0);
}

function runRelay(args) {
  args = resolveCommand(args);
  const net = require("net");
  const hostScript = path.join(__dirname, "sunboxed-host.js");
  const node = process.execPath;
  const [cols, rows] = detectTermSize();
  const token = crypto.randomBytes(64).toString("hex");

  // Prevent Ctrl+C from killing the relay — bytes are forwarded to host PTY
  process.on("SIGINT", () => {});

  let cleaned = false;
  function cleanup(code) {
    if (cleaned) return;
    cleaned = true;
    if (process.stdin.isTTY) {
      // Restore terminal: exit alt screen, show cursor, reset attrs
      // Only clear screen on clean exit — on error leave output visible
      const clear = code === 0 ? "\x1b[2J\x1b[H" : "\n";
      try { process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[0m" + clear); } catch (_) {}
      try { process.stdin.setRawMode(false); } catch (_) {}
    }
    process.stdin.pause();
    startExe("/box:" + box, "/silent", "/terminate");
    removeBoxConfig();
    process.exit(code || 0);
  }

  function sendMsg(socket, msg) {
    try { socket.write(JSON.stringify(msg) + "\n"); } catch (_) {}
  }

  function parseMessages(buf, cb) {
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        try { cb(JSON.parse(line)); } catch (_) {}
      }
    }
    return buf;
  }

  let authenticated = false;

  let connectTimeout;

  const server = net.createServer(socket => {
    clearTimeout(connectTimeout);
    server.close();

    let buf = "";
    socket.on("data", chunk => {
      buf = parseMessages(buf + chunk.toString(), msg => {
        // Verify auth token before accepting any data
        if (!authenticated) {
          if (msg.t === "auth" && msg.token === token) {
            authenticated = true;
          } else if (msg.t !== "auth") {
            socket.destroy();
          }
          return;
        }

        if (msg.t === "o" && msg.d) {
          process.stdout.write(Buffer.from(msg.d, "base64"));
        } else if (msg.t === "x") {
          cleanup(msg.c || 0);
        } else if (msg.t === "ready") {
          // Host PTY is ready — start relay
          const isTTY = process.stdin.isTTY;
          if (isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();

          let ctrlCTimes = [];
          process.stdin.on("data", data => {
            // Triple Ctrl+C within 2s = force exit relay (TTY only)
            if (isTTY && data.length === 1 && data[0] === 0x03) {
              const now = Date.now();
              ctrlCTimes.push(now);
              ctrlCTimes = ctrlCTimes.filter(t => now - t < 2000);
              if (ctrlCTimes.length >= 3) {
                cleanup(130);
                return;
              }
            }
            sendMsg(socket, { t: "i", d: data.toString("base64") });
          });

          sendMsg(socket, { t: "r", c: cols, r: rows });

          process.stdout.on("resize", () => {
            sendMsg(socket, { t: "r", c: process.stdout.columns, r: process.stdout.rows });
          });
        }
      });
    });

    socket.on("close", () => cleanup(1));
    socket.on("error", () => cleanup(1));
  });

  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;

    // Launch host inside sandbox via .cmd
    const startArgs = [
      "/box:" + box, "/hide_window",
      node, hostScript,
      "--port", String(port),
      "--token", token,
      "--cols", String(cols),
      "--rows", String(rows),
      "--", ...args
    ];
    const cmdLine = startArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
    const batFile = path.join(overlay, "__relay.cmd");
    fs.mkdirSync(path.dirname(batFile), { recursive: true });
    fs.writeFileSync(batFile, `@"${SBIE_START}" ${cmdLine}\r\n`);

    const child = spawn("cmd.exe", ["/c", batFile], {
      stdio: "pipe",
      windowsHide: true,
      cwd,
    });
    child.unref();
  });

  // timeout if host doesn't connect
  connectTimeout = setTimeout(() => {
    console.error("Timeout: sandbox host did not connect within 15s.");
    server.close();
    cleanup(1);
  }, 15000);
}

function runTty(args) {
  const tty = findTerminal();
  if (!tty) {
    console.log("ERROR: /tty requires a terminal emulator.");
    console.log("Supported: WezTerm, Windows Terminal");
    console.log("Or set SUNBOXED_TERMINAL=path\\to\\terminal.exe");
    process.exit(1);
  }

  const cmd = args.join(" ");
  let launchArgs;

  if (tty.type === "wezterm") {
    launchArgs = ["/box:" + box, tty.exe, "start", "--cwd", cwd, "--", "cmd", "/k", cmd];
  } else if (tty.type === "wt") {
    launchArgs = ["/box:" + box, tty.exe, "-d", cwd, "cmd", "/k", cmd];
  } else {
    launchArgs = ["/box:" + box, tty.exe, "cmd", "/k", cmd];
  }

  const child = require("child_process").spawn(SBIE_START, launchArgs, {
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref();
}

function findTerminal() {
  if (process.env.SUNBOXED_TERMINAL) {
    return { exe: process.env.SUNBOXED_TERMINAL, type: "custom" };
  }

  const wezPaths = [
    "C:\\Program Files\\WezTerm\\wezterm-gui.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "WezTerm", "wezterm-gui.exe"),
  ];
  const wez = wezPaths.find(p => fs.existsSync(p));
  if (wez) return { exe: wez, type: "wezterm" };

  try {
    const wt = execSync("where wt.exe", { encoding: "utf-8", windowsHide: true }).trim().split("\n")[0];
    if (wt) return { exe: wt.trim(), type: "wt" };
  } catch (_) {}

  return null;
}

function doReset() {
  sbie("set", box, "Enabled", "y");
  sbie("set", box, "FileRootPath", overlay);
  startExe("/reload");
  startExe("/box:" + box, "/silent", "/terminate");
  startExe("/box:" + box, "/silent", "delete_sandbox_silent");
  console.log("Overlay cleared: " + overlay);
}

function doSnap(args) {
  const snapDir = path.join(parentDir, ".sbox", dirname, "__snapshots__");
  const sub = (args[0] || "").toLowerCase();
  const name = args[1];

  if (sub === "create") {
    if (!name) { console.log("ERROR: Specify snapshot name."); process.exit(1); }
    const snapPath = path.join(snapDir, name);
    if (fs.existsSync(snapPath)) { console.log(`ERROR: Snapshot "${name}" already exists.`); process.exit(1); }
    fs.mkdirSync(snapPath, { recursive: true });
    spawnSync("robocopy", [cwd, path.join(snapPath, "data"), "/MIR",
      "/XD", ".git", "node_modules", ".sbox", "__pycache__",
      "/XF", ".env.local",
      "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"],
      { stdio: "pipe", windowsHide: true });
    fs.writeFileSync(path.join(snapPath, "created.txt"), new Date().toISOString());
    console.log("Snapshot created: " + name);
  } else if (sub === "list") {
    if (!fs.existsSync(snapDir)) { console.log("No snapshots."); return; }
    const entries = fs.readdirSync(snapDir, { withFileTypes: true }).filter(d => d.isDirectory());
    if (entries.length === 0) { console.log("No snapshots."); return; }
    for (const d of entries) {
      let date = "";
      const tf = path.join(snapDir, d.name, "created.txt");
      if (fs.existsSync(tf)) date = fs.readFileSync(tf, "utf-8").trim();
      console.log(`  ${d.name}    ${date}`);
    }
  } else if (sub === "restore") {
    if (!name) { console.log("ERROR: Specify snapshot name."); process.exit(1); }
    const dataPath = path.join(snapDir, name, "data");
    if (!fs.existsSync(dataPath)) { console.log(`ERROR: Snapshot "${name}" not found.`); process.exit(1); }
    spawnSync("robocopy", [dataPath, cwd, "/MIR",
      "/XD", ".git", "node_modules", ".sbox", "__pycache__",
      "/XF", ".env.local",
      "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP"],
      { stdio: "pipe", windowsHide: true });
    console.log("Restored: " + name);
  } else if (sub === "delete") {
    if (!name) { console.log("ERROR: Specify snapshot name."); process.exit(1); }
    const snapPath = path.join(snapDir, name);
    if (!fs.existsSync(snapPath)) { console.log(`ERROR: Snapshot "${name}" not found.`); process.exit(1); }
    fs.rmSync(snapPath, { recursive: true, force: true });
    console.log("Deleted: " + name);
  } else {
    console.log("Usage: sunboxed /snap <create|list|restore|delete> [name]");
    process.exit(1);
  }
}

function usage() {
  console.log(`SunBoxed — run commands inside a Sandboxie container

Usage:
  sunboxed [flags] <command> [args...]
  sunboxed [flags] -- <command> [args...]
  sunboxed /reset
  sunboxed /snap create <name>
  sunboxed /snap list
  sunboxed /snap restore <name>
  sunboxed /snap delete <name>

Flags:
  /tty             Open in terminal (WezTerm/WT) for interactive TUI apps
  /net-block       Block all network access
  /readonly        CWD is read-only (writes go to overlay)
  /show            Show command window (default: hidden)
  /no-pty          Disable ConPTY bridge (use hidden window mode)
  /allow:<path>    Only allow writes to specific paths (relative to CWD)
  /deny:<path>     Block all access to specific paths (relative to CWD)

Current directory (${cwd}) is writable by default.
All other writes are stored in ..\\.sbox\\<dirname> (overlay).

When node-pty is installed, TUI apps (claude, vim, etc.) work in your
current terminal via an automatic ConPTY bridge inside the sandbox.
Use /no-pty to fall back to hidden-window mode if needed.

Examples:
  sunboxed claude
  sunboxed /tty vim file.txt
  sunboxed /net-block node script.js
  sunboxed /allow:src /allow:dist -- node build.js
  sunboxed /deny:.env /deny:.git cmd /c app.exe
  sunboxed /snap create before-refactor
  sunboxed /snap restore before-refactor`);
}
