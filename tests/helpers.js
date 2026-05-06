/**
 * Shared test helpers for sunboxed.cmd integration tests.
 */

const { execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SBOX = path.resolve(__dirname, "..", "scripts", "sunboxed.cmd");
const SBIE_INI = "C:\\Program Files\\Sandboxie-Plus\\SbieIni.exe";
const ROOT = path.resolve(__dirname, "..");
const TMP = path.resolve(__dirname, ".tmp");
const EXEC_OPTS = { shell: "cmd.exe", stdio: "pipe", windowsHide: true };

let passed = 0;
let failed = 0;

function assert(ok, name) {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${name}`);
  ok ? passed++ : failed++;
}

function getResults() { return { passed, failed }; }
function resetResults() { passed = 0; failed = 0; }

function writeInnerScript(ws, name, code) {
  const p = path.join(ws, name);
  fs.writeFileSync(p, code);
  return p;
}

function sbox(flags, scriptName, ws) {
  const cwd = ws;
  const script = path.join(cwd, scriptName);
  const cmd = `"${SBOX}" ${flags} -- node "${script}"`;
  try {
    return execSync(cmd, { cwd, timeout: 30000, ...EXEC_OPTS });
  } catch (e) {
    return e.stdout || Buffer.from("");
  }
}

function resetBox(ws) {
  try {
    execSync(`"${SBOX}" /reset`, { cwd: ws, timeout: 15000, ...EXEC_OPTS });
  } catch (_) {}
}

function queryBox(boxName, setting) {
  try {
    return execSync(`"${SBIE_INI}" query ${boxName} ${setting}`, { ...EXEC_OPTS, timeout: 5000 })
      .toString().trim();
  } catch (_) { return ""; }
}

function workspace(name) {
  return path.join(TMP, name);
}

function setupWorkspace(ws) {
  const overlay = path.resolve(ws, "..", ".sbox", path.basename(ws));
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(overlay, { recursive: true, force: true }); } catch (_) {}
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(path.join(ws, "src"), { recursive: true });
  fs.mkdirSync(path.join(ws, "dist"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".env"), "SECRET=abc123");
}

function cleanupWorkspace(ws) {
  const overlay = path.resolve(ws, "..", ".sbox", path.basename(ws));
  resetBox(ws);
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(overlay, { recursive: true, force: true }); } catch (_) {}
}

function overlayPath(ws) {
  return path.resolve(ws, "..", ".sbox", path.basename(ws));
}

function boxName(cwd) {
  const hash = crypto.createHash("sha256").update(cwd).digest("hex").substring(0, 16).toUpperCase();
  return `_SB_${hash}`;
}

function cleanupAll() {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
}

module.exports = {
  SBOX, ROOT, TMP, EXEC_OPTS,
  assert, getResults, resetResults,
  writeInnerScript, sbox, resetBox, queryBox, boxName,
  workspace, setupWorkspace, cleanupWorkspace, overlayPath, cleanupAll,
};
