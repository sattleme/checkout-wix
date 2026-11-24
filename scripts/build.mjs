// Builds the plugin, from its modules (plugin/site/), the pinned @sattleme/checkout (sdk/, installed
// from its tarball) and the payment page's QR code encoder (uqr, from npm), ECMAScript 2020, the
// level Wix documents for site code:
//
// - dist/plugin-site/: the release, as a site gets it: backend/sattleme-plugin.js, ONE file
//   holding every module of the plugin, the SDK and the QR code encoder (an ES module, merged by
//   esbuild), and the five files Wix requires at fixed names, which only call into it
//   (WIX_FILES); with SHA256SUMS and PROVENANCE.json.
// - dist/plugin-modules/: the same plugin as separate modules (plugin/site/ as it is, with the SDK
//   and the QR code encoder bundled in backend/sattleme-checkout/checkout-sdk.js, CommonJS): what
//   the type check reads (Velo's types; the release's one file is not type-checked by Wix) and
//   what the tests run on first.
// - dist/plugin-test/: the release's one file built alike, but for the SDK left out
//   (./checkout-sdk.js imported), for the tests that give the plugin a fake SDK.
//
//   node scripts/build.mjs           build the three
//   node scripts/build.mjs --check   build them again elsewhere and fail unless every byte matches

import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { builtinModules } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// The SDK the plugin pins (sdk/PIN.json, scripts/sdk.mjs): its commit, version and specification.
const pin = JSON.parse(readFileSync(join(root, "sdk", "PIN.json"), "utf8"));

// ws requires these native modules only when they are installed, inside try/catch. Wix's code
// panel reports a require of a module the site lacks as an error (measured), so the bundle holds,
// in their place, a module that throws as an absent one does: ws then uses its own JavaScript, as
// it does without them.
const ABSENT = ["bufferutil", "utf-8-validate"];

const absentModules = {
  name: "absent-modules",
  setup(build) {
    const names = new RegExp(`^(${ABSENT.join("|")})$`);
    build.onResolve({ filter: names }, (args) => ({ path: args.path, namespace: "absent" }));
    build.onLoad({ filter: /.*/, namespace: "absent" }, (args) => ({
      contents:
        `const error = new Error("Cannot find module '${args.path}'");\n` +
        `error.code = "MODULE_NOT_FOUND";\nthrow error;\n`,
      loader: "js"
    }));
  }
};
const TARGET = "es2020";
// The SDK's bundle of dist/plugin-modules, and the release's one file of the plugin.
const BUNDLE = join("backend", "sattleme-checkout", "checkout-sdk.js");
export const PLUGIN_FILE = "backend/sattleme-plugin.js";
// The files Wix looks for at fixed names, copied as they are: the payment provider's two (Wix
// makes them, by the name given to the service plugin: its functions, and getConfig on its own),
// the HTTP functions, the backend events, the scheduled jobs. Each only calls into PLUGIN_FILE,
// but the configuration, which imports nothing.
export const WIX_FILES = [
  "backend/events.js",
  "backend/http-functions.js",
  "backend/jobs.config",
  "backend/service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout-config.js",
  "backend/service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
];
// Wix's modules and the two packages of Wix's SDK the merchant installs: left as imports.
const WIX_MODULES = ["wix-*", "@wix/ecom", "@wix/essentials"];

const builtin = new Set(builtinModules);

/**
 * Node's own modules in the release's one file, an ES module: imported, never required (an ES
 * module has no require). The CommonJS packages of the bundle (ws) require them: each such
 * require gets the module of an import instead (node-import:, its default export: what require
 * gives), and the file imports it once at its top.
 */
const nodeModules = {
  name: "node-modules",
  setup(build) {
    build.onResolve({ filter: /^(node:)?[a-z_/]+$/ }, (args) => {
      const name = args.path.replace(/^node:/, "");
      if (!builtin.has(name)) return undefined;
      if (args.kind === "require-call") return { path: name, namespace: "node-require" };
      return { path: name, external: true };
    });
    build.onResolve({ filter: /^node-import:/ }, (args) => ({
      path: args.path.slice("node-import:".length),
      namespace: "node-import"
    }));
    build.onLoad({ filter: /.*/, namespace: "node-require" }, (args) => ({
      contents: `module.exports = require("node-import:${args.path}").default;\n`,
      loader: "js"
    }));
    build.onLoad({ filter: /.*/, namespace: "node-import" }, (args) => ({
      contents: `import * as m from "${args.path}";\nexport default m.default || m;\n`,
      loader: "js",
      resolveDir: root
    }));
  }
};

/**
 * The SDK's bundle the plugin imports (sdk.js: ./checkout-sdk.js): merged into the release's one
 * file from plugin/bundle/entry.js, or left out for the tests' fake SDK.
 */
function sdkBundle(inline) {
  return {
    name: "sdk-bundle",
    setup(build) {
      build.onResolve({ filter: /^\.\/checkout-sdk\.js$/ }, () =>
        inline
          ? { path: join(root, "plugin", "bundle", "entry.js") }
          : { path: "./checkout-sdk.js", external: true }
      );
    }
  };
}

function installed(name) {
  return JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));
}

/**
 * What goes into the bundle: the SDK, as sdk/PIN.json pins it, and the plugin's other
 * dependencies (the QR code encoder), at the exact versions package.json pins, then the packages
 * they require, at the exact versions their package.json pins (and theirs), each with the
 * lockfile's integrity: never a range, never a second copy. The version the status page names
 * (constants.js) is the SDK's, and the specification's its own.
 */
function inputs() {
  const constants = readFileSync(
    join(root, "plugin", "site", "backend", "sattleme-checkout", "constants.js"),
    "utf8"
  );
  for (const [name, wanted] of [
    ["SDK_VERSION", pin.version],
    ["SPEC_VERSION", pin.spec.version]
  ]) {
    const named = new RegExp(`^export const ${name} = "([^"]*)";$`, "m").exec(constants);
    if (!named || named[1] !== wanted) {
      throw new Error(`constants.js: ${name} is ${named && named[1]}, sdk/PIN.json says ${wanted}`);
    }
  }
  const sdkSpec = manifest.dependencies[pin.name];
  if (sdkSpec !== `file:sdk/${Object.keys(pin.files)[0]}`) {
    throw new Error(`package.json: ${pin.name} is ${sdkSpec}, not sdk/'s tarball`);
  }
  const wanted = new Map([[pin.name, pin.version]]);
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (name === pin.name) continue;
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
      throw new Error(`package.json asks for ${name} ${version}: not an exact version`);
    }
    wanted.set(name, version);
  }
  for (const name of wanted.keys()) {
    for (const [dep, version] of Object.entries(installed(name).dependencies || {})) {
      if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
        throw new Error(`${name} asks for ${dep} ${version}: not an exact version`);
      }
      if (wanted.has(dep) && wanted.get(dep) !== version) {
        throw new Error(`${dep}: ${wanted.get(dep)} and ${version} are both asked for`);
      }
      wanted.set(dep, version);
    }
  }
  return [...wanted].map(([name, version]) => {
    const entry = lock.packages[`node_modules/${name}`];
    if (!entry) throw new Error(`${name} is not in package-lock.json`);
    if (entry.version !== version) {
      throw new Error(`${name}: ${version} is pinned, the lockfile has ${entry.version}`);
    }
    const copies = Object.keys(lock.packages).filter((path) =>
      path.endsWith(`node_modules/${name}`)
    );
    if (copies.length !== 1) {
      throw new Error(`${name} is installed ${copies.length} times: ${copies}`);
    }
    if (installed(name).version !== entry.version) {
      throw new Error(`${name}: node_modules has ${installed(name).version}, run npm ci`);
    }
    return {
      name,
      version: entry.version,
      resolved: entry.resolved,
      integrity: entry.integrity,
      license: entry.license
    };
  });
}

/** The license texts of the bundled packages, as a comment at the end of the bundle (MIT asks it). */
function footer(packages) {
  const blocks = packages.map((p) => {
    const text = readFileSync(join(root, "node_modules", p.name, "LICENSE"), "utf8").replace(
      /\*\//g,
      "* /"
    );
    return `${p.name}@${p.version}, LICENSE:\n\n${text.trim()}`;
  });
  return `/*\nLicenses of the bundled packages.\n\n${blocks.join("\n\n----\n\n")}\n*/`;
}

function banner(packages, merged) {
  const lines = [
    // Wix's code panel lints site code with an older list of globals (BigInt, globalThis: "no-undef",
    // measured), and type-checks it with Velo's types: a generated bundle is not code to check.
    "/* eslint-disable */",
    "// @ts-nocheck",
    ...(merged
      ? [
          `// sattle.me Checkout for Wix ${manifest.version}: the whole plugin in one file, its modules`,
          "// (plugin/site/backend/sattleme-checkout/ of github.com/sattleme/checkout-wix, MIT), the SDK",
          "// and the QR code encoder, merged by checkout-wix's scripts/build.mjs with esbuild",
          `// ${esbuild.version}, target ${TARGET}, an ES module, from these packages (package-lock.json),`
        ]
      : [
          "// sattle.me Checkout for Wix: the bundle of the SDK and the QR code encoder, built by",
          `// checkout-wix's scripts/build.mjs with esbuild ${esbuild.version}, target ${TARGET}, CommonJS,`,
          "// from these packages (package-lock.json),"
        ]),
    `// ${pin.name} ${pin.version} packed from ${pin.repository} at`,
    `// ${pin.commit}:`,
    ...packages.map((p) => `//   ${p.name}@${p.version} (${p.license}) ${p.integrity}`),
    "// Generated: do not edit. Their licenses are at the end of this file."
  ];
  return lines.join("\n");
}

/** The SDK's bundle of dist/plugin-modules: CommonJS, as the modules import it. */
async function bundle(outfile, packages) {
  const result = await esbuild.build({
    entryPoints: [join(root, "plugin", "bundle", "entry.js")],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: TARGET,
    plugins: [absentModules],
    legalComments: "eof",
    charset: "ascii",
    minify: false,
    sourcemap: false,
    metafile: true,
    logLevel: "warning",
    banner: { js: banner(packages, false) },
    footer: { js: footer(packages) }
  });
  checkInputs(result.metafile, packages, ["plugin/bundle/"]);
}

/**
 * The release's one file (`inline`), or its tests' (the SDK left out): every module of the
 * plugin from plugin/site/backend/sattleme-plugin.js, an ES module, Wix's modules and Node's
 * own imported, nothing required.
 */
async function merge(outfile, packages, inline) {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [join(root, "plugin", "site", PLUGIN_FILE)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: TARGET,
    external: WIX_MODULES,
    plugins: [absentModules, nodeModules, sdkBundle(inline)],
    legalComments: "eof",
    charset: "ascii",
    minify: false,
    sourcemap: false,
    metafile: true,
    logLevel: "warning",
    banner: { js: banner(packages, true) },
    footer: { js: footer(packages) }
  });
  checkInputs(result.metafile, inline ? packages : [], [
    "plugin/site/backend/",
    ...(inline ? ["plugin/bundle/"] : [])
  ]);
}

/** Every file in a bundle comes from the pinned packages or from the plugin's own folders. */
function checkInputs(metafile, packages, folders) {
  const allowed = [...folders, ...packages.map((p) => `node_modules/${p.name}/`)];
  const virtual = [
    ...ABSENT.map((name) => `absent:${name}`),
    ...[...builtin].flatMap((name) => [`node-require:${name}`, `node-import:${name}`])
  ];
  for (const file of Object.keys(metafile.inputs)) {
    const path = file.split(sep).join("/");
    if (!allowed.some((prefix) => path.startsWith(prefix)) && !virtual.includes(path)) {
      throw new Error(`unexpected input in the bundle: ${file}`);
    }
  }
}

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listed(out) {
  return filesUnder(out).map((path) => ({
    path: relative(out, path).split(sep).join("/"),
    sha256: sha256(path),
    bytes: statSync(path).size
  }));
}

function fresh(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** The plugin as separate modules, with the SDK's bundle (dist/plugin-modules). */
async function buildModules(out, packages) {
  fresh(out);
  cpSync(join(root, "plugin", "site"), out, { recursive: true });
  await bundle(join(out, BUNDLE), packages);
}

/** The release (dist/plugin-site), or its tests' twin (dist/plugin-test: the SDK left out). */
async function buildSite(out, packages, inline) {
  fresh(out);
  for (const path of WIX_FILES) {
    mkdirSync(dirname(join(out, path)), { recursive: true });
    cpSync(join(root, "plugin", "site", path), join(out, path));
  }
  await merge(join(out, PLUGIN_FILE), packages, inline);
  if (!inline) return;
  const files = listed(out);
  writeFileSync(join(out, "SHA256SUMS"), files.map((f) => `${f.sha256}  ${f.path}\n`).join(""));
  const provenance = {
    description: `How dist/plugin-site was built: ${PLUGIN_FILE} holds every module of the plugin (plugin/site/backend/sattleme-checkout/), the SDK from sdk/, its dependencies and the QR code encoder from npm, merged by esbuild into one ES module; the other files are the plugin's own, as Wix requires them.`,
    plugin: manifest.version,
    sdk: {
      name: pin.name,
      version: pin.version,
      repository: pin.repository,
      commit: pin.commit,
      spec: pin.spec
    },
    packages,
    esbuild: esbuild.version,
    target: TARGET,
    format: "esm",
    absent: ABSENT,
    files
  };
  writeFileSync(join(out, "PROVENANCE.json"), JSON.stringify(provenance, null, 2) + "\n");
}

const LAYOUTS = ["plugin-modules", "plugin-site", "plugin-test"];

async function build(dist) {
  const packages = inputs();
  await buildModules(join(dist, "plugin-modules"), packages);
  await buildSite(join(dist, "plugin-site"), packages, true);
  await buildSite(join(dist, "plugin-test"), packages, false);
  return listed(join(dist, "plugin-site"));
}

const dist = join(root, "dist");
if (process.argv.includes("--check")) {
  const again = mkdtempSync(join(tmpdir(), "plugin-build-"));
  try {
    await build(again);
    let count = 0;
    for (const layout of LAYOUTS) {
      const first = filesUnder(join(dist, layout)).map((p) => [relative(dist, p), sha256(p)]);
      const second = filesUnder(join(again, layout)).map((p) => [relative(again, p), sha256(p)]);
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error(
          `the plugin does not build reproducibly: a second build differs from dist/${layout}`
        );
      }
      count += first.length;
    }
    console.log(`reproducible: ${count} files, same SHA-256 in a second build`);
  } finally {
    rmSync(again, { recursive: true, force: true });
  }
} else {
  const files = await build(dist);
  for (const f of files) console.log(`${f.sha256}  ${f.path} (${f.bytes} bytes)`);
}
