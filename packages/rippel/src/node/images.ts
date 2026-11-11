/**
 * Image pipeline: converts PNGs to the pixel formats LVGL draws directly.
 * The dev runtime and the C backend share it, so both draw the same pixels.
 */
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import type { ColorFormat } from "../displays.js";

export interface ConvertedImage {
  width: number;
  height: number;
  /** Bytes per row of the first plane. */
  stride: number;
  /** Name of an LVGL color format constant. */
  format: string;
  data: Buffer;
}

/** Converts decoded RGBA pixels. Exported for tests. */
export function convertPixels(rgba: Uint8Array, width: number, height: number, colorFormat: ColorFormat): ConvertedImage {
  const pixels = width * height;
  let opaque = true;
  for (let i = 0; i < pixels; i++) {
    if (rgba[i * 4 + 3] !== 255) {
      opaque = false;
      break;
    }
  }

  if (colorFormat === "RGB565") {
    // RGB565A8 is the RGB565 plane followed by one alpha byte per pixel.
    const data = Buffer.alloc(pixels * (opaque ? 2 : 3));
    for (let i = 0; i < pixels; i++) {
      const r = rgba[i * 4];
      const g = rgba[i * 4 + 1];
      const b = rgba[i * 4 + 2];
      data.writeUInt16LE(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3), i * 2);
      if (!opaque) data[pixels * 2 + i] = rgba[i * 4 + 3];
    }
    return { width, height, stride: width * 2, format: opaque ? "LV_COLOR_FORMAT_RGB565" : "LV_COLOR_FORMAT_RGB565A8", data };
  }

  const data = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    data[i * 4] = rgba[i * 4 + 2];
    data[i * 4 + 1] = rgba[i * 4 + 1];
    data[i * 4 + 2] = rgba[i * 4];
    data[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return { width, height, stride: width * 4, format: "LV_COLOR_FORMAT_ARGB8888", data };
}

export async function convertImage(file: string, colorFormat: ColorFormat): Promise<ConvertedImage> {
  const png = PNG.sync.read(await readFile(file));
  return convertPixels(png.data, png.width, png.height, colorFormat);
}
