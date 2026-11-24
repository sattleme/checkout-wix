// Checks the built plugin as it goes into a Wix site: the release (dist/plugin-site) and its
// modules (dist/plugin-modules):
// - every JavaScript file parses as ECMAScript 2020, the level Wix documents for site code
//   ("modern JavaScript features up through and including ES2020");
// - the plugin's modules import only Wix's modules, the two packages of Wix's SDK the install adds
//   (@wix/ecom, @wix/essentials), Node's crypto, and each other (relative paths that exist);
// - the SDK's bundle requires only Node's own modules: Wix's code panel reports any other as a
//   module to install (measured);
// - the release holds the plugin's one file and the five files Wix requires, nothing else; its
//   one file imports only Wix's modules, those two packages and Node's own modules, and requires
//   nothing (an ES module); the other files import only it;
// - jobs.config is valid JSON: one job, hourly (at a minute of its own), a function the plugin's
//   file exports.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as acorn from "acorn";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = join(root, "dist", "plugin-site");
const modular = join(root, "dist", "plugin-modules");
const BUNDLE = join(modular, "backend", "sattleme-checkout", "checkout-sdk.js");
const PLUGIN_FILE = "backend/sattleme-plugin.js";
const WIX_FILES = [
  "backend/events.js",
  "backend/http-functions.js",
  "backend/jobs.config",
  "backend/service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout-config.js",
  "backend/service-plugins/payment-provider/sattlemeCheckout/sattlemeCheckout.js"
];

const MODULES = new Set([
  "wix-auth",
  "wix-crm-backend",
  "wix-crm.v2",
  "wix-data",
  "wix-data.v2",
  "wix-ecom-backend",
  "wix-http-functions",
  "wix-payment-provider-backend",
  "wix-secrets-backend.v2",
  "wix-site-backend",
  "@wix/ecom",
  "@wix/essentials",
  "crypto"
]);

function filesUnder(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? filesUnder(path) : [path];
    });
}

/** The names a CommonJS file requires with a literal: require("x"). */
function requires(ast) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "require"
    ) {
      const [arg] = node.arguments;
      found.push(arg && arg.type === "Literal" ? arg.value : null);
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return found;
}

function sources(ast) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.source
    ) {
      found.push(node.source.value);
    }
    if (node.type === "ImportExpression") found.push(node.source.value);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return found;
}

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(message);
};

/** Each JavaScript file of `site`, parsed as ES2020, with its name; a failure for any other. */
function parsed(site) {
  const out = [];
  for (const path of filesUnder(site).filter((p) => p.endsWith(".js"))) {
    const name = relative(site, path).split("\\").join("/");
    try {
      const ast = acorn.parse(readFileSync(path, "utf8"), {
        ecmaVersion: 2020,
        sourceType: "module"
      });
      console.log(`ES2020: ${relative(root, path)}`);
      out.push({ path, name, ast });
    } catch (error) {
      fail(`not ES2020: ${relative(root, path)}: ${error.message}`);
    }
  }
  return out;
}

/** The names a module exports. */
function exportsOf(ast) {
  const names = [];
  for (const node of ast.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    for (const specifier of node.specifiers || []) names.push(specifier.exported.name);
    const declaration = node.declaration;
    if (declaration && declaration.type === "VariableDeclaration") {
      for (const d of declaration.declarations) names.push(d.id.name);
    } else if (declaration && declaration.id) {
      names.push(declaration.id.name);
    }
  }
  return names;
}

/** The modules: their imports, and the SDK's bundle's requires. */
for (const { path, name, ast } of parsed(modular)) {
  if (path === BUNDLE) {
    for (const required of requires(ast)) {
      if (
        typeof required !== "string" ||
        !builtinModules.includes(required.replace(/^node:/, ""))
      ) {
        fail(`${name}: the SDK's bundle requires ${required}, not one of Node's own modules`);
      }
    }
    continue;
  }
  for (const source of sources(ast)) {
    if (typeof source !== "string") {
      fail(`${name}: an import of a computed name`);
    } else if (source.startsWith(".")) {
      if (!existsSync(resolve(dirname(path), source))) fail(`${name}: ${source} does not exist`);
    } else if (!MODULES.has(source)) {
      fail(`${name}: imports ${source}, not one of the modules a Wix site gives it`);
    }
  }
}

/** The release: its files, its one file of the plugin, the others calling into it. */
const shipped = filesUnder(release)
  .map((path) => relative(release, path).split("\\").join("/"))
  .filter((name) => name.startsWith("backend/"));
const expected = [...WIX_FILES, PLUGIN_FILE].sort();
if (JSON.stringify(shipped) !== JSON.stringify(expected)) {
  fail(`dist/plugin-site holds ${shipped.join(", ")}: expected ${expected.join(", ")}`);
}
let pluginExports = [];
for (const { path, name, ast } of parsed(release)) {
  if (name === PLUGIN_FILE) {
    pluginExports = exportsOf(ast);
    if (requires(ast).length) fail(`${name}: requires ${requires(ast).join(", ")}`);
    for (const source of sources(ast)) {
      const node = typeof source === "string" ? source.replace(/^node:/, "") : null;
      if (node === null || (!MODULES.has(node) && !builtinModules.includes(node))) {
        fail(`${name}: imports ${source}, not one of Wix's modules nor Node's own`);
      }
    }
    continue;
  }
  for (const source of sources(ast)) {
    if (typeof source !== "string" || !source.startsWith(".")) {
      if (!MODULES.has(source)) fail(`${name}: imports ${source}`);
    } else if (resolve(dirname(path), source) !== join(release, PLUGIN_FILE)) {
      fail(`${name}: imports ${source}, not the plugin's file`);
    }
  }
}

const jobs = JSON.parse(readFileSync(join(release, "backend", "jobs.config"), "utf8")).jobs;
const [job] = jobs;
const hourly = job
  ? /^([0-9]|[1-5][0-9]) \* \* \* \*$/.exec(job.executionConfig.cronExpression)
  : null;
if (jobs.length !== 1 || job.functionLocation !== "/sattleme-plugin.js" || !hourly) {
  fail(`jobs.config: one hourly job of /sattleme-plugin.js expected: ${JSON.stringify(jobs)}`);
} else if (!pluginExports.includes(job.functionName)) {
  fail(`jobs.config: ${job.functionName} is not exported by ${PLUGIN_FILE}`);
} else {
  console.log(`jobs.config: one job, hourly at minute ${hourly[1]}, exported by ${PLUGIN_FILE}`);
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
