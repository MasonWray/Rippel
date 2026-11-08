/**
 * Runs the LVGL WASM simulator on a <canvas>: drives LVGL's clock from
 * requestAnimationFrame, copies changed frames to the canvas, and feeds
 * pointer input back to LVGL.
 */
import type { DisplayConfig } from "../displays.js";
import { loadLvgl, type Lvgl } from "./lvgl.js";

export interface Simulator {
  lv: Lvgl;
  stop(): void;
}

export async function startSimulator(canvas: HTMLCanvasElement, display: Required<DisplayConfig>): Promise<Simulator> {
  const lv = await loadLvgl();
  const { width, height } = display;
  lv.init(width, height, display.colorFormat, display.dpi);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context isn't available");
  const image = ctx.createImageData(width, height);

  let pointerDown = false;
  const toDevice = (e: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * height);
    return [Math.max(0, Math.min(width - 1, x)), Math.max(0, Math.min(height - 1, y))];
  };
  const onDown = (e: PointerEvent) => {
    pointerDown = true;
    canvas.setPointerCapture(e.pointerId);
    lv.pointer(...toDevice(e), true);
  };
  const onMove = (e: PointerEvent) => lv.pointer(...toDevice(e), pointerDown);
  const onUp = (e: PointerEvent) => {
    pointerDown = false;
    lv.pointer(...toDevice(e), false);
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  let last = performance.now();
  let frame = 0;
  const loop = (now: number) => {
    // Clamp the step so a backgrounded tab doesn't fast-forward animations.
    const elapsed = Math.min(100, Math.max(0, Math.round(now - last)));
    last = now;
    lv.tick(elapsed);
    const dirty = lv.takeFrame(image.data);
    if (dirty) ctx.putImageData(image, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return {
    lv,
    stop() {
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    },
  };
}
