// Installs the pinned Emscripten SDK into .toolchain/emsdk (gitignored).
// Only contributors who rebuild the LVGL WASM simulator need this.
// Users of the published package get the prebuilt WASM and never need Emscripten.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EMSDK_VERSION = "7.0.0";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const emsdkDir = join(root, ".toolchain", "emsdk");
const python = process.platform === "win32" ? "python" : "python3";

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

if (!existsSync(emsdkDir)) {
  mkdirSync(dirname(emsdkDir), { recursive: true });
  run("git", ["clone", "--depth", "1", "https://github.com/emscripten-core/emsdk.git", emsdkDir], root);
}
run(python, ["emsdk.py", "install", EMSDK_VERSION], emsdkDir);
run(python, ["emsdk.py", "activate", EMSDK_VERSION], emsdkDir);
console.log(`Emscripten ${EMSDK_VERSION} is ready in ${emsdkDir}`);
