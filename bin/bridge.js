#!/usr/bin/env node

let pty;
try {
  pty = require("node-pty");
} catch (e) {
  process.stderr.write("bridge: node-pty unavailable: " + e.message + "\n");
  process.exit(1);
}

const cols = parseInt(process.argv[2], 10) || 80;
const rows = parseInt(process.argv[3], 10) || 24;
const cmd = process.argv[4];
const cmdArgs = process.argv.slice(5);

if (!cmd) process.exit(1);

const proc = pty.spawn(cmd, cmdArgs, {
  name: "xterm-256color",
  cols,
  rows,
  cwd: process.cwd(),
  env: process.env,
});

proc.onData((d) => {
  try { process.stdout.write(d); } catch (_) {}
});
process.stdin.on("data", (d) => {
  try { proc.write(d.toString("utf8")); } catch (_) {}
});
process.stdin.on("end", () => proc.kill());
proc.onExit(({ exitCode }) => process.exit(exitCode || 0));
