// Node 18 only (scripts/test.mjs): leaves the process with process.exit() once its event loop is
// empty, every test reported. Node 18.17.1 at times never ends a process that ends on its own: its
// teardown spins in V8's garbage collector (measured: 3 runs in 20 at 100 % CPU, after every test
// passed; gdb: node::FreeEnvironment, NodePlatform::DrainTasks, Heap::Scavenge). process.exit()
// keeps the exit code and skips that teardown (measured: none in 40 runs).
"use strict";

process.once("beforeExit", () => process.exit());
