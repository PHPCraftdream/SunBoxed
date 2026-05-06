#!/usr/bin/env node
// SunBoxed PTY Host — runs INSIDE sandbox.
// Connects to client via TCP, creates ConPTY, relays terminal I/O.
// Auth token required to prevent unauthorized connections.
//
// Usage: node sunboxed-host.js --port PORT --token TOKEN --cols C --rows R -- command [args...]

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require(path.join(__dirname, '..', 'node_modules', 'node-pty'));

// ---- Parse args ----
const argv = process.argv.slice(2);
let port = 0;
let token = '';
let cols = 80;
let rows = 24;
let cmdParts = [];

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port' && argv[i + 1]) { port = parseInt(argv[++i]); continue; }
  if (argv[i] === '--token' && argv[i + 1]) { token = argv[++i]; continue; }
  if (argv[i] === '--cols' && argv[i + 1]) { cols = parseInt(argv[++i]); continue; }
  if (argv[i] === '--rows' && argv[i + 1]) { rows = parseInt(argv[++i]); continue; }
  if (argv[i] === '--') {
    cmdParts = argv.slice(i + 1);
    break;
  }
}

if (!port || !token || cmdParts.length === 0) {
  process.stderr.write('Usage: node sunboxed-host.js --port PORT --token TOKEN -- command [args...]\n');
  process.exit(1);
}

// ---- Spawn strategy ----
// Direct spawn for .exe/.com — no cmd.exe layer, transparent signal handling.
// cmd.exe /c via temp .cmd file for .cmd/.bat/unresolved — needed for PATH and script support.
let spawnFile, spawnArgs;
let tempCmd = null;
const ext = path.extname(cmdParts[0]).toLowerCase();

if (ext === '.exe' || ext === '.com') {
  // Direct spawn — fully transparent, no cmd.exe artifacts
  spawnFile = cmdParts[0];
  spawnArgs = cmdParts.slice(1);
} else {
  // Need cmd.exe for .cmd/.bat scripts and PATH resolution
  tempCmd = path.join(os.tmpdir(), `sunboxed-${process.pid}.cmd`);
  const cmdLine = cmdParts.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
  fs.writeFileSync(tempCmd, `@${cmdLine}\r\n`);
  spawnFile = 'cmd.exe';
  spawnArgs = ['/c', tempCmd];
}

// ---- Protocol helpers ----
function send(socket, msg) {
  try { socket.write(JSON.stringify(msg) + '\n'); } catch (_) {}
}

function parseMessages(buf, callback) {
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.length > 0) {
      try { callback(JSON.parse(line)); } catch (_) {}
    }
  }
  return buf;
}

function cleanup() {
  if (tempCmd) try { fs.unlinkSync(tempCmd); } catch (_) {}
}

// ---- Connect to client and spawn PTY ----
const socket = net.connect(port, '127.0.0.1', () => {
  send(socket, { t: 'auth', token });

  const term = pty.spawn(spawnFile, spawnArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: process.env,
  });

  send(socket, { t: 'ready', pid: term.pid });

  term.onData(data => {
    send(socket, { t: 'o', d: Buffer.from(data, 'utf-8').toString('base64') });
  });

  term.onExit(({ exitCode }) => {
    send(socket, { t: 'x', c: exitCode || 0 });
    cleanup();
    setTimeout(() => process.exit(exitCode || 0), 200);
  });

  let buf = '';
  socket.on('data', chunk => {
    buf = parseMessages(buf + chunk.toString(), msg => {
      if (msg.t === 'i' && msg.d) {
        term.write(Buffer.from(msg.d, 'base64').toString('utf-8'));
      } else if (msg.t === 'r' && msg.c && msg.r) {
        try { term.resize(msg.c, msg.r); } catch (_) {}
      }
    });
  });

  socket.on('close', () => {
    try { term.kill(); } catch (_) {}
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });

  socket.on('error', () => {
    try { term.kill(); } catch (_) {}
    cleanup();
    setTimeout(() => process.exit(1), 100);
  });
});

socket.on('error', err => {
  process.stderr.write('Host: connection failed: ' + err.message + '\n');
  cleanup();
  process.exit(1);
});
