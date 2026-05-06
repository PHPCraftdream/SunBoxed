#!/usr/bin/env node
/**
 * cc75 — Claude Code 2.1.75 in a sandboxed terminal.
 *
 * Usage:
 *   cc75                    Sandboxed Claude Code (WezTerm + Sandboxie)
 *   cc75 --no-sandbox       Run without sandbox in current terminal
 */
const { spawnSync } = require("child_process");
const path = require("path");

const args = process.argv.slice(2);

if (args[0] === "--no-sandbox") {
  const r = spawnSync("npx", ["--yes", "@anthropic-ai/claude-code@2.1.75", "--dangerously-skip-permissions", ...args.slice(1)], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(r.status || 0);
}

// Launch via sunboxed /tty
const sunboxed = path.resolve(__dirname, "sunboxed.js");
const r = spawnSync("node", [sunboxed, "npx", "--yes", "@anthropic-ai/claude-code@2.1.75", "--dangerously-skip-permissions", ...args], {
  stdio: "inherit",
});
process.exit(r.status || 0);
