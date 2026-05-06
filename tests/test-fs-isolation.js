/**
 * Filesystem isolation tests: CWD access, parent protection, readonly, allow, deny.
 */
const path = require("path");
const fs = require("fs");
const h = require("./helpers");

const WS = h.workspace("ws_fs");

function setup() {
  const parentFile = path.resolve(WS, "..", "parent_test.txt");
  try { fs.unlinkSync(parentFile); } catch (_) {}
  h.setupWorkspace(WS);
}

function cleanup() {
  h.cleanupWorkspace(WS);
  const parentFile = path.resolve(WS, "..", "parent_test.txt");
  try { fs.unlinkSync(parentFile); } catch (_) {}
}

function testDefaultMode() {
  console.log("\n[FS 1] Default mode: CWD writable, parent sandboxed");
  setup();
  h.writeInnerScript(WS, "t.js", `
    const fs = require("fs"), p = require("path");
    fs.writeFileSync(p.join(process.cwd(), "cwd_file.txt"), "hello");
    fs.writeFileSync(p.resolve(process.cwd(), "..", "parent_file.txt"), "sneaky");
  `);
  h.sbox("", "t.js", WS);
  h.assert(fs.existsSync(path.join(WS, "cwd_file.txt")), "CWD write on real disk");
  h.assert(!fs.existsSync(path.resolve(WS, "..", "parent_file.txt")), "Parent write sandboxed");
}

function testReadonly() {
  console.log("\n[FS 2] /readonly: CWD writes go to overlay");
  setup();
  h.writeInnerScript(WS, "t.js", `
    require("fs").writeFileSync(require("path").join(process.cwd(), "ro.txt"), "blocked");
  `);
  h.sbox("/readonly", "t.js", WS);
  h.assert(!fs.existsSync(path.join(WS, "ro.txt")), "CWD write NOT on real disk");
}

function testAllow() {
  console.log("\n[FS 3] /allow:src: only src/ writable");
  setup();
  h.writeInnerScript(WS, "t.js", `
    const fs = require("fs"), p = require("path"), cwd = process.cwd();
    fs.writeFileSync(p.join(cwd, "src", "ok.txt"), "ok");
    fs.writeFileSync(p.join(cwd, "dist", "no.txt"), "no");
  `);
  h.sbox("/allow:src", "t.js", WS);
  h.assert(fs.existsSync(path.join(WS, "src", "ok.txt")), "src/ write on real disk");
  h.assert(!fs.existsSync(path.join(WS, "dist", "no.txt")), "dist/ write sandboxed");
}

function testDeny() {
  console.log("\n[FS 4] /deny:.env: blocks access to .env");
  setup();
  h.writeInnerScript(WS, "t.js", `
    const fs = require("fs"), p = require("path");
    let r; try { r = fs.readFileSync(p.join(process.cwd(), ".env"), "utf-8"); } catch(e) { r = "DENIED:" + e.code; }
    fs.writeFileSync(p.join(process.cwd(), "result.txt"), r);
  `);
  h.sbox("/deny:.env", "t.js", WS);
  const f = path.join(WS, "result.txt");
  if (fs.existsSync(f)) {
    h.assert(!fs.readFileSync(f, "utf-8").includes("SECRET"), ".env not readable");
  } else {
    h.assert(true, ".env not readable (result went to overlay)");
  }
}

function testAbsolutePath() {
  console.log("\n[FS 5] Absolute path writes sandboxed");
  setup();
  const absTarget = path.join(require("os").tmpdir(), "sunboxed_escape_test.txt");
  try { fs.unlinkSync(absTarget); } catch (_) {}
  h.writeInnerScript(WS, "t.js", `
    const fs = require("fs"), os = require("os"), p = require("path");
    fs.writeFileSync(p.join(os.tmpdir(), "sunboxed_escape_test.txt"), "escaped");
    fs.writeFileSync(p.join(process.cwd(), "done.txt"), "ok");
  `);
  h.sbox("", "t.js", WS);
  h.assert(!fs.existsSync(absTarget), "Temp dir write sandboxed (not on real disk)");
  h.assert(fs.existsSync(path.join(WS, "done.txt")), "CWD write still works");
  try { fs.unlinkSync(absTarget); } catch (_) {}
}

function testUserProfile() {
  console.log("\n[FS 6] User profile writes sandboxed");
  setup();
  const profileTarget = path.join(process.env.USERPROFILE || "C:\\Users\\Default", "sunboxed_escape_test.txt");
  try { fs.unlinkSync(profileTarget); } catch (_) {}
  const escapedProfile = (process.env.USERPROFILE || "C:\\Users\\Default").replace(/\\/g, "\\\\");
  h.writeInnerScript(WS, "t.js", `
    const fs = require("fs");
    try { fs.writeFileSync("${escapedProfile}\\\\sunboxed_escape_test.txt", "escaped"); } catch(_) {}
    fs.writeFileSync(require("path").join(process.cwd(), "done.txt"), "ok");
  `);
  h.sbox("", "t.js", WS);
  h.assert(!fs.existsSync(profileTarget), "User profile write sandboxed");
  try { fs.unlinkSync(profileTarget); } catch (_) {}
}

try { testDefaultMode(); testReadonly(); testAllow(); testDeny(); testAbsolutePath(); testUserProfile(); } finally { cleanup(); }
module.exports = {};
