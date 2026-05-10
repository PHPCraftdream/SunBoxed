// In-container DoH proxy bootstrap.
//
// Used by sundohed (and sundohed-cc) to extend sundocked: every time a
// container is created or restarted, a small Go binary (sundocked-dns-*)
// is copied into /opt/sundocked/ and started. The init script overwrites
// /etc/resolv.conf to point at 127.0.0.1, so all DNS queries go through
// the proxy, which talks to public resolvers via DoH (TCP:443) — bypassing
// kernel-level UDP:53 hijacks on the host (e.g. Cisco Secure Client).

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DNS_PROXY_BIN_DIR = path.join(__dirname, "dns-proxy-bin");
const DNS_PROXY_INIT_SH = path.join(__dirname, "..", "scripts", "sundohed-init.sh");

function docker(args) {
  return spawnSync("docker", args, { encoding: "utf-8", windowsHide: true });
}

function pickBinary(arch) {
  switch (arch) {
    case "x86_64":
    case "amd64":  return "sundocked-dns-linux-amd64";
    case "aarch64":
    case "arm64":  return "sundocked-dns-linux-arm64";
    default:       return null;
  }
}

function disabledReason(config, opts) {
  if (config && config.network === "host") return "container uses --network=host (resolv.conf is shared with host)";
  if (opts && opts.dnsProxy === false) return "--no-dns-proxy override";
  if (config && config.dnsProxy === false) return "config.dnsProxy=false";
  return null;
}

function bootstrap({ name, config, opts = {}, fresh = false }) {
  const skip = disabledReason(config, opts);
  if (skip) {
    if (!opts.quiet) console.log(`DNS proxy: skipped (${skip})`);
    return;
  }

  // Fast path: if the binary and init.sh already exist inside the
  // container, skip docker cp (each cp of the 6MB binary is ~200ms).
  // init.sh itself is idempotent — it checks PID file and exits early
  // when the proxy is already alive, otherwise it (re)starts it. Docker
  // regenerates /etc/resolv.conf on every container start, so init.sh
  // also rewrites it back to 127.0.0.1 on each run.
  if (!fresh) {
    const fast = docker([
      "exec", name, "sh", "-c",
      "test -x /opt/sundocked/init.sh && /opt/sundocked/init.sh",
    ]);
    if (fast.status === 0) {
      if (!opts.quiet) {
        const out = (fast.stdout || "").trim();
        console.log(`DNS proxy: ${out || "ready"}`);
      }
      return;
    }
    // fall through to full bootstrap
  }

  if (!fs.existsSync(DNS_PROXY_INIT_SH)) {
    if (!opts.quiet) console.log(`DNS proxy: missing ${DNS_PROXY_INIT_SH}, skipping`);
    return;
  }

  const archProc = docker(["exec", name, "uname", "-m"]);
  if (archProc.status !== 0) {
    if (!opts.quiet) console.log(`DNS proxy: cannot detect arch (uname failed), skipping`);
    return;
  }
  const arch = (archProc.stdout || "").trim();
  const binFile = pickBinary(arch);
  if (!binFile) {
    if (!opts.quiet) console.log(`DNS proxy: unsupported arch ${arch}, skipping`);
    return;
  }
  const binPath = path.join(DNS_PROXY_BIN_DIR, binFile);
  if (!fs.existsSync(binPath)) {
    if (!opts.quiet) console.log(`DNS proxy: missing binary ${binPath}, skipping`);
    return;
  }

  let r = docker(["exec", name, "mkdir", "-p", "/opt/sundocked"]);
  if (r.status !== 0) { if (!opts.quiet) console.log(`DNS proxy: mkdir failed, skipping`); return; }

  r = docker(["cp", binPath, `${name}:/opt/sundocked/${binFile}`]);
  if (r.status !== 0) { if (!opts.quiet) console.log(`DNS proxy: cp binary failed: ${(r.stderr || "").trim()}`); return; }

  r = docker(["cp", DNS_PROXY_INIT_SH, `${name}:/opt/sundocked/init.sh`]);
  if (r.status !== 0) { if (!opts.quiet) console.log(`DNS proxy: cp init.sh failed: ${(r.stderr || "").trim()}`); return; }

  r = docker([
    "exec", name, "sh", "-c",
    "chmod +x /opt/sundocked/init.sh /opt/sundocked/sundocked-dns-* && /opt/sundocked/init.sh",
  ]);
  if (r.status !== 0) {
    if (!opts.quiet) {
      console.log(`DNS proxy: init failed (status=${r.status})`);
      const err = (r.stderr || r.stdout || "").trim();
      if (err) console.log(err.split("\n").slice(0, 5).join("\n"));
    }
    return;
  }
  if (!opts.quiet) {
    const out = (r.stdout || "").trim();
    console.log(`DNS proxy: ${out || "ready"} (resolv.conf -> 127.0.0.1)`);
  }
}

module.exports = { bootstrap };
