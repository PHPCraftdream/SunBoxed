/**
 * TCP relay tests: connection, auth, output relay, setRawMode inside sandbox.
 */
const net = require("net");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync, execSync } = require("child_process");
const h = require("./helpers");

const SBIE = "C:\\Program Files\\Sandboxie-Plus";
const SBIE_INI = path.join(SBIE, "SbieIni.exe");
const SBIE_START = path.join(SBIE, "Start.exe");
const NODE = process.execPath;
const HOST = path.resolve(__dirname, "..", "bin", "sunboxed-host.js");

const WS = h.workspace("ws_relay");
const OVERLAY = h.overlayPath(WS);

function sbie(...args) {
  spawnSync(SBIE_INI, args, { stdio: "pipe", windowsHide: true });
}

function setupBox() {
  const hash = crypto.createHash("sha256").update(WS).digest("hex").substring(0, 16).toUpperCase();
  const box = `_SB_${hash}`;
  try { execSync("taskkill /f /im SandMan.exe", { stdio: "pipe", windowsHide: true }); } catch (_) {}
  sbie("set", box, "Enabled", "y");
  sbie("set", box, "FileRootPath", OVERLAY);
  sbie("set", box, "ConfigLevel", "99");
  sbie("set", box, "OpenIpcPath", "*");
  sbie("append", box, "OpenPipePath", "*");
  sbie("set", box, "OpenFilePath", WS);
  sbie("set", box, "Template", "BlockPorts");
  spawnSync(SBIE_START, ["/reload"], { stdio: "pipe", windowsHide: true });
  return box;
}

function terminateBox(box) {
  spawnSync(SBIE_START, ["/box:" + box, "/silent", "/terminate"], { stdio: "pipe", windowsHide: true });
}

function launchHost(box, port, token, cmdParts) {
  const startArgs = [
    "/box:" + box, "/hide_window",
    NODE, HOST,
    "--port", String(port),
    "--token", token,
    "--cols", "80", "--rows", "24",
    "--", ...cmdParts
  ];
  const cmdLine = startArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ");
  const batFile = path.join(WS, "__test_relay.cmd");
  fs.writeFileSync(batFile, `@"${SBIE_START}" ${cmdLine}\r\n`);
  const child = spawn("cmd.exe", ["/c", batFile], { stdio: "pipe", windowsHide: true, cwd: WS });
  child.unref();
  return child;
}

function parseMessages(buf, callback) {
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.length > 0) {
      try { callback(JSON.parse(line)); } catch (_) {}
    }
  }
  return buf;
}

// Run a relay test and return collected messages via callback
function runRelayTest(box, token, cmdParts, timeout) {
  return new Promise((resolve, reject) => {
    const messages = [];
    let output = "";
    let buf = "";
    let authed = false;

    const timer = setTimeout(() => {
      terminateBox(box);
      reject(new Error("timeout"));
    }, timeout || 15000);

    const server = net.createServer(socket => {
      server.close();
      socket.on("data", chunk => {
        buf = parseMessages(buf + chunk.toString(), msg => {
          if (!authed) {
            if (msg.t === "auth" && msg.token === token) authed = true;
            return;
          }
          messages.push(msg);
          if (msg.t === "o" && msg.d) {
            output += Buffer.from(msg.d, "base64").toString("utf-8");
          }
          if (msg.t === "x") {
            clearTimeout(timer);
            terminateBox(box);
            resolve({ messages, output, exitCode: msg.c, authed });
          }
        });
      });
      socket.on("error", () => {
        clearTimeout(timer);
        terminateBox(box);
        reject(new Error("socket error"));
      });
    });

    server.listen(0, "127.0.0.1", () => {
      launchHost(box, server.address().port, token, cmdParts);
    });
  });
}

// ================================================================
async function testRelayOutput() {
  console.log("\n[RELAY 1] TCP relay: output forwarding");
  const box = setupBox();
  const token = crypto.randomBytes(16).toString("hex");
  const result = await runRelayTest(box, token, ["echo", "RELAY_OK"], 15000);
  h.assert(result.authed, "Auth token accepted");
  h.assert(result.output.includes("RELAY_OK"), "Output contains expected text");
  h.assert(result.exitCode === 0, "Exit code 0");
}

// ================================================================
async function testRelayBadToken() {
  console.log("\n[RELAY 2] TCP relay: bad token rejected");
  const box = setupBox();
  const goodToken = crypto.randomBytes(16).toString("hex");
  const badToken = "bad_token_" + Date.now();

  // The host sends the bad token → server doesn't auth → host eventually exits
  // We expect the test to fail with timeout or exit without auth
  const result = await new Promise((resolve) => {
    let buf = "";
    let gotAuth = false;

    const timer = setTimeout(() => {
      terminateBox(box);
      resolve({ rejected: !gotAuth });
    }, 8000);

    const server = net.createServer(socket => {
      server.close();
      socket.on("data", chunk => {
        buf = parseMessages(buf + chunk.toString(), msg => {
          if (msg.t === "auth") {
            gotAuth = msg.token === goodToken;
            if (!gotAuth) {
              socket.destroy();
              clearTimeout(timer);
              terminateBox(box);
              resolve({ rejected: true });
            }
          }
        });
      });
    });

    server.listen(0, "127.0.0.1", () => {
      launchHost(box, server.address().port, badToken, ["echo", "x"]);
    });
  });

  h.assert(result.rejected, "Bad token connection rejected");
}

// ================================================================
async function testRelaySetRawMode() {
  console.log("\n[RELAY 3] TCP relay: setRawMode works inside sandbox");
  h.setupWorkspace(WS);
  const innerScript = path.join(WS, "test_raw.js");
  fs.writeFileSync(innerScript, `
    try {
      process.stdin.setRawMode(true);
      process.stdout.write('RAWMODE_OK\\n');
      process.stdin.setRawMode(false);
      process.exit(0);
    } catch (e) {
      process.stdout.write('RAWMODE_FAIL:' + e.code + '\\n');
      process.exit(1);
    }
  `);
  const box = setupBox();
  const token = crypto.randomBytes(16).toString("hex");
  const result = await runRelayTest(box, token, [NODE, innerScript], 15000);
  h.assert(result.output.includes("RAWMODE_OK"), "setRawMode(true) succeeded inside sandbox");
  h.assert(!result.output.includes("RAWMODE_FAIL"), "No EPERM error");
}

// ================================================================
async function testRelayExitCode() {
  console.log("\n[RELAY 4] TCP relay: exit code propagation");
  const box = setupBox();
  const token = crypto.randomBytes(16).toString("hex");
  const result = await runRelayTest(box, token, ["cmd", "/c", "exit 42"], 15000);
  h.assert(result.exitCode === 42, "Exit code 42 propagated");
}

// ================================================================
async function testRelaySandboxMarker() {
  console.log("\n[RELAY 5] TCP relay: process runs inside sandbox");
  const box = setupBox();
  const token = crypto.randomBytes(16).toString("hex");
  const result = await runRelayTest(box, token, ["echo", "test"], 15000);
  // Sandboxie adds [#] to cmd.exe window title in sandboxed processes
  h.assert(result.output.includes("[#]"), "Sandbox marker [#] present in output");
}

// ================================================================
async function runAll() {
  h.setupWorkspace(WS);
  try {
    await testRelayOutput();
    await testRelayBadToken();
    await testRelaySetRawMode();
    await testRelayExitCode();
    await testRelaySandboxMarker();
  } finally {
    h.cleanupWorkspace(WS);
  }
}

module.exports = runAll().catch(e => {
  console.error("Relay test error:", e.message);
  h.cleanupWorkspace(WS);
});
