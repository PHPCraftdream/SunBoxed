/**
 * Per-directory box tests: unique boxes, cross-dir isolation, hardened config.
 */
const path = require("path");
const fs = require("fs");
const h = require("./helpers");

const WS1 = h.workspace("ws_box1");
const WS2 = h.workspace("ws_box2");

function testPerDirBoxNames() {
  console.log("\n[BOX 1] Per-directory box names (hash-based, collision-free)");
  h.setupWorkspace(WS1);
  h.setupWorkspace(WS2);
  h.writeInnerScript(WS1, "t.js", `
    require("fs").writeFileSync(require("path").join(process.cwd(), "ok.txt"), "ws1");
  `);
  h.writeInnerScript(WS2, "t.js", `
    require("fs").writeFileSync(require("path").join(process.cwd(), "ok.txt"), "ws2");
  `);
  h.sbox("", "t.js", WS1);
  h.sbox("", "t.js", WS2);

  const box1 = h.boxName(WS1);
  const box2 = h.boxName(WS2);
  const cfg1 = h.queryBox(box1, "FileRootPath");
  const cfg2 = h.queryBox(box2, "FileRootPath");
  h.assert(box1 !== box2, "Different dirs get different box names");
  h.assert(cfg1.includes("ws_box1"), "Box 1 correct FileRootPath");
  h.assert(cfg2.includes("ws_box2"), "Box 2 correct FileRootPath");
  h.assert(fs.existsSync(path.join(WS1, "ok.txt")), "Workspace 1 file on disk");
  h.assert(fs.existsSync(path.join(WS2, "ok.txt")), "Workspace 2 file on disk");
}

function testCrossDirIsolation() {
  console.log("\n[BOX 2] Cross-directory isolation");
  h.setupWorkspace(WS1);
  h.setupWorkspace(WS2);
  const ws2Win = WS2.replace(/\//g, "\\");
  h.writeInnerScript(WS1, "t.js", `
    const fs = require("fs");
    try { fs.writeFileSync("${ws2Win.replace(/\\/g, "\\\\")}\\cross.txt", "hacked"); } catch(_) {}
  `);
  h.sbox("", "t.js", WS1);
  h.assert(!fs.existsSync(path.join(WS2, "cross.txt")), "Box 1 cannot write to workspace 2");
}

function testHardenedConfig() {
  console.log("\n[BOX 3] Hardened box config");
  h.setupWorkspace(WS1);
  h.writeInnerScript(WS1, "t.js", `
    require("fs").writeFileSync(require("path").join(process.cwd(), "ok.txt"), "ok");
  `);
  h.sbox("", "t.js", WS1);
  const box1 = h.boxName(WS1);
  h.assert(h.queryBox(box1, "ConfigLevel") === "99", "ConfigLevel=99");
  h.assert(h.queryBox(box1, "Template").split("\r\n")[0] === "BlockPorts", "Only BlockPorts template");
  h.assert(h.queryBox(box1, "BlockNetworkFiles") === "y", "BlockNetworkFiles=y");
}

try { testPerDirBoxNames(); testCrossDirIsolation(); testHardenedConfig(); }
finally { h.cleanupWorkspace(WS1); h.cleanupWorkspace(WS2); }
module.exports = {};
