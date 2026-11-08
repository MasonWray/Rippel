/**
 * Display presets. A preset is just a function that returns a DisplayConfig,
 * so a custom display can be written inline as a plain object.
 */

export type ColorFormat = "RGB565" | "RGB888" | "XRGB8888";
export type Rotation = 0 | 90 | 180 | 270;

export interface DisplayConfig {
  /** Shown in the dev shell. */
  name?: string;
  /** Width in pixels, after rotation. */
  width: number;
  /** Height in pixels, after rotation. */
  height: number;
  /** Pixel format the display expects. Defaults to RGB565. */
  colorFormat?: ColorFormat;
  /** Physical pixel density. LVGL's default theme scales sizes by it. Defaults to 130. */
  dpi?: number;
}

/** Computes DPI from resolution and diagonal size in inches. */
export function dpiFromDiagonal(width: number, height: number, inches: number): number {
  return Math.round(Math.hypot(width, height) / inches);
}

function rotate(width: number, height: number, rotation: Rotation): [number, number] {
  return rotation === 90 || rotation === 270 ? [height, width] : [width, height];
}

/** Adafruit 2.8" TFT (ILI9341), 240x320 in its native portrait orientation. */
export function adafruit_2_8_tft(options: { rotation?: Rotation } = {}): DisplayConfig {
  const [width, height] = rotate(240, 320, options.rotation ?? 0);
  return {
    name: 'Adafruit 2.8" TFT (ILI9341)',
    width,
    height,
    colorFormat: "RGB565",
    dpi: dpiFromDiagonal(240, 320, 2.8),
  };
}

/** Adafruit 3.5" TFT (HX8357D), 320x480 in its native portrait orientation. */
export function adafruit_3_5_tft(options: { rotation?: Rotation } = {}): DisplayConfig {
  const [width, height] = rotate(320, 480, options.rotation ?? 0);
  return {
    name: 'Adafruit 3.5" TFT (HX8357D)',
    width,
    height,
    colorFormat: "RGB565",
    dpi: dpiFromDiagonal(320, 480, 3.5),
  };
}

/** ESP32-S3-BOX-3: 320x240 ILI9342C, 2.4". */
export function esp32_s3_box_3(): DisplayConfig {
  return {
    name: "ESP32-S3-BOX-3",
    width: 320,
    height: 240,
    colorFormat: "RGB565",
    dpi: dpiFromDiagonal(320, 240, 2.4),
  };
}
