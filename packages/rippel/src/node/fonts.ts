/**
 * Font pipeline: converts TTF/OTF/WOFF fonts to LVGL binary fonts with
 * lv_font_conv, cached on disk by source content and options.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ResolvedFont } from "./load-config.js";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

export async function buildFont(font: ResolvedFont, size: number, cacheDir: string): Promise<Buffer> {
  const source = await readFile(font.src);
  const key = createHash("sha256")
    .update(source)
    .update(JSON.stringify({ size, range: font.range, bpp: font.bpp }))
    .digest("hex")
    .slice(0, 16);
  const out = join(cacheDir, `${font.family}-${size}-${key}.bin`);
  try {
    return await readFile(out);
  } catch {
    // Not cached yet.
  }

  await mkdir(cacheDir, { recursive: true });
  const cli = require.resolve("lv_font_conv/lv_font_conv.js");
  try {
    await run(process.execPath, [
      cli,
      "--font", font.src,
      "--range", font.range,
      "--size", String(size),
      "--bpp", String(font.bpp),
      "--format", "bin",
      // LVGL's binary font loader can't read compressed bitmaps.
      "--no-compress",
      "-o", out,
    ]);
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`lv_font_conv failed for ${font.family} ${size}px: ${e.stderr?.trim() || e.message}`);
  }
  return readFile(out);
}
