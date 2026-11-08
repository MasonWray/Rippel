// Builds the LVGL browser simulator (LVGL + Rippel bridge + simulator platform) to WASM.
//
// Output: wasm/rippel-lvgl.mjs and wasm/rippel-lvgl.wasm.
// Requires Emscripten: run `node scripts/setup-emsdk.mjs` at the repo root once,
// or set EMSDK to an existing emsdk install.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = join(pkgDir, "..", "..");
const nativeDir = join(pkgDir, "native");
const lvglDir = join(nativeDir, "lvgl");
const outDir = join(pkgDir, "wasm");
const objDir = join(outDir, "build");

function findEmcc() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const roots = [process.env.EMSDK, join(repoDir, ".toolchain", "emsdk")].filter(Boolean);
  for (const root of roots) {
    for (const name of [`emcc${exe}`, "emcc.bat", "emcc"]) {
      const candidate = join(root, "upstream", "emscripten", name);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error("Emscripten not found. Run `node scripts/setup-emsdk.mjs` at the repo root, or set EMSDK.");
}

function listC(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listC(full));
    else if (entry.endsWith(".c")) out.push(full);
  }
  return out;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

const emcc = findEmcc();
const sources = [
  ...listC(join(lvglDir, "src")),
  join(nativeDir, "bridge", "rippel_bridge.c"),
  join(nativeDir, "sim", "sim.c"),
];

const cflags = [
  "-O2",
  "-DLV_CONF_INCLUDE_SIMPLE",
  "-I", join(nativeDir, "sim"),
  "-I", lvglDir,
  "-I", join(nativeDir, "bridge"),
];

mkdirSync(objDir, { recursive: true });

// Incremental: an object is rebuilt when it's older than its source or a shared header.
// Pass --clean after updating the LVGL submodule.
const clean = process.argv.includes("--clean");
const sharedInputs = [join(nativeDir, "sim", "lv_conf.h"), join(nativeDir, "bridge", "rippel_bridge.h"), import.meta.filename];
const sharedMtime = Math.max(...sharedInputs.map((f) => statSync(f).mtimeMs));
const isStale = (src, obj) =>
  clean || !existsSync(obj) || statSync(obj).mtimeMs < Math.max(statSync(src).mtimeMs, sharedMtime);

// Compile in parallel, then link once.
const objects = sources.map((src) => join(objDir, relative(pkgDir, src).replace(/[\\/:]/g, "_") + ".o"));
const todo = sources.map((src, i) => i).filter((i) => isStale(sources[i], objects[i]));
let next = 0;
let done = 0;
async function worker() {
  while (next < todo.length) {
    const i = todo[next++];
    await run(emcc, [...cflags, "-c", sources[i], "-o", objects[i]]);
    done++;
    if (done % 50 === 0 || done === todo.length) console.log(`compiled ${done}/${todo.length}`);
  }
}
await Promise.all(Array.from({ length: availableParallelism() }, worker));

// The object list is too long for a Windows command line, so pass it in a response file.
const responseFile = join(objDir, "objects.rsp");
writeFileSync(responseFile, objects.map((o) => `"${o.replaceAll("\\", "/")}"`).join("\n"));

const exported = ["_malloc", "_free"];
const runtime = ["HEAPU8", "HEAP32", "stringToNewUTF8", "UTF8ToString"];
await run(emcc, [
  `@${responseFile}`,
  "-O2",
  "-o", join(outDir, "rippel-lvgl.mjs"),
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sEXPORT_NAME=createRippelLvgl",
  "-sENVIRONMENT=web",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sINITIAL_MEMORY=16777216",
  `-sEXPORTED_FUNCTIONS=${exported.join(",")}`,
  `-sEXPORTED_RUNTIME_METHODS=${runtime.join(",")}`,
]);
console.log(`Wrote ${relative(repoDir, join(outDir, "rippel-lvgl.mjs"))} and .wasm`);
