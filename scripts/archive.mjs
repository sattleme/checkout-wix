// The release archive, dist/checkout-wix-<version>.zip: the plugin's files as a site gets them
// (dist/plugin-site, from `npm run build`: the plugin's one file, backend/sattleme-plugin.js, the
// five files Wix requires, SHA256SUMS, PROVENANCE.json) and the repository's CHANGELOG.md, LICENSE
// and README.md, all under checkout-wix-<version>/. The same files make the same bytes: the entries in the order of their names, stored (not compressed: a
// deflate stream depends on the zlib that makes it), dated 1980-01-01, mode 644, no extra field.
//
//   node scripts/archive.mjs                  write it
//   node scripts/archive.mjs --check          read it back: each file as SHA256SUMS says, nothing
//                                             else, and the very bytes dist/plugin-site makes
//   node scripts/archive.mjs --extract <dir>  read it back, then write its site files (all but the
//                                             documents) into <dir>, which must not exist: the
//                                             tests then run on what the archive holds

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOCUMENTS = ["CHANGELOG.md", "LICENSE", "README.md"];

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
// Version 1.0 of the format (stored files), made on Unix: the mode is in the upper 16 bits.
const VERSION = 10;
const MADE_BY = (3 << 8) | VERSION;
const MODE = 0o100644;
// 1980-01-01 00:00:00 in MS-DOS time, the first date the format holds.
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;

export function archiveName(version) {
  return `checkout-wix-${version}`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as zip computes it (ISO 3309; zlib's crc32, which Node 18 lacks). */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The bytes of a zip archive of `entries` ([{ name, data }]), in that order. */
export function zip(entries) {
  if (entries.length > 0xffff) throw new Error("too many entries for a zip archive");
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    if (data.length > 0xfffffffe || offset > 0xfffffffe) throw new Error("too large for zip");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(MADE_BY, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(MODE * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

/**
 * The entries ([{ name, data }]) of an archive as zip() writes it, and only such: stored entries
 * one after the other, each named alike in its two headers and matching its CRC-32, then the
 * directory and its end, nothing before, between or after.
 */
export function unzip(bytes) {
  const fail = (what) => {
    throw new Error(`not an archive of scripts/archive.mjs: ${what}`);
  };
  if (bytes.length < 22) fail("too short");
  const end = bytes.length - 22;
  if (bytes.readUInt32LE(end) !== END || bytes.readUInt16LE(end + 20) !== 0) fail("its end");
  const count = bytes.readUInt16LE(end + 10);
  if (bytes.readUInt32LE(end + 4) !== 0 || bytes.readUInt16LE(end + 8) !== count) fail("disks");
  const start = bytes.readUInt32LE(end + 16);
  if (start + bytes.readUInt32LE(end + 12) !== end) fail("its directory's size");
  const entries = [];
  let at = start;
  let next = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== CENTRAL) fail(`directory entry ${i}`);
    const length = bytes.readUInt16LE(at + 28);
    const header = bytes.subarray(at, at + 46);
    const nameBytes = bytes.subarray(at + 46, at + 46 + length);
    const name = nameBytes.toString("utf8");
    const size = header.readUInt32LE(24);
    const expected = {
      madeBy: MADE_BY,
      version: VERSION,
      flags: 0,
      method: 0,
      time: DOS_TIME,
      date: DOS_DATE,
      compressed: size,
      extra: 0,
      comment: 0,
      disk: 0,
      internal: 0,
      external: MODE * 0x10000,
      offset: next
    };
    const actual = {
      madeBy: header.readUInt16LE(4),
      version: header.readUInt16LE(6),
      flags: header.readUInt16LE(8),
      method: header.readUInt16LE(10),
      time: header.readUInt16LE(12),
      date: header.readUInt16LE(14),
      compressed: header.readUInt32LE(20),
      extra: header.readUInt16LE(30),
      comment: header.readUInt16LE(32),
      disk: header.readUInt16LE(34),
      internal: header.readUInt16LE(36),
      external: header.readUInt32LE(38),
      offset: header.readUInt32LE(42)
    };
    for (const key of Object.keys(expected)) {
      if (actual[key] !== expected[key]) fail(`${name}: its ${key}`);
    }
    if (!Buffer.from(name, "utf8").equals(nameBytes)) fail(`entry ${i}: its name is not UTF-8`);
    const crc = header.readUInt32LE(16);
    const local = bytes.subarray(next, next + 30);
    if (local.length < 30 || local.readUInt32LE(0) !== LOCAL) fail(`${name}: its local header`);
    const localExpected = [VERSION, 0, 0, DOS_TIME, DOS_DATE];
    const localActual = [4, 6, 8, 10, 12].map((offset) => local.readUInt16LE(offset));
    if (
      localActual.some((value, k) => value !== localExpected[k]) ||
      local.readUInt32LE(14) !== crc ||
      local.readUInt32LE(18) !== size ||
      local.readUInt32LE(22) !== size ||
      local.readUInt16LE(26) !== length ||
      local.readUInt16LE(28) !== 0 ||
      !bytes.subarray(next + 30, next + 30 + length).equals(nameBytes)
    ) {
      fail(`${name}: its two headers differ`);
    }
    const dataStart = next + 30 + length;
    if (dataStart + size > start) fail(`${name}: its data runs into the directory`);
    const data = bytes.subarray(dataStart, dataStart + size);
    if (crc32(data) !== crc) fail(`${name}: its CRC-32`);
    entries.push({ name, data });
    next = dataStart + size;
    at += 46 + length;
  }
  if (next !== start || at !== end) fail("bytes outside its entries");
  return entries;
}

function filesUnder(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(join(dir, prefix)).sort()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, path)).isDirectory()) out.push(...filesUnder(dir, path));
    else out.push(path);
  }
  return out;
}

function byName(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** What the archive of the plugin's `version` holds, from dist/plugin-site and the documents. */
export function archiveEntries(root = ROOT, version = packageVersion(root)) {
  const site = join(root, "dist", "plugin-site");
  if (!existsSync(site)) throw new Error("dist/plugin-site is missing: npm run build first");
  const prefix = archiveName(version);
  const files = filesUnder(site);
  for (const document of DOCUMENTS) {
    if (files.includes(document)) throw new Error(`dist/plugin-site has a file ${document}`);
  }
  return [
    ...DOCUMENTS.map((path) => ({
      name: `${prefix}/${path}`,
      data: readFileSync(join(root, path))
    })),
    ...files.map((path) => ({ name: `${prefix}/${path}`, data: readFileSync(join(site, path)) }))
  ].sort(byName);
}

function packageVersion(root) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

export function archivePath(root = ROOT, version = packageVersion(root)) {
  return join(root, "dist", `${archiveName(version)}.zip`);
}

function safe(path) {
  return (
    !/[\\\0]/.test(path) &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/**
 * The site files of an archive (`bytes`) of `version`, as { path: data }, once it holds what it
 * says: every name under checkout-wix-<version>/ and safe, its documents, its SHA256SUMS and
 * PROVENANCE.json, the files SHA256SUMS lists, with those SHA-256s, and nothing else.
 */
export function siteFiles(bytes, version) {
  const prefix = `${archiveName(version)}/`;
  const files = new Map();
  for (const { name, data } of unzip(bytes)) {
    const path = name.slice(prefix.length);
    if (!name.startsWith(prefix) || !safe(path)) throw new Error(`a file outside: ${name}`);
    if (files.has(path)) throw new Error(`${name} is in the archive twice`);
    files.set(path, data);
  }
  const sums = files.get("SHA256SUMS");
  if (!sums) throw new Error("the archive has no SHA256SUMS");
  const listed = new Map();
  for (const line of sums.toString("utf8").split("\n").slice(0, -1)) {
    const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (!match || !safe(match[2]) || listed.has(match[2])) {
      throw new Error(`SHA256SUMS: ${line}`);
    }
    listed.set(match[2], match[1]);
  }
  if (!sums.toString("utf8").endsWith("\n") || listed.size === 0) {
    throw new Error("SHA256SUMS lists no file, or does not end with a line break");
  }
  const provenance = JSON.parse(files.get("PROVENANCE.json")?.toString("utf8") || "null");
  if (!provenance || provenance.plugin !== version) {
    throw new Error(`PROVENANCE.json is missing or is not of ${version}`);
  }
  const described = provenance.files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
  if (described !== sums.toString("utf8")) {
    throw new Error("PROVENANCE.json and SHA256SUMS list different files");
  }
  const wanted = [...DOCUMENTS, "PROVENANCE.json", "SHA256SUMS", ...listed.keys()];
  for (const path of wanted) {
    if (!files.has(path)) throw new Error(`the archive lacks ${path}`);
  }
  for (const path of files.keys()) {
    if (!wanted.includes(path)) throw new Error(`the archive has ${path}, which SHA256SUMS lacks`);
  }
  const site = {};
  for (const [path, data] of files) {
    if (listed.has(path) && sha256(data) !== listed.get(path)) {
      throw new Error(`${path}: its SHA-256 is not the one SHA256SUMS gives`);
    }
    if (!DOCUMENTS.includes(path)) site[path] = data;
  }
  return site;
}

/** Writes the archive of dist/plugin-site; returns its path, size and SHA-256. */
export function writeArchive(root = ROOT) {
  const path = archivePath(root);
  const bytes = zip(archiveEntries(root));
  writeFileSync(path, bytes);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

/** Checks the archive in dist/; returns its path, size, SHA-256 and number of files. */
export function checkArchive(root = ROOT) {
  const path = archivePath(root);
  const version = packageVersion(root);
  const bytes = readFileSync(path);
  const site = siteFiles(bytes, version);
  if (!bytes.equals(zip(archiveEntries(root, version)))) {
    throw new Error(`${path} is not the archive of dist/plugin-site and the documents`);
  }
  return { path, bytes: bytes.length, sha256: sha256(bytes), files: Object.keys(site).length };
}

/** Writes the site files of the archive in dist/ into `dir`, which must not exist. */
export function extractArchive(dir, root = ROOT) {
  if (existsSync(dir)) throw new Error(`${dir} exists: the archive is extracted into a new one`);
  const site = siteFiles(readFileSync(archivePath(root)), packageVersion(root));
  for (const [path, data] of Object.entries(site)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), data);
  }
  return Object.keys(site).length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2);
  if (command === undefined) {
    const made = writeArchive();
    console.log(`${made.sha256}  ${made.path} (${made.bytes} bytes)`);
  } else if (command === "--check" && dir === undefined) {
    const checked = checkArchive();
    console.log(
      `${checked.sha256}  ${checked.path} (${checked.bytes} bytes): ${checked.files} site files ` +
        `as SHA256SUMS lists them, with ${DOCUMENTS.join(", ")}; the archive of dist/plugin-site`
    );
  } else if (command === "--extract" && dir) {
    console.log(`${extractArchive(dir)} files of ${archivePath()} written into ${dir}`);
  } else {
    console.error("usage: node scripts/archive.mjs [--check | --extract <dir>]");
    process.exit(2);
  }
}
