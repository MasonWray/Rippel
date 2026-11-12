/** Finds, loads and validates rippel.config.ts. */
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createJiti } from "jiti";
import {
  BUILTIN_MONTSERRAT_SIZES,
  resolveDisplay,
  type ClientConfig,
  type RippelConfig,
} from "../config.js";
import type { DisplayConfig } from "../displays.js";
import type { McuConfig } from "../mcu.js";
import type { StyleContext } from "../style/ir.js";

const CONFIG_FILES = ["rippel.config.ts", "rippel.config.mts", "rippel.config.js", "rippel.config.mjs"];
const DEFAULT_RANGE = "0x20-0x7E,0xB0";

export interface ResolvedFont {
  family: string;
  src: string;
  sizes: number[];
  range: string;
  bpp: 1 | 2 | 4 | 8;
}

export interface ResolvedConfig {
  root: string;
  configFile: string;
  entry: string;
  contract: string | undefined;
  mock: string | undefined;
  display: Required<DisplayConfig>;
  mcu: McuConfig | undefined;
  fonts: ResolvedFont[];
  defaultFont: { family: string; size: number };
  rem: number;
  refreshHz: number;
  output: RippelConfig["output"];
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function fail(file: string, message: string): never {
  throw new ConfigError(`${file}: ${message}`);
}

export async function loadConfig(root: string, target?: string): Promise<ResolvedConfig> {
  const configFile = CONFIG_FILES.map((f) => join(root, f)).find(existsSync);
  if (!configFile) {
    throw new ConfigError(`No rippel.config.ts found in ${root}`);
  }
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  const raw = await jiti.import<RippelConfig>(configFile, { default: true });
  return resolveConfig(target ? applyTarget(raw, target, relative(root, configFile)) : raw, root, configFile);
}

/** Applies a target's overrides on top of the base config. */
export function applyTarget(raw: RippelConfig, target: string, name: string): RippelConfig {
  const overrides = raw?.targets?.[target];
  if (!overrides) {
    const known = Object.keys(raw?.targets ?? {});
    fail(name, `there's no target "${target}". ${known.length ? `Targets: ${known.join(", ")}.` : "Add one under `targets`."}`);
  }
  return { ...raw, ...overrides };
}

export function resolveConfig(raw: RippelConfig, root: string, configFile: string): ResolvedConfig {
  const name = relative(root, configFile);
  if (!raw || typeof raw !== "object") fail(name, "must default-export a config object (use defineConfig).");

  const d = raw.display;
  if (!d || !Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width <= 0 || d.height <= 0) {
    fail(name, "`display` needs a positive integer `width` and `height`.");
  }
  if (d.colorFormat && !["RGB565", "RGB888", "XRGB8888"].includes(d.colorFormat)) {
    fail(name, `\`display.colorFormat\` must be RGB565, RGB888 or XRGB8888, not "${d.colorFormat}".`);
  }

  const abs = (p: string) => (isAbsolute(p) ? p : resolve(root, p));

  const entry = abs(raw.entry ?? "src/App.tsx");
  if (!existsSync(entry)) fail(name, `entry file ${relative(root, entry)} doesn't exist.`);

  let contract: string | undefined;
  if (raw.contract) {
    contract = abs(raw.contract);
    if (!existsSync(contract)) fail(name, `contract file ${raw.contract} doesn't exist.`);
  } else if (existsSync(abs("src/firmware.contract.ts"))) {
    contract = abs("src/firmware.contract.ts");
  }

  let mock: string | undefined;
  if (raw.mock) {
    mock = abs(raw.mock);
    if (!existsSync(mock)) fail(name, `mock file ${raw.mock} doesn't exist.`);
  } else if (existsSync(abs("src/firmware.mock.ts"))) {
    mock = abs("src/firmware.mock.ts");
  }

  const fonts: ResolvedFont[] = [];
  for (const [family, font] of Object.entries(raw.fonts ?? {})) {
    if (family === "montserrat") fail(name, `"montserrat" is built in. Give your font a different family name.`);
    if (!/^[a-z][a-z0-9-]*$/.test(family)) {
      fail(name, `font family "${family}" should be lowercase letters, digits and dashes.`);
    }
    const src = abs(font.src);
    if (!existsSync(src)) fail(name, `font file ${font.src} for "${family}" doesn't exist.`);
    if (!font.sizes?.length || font.sizes.some((s) => !Number.isInteger(s) || s < 6 || s > 200)) {
      fail(name, `fonts.${family}.sizes must list whole pixel sizes between 6 and 200.`);
    }
    fonts.push({ family, src, sizes: [...font.sizes], range: font.range ?? DEFAULT_RANGE, bpp: font.bpp ?? 4 });
  }

  const resolved: ResolvedConfig = {
    root,
    configFile,
    entry,
    contract,
    mock,
    display: resolveDisplay(d),
    mcu: raw.mcu,
    fonts,
    defaultFont: raw.defaultFont ?? { family: "montserrat", size: 14 },
    rem: raw.rem ?? 16,
    refreshHz: raw.refreshHz ?? 30,
    output: raw.output,
  };

  if (!Number.isFinite(resolved.refreshHz) || resolved.refreshHz < 1 || resolved.refreshHz > 120) {
    fail(name, "`refreshHz` must be between 1 and 120.");
  }

  const catalog = fontCatalog(resolved);
  const { family, size } = resolved.defaultFont;
  if (!catalog[family]?.includes(size)) fail(name, `defaultFont ${family} ${size}px isn't an available font.`);
  return resolved;
}

export function fontCatalog(config: ResolvedConfig): Record<string, number[]> {
  const catalog: Record<string, number[]> = { montserrat: BUILTIN_MONTSERRAT_SIZES };
  for (const font of config.fonts) catalog[font.family] = font.sizes;
  return catalog;
}

export function styleContext(config: ResolvedConfig): StyleContext {
  return {
    fonts: fontCatalog(config),
    defaultFont: config.defaultFont,
    rem: config.rem,
    display: { width: config.display.width, height: config.display.height },
  };
}

export const FONT_URL_PREFIX = "/@rippel/fonts/";

export function clientConfig(config: ResolvedConfig): ClientConfig {
  return {
    display: config.display,
    mcu: config.mcu,
    fonts: config.fonts.flatMap((f) =>
      f.sizes.map((size) => ({ family: f.family, size, url: `${FONT_URL_PREFIX}${f.family}/${size}.bin` })),
    ),
    fontCatalog: fontCatalog(config),
    defaultFont: config.defaultFont,
    rem: config.rem,
    refreshHz: config.refreshHz,
  };
}
