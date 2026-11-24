// The pinned copy of the SDK: sdk/ holds the package of sattleme/checkout-node that `npm pack`
// makes from a clean clone at one commit, unchanged (for 1.0.0, the same bytes as npm's), and
// sdk/PIN.json says which commit it comes from, with the SHA-256 of the tarball and of each file it
// holds. package.json installs that tarball (`file:`), so that package-lock.json records its
// integrity; the build bundles what it installed (scripts/build.mjs).
//
//   node scripts/sdk.mjs check
//       Whether sdk/ is PIN.json's, file for file, the tarball's own files included, and whether
//       package.json and package-lock.json install it (test/unit/sdk-pin.test.mjs runs it too).
//   node scripts/sdk.mjs import <checkout-node clone>
//       Packs a clean clone at the commit it is on (npm ci --ignore-scripts, then npm pack, whose
//       prepack builds dist/), replaces sdk/ with its tarball, writes PIN.json, then installs it
//       (npm install --save-exact --ignore-scripts). Clone and check out the version yourself; npm
//       needs the registry for the SDK's tools. Then set SDK_VERSION and SPEC_VERSION in
//       plugin/site/backend/sattleme-checkout/constants.js (the build refuses others) and run
//       `npm run check`.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const REPOSITORY = "https://github.com/sattleme/checkout-node";
export const NAME = "@sattleme/checkout";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COPY = join(ROOT, "sdk");
const PIN = "PIN.json";

function hash(algorithm, bytes, encoding = "hex") {
  return createHash(algorithm).update(bytes).digest(encoding);
}

/** The name npm pack gives the tarball of `version`: @sattleme/checkout 1.0.0 → sattleme-checkout-1.0.0.tgz. */
export function tarballName(version) {
  return `${NAME.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

function octal(field) {
  const text = field.toString("ascii").replace(/\0.*$/s, "").trim();
  if (!/^[0-7]+$/.test(text)) throw new Error(`a tar header with a size of "${text}"`);
  return Number.parseInt(text, 8);
}

/**
 * The regular files of a gzipped tar archive (ustar, as npm pack writes it, its pax headers
 * read for long names), as a map of path to bytes. Anything else than a file or a directory (a
 * link, a device) is refused: a package of the SDK holds none.
 */
export function tarFiles(gzipped) {
  const tar = gunzipSync(gzipped);
  const files = new Map();
  let paxPath = null;
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const body = tar.subarray(at + 512, at + 512 + size);
    if (body.length !== size) throw new Error("a truncated tar archive");
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      // A pax header: its "path" record names the next entry.
      for (const record of body.toString("utf8").split("\n")) {
        const match = /^\d+ path=(.*)$/s.exec(record);
        if (match) paxPath = match[1];
      }
      continue;
    }
    const path = paxPath || (prefix ? `${prefix}/${name}` : name);
    paxPath = null;
    if (type === "5") continue;
    if (type !== "0") throw new Error(`${path}: a tar entry of type ${type}, not a file`);
    if (files.has(path)) throw new Error(`${path} is twice in the archive`);
    files.set(path, Buffer.from(body));
  }
  return files;
}

/** What differs between sdk/, package.json, package-lock.json and PIN.json: empty when all agree. */
export function checkCopy(root = ROOT) {
  const copy = join(root, "sdk");
  const pinPath = join(copy, PIN);
  if (!existsSync(pinPath)) return [`sdk/${PIN} is missing`];
  const pin = JSON.parse(readFileSync(pinPath, "utf8"));
  const problems = [];
  if (pin.repository !== REPOSITORY) problems.push(`${PIN}: repository is not ${REPOSITORY}`);
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? "")) problems.push(`${PIN}: commit is not a commit`);
  if (pin.name !== NAME) problems.push(`${PIN}: name is not ${NAME}`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pin.version ?? "")) problems.push(`${PIN}: no version`);
  const tarball = tarballName(pin.version);
  const files = pin.files ?? {};
  if (Object.keys(files).join() !== tarball) problems.push(`${PIN}: files is not ${tarball} alone`);
  for (const [file, sha256] of Object.entries(files)) {
    const path = join(copy, file);
    if (!existsSync(path)) problems.push(`sdk/${file} is missing`);
    else if (hash("sha256", readFileSync(path)) !== sha256) problems.push(`sdk/${file} differs`);
  }
  for (const file of readdirSync(copy).sort()) {
    if (file !== PIN && !(file in files)) problems.push(`sdk/${file} is not in ${PIN}`);
  }
  if (problems.length) return problems;

  // The tarball's own files: those PIN.json lists, each with its SHA-256, and no other.
  const bytes = readFileSync(join(copy, tarball));
  let inside;
  try {
    inside = tarFiles(bytes);
  } catch (error) {
    return [`sdk/${tarball}: ${error.message}`];
  }
  const listed = pin.package ?? {};
  for (const [file, sha256] of Object.entries(listed)) {
    if (!inside.has(file)) problems.push(`${tarball}: ${file} is missing`);
    else if (hash("sha256", inside.get(file)) !== sha256) {
      problems.push(`${tarball}: ${file} differs`);
    }
  }
  for (const file of inside.keys()) {
    if (!(file in listed)) problems.push(`${tarball}: ${file} is not in ${PIN}`);
  }
  const manifest = inside.has("package/package.json")
    ? JSON.parse(inside.get("package/package.json").toString("utf8"))
    : {};
  if (manifest.name !== pin.name || manifest.version !== pin.version) {
    problems.push(`${tarball}: its package.json is not ${pin.name} ${pin.version}`);
  }

  // Installed from that file, at that integrity.
  const spec = `file:sdk/${tarball}`;
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if ((pkg.dependencies ?? {})[NAME] !== spec) {
    problems.push(`package.json: ${NAME} is not ${spec}`);
  }
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const entry = (lock.packages ?? {})[`node_modules/${NAME}`] ?? {};
  const integrity = `sha512-${hash("sha512", bytes, "base64")}`;
  if (((lock.packages ?? {})[""]?.dependencies ?? {})[NAME] !== spec) {
    problems.push(`package-lock.json: the root's ${NAME} is not ${spec}`);
  }
  if (entry.version !== pin.version) {
    problems.push(`package-lock.json: ${NAME} is not ${pin.version}`);
  }
  if (entry.resolved !== spec) {
    problems.push(`package-lock.json: ${NAME} is not resolved to ${spec}`);
  }
  if (entry.integrity !== integrity) {
    problems.push(`package-lock.json: ${NAME}'s integrity differs`);
  }
  return problems;
}

function importSdk(clone) {
  const git = (...args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8" }).trim();
  if (git("status", "--porcelain", "--ignored") !== "") {
    throw new Error(`${clone} is not a clean clone (git status --ignored lists files)`);
  }
  const commit = git("rev-parse", "HEAD");
  const manifest = JSON.parse(readFileSync(join(clone, "package.json"), "utf8"));
  if (manifest.name !== NAME) throw new Error(`${clone} is not ${NAME}`);
  const specPin = JSON.parse(readFileSync(join(clone, "spec", "PIN.json"), "utf8"));
  const npm = (args, cwd) => execFileSync("npm", args, { cwd, encoding: "utf8", stdio: "pipe" });
  const out = mkdtempSync(join(tmpdir(), "sdk-pack-"));
  try {
    npm(["ci", "--ignore-scripts", "--no-audit", "--no-fund"], clone);
    npm(["pack", "--pack-destination", out], clone);
    const tarball = tarballName(manifest.version);
    const bytes = readFileSync(join(out, tarball));
    const inside = tarFiles(bytes);
    rmSync(COPY, { recursive: true, force: true });
    mkdirSync(COPY);
    copyFileSync(join(out, tarball), join(COPY, tarball));
    const pin = {
      repository: REPOSITORY,
      commit,
      name: NAME,
      version: manifest.version,
      spec: { repository: specPin.repository, commit: specPin.commit, version: specPin.version },
      packedWith: {
        node: process.versions.node,
        npm: npm(["--version"], clone).trim()
      },
      files: { [tarball]: hash("sha256", bytes) },
      package: Object.fromEntries(
        [...inside.keys()].sort().map((file) => [file, hash("sha256", inside.get(file))])
      )
    };
    writeFileSync(join(COPY, PIN), `${JSON.stringify(pin, null, 2)}\n`);
    npm(["install", "--save-exact", "--ignore-scripts", `file:sdk/${tarball}`], ROOT);
    return pin;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, clone] = process.argv.slice(2);
  if (command === "check") {
    const problems = checkCopy();
    for (const problem of problems) console.error(problem);
    if (problems.length === 0) console.log("sdk/ is PIN.json's, and package-lock.json installs it");
    process.exit(problems.length === 0 ? 0 : 1);
  } else if (command === "import" && clone) {
    const pin = importSdk(clone);
    console.log(`sdk/ is ${pin.name} ${pin.version} at ${pin.commit}`);
  } else {
    console.error("Usage: node scripts/sdk.mjs check | import <checkout-node clone>");
    process.exit(2);
  }
}
