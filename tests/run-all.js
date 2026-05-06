/**
 * Test runner — executes all test-*.js files and reports totals.
 * Supports both sync and async (promise-returning) test modules.
 *
 * Usage: node tests/run-all.js
 */
const h = require("./helpers");

const syncSuites = [
  "./test-fs-isolation",
  "./test-network",
  "./test-overlay",
  "./test-box-per-dir",
  "./test-snapshots",
];

const asyncSuites = [
  "./test-relay",
];

async function main() {
  console.log("SunBoxed integration tests");
  console.log("==========================");

  for (const suite of syncSuites) {
    require(suite);
  }

  for (const suite of asyncSuites) {
    const mod = require(suite);
    if (mod && typeof mod.then === "function") {
      await mod;
    }
  }

  h.cleanupAll();

  const { passed, failed } = h.getResults();
  console.log(`\n==========================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Runner error:", e);
  h.cleanupAll();
  process.exit(1);
});
