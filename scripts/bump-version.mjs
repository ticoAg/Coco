import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = { to: undefined, from: undefined, check: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--to") {
      args.to = argv[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith("--to=")) {
      args.to = a.slice("--to=".length);
      continue;
    }
    if (a === "--from") {
      args.from = argv[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith("--from=")) {
      args.from = a.slice("--from=".length);
      continue;
    }
    if (a === "--no-check") {
      args.check = false;
      continue;
    }
  }
  return args;
}

function isSemverXyz(v) {
  return /^[0-9]+\.[0-9]+\.[0-9]+$/.test(v);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonPretty(filePath, obj) {
  // Preserve trailing newline for nicer diffs.
  await fs.writeFile(filePath, `${JSON.stringify(obj, null, 2)}\n`, "utf8");
}

function bumpCargoTomlPackageVersion(raw, from, to) {
  const lines = raw.split(/\r?\n/);
  let inPackage = false;
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "[package]") {
      inPackage = true;
      continue;
    }
    if (inPackage && trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inPackage = false;
      continue;
    }
    if (!inPackage) continue;

    const match = lines[i].match(/^version\s*=\s*"([^"]+)"\s*$/);
    if (!match) continue;

    const current = match[1];
    if (from && current !== from) {
      throw new Error(`Unexpected [package].version ${current} (expected ${from})`);
    }
    lines[i] = `version = "${to}"`;
    changed = true;
    break;
  }

  if (!changed) throw new Error("No [package].version found");
  return lines.join("\n");
}

function bumpCargoLockPackageVersions(raw, packageNames, from, to) {
  const lines = raw.split(/\r?\n/);
  let inPackage = false;
  let currentName = null;
  let changed = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "[[package]]") {
      inPackage = true;
      currentName = null;
      continue;
    }
    if (!inPackage) continue;

    const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"\s*$/);
    if (nameMatch) {
      currentName = nameMatch[1];
      continue;
    }

    const versionMatch = trimmed.match(/^version\s*=\s*"([^"]+)"\s*$/);
    if (versionMatch && currentName && packageNames.has(currentName)) {
      const currentVersion = versionMatch[1];
      if (from && currentVersion !== from) {
        throw new Error(
          `Cargo.lock ${currentName} has version ${currentVersion} (expected ${from})`
        );
      }
      lines[i] = `version = "${to}"`;
      changed += 1;
      continue;
    }
  }

  if (changed === 0) {
    throw new Error("No matching agentmesh packages found in Cargo.lock");
  }
  return lines.join("\n");
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const to = argv.to;
  if (!to) {
    console.error("Usage: node scripts/bump-version.mjs --to X.Y.Z [--from A.B.C] [--no-check]");
    process.exit(2);
  }
  if (!isSemverXyz(to)) {
    console.error(`Invalid version: ${to} (expected X.Y.Z)`);
    process.exit(2);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");

  const guiPkgPath = path.join(repoRoot, "apps/gui/package.json");
  const currentGui = await readJson(guiPkgPath);
  const from = argv.from ?? currentGui.version;

  if (!isSemverXyz(from)) {
    console.error(`Invalid current version: ${from} (expected X.Y.Z)`);
    process.exit(2);
  }
  if (from === to) {
    console.log(`[bump-version] already at ${to}; nothing to do`);
    return;
  }

  // 1) GUI versions (+ package-lock) via npm, so the lock stays consistent.
  console.log(`[bump-version] GUI: ${from} -> ${to}`);
  await execFileAsync("npm", ["--prefix", "apps/gui", "version", to, "--no-git-tag-version"], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  // 2) tauri.conf.json (not touched by npm version)
  const tauriConfPath = path.join(repoRoot, "apps/gui/src-tauri/tauri.conf.json");
  const tauriConf = await readJson(tauriConfPath);
  tauriConf.version = to;
  await writeJsonPretty(tauriConfPath, tauriConf);

  // 3) Cargo.toml package versions
  const cargoTomls = [
    path.join(repoRoot, "apps/gui/src-tauri/Cargo.toml"),
    path.join(repoRoot, "crates/agentmesh-core/Cargo.toml"),
    path.join(repoRoot, "crates/agentmesh-codex/Cargo.toml"),
    path.join(repoRoot, "crates/agentmesh-orchestrator/Cargo.toml"),
    path.join(repoRoot, "crates/agentmesh-cli/Cargo.toml"),
  ];

  for (const p of cargoTomls) {
    const raw = await fs.readFile(p, "utf8");
    const next = bumpCargoTomlPackageVersion(raw, from, to);
    await fs.writeFile(p, next, "utf8");
  }

  // 4) Cargo.lock: update only our own crate versions; avoid re-resolving all deps.
  const cargoLockPath = path.join(repoRoot, "Cargo.lock");
  const lockRaw = await fs.readFile(cargoLockPath, "utf8");
  const names = new Set([
    "agentmesh-core",
    "agentmesh-codex",
    "agentmesh-orchestrator",
    "agentmesh-cli",
    "agentmesh-app",
  ]);
  const lockNext = bumpCargoLockPackageVersions(lockRaw, names, from, to);
  await fs.writeFile(cargoLockPath, lockNext, "utf8");

  if (argv.check) {
    console.log(`[bump-version] verify versions match ${to}`);
    await execFileAsync("node", ["scripts/check-version.mjs", "--expected", to], {
      cwd: repoRoot,
      stdio: "inherit",
    });
  }

  console.log("[bump-version] done");
}

await main();

