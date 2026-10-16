// Inline because Codex must select the install before it can import package code.
// Node resolves physical paths on Windows; PowerShell only launches this program.
const WINDOWS_LAUNCHER = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(1);
const entryIn = dir => path.join(dir, "node_modules", "@kontourai", "veritas", "bin", "veritas.mjs");
const file = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const physical = p => fs.realpathSync.native(p);
const same = (a, b) => {
  const x = fs.statSync(a, { bigint: true }), y = fs.statSync(b, { bigint: true });
  return x.ino !== 0n && x.dev === y.dev && x.ino === y.ino;
};
try {
  const cwd = physical(process.cwd());
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  let entry;
  if (git.status === 0 && git.stdout.trim()) {
    const root = physical(git.stdout.trim());
    let dir = cwd, found;
    while (true) {
      if (!found && file(entryIn(dir))) found = entryIn(dir);
      if (same(dir, root)) { entry = found; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } else if (file(entryIn(cwd))) {
    entry = entryIn(cwd);
  }
  if (!entry) {
    const npm = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (file(npm)) {
      const global = spawnSync(process.execPath, [npm, "root", "--global"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      if (global.status === 0 && global.stdout.trim()) {
        const candidate = path.join(global.stdout.trim(), "@kontourai", "veritas", "bin", "veritas.mjs");
        if (file(candidate)) entry = candidate;
      }
    }
  }
  if (!entry) {
    process.stderr.write("Veritas: no installed package entry found. Install this repository's dependencies or @kontourai/veritas globally, then retry. No package was downloaded.\n");
    process.exitCode = 2;
  } else {
    const child = spawnSync(process.execPath, [entry, ...args], { stdio: "inherit", windowsHide: true });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  }
} catch (error) {
  process.stderr.write("Veritas Windows launcher: " + error.message + "\n");
  process.exitCode = 2;
}
`.trim();

export function windowsInstalledVeritasCommand(args) {
  const encoded = Buffer.from(WINDOWS_LAUNCHER).toString('base64');
  return `node -e "eval(Buffer.from('${encoded}','base64').toString())" ${args}; exit $LASTEXITCODE`;
}
