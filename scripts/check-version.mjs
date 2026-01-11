import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { expected: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--expected") {
      args.expected = argv[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith("--expected=")) {
      args.expected = a.slice("--expected=".length);
      continue;
    }
  }
  return args;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readCargoTomlPackageVersion(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let inPackage = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;

    if (trimmed === "[package]") {
      inPackage = true;
      continue;
    }

    if (inPackage && trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inPackage = false;
      continue;
    }

    if (!inPackage) continue;

    const match = trimmed.match(/^version\s*=\s*"([^"]+)"\s*$/);
    if (match) return match[1];
  }

  throw new Error(`No [package].version found in ${filePath}`);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  const expected = argv.expected ?? process.env.EXPECTED_VERSION;

  if (!expected) {
    console.error("Missing expected version. Usage: node scripts/check-version.mjs --expected <X.Y.Z>");
    process.exit(2);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..");

  const checks = [
    {
      file: "apps/gui/src-tauri/tauri.conf.json",
      get: async () => (await readJson(path.join(repoRoot, "apps/gui/src-tauri/tauri.conf.json"))).version,
    },
    {
      file: "apps/gui/package.json",
      get: async () => (await readJson(path.join(repoRoot, "apps/gui/package.json"))).version,
    },
    {
      file: "apps/gui/src-tauri/Cargo.toml",
      get: async () =>
        await readCargoTomlPackageVersion(path.join(repoRoot, "apps/gui/src-tauri/Cargo.toml")),
    },
  ];

  const cratesDir = path.join(repoRoot, "crates");
  if (await fileExists(cratesDir)) {
    const entries = await fs.readdir(cratesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cargoTomlRel = path.join("crates", entry.name, "Cargo.toml");
      const cargoTomlAbs = path.join(repoRoot, cargoTomlRel);
      if (!(await fileExists(cargoTomlAbs))) continue;
      checks.push({
        file: cargoTomlRel,
        get: async () => await readCargoTomlPackageVersion(cargoTomlAbs),
      });
    }
  }

  checks.sort((a, b) => a.file.localeCompare(b.file));

  const mismatches = [];
  for (const check of checks) {
    const found = await check.get();
    if (found !== expected) mismatches.push({ file: check.file, found });
  }

  if (mismatches.length > 0) {
    console.error(`Version mismatch (expected ${expected}):`);
    for (const m of mismatches) console.error(`- ${m.file}: found ${m.found}`);
    process.exit(1);
  }

  console.log(`OK: all versions match ${expected}`);
}

await main();

