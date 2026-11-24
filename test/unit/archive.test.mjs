// The release archive (scripts/archive.mjs): a zip of the built plugin and its documents, the same
// bytes from the same files, read back only as it was written, every file as SHA256SUMS says.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
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
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

import {
  DOCUMENTS,
  archiveEntries,
  archiveName,
  archivePath,
  checkArchive,
  crc32,
  extractArchive,
  siteFiles,
  unzip,
  writeArchive,
  zip
} from "../../scripts/archive.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

// A copy of the repository's documents and built plugin, where archives are written and broken.
const copy = mkdtempSync(join(tmpdir(), "checkout-wix-archive-"));
after(() => rmSync(copy, { recursive: true, force: true }));
for (const document of [...DOCUMENTS, "package.json"]) {
  cpSync(join(root, document), join(copy, document));
}
cpSync(join(root, "dist", "plugin-site"), join(copy, "dist", "plugin-site"), { recursive: true });

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function entry(name, text) {
  return { name, data: Buffer.from(text, "utf8") };
}

test("CRC-32 as zip computes it", () => {
  assert.equal(crc32(Buffer.alloc(0)), 0);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const bytes = readFileSync(join(root, "LICENSE"));
  if (typeof zlib.crc32 === "function") assert.equal(crc32(bytes), zlib.crc32(bytes));
});

test("an archive is read back as written, and the same entries make the same bytes", () => {
  const entries = [entry("a/b.txt", "one\n"), entry("a/c/d.js", "two"), entry("a/e", "")];
  const bytes = zip(entries);
  assert.ok(bytes.equals(zip(entries.map((e) => ({ name: e.name, data: Buffer.from(e.data) })))));
  assert.deepEqual(
    unzip(bytes).map((e) => [e.name, e.data.toString("utf8")]),
    [
      ["a/b.txt", "one\n"],
      ["a/c/d.js", "two"],
      ["a/e", ""]
    ]
  );
  // Stored: each file's bytes are in the archive as they are.
  assert.ok(bytes.includes(Buffer.from("one\n")));
});

test("anything but an archive as zip() writes it is refused", () => {
  const bytes = zip([entry("a/b.txt", "one\n"), entry("a/c.txt", "two\n")]);
  const changed = (offset, value) => {
    const copy = Buffer.from(bytes);
    copy[offset] = value;
    return copy;
  };
  const at = bytes.indexOf(Buffer.from("one\n"));
  assert.throws(() => unzip(changed(at, 0x4f)), /a\/b\.txt: its CRC-32/);
  assert.throws(() => unzip(Buffer.concat([bytes, Buffer.from([0])])), /its end/);
  assert.throws(() => unzip(Buffer.concat([Buffer.from([0]), bytes])), /its directory's size/);
  assert.throws(() => unzip(bytes.subarray(0, 21)), /too short/);
  // Compressed (method 8), in the directory and in the local header alike.
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const deflated = changed(central + 10, 8);
  deflated[8] = 8;
  assert.throws(() => unzip(deflated), /its method/);
  // The directory naming another file than the local header.
  const renamed = Buffer.from(bytes);
  renamed[central + 46] = "x".charCodeAt(0);
  assert.throws(() => unzip(renamed), /two headers differ/);
});

test("the archive holds the built plugin and the documents, under checkout-wix-<version>/", () => {
  const made = writeArchive(copy);
  assert.equal(made.path, join(copy, "dist", `${archiveName(version)}.zip`));
  const bytes = readFileSync(made.path);
  assert.equal(made.sha256, sha256(bytes));
  const sums = readFileSync(join(copy, "dist", "plugin-site", "SHA256SUMS"), "utf8");
  const listed = sums
    .trim()
    .split("\n")
    .map((line) => line.slice(66));
  // The plugin in one file, and the five files Wix requires at fixed names: nothing else.
  assert.deepEqual(listed, [
    "backend/events.js",
    "backend/http-functions.js",
    "backend/jobs.config",
    "backend/sattleme-plugin.js",
    "backend/service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout-config.js",
    "backend/service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
  ]);
  assert.deepEqual(
    unzip(bytes).map((e) => e.name),
    [...DOCUMENTS, "PROVENANCE.json", "SHA256SUMS", ...listed]
      .map((path) => `checkout-wix-${version}/${path}`)
      .sort()
  );
  for (const { name, data } of unzip(bytes)) {
    const path = name.slice(`checkout-wix-${version}/`.length);
    const source = DOCUMENTS.includes(path)
      ? join(copy, path)
      : join(copy, "dist", "plugin-site", path);
    assert.ok(data.equals(readFileSync(source)), path);
  }
  const checked = checkArchive(copy);
  assert.deepEqual(checked, {
    path: made.path,
    bytes: bytes.length,
    sha256: made.sha256,
    files: listed.length + 2
  });
  // Written again from the same files: the same bytes.
  assert.equal(writeArchive(copy).sha256, made.sha256);
});

test("the check refuses an archive that differs from the build or from its SHA256SUMS", () => {
  writeArchive(copy);
  const path = archivePath(copy);
  const good = readFileSync(path);
  const entries = archiveEntries(copy);
  const named = (suffix) => entries.findIndex((e) => e.name.endsWith(suffix));
  const variant = (change) => {
    const copied = entries.map((e) => ({ name: e.name, data: Buffer.from(e.data) }));
    change(copied);
    return zip(copied);
  };
  try {
    // A file changed after the build: no longer the SHA-256 that SHA256SUMS gives.
    const changed = variant((list) => {
      list[named("/sattleme-plugin.js")].data = Buffer.from("export {};\n");
    });
    writeFileSync(path, changed);
    assert.throws(() => checkArchive(copy), /sattleme-plugin\.js: its SHA-256/);
    // A file SHA256SUMS does not list.
    writeFileSync(
      path,
      variant((list) => list.push(entry(`checkout-wix-${version}/backend/extra.js`, "1")))
    );
    assert.throws(() => checkArchive(copy), /has backend\/extra\.js, which SHA256SUMS lacks/);
    // A file missing.
    writeFileSync(
      path,
      variant((list) => list.splice(named("/LICENSE"), 1))
    );
    assert.throws(() => checkArchive(copy), /lacks LICENSE/);
    // A name that leaves the archive's folder.
    for (const name of [
      `checkout-wix-${version}/../evil.js`,
      `checkout-wix-${version}//evil.js`,
      "evil.js"
    ]) {
      writeFileSync(
        path,
        variant((list) => list.push(entry(name, "1")))
      );
      assert.throws(() => checkArchive(copy), /a file outside/, name);
    }
    // Another version's archive.
    writeFileSync(path, zip(archiveEntries(copy, "9.9.9")));
    assert.throws(() => checkArchive(copy), /a file outside/);
    // A document changed: SHA256SUMS does not cover it, the comparison with the build does.
    writeFileSync(
      path,
      variant((list) => {
        list[named("/README.md")].data = Buffer.from("# another\n");
      })
    );
    assert.throws(() => checkArchive(copy), /is not the archive of dist\/plugin-site/);
  } finally {
    writeFileSync(path, good);
  }
  assert.equal(checkArchive(copy).sha256, sha256(good));
});

test("extracted, the archive gives back dist/plugin-site, file for file, and no document", () => {
  writeArchive(copy);
  const out = join(copy, "extracted");
  const count = extractArchive(out, copy);
  const site = join(copy, "dist", "plugin-site");
  const list = (dir, prefix = "") =>
    readdirSync(join(dir, prefix), { withFileTypes: true })
      .flatMap((d) =>
        d.isDirectory()
          ? list(dir, join(prefix, d.name))
          : [[join(prefix, d.name), sha256(readFileSync(join(dir, prefix, d.name)))]]
      )
      .sort();
  assert.deepEqual(list(out), list(site));
  assert.equal(count, list(site).length);
  for (const document of DOCUMENTS) assert.equal(existsSync(join(out, document)), false);
  // Never into a folder that exists.
  mkdirSync(join(copy, "taken"));
  assert.throws(() => extractArchive(join(copy, "taken"), copy), /exists/);
  // siteFiles alone: the same files.
  const files = siteFiles(readFileSync(archivePath(copy)), version);
  assert.equal(Object.keys(files).length, count);
});
