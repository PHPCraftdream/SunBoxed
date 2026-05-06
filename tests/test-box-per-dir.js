/**
 * Per-directory box tests: unique boxes, cross-dir isolation, hardened config.
 * Config is verified from INSIDE the sandbox (box is cleaned up after each run).
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
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
  h.assert(box1 !== box2, "Different dirs get different box names");
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
  console.log("\n[BOX 3] Hardened box config (verified from inside sandbox)");
  h.setupWorkspace(WS1);
  // Inner script queries its own box config via SbieIni.exe
  const sbiIni = "C:\\\\Program Files\\\\Sandboxie-Plus\\\\SbieIni.exe";
  h.writeInnerScript(WS1, "t.js", `
    const { execSync } = require("child_process");
    const crypto = require("crypto");
    const cwd = process.cwd();
    const hash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 16).toUpperCase();
    const box = "_SB_" + hash;
    function q(s) {
      try { return execSync('"${sbiIni}" query ' + box + ' ' + s, {shell:"cmd.exe",encoding:"utf-8",windowsHide:true,stdio:["pipe","pipe","pipe"]}).trim(); }
      catch(_) { return ""; }
    }
    const result = {
      configLevel: q("ConfigLevel"),
      template: q("Template"),
      blockNetFiles: q("BlockNetworkFiles"),
    };
    require("fs").writeFileSync(require("path").join(cwd, "config.json"), JSON.stringify(result));
  `);
  h.sbox("", "t.js", WS1);
  const f = path.join(WS1, "config.json");
  if (fs.existsSync(f)) {
    const cfg = JSON.parse(fs.readFileSync(f, "utf-8"));
    h.assert(cfg.configLevel === "99", "ConfigLevel=99");
    h.assert(cfg.template.split("\r\n")[0] === "BlockPorts", "Only BlockPorts template");
    h.assert(cfg.blockNetFiles === "y", "BlockNetworkFiles=y");
  } else {
    h.assert(false, "ConfigLevel=99 (config.json missing)");
    h.assert(false, "Only BlockPorts template");
    h.assert(false, "BlockNetworkFiles=y");
  }
}

try { testPerDirBoxNames(); testCrossDirIsolation(); testHardenedConfig(); }
finally { h.cleanupWorkspace(WS1); h.cleanupWorkspace(WS2); }
module.exports = {};
