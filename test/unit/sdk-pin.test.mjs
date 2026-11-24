// The pinned copy of the SDK (sdk/, scripts/sdk.mjs): the tarball sdk/PIN.json pins, with its
// SHA-256 and that of each file it holds, installed from that file at that integrity. It changes
// only by importing another commit of checkout-node (node scripts/sdk.mjs import <clone>), never
// by hand. And the vectors the tests use: files of the specification that SDK implements.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { checkCopy, tarFiles, tarballName } from "../../scripts/sdk.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pin = JSON.parse(readFileSync(join(root, "sdk", "PIN.json"), "utf8"));

test("sdk/ is the copy PIN.json pins, and package-lock.json installs it", () => {
  assert.deepEqual(checkCopy(), []);
  assert.equal(pin.name, "@sattleme/checkout");
  assert.equal(pin.repository, "https://github.com/sattleme/checkout-node");
  assert.equal(tarballName(pin.version), `sattleme-checkout-${pin.version}.tgz`);
  // The bundle is built from what npm installed: that tarball's dist/, unchanged.
  const installed = readFileSync(
    join(root, "node_modules", "@sattleme", "checkout", "dist", "index.js")
  );
  const inside = tarFiles(readFileSync(join(root, "sdk", tarballName(pin.version))));
  assert.ok(inside.get("package/dist/index.js").equals(installed));
});

test("a copy that differs from PIN.json, or that npm does not install so, is refused", () => {
  const copy = mkdtempSync(join(tmpdir(), "sdk-pin-"));
  try {
    for (const name of ["sdk", "package.json", "package-lock.json"]) {
      cpSync(join(root, name), join(copy, name), { recursive: true });
    }
    assert.deepEqual(checkCopy(copy), []);
    // Another file next to the tarball.
    writeFileSync(join(copy, "sdk", "notes.txt"), "x");
    assert.deepEqual(checkCopy(copy), ["sdk/notes.txt is not in PIN.json"]);
    rmSync(join(copy, "sdk", "notes.txt"));
    // A tarball rebuilt with one file changed: its SHA-256 differs.
    const tarball = join(copy, "sdk", tarballName(pin.version));
    writeFileSync(tarball, gzipSync(Buffer.alloc(1024)));
    assert.deepEqual(checkCopy(copy), [`sdk/${tarballName(pin.version)} differs`]);
    cpSync(join(root, "sdk"), join(copy, "sdk"), { recursive: true });
    // The lockfile's integrity of another tarball.
    const lock = JSON.parse(readFileSync(join(copy, "package-lock.json"), "utf8"));
    lock.packages["node_modules/@sattleme/checkout"].integrity = "sha512-AAAA";
    writeFileSync(join(copy, "package-lock.json"), JSON.stringify(lock));
    assert.deepEqual(checkCopy(copy), [
      "package-lock.json: @sattleme/checkout's integrity differs"
    ]);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test("test/vectors/ are files of the specification the SDK implements, unchanged", () => {
  const vectors = join(root, "test", "vectors");
  const pinned = JSON.parse(readFileSync(join(vectors, "PIN.json"), "utf8"));
  assert.equal(pinned.repository, "https://github.com/sattleme/checkout-spec");
  assert.deepEqual([pinned.commit, pinned.version], [pin.spec.commit, pin.spec.version]);
  assert.deepEqual(readdirSync(vectors).sort(), ["PIN.json", ...Object.keys(pinned.files)].sort());
  for (const [file, { sha256 }] of Object.entries(pinned.files)) {
    const bytes = readFileSync(join(vectors, file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, file);
  }
});
