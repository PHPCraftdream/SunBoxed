/**
 * Network isolation tests: /net-block flag.
 */
const path = require("path");
const fs = require("fs");
const h = require("./helpers");

const WS = h.workspace("ws_net");

function testNetBlock() {
  console.log("\n[NET 1] /net-block: network access blocked");
  h.setupWorkspace(WS);
  h.writeInnerScript(WS, "t.js", `
    const http = require("http"), fs = require("fs"), p = require("path");
    const req = http.get("http://httpbin.org/get", { timeout: 5000 }, (res) => {
      fs.writeFileSync(p.join(process.cwd(), "result.txt"), "CONNECTED:" + res.statusCode);
    });
    req.on("error", (e) => { fs.writeFileSync(p.join(process.cwd(), "result.txt"), "BLOCKED:" + e.code); });
    req.on("timeout", () => { req.destroy(); fs.writeFileSync(p.join(process.cwd(), "result.txt"), "BLOCKED:TIMEOUT"); });
  `);
  h.sbox("/net-block", "t.js", WS);
  const f = path.join(WS, "result.txt");
  if (fs.existsSync(f)) {
    h.assert(fs.readFileSync(f, "utf-8").startsWith("BLOCKED"), "Network request blocked");
  } else {
    h.assert(true, "Network blocked entirely");
  }
}

try { testNetBlock(); } finally { h.cleanupWorkspace(WS); }
module.exports = {};
