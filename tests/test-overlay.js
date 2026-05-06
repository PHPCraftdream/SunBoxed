/**
 * Overlay tests: persistence between runs, /reset.
 */
const path = require("path");
const fs = require("fs");
const h = require("./helpers");

const WS = h.workspace("ws_ovl");

function testReset() {
  console.log("\n[OVL 1] /reset: clears overlay");
  h.setupWorkspace(WS);
  h.writeInnerScript(WS, "t.js", `
    const fs = require("fs"), os = require("os"), p = require("path");
    fs.writeFileSync(p.join(os.tmpdir(), "marker.txt"), "data");
  `);
  h.sbox("", "t.js", WS);
  h.resetBox(WS);
  h.assert(
    !fs.existsSync(h.overlayPath(WS)) || !fs.existsSync(path.join(h.overlayPath(WS), "drive")),
    "Overlay cleared after /reset"
  );
}

function testOverlayPersists() {
  console.log("\n[OVL 2] Overlay persists between runs");
  h.setupWorkspace(WS);
  h.writeInnerScript(WS, "a.js", `
    require("fs").writeFileSync(require("path").join(require("os").tmpdir(), "persist.txt"), "ok");
  `);
  h.sbox("", "a.js", WS);
  h.writeInnerScript(WS, "b.js", `
    const fs = require("fs"), os = require("os"), p = require("path");
    const found = fs.existsSync(p.join(os.tmpdir(), "persist.txt"));
    fs.writeFileSync(p.join(process.cwd(), "result.txt"), found ? "FOUND" : "MISSING");
  `);
  h.sbox("", "b.js", WS);
  const f = path.join(WS, "result.txt");
  if (fs.existsSync(f)) {
    h.assert(fs.readFileSync(f, "utf-8").includes("FOUND"), "Overlay data visible in next run");
  } else {
    h.assert(false, "Overlay data visible in next run (file missing)");
  }
}

try { testReset(); testOverlayPersists(); } finally { h.cleanupWorkspace(WS); }
module.exports = {};
