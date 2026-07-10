import {defineConfig} from "tsup";

export default defineConfig({
    entry: ["src/server/index.ts"],
    outDir: "dist/server",
    format: ["esm"],
    target: "node24",
    platform: "node",
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    external: [
        "better-sqlite3",
        "argon2",
        "@prisma/client",
        ".prisma/client",
    ],
});
