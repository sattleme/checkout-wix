// Runs the tests on the Node that runs this script (22 or later, and 18.17.1, a Wix site's
// backend's), against the built plugin (npm run build: its modules, then the release's one file),
// with no network:
//   test/unit, test/journeys   the plugin with fakes of the Wix modules and of the SDK;
//   test/integration           the plugin and the SDK's real bundle, its HTTP client and WebSocket
//                              pointed at fakes, with checkout-spec's public vectors.
// Each group in its own `node --test` run: the module hooks (test/fakes/hooks.mjs) give it the fake
// SDK or the real bundle. Node 18 has no module.register(): the hooks load with
// --experimental-loader there, and test/fakes/exit.cjs ends each process (see there).

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [major, minor] = process.versions.node.split(".").map(Number);
const hooks =
  major > 20 || (major === 20 && minor >= 6)
    ? ["--import", "./test/fakes/register.mjs"]
    : ["--experimental-loader", "./test/fakes/hooks.mjs", "--no-warnings"];
const exit = major === 18 ? ["--require", "./test/fakes/exit.cjs"] : [];

// Each group runs on the plugin's separate modules (dist/plugin-modules), then on the release's
// one file (dist/plugin-site, with the SDK it holds; dist/plugin-test, the same file with the SDK
// left out, for the fake SDK).
const GROUPS = [
  { dir: "unit", sdk: "fake", dist: "plugin-modules" },
  { dir: "journeys", sdk: "fake", dist: "plugin-modules" },
  { dir: "integration", sdk: "real", dist: "plugin-modules" },
  { dir: "unit", sdk: "fake", dist: "plugin-test" },
  { dir: "journeys", sdk: "fake", dist: "plugin-test" },
  { dir: "integration", sdk: "real", dist: "plugin-site" }
];

let failed = false;
for (const group of GROUPS) {
  const files = readdirSync(join(root, "test", group.dir))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => join("test", group.dir, name));
  if (!files.length) continue;
  console.log(
    `\n# ${group.dir} (${files.length} files, ${group.sdk} SDK, dist/${group.dist}, Node ${process.version})`
  );
  const run = spawnSync(
    process.execPath,
    [...exit, "--require", "./test/fakes/guard.cjs", ...hooks, "--test", ...files],
    {
      cwd: root,
      stdio: "inherit",
      env: Object.assign({}, process.env, {
        SATTLEME_TEST_SDK: group.sdk,
        SATTLEME_TEST_DIST: group.dist
      })
    }
  );
  if (run.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
