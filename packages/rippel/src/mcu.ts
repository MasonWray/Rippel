/**
 * MCU presets. In M1 these are informational (shown in the dev shell).
 * C codegen will use them for number defaults, lv_conf.h memory settings,
 * GPU draw backends and build integration.
 */

export interface McuConfig {
  /** Shown in the dev shell. */
  name: string;
  /** Hardware floating point support. Decides whether UI numbers default to float or int. */
  fpu: "none" | "single" | "double";
  /** Internal RAM in KB. */
  ramKB: number;
  /** External PSRAM in KB, if any. */
  psramKB?: number;
  /** GPU or 2D accelerator LVGL can draw with, if any. */
  gpu?: "dma2d" | "ppa" | "vglite" | "pxp";
}

export function esp32s3(options: { psramKB?: number } = {}): McuConfig {
  return { name: "ESP32-S3", fpu: "single", ramKB: 512, psramKB: options.psramKB };
}

export function esp32(options: { psramKB?: number } = {}): McuConfig {
  return { name: "ESP32", fpu: "single", ramKB: 520, psramKB: options.psramKB };
}

export function esp32p4(options: { psramKB?: number } = {}): McuConfig {
  return { name: "ESP32-P4", fpu: "single", ramKB: 768, psramKB: options.psramKB, gpu: "ppa" };
}

export function rp2040(): McuConfig {
  return { name: "RP2040", fpu: "none", ramKB: 264 };
}

export function rp2350(): McuConfig {
  return { name: "RP2350", fpu: "single", ramKB: 520 };
}

export function stm32f429(): McuConfig {
  return { name: "STM32F429", fpu: "single", ramKB: 256, gpu: "dma2d" };
}

export function stm32h747(): McuConfig {
  return { name: "STM32H747", fpu: "double", ramKB: 1024, gpu: "dma2d" };
}
