// Node 20.6 and later: the module hooks, registered before the tests (--import).
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
