// Checks that a project's generated C draws the same pixels as the dev runtime.
//
// Both sides run real LVGL compiled to WASM, in Node, with the simulator's
// lv_conf.h. One side renders the TSX through the Solid renderer, the other
// runs the C. A scenario file drives both through the same signals and touches.
//
// Usage: node scripts/conformance.mjs <project-dir> <generated-c-dir> [scenario.json]
// Requires Emscripten and the object files left by `npm run build:wasm`.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoDir = join(pkgDir, "..", "..");
const nativeDir = join(pkgDir, "native");
const objDir = join(pkgDir, "wasm", "build");

const [projectArg, generatedArg, scenarioArg] = process.argv.slice(2);
if (!projectArg || !generatedArg) {
  console.error("Usage: node scripts/conformance.mjs <project-dir> <generated-c-dir> [scenario.json]");
  process.exit(2);
}
const projectDir = resolve(projectArg);
const generatedDir = resolve(generatedArg);
const tmpDir = join(projectDir, "node_modules", ".rippel", "conformance");
mkdirSync(tmpDir, { recursive: true });

function findEmcc() {
  const exe = process.platform === "win32" ? ".exe" : "";
  const roots = [process.env.EMSDK, join(repoDir, ".toolchain", "emsdk")].filter(Boolean);
  for (const root of roots) {
    const candidate = join(root, "upstream", "emscripten", `emcc${exe}`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Emscripten not found. Run `npm run setup:emsdk`, or set EMSDK.");
}

function run(cmd, args) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${cmd} exited with ${code}`))));
  });
}

const emcc = findEmcc();
const cflags = ["-O2", "-DLV_CONF_INCLUDE_SIMPLE", "-DLV_LVGL_H_INCLUDE_SIMPLE", "-I", join(nativeDir, "sim"), "-I", join(nativeDir, "lvgl"), "-I", join(nativeDir, "bridge")];
const runtime = "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,stringToNewUTF8,UTF8ToString";
const linkFlags = ["-O2", "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=node", "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=16777216", runtime];
const objects = `@${join(objDir, "objects.rsp")}`;

/** Links the simulator objects, plus any extra objects, into a Node module. */
async function link(name, extraObjects, exported) {
  const out = join(tmpDir, `${name}.mjs`);
  await run(emcc, [objects, ...extraObjects, ...linkFlags, `-sEXPORTED_FUNCTIONS=${exported.join(",")}`, "-o", out]);
  return (await import(pathToFileURL(out).href + `?t=${Date.now()}`)).default;
}

const snake = (name) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const { createServer } = await import("vite");
const { loadConfig, styleContext } = await import("../dist/node/load-config.js");
const { rippel } = await import("../dist/vite/plugin.js");
const { buildFont } = await import("../dist/node/fonts.js");

const config = await loadConfig(projectDir);
const { width, height, colorFormat, dpi } = config.display;
const COLOR_FORMAT = { RGB565: 0, RGB888: 1, XRGB8888: 2 };
const scenarioFile = scenarioArg ? resolve(scenarioArg) : join(projectDir, "conformance.json");
const scenario = existsSync(scenarioFile) ? JSON.parse(readFileSync(scenarioFile, "utf8")) : [];

console.log("Linking the WASM builds...");
const sources = readdirSync(generatedDir).filter((f) => f.endsWith(".c") && f !== "rippel_bridge.c");
const compiled = [];
for (const source of sources) {
  const object = join(tmpDir, `${source}.o`);
  await run(emcc, [...cflags, "-c", join(generatedDir, source), "-o", object]);
  compiled.push(object);
}

globalThis.__rippelDevFactory = await link("dev", [], ["_malloc", "_free"]);

// The dev side: the real renderer and style registry, loaded through Vite so TSX and CSS compile as in `rippel dev`.
const FACTORY_ID = "\0conformance:lvgl-factory";
const server = await createServer({
  root: projectDir,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { noExternal: true, resolve: { conditions: ["browser", "development"], externalConditions: ["node"] } },
  plugins: [
    {
      name: "conformance-factory",
      enforce: "pre",
      resolveId: (id) => (id.endsWith("rippel-lvgl.mjs") ? FACTORY_ID : undefined),
      load: (id) => (id === FACTORY_ID ? "export default globalThis.__rippelDevFactory;" : undefined),
    },
    ...rippel(config),
  ],
});

const dist = (file) => pathToFileURL(join(pkgDir, "dist", file)).pathname;
const load = (id) => server.ssrLoadModule(id);

const FRAME_TICKS = 40;
const settle = () => new Promise((done) => setTimeout(done, 0));

async function startDev() {
  const { loadLvgl } = await load(dist("runtime/lvgl.js"));
  const { attachLvgl, registerFont } = await load(dist("runtime/host.js"));
  const { setStyleContext } = await load(dist("runtime/styles.js"));
  const { render, createComponent, createRoot } = await load(dist("runtime/renderer.js"));
  const { contractMeta } = await load(dist("contract.js"));

  const lv = await loadLvgl();
  lv.init(width, height, colorFormat, dpi);
  attachLvgl(lv);
  setStyleContext(styleContext(config));
  const cacheDir = join(tmpDir, "fonts");
  for (const font of config.fonts) {
    for (const size of font.sizes) registerFont(font.family, size, lv.loadFont(new Uint8Array(await buildFont(font, size, cacheDir))));
  }

  const contract = config.contract ? await load(config.contract) : {};
  const app = await load(config.entry);
  render(() => createComponent(app.default, {}), createRoot());
  await settle();

  const frame = new Uint8ClampedArray(width * height * 4);
  return {
    pointer: (x, y, down) => lv.pointer(x, y, down),
    tick: () => lv.tick(16),
    setSignal: (name, value) => contractMeta(contract[name]).set(value),
    async draw() {
      for (let i = 0; i < FRAME_TICKS; i++) {
        lv.tick(16);
        lv.takeFrame(frame);
        await settle();
      }
      return frame;
    },
  };
}

async function startC(exportedSignals) {
  const factory = await link("c", compiled, ["_malloc", "_free", "_ui_init", "_lv_display_get_default", ...exportedSignals]);
  const m = await factory();
  if (m._rp_sim_init(width, height, COLOR_FORMAT[colorFormat], dpi) !== 0) throw new Error("Simulator failed to start");
  m.onRippelEvent = () => {};
  m._ui_init(m._lv_display_get_default());

  const frame = new Uint8ClampedArray(width * height * 4);
  return {
    pointer: (x, y, down) => m._rp_sim_pointer(x, y, down ? 1 : 0),
    tick: () => m._rp_sim_tick(16),
    setSignal(name, value) {
      const setter = m[`_ui_set_${snake(name)}`];
      if (!setter) throw new Error(`Generated code has no ui_set_${snake(name)}`);
      setter(typeof value === "boolean" ? (value ? 1 : 0) : value);
    },
    async draw() {
      for (let i = 0; i < FRAME_TICKS; i++) m._rp_sim_tick(16);
      const rgba = m._rp_sim_rgba();
      frame.set(m.HEAPU8.subarray(rgba, rgba + width * height * 4));
      return frame;
    },
  };
}

function writePpm(file, frame) {
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
  const body = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    body[i * 3] = frame[i * 4];
    body[i * 3 + 1] = frame[i * 4 + 1];
    body[i * 3 + 2] = frame[i * 4 + 2];
  }
  writeFileSync(file, Buffer.concat([header, body]));
}

function compare(name, a, b) {
  if (process.env.CONFORMANCE_DUMP) writePpm(join(tmpDir, `${name.replace(/[^a-z0-9]+/gi, "-")}.dump.ppm`), b);
  let differing = 0;
  let box;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) {
        differing++;
        box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
      }
    }
  }
  if (differing === 0) {
    console.log(`  ok    ${name}`);
    return true;
  }
  const slug = name.replace(/[^a-z0-9]+/gi, "-");
  writePpm(join(tmpDir, `${slug}.dev.ppm`), a);
  writePpm(join(tmpDir, `${slug}.c.ppm`), b);
  console.log(`  FAIL  ${name}: ${differing} pixels differ, in x ${box[0]}-${box[2]}, y ${box[1]}-${box[3]} (frames in ${tmpDir})`);
  return false;
}

let failed = false;
try {
  const contract = config.contract ? await load(config.contract) : {};
  const { contractMeta } = await load(dist("contract.js"));
  const signals = Object.entries(contract).filter(([, v]) => contractMeta(v)?.kind === "signal").map(([k]) => `_ui_set_${snake(k)}`);

  const dev = await startDev();
  const c = await startC(signals);

  let previous;
  const check = async (name) => {
    const [a, b] = [await dev.draw(), await c.draw()];
    if (!compare(name, a, b)) failed = true;
    if (previous && previous.every((v, i) => v === a[i])) {
      console.log(`  FAIL  ${name}: this step didn't change anything on screen`);
      failed = true;
    }
    previous = a.slice();
  };

  console.log(`Comparing ${width}x${height} frames:`);
  await check("initial");
  for (const step of scenario) {
    for (const side of [dev, c]) {
      if (step.signal) side.setSignal(step.signal, step.value);
      if (step.touch) {
        // A finger hovers, presses, moves in small steps and lifts, with time passing in between.
        const [x0, y0] = step.touch;
        const [x1, y1] = step.drag ?? step.touch;
        const at = (t) => [Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t)];
        const move = async (t, down) => {
          side.pointer(...at(t), down);
          side.tick();
          await settle();
        };
        await move(0, false);
        await move(0, true);
        for (let i = 1; i <= 8; i++) await move(i / 8, true);
        await move(1, false);
      }
    }
    await check(step.name ?? JSON.stringify(step));
  }
} finally {
  await server.close();
}

console.log(failed ? "\nThe generated C doesn't match the dev runtime." : "\nThe generated C matches the dev runtime.");
process.exit(failed ? 1 : 0);
