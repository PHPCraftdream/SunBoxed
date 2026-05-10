#!/usr/bin/env node
// sundohed — sundocked + DoH'd.
//
// Thin wrapper: requires bin/sundocked.js as a module, registers a
// post-container-start hook that bootstraps the in-container DoH proxy,
// then runs sundocked.main() with the original argv. Result: every
// container created/restarted via this entry point gets DNS over HTTPS,
// bypassing kernel-level DNS hijacks (Cisco Secure Client, Zscaler, etc).
//
// `sundocked` (the bare CLI) stays simple — no proxy, no extra logic.
// `sundohed` adds the proxy. `sundohed-cc` injects the `cc` subcommand.

const sundocked = require("./sundocked.js");
const proxy = require("./sundohed-proxy.js");

sundocked.setHooks({
  afterContainerStart: proxy.bootstrap,
});

sundocked.main().catch(e => { console.error(e); process.exit(1); });
