import type { ColorFormat, DisplayConfig } from "./displays.js";
import type { McuConfig } from "./mcu.js";

export interface FontConfig {
  /** Path to a .ttf, .otf or .woff file, relative to the project root. */
  src: string;
  /** Pixel sizes to generate. Each size is a separate LVGL font. */
  sizes: number[];
  /** Unicode ranges to include, in lv_font_conv syntax. Defaults to printable ASCII plus the degree sign. */
  range?: string;
  /** Bits per pixel for anti-aliasing (1, 2, 4 or 8). Defaults to 4. */
  bpp?: 1 | 2 | 4 | 8;
}

export interface RippelConfig {
  /** Module whose default export is the root component. Defaults to "src/App.tsx". */
  entry?: string;
  /** Firmware contract module. Defaults to "src/firmware.contract.ts" if it exists. */
  contract?: string;
  /**
   * Custom widgets declared in the contract with `widget()`. `sources` are the C
   * files that implement them. The dev server compiles them into the simulator
   * when Emscripten is available, and shows placeholders when it isn't.
   */
  widgets?: { sources: string[] };
  /** Dev-only script that plays the firmware in the simulator. Defaults to "src/firmware.mock.ts" if it exists. */
  mock?: string;
  display: DisplayConfig;
  mcu?: McuConfig;
  /** Custom fonts, by family name. "montserrat" is built in. */
  fonts?: Record<string, FontConfig>;
  /** Font used when a style sets only a size or only a family. Defaults to montserrat 14px. */
  defaultFont?: { family: string; size: number };
  /** Pixels per rem. Defaults to 16. */
  rem?: number;
  /** How many times a second LVGL may redraw. Defaults to 30. Lower saves CPU, higher looks smoother. */
  refreshHz?: number;
  /**
   * Other hardware the same UI runs on. Each target overrides these settings,
   * and `--target <name>` on any command selects it. `@media` queries see the
   * selected target's display.
   */
  targets?: Record<string, TargetConfig>;
  /** Where `rippel build` writes generated C (used from M2). */
  output?: {
    dir: string;
    integration?: "cmake" | "esp-idf" | "zephyr" | "platformio";
    /** Memory LVGL reserves for its objects and styles. Defaults to an eighth of the MCU's RAM. */
    lvglHeapKB?: number;
  };
}

/** The settings a target can override. */
export type TargetConfig = Partial<Pick<RippelConfig, "display" | "mcu" | "output" | "fonts" | "defaultFont" | "rem" | "refreshHz">>;

/** Identity helper that gives rippel.config.ts type checking and autocompletion. */
export function defineConfig(config: RippelConfig): RippelConfig {
  return config;
}

/** Sizes compiled into the simulator's built-in Montserrat font. */
export const BUILTIN_MONTSERRAT_SIZES = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 48];

/** The part of the config the browser needs. Serializable. */
export interface ClientConfig {
  display: Required<DisplayConfig>;
  mcu?: McuConfig;
  /** Custom fonts the runtime loads, with the URL serving each generated font file. */
  fonts: { family: string; size: number; url: string }[];
  /** All available fonts (built-in and custom), family -> sizes. */
  fontCatalog: Record<string, number[]>;
  defaultFont: { family: string; size: number };
  rem: number;
  refreshHz: number;
  /** Set when custom widgets show as placeholders, saying why. */
  widgetsNote?: string;
}

export function resolveDisplay(display: DisplayConfig): Required<DisplayConfig> {
  const colorFormat: ColorFormat = display.colorFormat ?? "RGB565";
  return {
    name: display.name ?? `${display.width}x${display.height} display`,
    width: display.width,
    height: display.height,
    colorFormat,
    dpi: display.dpi ?? 130,
  };
}
