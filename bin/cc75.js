#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");

const script = path.resolve(__dirname, "..", "scripts", "cc75.cmd");
const result = spawnSync("cmd.exe", ["/c", script, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
});
process.exit(result.status || 0);
