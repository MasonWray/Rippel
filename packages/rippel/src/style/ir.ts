/**
 * Style IR: CSS translated into LVGL terms, independent of how it is applied.
 *
 * The dev runtime applies this IR through the bridge. C codegen will emit it
 * as style initializers. Names of LVGL constants (e.g. "LV_STYLE_BG_COLOR")
 * are kept as strings so the IR never depends on LVGL's numeric values.
 */

export type StyleValue =
  /** A plain number: pixels, opacity (0-255), grow factor. */
  | { t: "num"; v: number }
  /** A percentage of the parent size. */
  | { t: "pct"; v: number }
  /** LV_SIZE_CONTENT. */
  | { t: "content" }
  /** A 24-bit 0xRRGGBB color. */
  | { t: "color"; v: number }
  /** A named LVGL constant, e.g. "LV_FLEX_FLOW_ROW". */
  | { t: "const"; v: string }
  /** A font, resolved to an lv_font_t at runtime or codegen time. */
  | { t: "font"; family: string; size: number }
  /** Animates the named LVGL style properties when the object changes state. */
  | { t: "transition"; props: string[]; timeMs: number; delayMs: number; path: string };

export interface StyleDecl {
  /** LVGL style property name, e.g. "LV_STYLE_BG_COLOR". */
  prop: string;
  value: StyleValue;
}

export interface StyleSelector {
  /** LVGL part name, e.g. "LV_PART_MAIN". */
  part: string;
  /** LVGL state names, e.g. ["LV_STATE_PRESSED"]. Empty means the default state. */
  states: string[];
}

export interface StyleRule {
  className: string;
  selector: StyleSelector;
  decls: StyleDecl[];
}

export interface StyleSheet {
  /** Absolute path of the source file. */
  file: string;
  rules: StyleRule[];
}

/** Fonts available to styles: family name -> available pixel sizes. */
export type FontCatalog = Record<string, number[]>;

export interface StyleContext {
  fonts: FontCatalog;
  /** Font used to fill in a missing family or size when only one is given. */
  defaultFont: { family: string; size: number };
  /** Pixels per rem. */
  rem: number;
}
