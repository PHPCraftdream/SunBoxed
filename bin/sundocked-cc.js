#!/usr/bin/env node
// sundocked-cc — sundocked with the `cc` subcommand auto-injected.
//
// Equivalent to "sundocked cc [args...]" but a tiny bit shorter to type.
// One-shot launcher for Claude Code in any directory.
//
// Implementation: prepend `cc` to argv (after node + script name), then
// require ./sundocked.js so its main() runs with the modified argv.

process.argv.splice(2, 0, "cc");
require("./sundocked.js");
