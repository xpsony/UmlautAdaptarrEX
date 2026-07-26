// Asserts that the native bindings in the runtime-deps tree are actually usable
// before the image ships. Both argon2 and better-sqlite3 arrive prebuilt (the
// stage has no C++/Python toolchain — see runtime-deps.pnpm-workspace.yaml), and
// a prebuild can be missing (build script not allowed) or present but unloadable
// (linked against a newer glibc than the base image). Neither makes `pnpm
// install` fail, so without this check both only surface as a crash on the first
// DB query in a released container.
//
// EVERY installed better-sqlite3 copy is probed, not just the top-level one:
// @prisma/adapter-better-sqlite3 depends on its own range, so a root dependency
// outside that range silently installs a second copy — and the copy the adapter
// resolves is the one the app really runs on.
import {readdirSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.argv[2] ?? process.cwd();
const store = path.join(root, "node_modules", ".pnpm");

const copies = readdirSync(store).filter((entry) => entry.startsWith("better-sqlite3@"));
if (copies.length === 0) {
    throw new Error(`no better-sqlite3 installed under ${store}`);
}

for (const copy of copies) {
    const db = new (require(path.join(store, copy, "node_modules", "better-sqlite3")))(":memory:");
    // Run real SQL: proves the addon works, not merely that dlopen succeeded.
    db.exec("create table probe (x integer)");
    db.close();
    console.log(`native ok: ${copy}`);
}

// argon2 resolves its addon at import time, so importing it is the whole check.
require("argon2");
console.log("native ok: argon2");
