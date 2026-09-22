#!/usr/bin/env node
/**
 * Bump the app version in every place that carries it:
 *   1. package.json
 *   2. src/version.ts            (UI + update checker)
 *   3. src-tauri/tauri.conf.json (bundle + installer filename)
 *   4. src-tauri/Cargo.toml      ([package] only — deps untouched)
 *
 * Cargo.lock refreshes itself on the next cargo build.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch   # 1.0.0 -> 1.0.1
 *   node scripts/bump-version.mjs minor   # 1.0.0 -> 1.1.0
 *   node scripts/bump-version.mjs major   # 1.0.0 -> 2.0.0
 *   node scripts/bump-version.mjs 1.2.3   # explicit version
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = {
  packageJson: join(ROOT, "package.json"),
  versionTs: join(ROOT, "src", "version.ts"),
  tauriConf: join(ROOT, "src-tauri", "tauri.conf.json"),
  cargoToml: join(ROOT, "src-tauri", "Cargo.toml"),
};

function fail(msg) {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
}

function parseArg(raw) {
  if (/^\d+\.\d+\.\d+$/.test(raw)) return { mode: "explicit", version: raw };
  if (["patch", "minor", "major"].includes(raw)) return { mode: raw };
  fail(`expected patch|minor|major|X.Y.Z, got "${raw}"`);
}

function bump(current, mode) {
  const [major, minor, patch] = current.split(".").map(Number);
  if (mode === "major") return `${major + 1}.0.0`;
  if (mode === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

function main() {
  const arg = process.argv[2];
  if (!arg) fail("missing argument: patch|minor|major|X.Y.Z");
  const parsed = parseArg(arg);

  const pkg = JSON.parse(readFileSync(FILES.packageJson, "utf8"));
  const current = pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(current)) fail(`current version "${current}" is not semver`);

  const next = parsed.mode === "explicit" ? parsed.version : bump(current, parsed.mode);
  if (next === current) fail(`already at ${current}`);

  // 1. package.json
  pkg.version = next;
  writeJson(FILES.packageJson, pkg);

  // 2. src/version.ts
  {
    const p = FILES.versionTs;
    const src = readFileSync(p, "utf8");
    const out = src.replace(/APP_VERSION\s*=\s*"[^"]+"/, `APP_VERSION = "${next}"`);
    if (out === src) fail("APP_VERSION not found in src/version.ts");
    writeFileSync(p, out);
  }

  // 3. src-tauri/tauri.conf.json
  {
    const conf = JSON.parse(readFileSync(FILES.tauriConf, "utf8"));
    conf.version = next;
    writeJson(FILES.tauriConf, conf);
  }

  // 4. src-tauri/Cargo.toml — only the [package] version, never deps
  {
    const p = FILES.cargoToml;
    const lines = readFileSync(p, "utf8").split("\n");
    let inPackage = false;
    let replaced = false;
    const out = lines.map((line) => {
      const section = line.match(/^\[(.+)\]\s*$/);
      if (section) {
        inPackage = section[1].trim() === "package";
        return line;
      }
      if (inPackage && !replaced && /^version\s*=\s*"[^"]+"/.test(line)) {
        replaced = true;
        return `version = "${next}"`;
      }
      return line;
    });
    if (!replaced) fail("[package] version not found in Cargo.toml");
    writeFileSync(p, out.join("\n"));
  }

  console.log(`bump-version: ${current} -> ${next}`);
  console.log("  updated: package.json, src/version.ts, src-tauri/tauri.conf.json, src-tauri/Cargo.toml");
  console.log("  (Cargo.lock refreshes automatically on the next build)");
  console.log("Next steps:");
  console.log("  1. npm run tauri:build");
  console.log(`  2. Publish GitHub Release with tag v${next} + attach the new setup exe`);
}

main();
