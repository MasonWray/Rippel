/**
 * Typed JS side of the bridge: loads the LVGL WASM module and wraps the
 * exported rp_* functions. Pointers are plain numbers.
 */
import createRippelLvgl, { type RippelLvglModule } from "../../wasm/rippel-lvgl.mjs";
import type { ColorFormat } from "../displays.js";

export type Ptr = number;

/** Widget type ids. Must match rp_widget_t in rippel_bridge.h. */
export const WIDGET = { view: 0, label: 1, button: 2, slider: 3, arc: 4, bar: 5 } as const;
export type WidgetType = keyof typeof WIDGET;

/** Event ids. Must match rp_event_t in rippel_bridge.h. */
export const EVENT = {
  click: 1,
  press: 2,
  release: 3,
  longPress: 4,
  valueChanged: 5,
  focus: 6,
  blur: 7,
} as const;

const COLOR_FORMAT: Record<ColorFormat, number> = { RGB565: 0, RGB888: 1, XRGB8888: 2 };

export interface Lvgl {
  readonly module: RippelLvglModule;
  /** Looks up a named LVGL constant, e.g. "LV_STYLE_BG_COLOR". Throws if unknown. */
  constant(name: string): number;
  onEvent: ((obj: Ptr, event: number, value: number) => void) | undefined;

  // Simulator platform
  init(width: number, height: number, colorFormat: ColorFormat, dpi: number): void;
  tick(elapsedMs: number): void;
  pointer(x: number, y: number, down: boolean): void;
  screen(): Ptr;
  detachedRoot(): Ptr;
  /** Copies the frame into `target` (RGBA) if it changed. Returns the dirty rect, or undefined. */
  takeFrame(target: Uint8ClampedArray): { x: number; y: number; w: number; h: number } | undefined;
  memUsed(): number;
  memMaxUsed(): number;
  loadFont(data: Uint8Array): Ptr;

  // Bridge
  objCreate(type: WidgetType, parent: Ptr): Ptr;
  objDelete(obj: Ptr): void;
  objSetParent(obj: Ptr, parent: Ptr, index: number): void;
  objSetState(obj: Ptr, state: number, on: boolean): void;
  objSetHidden(obj: Ptr, hidden: boolean): void;
  objCenter(obj: Ptr): void;
  objListen(obj: Ptr): void;
  labelSetText(obj: Ptr, text: string): void;
  sliderSetRange(obj: Ptr, min: number, max: number): void;
  sliderSetValue(obj: Ptr, value: number): void;
  arcSetRange(obj: Ptr, min: number, max: number): void;
  arcSetValue(obj: Ptr, value: number): void;
  arcSetReadonly(obj: Ptr, readonly: boolean): void;
  barSetRange(obj: Ptr, min: number, max: number): void;
  barSetValue(obj: Ptr, value: number): void;
  viewSetScroll(obj: Ptr, scroll: boolean): void;
  styleCreate(): Ptr;
  styleDestroy(style: Ptr): void;
  styleSetNum(style: Ptr, prop: number, value: number): void;
  styleSetColor(style: Ptr, prop: number, rgb: number): void;
  styleSetPtr(style: Ptr, prop: number, ptr: Ptr): void;
  styleSetTransition(style: Ptr, props: number[], timeMs: number, delayMs: number, path: number): void;
  objAddStyle(obj: Ptr, style: Ptr, selector: number): void;
  objRemoveStyle(obj: Ptr, style: Ptr, selector: number): void;
  objSetLocalNum(obj: Ptr, prop: number, value: number, selector: number): void;
  objSetLocalColor(obj: Ptr, prop: number, rgb: number, selector: number): void;
  objSetLocalPtr(obj: Ptr, prop: number, ptr: Ptr, selector: number): void;
  objRemoveLocal(obj: Ptr, prop: number, selector: number): void;
  pct(value: number): number;
  sizeContent(): number;
  fontBuiltin(size: number): Ptr;
}

export async function loadLvgl(): Promise<Lvgl> {
  const m = await createRippelLvgl();

  const constants = new Map<string, number>();
  const count = m._rp_const_count();
  for (let i = 0; i < count; i++) {
    constants.set(m.UTF8ToString(m._rp_const_name(i)), m._rp_const_value(i));
  }

  let width = 0;
  let height = 0;

  const lv: Lvgl = {
    module: m,
    constant(name) {
      const v = constants.get(name);
      if (v === undefined) throw new Error(`Unknown LVGL constant ${name}`);
      return v;
    },
    onEvent: undefined,

    init(w, h, colorFormat, dpi) {
      width = w;
      height = h;
      const rc = m._rp_sim_init(w, h, COLOR_FORMAT[colorFormat], dpi);
      if (rc !== 0) throw new Error(`LVGL simulator failed to start (code ${rc})`);
      m.onRippelEvent = (obj, event, value) => lv.onEvent?.(obj, event, value);
    },
    tick: (ms) => void m._rp_sim_tick(ms),
    pointer: (x, y, down) => void m._rp_sim_pointer(x, y, down ? 1 : 0),
    screen: () => m._rp_sim_screen(),
    detachedRoot: () => m._rp_sim_detached_root(),
    takeFrame(target) {
      const dirtyPtr = m._rp_sim_dirty() >> 2;
      const d = m.HEAP32.subarray(dirtyPtr, dirtyPtr + 5);
      if (d[0] === 0) return undefined;
      const rect = { x: d[1], y: d[2], w: d[3] - d[1] + 1, h: d[4] - d[2] + 1 };
      d[0] = 0;
      const rgba = m._rp_sim_rgba();
      target.set(m.HEAPU8.subarray(rgba, rgba + width * height * 4));
      return rect;
    },
    memUsed: () => m._rp_sim_mem_used() >>> 0,
    memMaxUsed: () => m._rp_sim_mem_max_used() >>> 0,
    loadFont(data) {
      // LVGL keeps reading from this buffer, so it is never freed.
      const ptr = m._malloc(data.length);
      m.HEAPU8.set(data, ptr);
      const font = m._rp_sim_font_load(ptr, data.length);
      if (!font) throw new Error("LVGL could not load the font");
      return font;
    },

    objCreate: (type, parent) => m._rp_obj_create(WIDGET[type], parent),
    objDelete: (obj) => void m._rp_obj_delete(obj),
    objSetParent: (obj, parent, index) => void m._rp_obj_set_parent(obj, parent, index),
    objSetState: (obj, state, on) => void m._rp_obj_set_state(obj, state, on ? 1 : 0),
    objSetHidden: (obj, hidden) => void m._rp_obj_set_hidden(obj, hidden ? 1 : 0),
    objCenter: (obj) => void m._rp_obj_center(obj),
    objListen: (obj) => void m._rp_obj_listen(obj),
    labelSetText(obj, text) {
      const ptr = m.stringToNewUTF8(text);
      m._rp_label_set_text(obj, ptr);
      m._free(ptr);
    },
    sliderSetRange: (obj, min, max) => void m._rp_slider_set_range(obj, min, max),
    sliderSetValue: (obj, value) => void m._rp_slider_set_value(obj, value),
    arcSetRange: (obj, min, max) => void m._rp_arc_set_range(obj, min, max),
    arcSetValue: (obj, value) => void m._rp_arc_set_value(obj, value),
    arcSetReadonly: (obj, readonly) => void m._rp_arc_set_readonly(obj, readonly ? 1 : 0),
    barSetRange: (obj, min, max) => void m._rp_bar_set_range(obj, min, max),
    barSetValue: (obj, value) => void m._rp_bar_set_value(obj, value),
    viewSetScroll: (obj, scroll) => void m._rp_view_set_scroll(obj, scroll ? 1 : 0),
    styleCreate: () => m._rp_style_create(),
    styleDestroy: (style) => void m._rp_style_destroy(style),
    styleSetNum: (style, prop, value) => void m._rp_style_set_num(style, prop, value),
    styleSetColor: (style, prop, rgb) => void m._rp_style_set_color(style, prop, rgb),
    styleSetPtr: (style, prop, ptr) => void m._rp_style_set_ptr(style, prop, ptr),
    styleSetTransition(style, props, timeMs, delayMs, path) {
      const ptr = m._malloc(props.length * 4);
      m.HEAP32.set(props, ptr >> 2);
      m._rp_style_set_transition(style, ptr, props.length, timeMs, delayMs, path);
      m._free(ptr);
    },
    objAddStyle: (obj, style, selector) => void m._rp_obj_add_style(obj, style, selector),
    objRemoveStyle: (obj, style, selector) => void m._rp_obj_remove_style(obj, style, selector),
    objSetLocalNum: (obj, prop, value, selector) => void m._rp_obj_set_local_num(obj, prop, value, selector),
    objSetLocalColor: (obj, prop, rgb, selector) => void m._rp_obj_set_local_color(obj, prop, rgb, selector),
    objSetLocalPtr: (obj, prop, ptr, selector) => void m._rp_obj_set_local_ptr(obj, prop, ptr, selector),
    objRemoveLocal: (obj, prop, selector) => void m._rp_obj_remove_local(obj, prop, selector),
    pct: (value) => m._rp_pct(value),
    sizeContent: () => m._rp_size_content(),
    fontBuiltin: (size) => m._rp_font_builtin(size),
  };
  return lv;
}
