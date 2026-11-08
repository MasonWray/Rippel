/** Emscripten module for the LVGL simulator. Built by scripts/build-wasm.mjs. */
export interface RippelLvglModule {
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  stringToNewUTF8(str: string): number;
  UTF8ToString(ptr: number): string;
  /** Called from C for every forwarded bridge event. */
  onRippelEvent?: (obj: number, event: number, value: number) => void;
  [exported: `_${string}`]: (...args: number[]) => number;
}

export default function createRippelLvgl(options?: Record<string, unknown>): Promise<RippelLvglModule>;
