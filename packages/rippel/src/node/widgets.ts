/**
 * Builds a simulator that includes the project's custom widget C, so the dev
 * runtime draws them for real. Needs Emscripten and the simulator's object
 * files from `npm run build:wasm`. Without them, widgets show as placeholders.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { contractWidgets, widgetExports, widgetHeader, type CustomWidget } from "../codegen/widgets.js";
import type { ResolvedConfig } from "./load-config.js";

const run = promisify(execFile);
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nativeDir = join(pkgDir, "native");

export type SimulatorBuild =
  | { kind: "none" }
  | { kind: "built"; module: string; widgets: CustomWidget[] }
  | { kind: "placeholder"; reason: string; widgets: CustomWidget[] };

export function findEmcc(): string | undefined {
  const exe = process.platform === "win32" ? ".exe" : "";
  const roots = [process.env.EMSDK, join(pkgDir, "..", "..", ".toolchain", "emsdk")].filter(Boolean) as string[];
  for (const root of roots) {
    const candidate = join(root, "upstream", "emscripten", `emcc${exe}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Compiler flags for C that runs inside the simulator. `extraInclude` holds ui_widgets.h. */
export function simulatorCflags(extraInclude: string): string[] {
  return [
    "-O2",
    "-DLV_CONF_INCLUDE_SIMPLE",
    "-DLV_LVGL_H_INCLUDE_SIMPLE",
    "-I", join(nativeDir, "sim"),
    "-I", join(nativeDir, "lvgl"),
    "-I", join(nativeDir, "bridge"),
    "-I", extraInclude,
  ];
}

export const simulatorObjects = () => join(pkgDir, "wasm", "build", "objects.rsp");

export async function buildCustomSimulator(config: ResolvedConfig): Promise<SimulatorBuild> {
  const sources = config.widgets?.sources ?? [];
  const widgets = config.contract ? contractWidgets(config.contract) : [];
  if (widgets.length === 0) return { kind: "none" };
  if (sources.length === 0) {
    return { kind: "placeholder", widgets, reason: "no C sources are listed under `widgets.sources` in rippel.config.ts" };
  }
  const emcc = findEmcc();
  if (!emcc) return { kind: "placeholder", widgets, reason: "Emscripten isn't installed. Run `npm run setup:emsdk`, or set EMSDK." };
  if (!existsSync(simulatorObjects())) {
    return { kind: "placeholder", widgets, reason: "the simulator's object files are missing. Run `npm run build:wasm` in the Rippel repo." };
  }

  const outDir = join(config.root, "node_modules", ".rippel", "sim");
  await mkdir(outDir, { recursive: true });
  const header = widgetHeader(widgets);
  await writeFile(join(outDir, "ui_widgets.h"), header);

  // Rebuild only when the widget C or the declared interface changes.
  const hash = createHash("sha256").update(header);
  for (const source of sources) hash.update(await readFile(source));
  const key = hash.digest("hex").slice(0, 16);
  const module = join(outDir, `rippel-lvgl-${key}.mjs`);
  if (existsSync(module)) return { kind: "built", module, widgets };

  try {
    const objects: string[] = [];
    for (const [i, source] of sources.entries()) {
      const object = join(outDir, `widget-${i}.o`);
      await run(emcc, [...simulatorCflags(outDir), "-c", source, "-o", object]);
      objects.push(object);
    }
    await run(emcc, [
      `@${simulatorObjects()}`,
      ...objects,
      "-O2",
      "-o", module,
      "-sMODULARIZE=1",
      "-sEXPORT_ES6=1",
      "-sEXPORT_NAME=createRippelLvgl",
      "-sENVIRONMENT=web",
      "-sALLOW_MEMORY_GROWTH=1",
      "-sINITIAL_MEMORY=16777216",
      `-sEXPORTED_FUNCTIONS=${["_malloc", "_free", ...widgetExports(widgets)].join(",")}`,
      "-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32,stringToNewUTF8,UTF8ToString",
    ]);
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    return { kind: "placeholder", widgets, reason: `the widget C didn't compile:\n${(e.stderr || e.message).trim()}` };
  }
  return { kind: "built", module, widgets };
}
