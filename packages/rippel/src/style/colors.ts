import colorNames from "color-name";

export interface ParsedColor {
  /** 0xRRGGBB */
  rgb: number;
  /** 0 to 1 */
  alpha: number;
}

const pack = (r: number, g: number, b: number) => ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

function channel(token: string): number {
  return token.endsWith("%") ? clamp255((Number(token.slice(0, -1)) / 100) * 255) : clamp255(Number(token));
}

function alphaValue(token: string): number {
  const v = token.endsWith("%") ? Number(token.slice(0, -1)) / 100 : Number(token);
  return Math.max(0, Math.min(1, v));
}

/** Parses hex, rgb()/rgba(), named colors and `transparent`. Returns undefined if not a color. */
export function parseColor(input: string): ParsedColor | undefined {
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { rgb: 0, alpha: 0 };

  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const rgb = parseInt(h.slice(0, 6), 16);
    const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { rgb, alpha };
  }

  const fn = /^rgba?\((.*)\)$/.exec(s);
  if (fn) {
    const [colorPart, slashAlpha] = fn[1].split("/");
    const parts = colorPart.split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 3 && !(parts.length === 4 && slashAlpha === undefined)) return undefined;
    const [r, g, b] = parts.slice(0, 3).map(channel);
    if ([r, g, b].some(Number.isNaN)) return undefined;
    const alphaToken = slashAlpha?.trim() ?? parts[3];
    return { rgb: pack(r, g, b), alpha: alphaToken === undefined ? 1 : alphaValue(alphaToken) };
  }

  const named = (colorNames as Record<string, [number, number, number]>)[s];
  if (named) return { rgb: pack(named[0], named[1], named[2]), alpha: 1 };

  return undefined;
}
