/**
 * Runtime state shared by the renderer and the style registry: the LVGL
 * instance and the loaded fonts.
 */
import type { StyleSelector, StyleValue } from "../style/ir.js";
import type { Lvgl, Ptr } from "./lvgl.js";

let current: Lvgl | undefined;
const customFonts = new Map<string, Ptr>();
const attachListeners: Array<(lv: Lvgl) => void> = [];

export function attachLvgl(lv: Lvgl): void {
  current = lv;
  for (const listener of attachListeners.splice(0)) listener(lv);
}

/** Returns the LVGL instance. Throws if the runtime hasn't started. */
export function lvgl(): Lvgl {
  if (!current) throw new Error("The Rippel runtime hasn't started yet");
  return current;
}

export function lvglIfReady(): Lvgl | undefined {
  return current;
}

/** Runs `fn` now if LVGL is attached, or as soon as it is. */
export function whenLvglReady(fn: (lv: Lvgl) => void): void {
  if (current) fn(current);
  else attachListeners.push(fn);
}

export function registerFont(family: string, size: number, font: Ptr): void {
  customFonts.set(`${family}/${size}`, font);
}

function resolveFont(lv: Lvgl, family: string, size: number): Ptr {
  if (family === "montserrat") {
    const font = lv.fontBuiltin(size);
    if (font) return font;
  }
  const font = customFonts.get(`${family}/${size}`);
  if (!font) throw new Error(`Font "${family}" ${size}px isn't loaded`);
  return font;
}

export function selectorValue(lv: Lvgl, selector: StyleSelector): number {
  let value = lv.constant(selector.part);
  for (const state of selector.states) value |= lv.constant(state);
  return value >>> 0;
}

export type ResolvedValue = { kind: "num"; v: number } | { kind: "color"; v: number } | { kind: "ptr"; v: Ptr };

/** Turns an IR value into what the bridge setters take. */
export function resolveValue(lv: Lvgl, value: StyleValue): ResolvedValue {
  switch (value.t) {
    case "num": return { kind: "num", v: value.v };
    case "pct": return { kind: "num", v: lv.pct(value.v) };
    case "content": return { kind: "num", v: lv.sizeContent() };
    case "const": return { kind: "num", v: lv.constant(value.v) };
    case "color": return { kind: "color", v: value.v };
    case "font": return { kind: "ptr", v: resolveFont(lv, value.family, value.size) };
  }
}
