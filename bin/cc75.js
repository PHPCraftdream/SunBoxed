#!/usr/bin/env node
/**
 * cc75 — Claude Code 2.1.75 in a Sandboxie container.
 *
 * Usage: cc75 [claude-code-args...]
 */
const { spawnSync } = require("child_process");
const path = require("path");

const sunboxed = path.resolve(__dirname, "sunboxed.js");
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [
  sunboxed, "--",
  "npx", "--yes", "@anthropic-ai/claude-code@2.1.75",
  "--dangerously-skip-permissions", ...args
], { stdio: "inherit" });
process.exit(r.status || 0);
