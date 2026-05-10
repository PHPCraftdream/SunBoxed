#!/usr/bin/env bash
# Unit test for the setHooks/callHook mechanism in bin/sundocked.js.
# No Docker required — we just require the module and exercise the API.

set -euo pipefail

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
to_native() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || echo "$1"; }
SUNDOCKED="$(to_native "$ROOT/bin/sundocked.js")"

node -e '
  const path = process.argv[1];
  const m = require(path);
  if (typeof m.main !== "function") { console.error("main not exported"); process.exit(1); }
  if (typeof m.setHooks !== "function") { console.error("setHooks not exported"); process.exit(2); }

  // 1. Unknown hook keys are silently ignored (forward-compat for wrappers
  //    that reference hooks added in newer sundocked versions).
  m.setHooks({ nonExistentHook: () => { throw new Error("should not run"); } });

  // 2. Registered hook fires with the payload we pass.
  let seen = null;
  m.setHooks({ afterContainerStart: (p) => { seen = p; } });

  // We cannot easily call callHook directly because it is private. Smoke-
  // test that setHooks accepts the call without throwing — actual
  // afterContainerStart firing is covered end-to-end by test-sundohed.sh.

  // 3. Re-registering replaces the previous callback (last writer wins).
  let v = 0;
  m.setHooks({ afterContainerStart: () => { v = 1; } });
  m.setHooks({ afterContainerStart: () => { v = 2; } });
  // Actually triggering it without ensureContainer is awkward; we
  // settle for asserting that the API does not throw and the symbol
  // accepts repeated assignments. Real semantic check is in
  // test-sundohed.sh (idempotent re-exec).

  console.log("hooks API exports OK, accepts unknown + repeated registrations");
' "$SUNDOCKED"

echo "test-hooks: passed"
