/**
 * Test runner — executes all test-*.js files and reports totals.
 *
 * Usage: node tests/run-all.js
 */
const h = require("./helpers");

const suites = [
  "./test-fs-isolation",
  "./test-network",
  "./test-overlay",
  "./test-box-per-dir",
  "./test-snapshots",
];

console.log("SunBoxed integration tests");
console.log("==========================");

try {
  for (const suite of suites) {
    require(suite);
  }
} finally {
  h.cleanupAll();
}

const { passed, failed } = h.getResults();
console.log(`\n==========================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
