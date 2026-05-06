/**
 * Snapshot tests: create, list, restore, delete.
 */
const path = require("path");
const fs = require("fs");
const { execSync, spawnSync } = require("child_process");
const h = require("./helpers");

const WS = h.workspace("ws_snap");
const SNAPDIR = path.resolve(WS, "..", ".sbox", "ws_snap", "__snapshots__");

function sunboxedSnap(args) {
  const snapArgs = [h.SBOX, "/snap", ...args.split(/\s+/).filter(Boolean)];
  try {
    const r = spawnSync(process.execPath, snapArgs, { cwd: WS, timeout: 15000, windowsHide: true, stdio: "pipe" });
    return (r.stdout || "").toString().trim();
  } catch (e) {
    return "";
  }
}

function setup() {
  try { fs.rmSync(SNAPDIR, { recursive: true, force: true }); } catch (_) {}
  h.setupWorkspace(WS);
  fs.writeFileSync(path.join(WS, "file1.txt"), "original");
  fs.writeFileSync(path.join(WS, "src", "code.txt"), "v1");
}

function cleanup() {
  try { fs.rmSync(SNAPDIR, { recursive: true, force: true }); } catch (_) {}
  h.cleanupWorkspace(WS);
}

// ================================================================
function testCreate() {
  console.log("\n[SNAP 1] Create snapshot");
  setup();
  const out = sunboxedSnap("create mysnap");
  h.assert(out.includes("Snapshot created: mysnap"), "Create output correct");
  h.assert(fs.existsSync(path.join(SNAPDIR, "mysnap", "data", "file1.txt")), "file1.txt in snapshot");
  h.assert(fs.existsSync(path.join(SNAPDIR, "mysnap", "data", "src", "code.txt")), "src/code.txt in snapshot");
  h.assert(fs.existsSync(path.join(SNAPDIR, "mysnap", "created.txt")), "Timestamp file exists");
}

// ================================================================
function testCreateDuplicate() {
  console.log("\n[SNAP 2] Create duplicate fails");
  const out = sunboxedSnap("create mysnap");
  h.assert(out.includes("already exists"), "Duplicate rejected");
}

// ================================================================
function testList() {
  console.log("\n[SNAP 3] List snapshots");
  sunboxedSnap("create second");
  const out = sunboxedSnap("list");
  h.assert(out.includes("mysnap"), "List shows mysnap");
  h.assert(out.includes("second"), "List shows second");
  // Check date is present (contains year)
  h.assert(out.includes("2026") || out.includes("202"), "List shows date");
}

// ================================================================
function testListEmpty() {
  console.log("\n[SNAP 4] List empty");
  try { fs.rmSync(SNAPDIR, { recursive: true, force: true }); } catch (_) {}
  const out = sunboxedSnap("list");
  h.assert(out.includes("No snapshots"), "Empty list message");
}

// ================================================================
function testRestore() {
  console.log("\n[SNAP 5] Restore snapshot");
  setup();
  sunboxedSnap("create v1");

  // Modify files
  fs.writeFileSync(path.join(WS, "file1.txt"), "modified");
  fs.writeFileSync(path.join(WS, "new_file.txt"), "added");
  fs.unlinkSync(path.join(WS, "src", "code.txt"));

  // Restore
  const out = sunboxedSnap("restore v1");
  h.assert(out.includes("Restored: v1"), "Restore output correct");
  h.assert(
    fs.readFileSync(path.join(WS, "file1.txt"), "utf-8") === "original",
    "file1.txt restored to original"
  );
  h.assert(
    fs.existsSync(path.join(WS, "src", "code.txt")),
    "Deleted file restored"
  );
  h.assert(
    !fs.existsSync(path.join(WS, "new_file.txt")),
    "Added file removed by /MIR"
  );
}

// ================================================================
function testRestoreNonExistent() {
  console.log("\n[SNAP 6] Restore non-existent fails");
  const out = sunboxedSnap("restore doesnotexist");
  h.assert(out.includes("not found"), "Non-existent restore rejected");
}

// ================================================================
function testDelete() {
  console.log("\n[SNAP 7] Delete snapshot");
  setup();
  sunboxedSnap("create todelete");
  h.assert(fs.existsSync(path.join(SNAPDIR, "todelete")), "Snapshot exists before delete");

  const out = sunboxedSnap("delete todelete");
  h.assert(out.includes("Deleted: todelete"), "Delete output correct");
  h.assert(!fs.existsSync(path.join(SNAPDIR, "todelete")), "Snapshot removed from disk");
}

// ================================================================
function testDeleteNonExistent() {
  console.log("\n[SNAP 8] Delete non-existent fails");
  const out = sunboxedSnap("delete ghost");
  h.assert(out.includes("not found"), "Non-existent delete rejected");
}

// ================================================================
function testCreateNoName() {
  console.log("\n[SNAP 9] Create without name fails");
  const out = sunboxedSnap("create");
  h.assert(out.includes("Specify snapshot name") || out.includes("ERROR"), "No-name rejected");
}

// ================================================================
function testExcludesGitAndNodeModules() {
  console.log("\n[SNAP 10] Excludes .git and node_modules");
  setup();
  fs.mkdirSync(path.join(WS, ".git", "objects"), { recursive: true });
  fs.writeFileSync(path.join(WS, ".git", "HEAD"), "ref: refs/heads/main");
  fs.mkdirSync(path.join(WS, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(WS, "node_modules", "pkg", "index.js"), "module.exports=1");

  sunboxedSnap("create withgit");
  h.assert(
    !fs.existsSync(path.join(SNAPDIR, "withgit", "data", ".git")),
    ".git excluded from snapshot"
  );
  h.assert(
    !fs.existsSync(path.join(SNAPDIR, "withgit", "data", "node_modules")),
    "node_modules excluded from snapshot"
  );
  h.assert(
    fs.existsSync(path.join(SNAPDIR, "withgit", "data", "file1.txt")),
    "Regular files included"
  );
}

try {
  testCreate();
  testCreateDuplicate();
  testList();
  testListEmpty();
  testRestore();
  testRestoreNonExistent();
  testDelete();
  testDeleteNonExistent();
  testCreateNoName();
  testExcludesGitAndNodeModules();
} finally {
  cleanup();
}
module.exports = {};
