#!/usr/bin/env node
// sundohed-cc — sundohed with the `cc` subcommand auto-injected.
//
// Equivalent to `sundohed cc [args...]` but a tiny bit shorter to type.
// Useful as a one-shot launcher for Claude Code in any directory:
//   sundohed-cc                    # interactive cc in CWD
//   sundohed-cc --image node:22-slim
//
// Implementation: prepend `cc` to argv (after node + script name), then
// delegate to sundohed.js (which loads sundocked.js + DNS proxy hook).

process.argv.splice(2, 0, "cc");
require("./sundohed.js");
