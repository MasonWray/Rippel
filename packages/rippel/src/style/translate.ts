/**
 * Translates CSS declarations into LVGL style declarations.
 *
 * This module has no Node or browser dependencies: the Vite plugin uses it for
 * stylesheets, and the dev runtime uses it for inline `style` props.
 * Anything that doesn't map cleanly onto LVGL is an error, never ignored.
 */
import { parseColor } from "./colors.js";
import type { StyleContext, StyleDecl, StyleValue } from "./ir.js";

export interface CssDeclaration {
  prop: string;
  value: string;
}

export class StyleError extends Error {
  /** Index of the declaration that caused the error, if known. */
  declIndex: number | undefined;
  constructor(message: string, declIndex?: number) {
    super(message);
    this.name = "StyleError";
    this.declIndex = declIndex;
  }
}

const num = (v: number): StyleValue => ({ t: "num", v });
const constant = (v: string): StyleValue => ({ t: "const", v });

/** Splits a CSS value on whitespace, keeping parenthesized groups together. */
export function splitValue(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

/** True if the value has a comma outside parentheses, i.e. it is a list. */
function hasTopLevelComma(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

interface LengthOptions {
  pct?: boolean;
  content?: boolean;
  negative?: boolean;
}

function parseLength(token: string, ctx: StyleContext, opts: LengthOptions = {}): StyleValue {
  const t = token.trim().toLowerCase();
  if (t === "auto" || t === "fit-content" || t === "max-content") {
    if (opts.content) return { t: "content" };
    throw new StyleError(`"${token}" isn't supported here`);
  }
  const m = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|%)?$/.exec(t);
  if (!m) {
    if (/^-?(?:\d+\.?\d*|\.\d+)(em|vw|vh|pt|ch)$/.test(t)) {
      throw new StyleError(`Unit in "${token}" isn't supported. Use px, rem or %.`);
    }
    throw new StyleError(`Expected a length, got "${token}"`);
  }
  const n = Number(m[1]);
  const unit = m[2];
  if (n < 0 && !opts.negative) throw new StyleError(`Negative value "${token}" isn't allowed here`);
  if (unit === "%") {
    if (!opts.pct) throw new StyleError(`Percentages aren't supported here ("${token}")`);
    return { t: "pct", v: Math.round(n) };
  }
  if (unit === undefined && n !== 0) throw new StyleError(`"${token}" needs a unit (px, rem or %)`);
  return num(Math.round(unit === "rem" ? n * ctx.rem : n));
}

function parseInteger(token: string, min: number): number {
  if (!/^\d+$/.test(token.trim())) throw new StyleError(`Expected a whole number, got "${token}"`);
  const n = Number(token);
  if (n < min) throw new StyleError(`Expected a number of at least ${min}, got "${token}"`);
  return n;
}

function parseOpacity(token: string): number {
  const t = token.trim();
  const m = /^(\d+\.?\d*|\.\d+)(%)?$/.exec(t);
  if (!m) throw new StyleError(`Expected an opacity (0-1 or 0%-100%), got "${token}"`);
  const v = m[2] ? Number(m[1]) / 100 : Number(m[1]);
  if (v > 1) throw new StyleError(`Opacity must be between 0 and 1, got "${token}"`);
  return Math.round(v * 255);
}

/** Emits a color and its matching opacity property, so alpha and transparency work. */
function emitColor(out: StyleDecl[], colorProp: string, opaProp: string, token: string) {
  const c = parseColor(token);
  if (!c) throw new StyleError(`Expected a color, got "${token}"`);
  out.push({ prop: colorProp, value: { t: "color", v: c.rgb } });
  out.push({ prop: opaProp, value: num(Math.round(c.alpha * 255)) });
}

/** Expands a 1-4 value box shorthand into [top, right, bottom, left]. */
function expandBox(tokens: string[]): [string, string, string, string] {
  switch (tokens.length) {
    case 1: return [tokens[0], tokens[0], tokens[0], tokens[0]];
    case 2: return [tokens[0], tokens[1], tokens[0], tokens[1]];
    case 3: return [tokens[0], tokens[1], tokens[2], tokens[1]];
    case 4: return [tokens[0], tokens[1], tokens[2], tokens[3]];
    default: throw new StyleError("Expected 1 to 4 values");
  }
}

function pick(token: string, table: Record<string, string>, what: string): StyleValue {
  const v = table[token.trim().toLowerCase()];
  if (!v) {
    throw new StyleError(`Unsupported ${what} "${token}". Supported: ${Object.keys(table).join(", ")}`);
  }
  return constant(v);
}

const FLEX_ALIGN: Record<string, string> = {
  "flex-start": "LV_FLEX_ALIGN_START",
  start: "LV_FLEX_ALIGN_START",
  "flex-end": "LV_FLEX_ALIGN_END",
  end: "LV_FLEX_ALIGN_END",
  center: "LV_FLEX_ALIGN_CENTER",
  "space-between": "LV_FLEX_ALIGN_SPACE_BETWEEN",
  "space-around": "LV_FLEX_ALIGN_SPACE_AROUND",
  "space-evenly": "LV_FLEX_ALIGN_SPACE_EVENLY",
};

const FLEX_CROSS_ALIGN: Record<string, string> = {
  "flex-start": "LV_FLEX_ALIGN_START",
  start: "LV_FLEX_ALIGN_START",
  "flex-end": "LV_FLEX_ALIGN_END",
  end: "LV_FLEX_ALIGN_END",
  center: "LV_FLEX_ALIGN_CENTER",
};

const TEXT_ALIGN: Record<string, string> = {
  left: "LV_TEXT_ALIGN_LEFT",
  start: "LV_TEXT_ALIGN_LEFT",
  center: "LV_TEXT_ALIGN_CENTER",
  right: "LV_TEXT_ALIGN_RIGHT",
  end: "LV_TEXT_ALIGN_RIGHT",
  auto: "LV_TEXT_ALIGN_AUTO",
};

const TEXT_DECOR: Record<string, string> = {
  none: "LV_TEXT_DECOR_NONE",
  underline: "LV_TEXT_DECOR_UNDERLINE",
  "line-through": "LV_TEXT_DECOR_STRIKETHROUGH",
};

/** CSS properties that can animate, and the LVGL properties each one animates. */
const TRANSITION_PROPS: Record<string, string[]> = {
  background: ["LV_STYLE_BG_COLOR", "LV_STYLE_BG_OPA"],
  "background-color": ["LV_STYLE_BG_COLOR", "LV_STYLE_BG_OPA"],
  color: ["LV_STYLE_TEXT_COLOR", "LV_STYLE_TEXT_OPA"],
  opacity: ["LV_STYLE_OPA"],
  width: ["LV_STYLE_WIDTH"],
  height: ["LV_STYLE_HEIGHT"],
  translate: ["LV_STYLE_TRANSLATE_X", "LV_STYLE_TRANSLATE_Y"],
  "border-color": ["LV_STYLE_BORDER_COLOR", "LV_STYLE_BORDER_OPA"],
  "border-width": ["LV_STYLE_BORDER_WIDTH"],
  "outline-color": ["LV_STYLE_OUTLINE_COLOR", "LV_STYLE_OUTLINE_OPA"],
  "outline-width": ["LV_STYLE_OUTLINE_WIDTH"],
  "box-shadow": ["LV_STYLE_SHADOW_WIDTH", "LV_STYLE_SHADOW_COLOR", "LV_STYLE_SHADOW_OPA", "LV_STYLE_SHADOW_SPREAD"],
  "arc-color": ["LV_STYLE_ARC_COLOR", "LV_STYLE_ARC_OPA"],
};

const TRANSITION_EASING: Record<string, string> = {
  linear: "RP_PATH_LINEAR",
  ease: "RP_PATH_EASE_IN_OUT",
  "ease-in": "RP_PATH_EASE_IN",
  "ease-out": "RP_PATH_EASE_OUT",
  "ease-in-out": "RP_PATH_EASE_IN_OUT",
  overshoot: "RP_PATH_OVERSHOOT",
  bounce: "RP_PATH_BOUNCE",
};

function parseTime(token: string): number | undefined {
  const m = /^(\d+\.?\d*|\.\d+)(ms|s)$/.exec(token.toLowerCase());
  if (!m) return undefined;
  return Math.round(m[2] === "s" ? Number(m[1]) * 1000 : Number(m[1]));
}

/** `transition: <property> <duration> [easing] [delay]`, comma separated. */
function parseTransition(value: string, out: StyleDecl[]) {
  const props: string[] = [];
  let shared: { timeMs: number; delayMs: number; path: string } | undefined;

  for (const item of value.split(",")) {
    const [name, ...rest] = splitValue(item);
    const lower = name?.toLowerCase();
    if (lower === "all") {
      throw new StyleError(`LVGL needs to know which properties animate. List them instead of "all".`);
    }
    const lvProps = TRANSITION_PROPS[lower ?? ""];
    if (!lvProps) {
      throw new StyleError(`Can't animate "${name}". Supported: ${Object.keys(TRANSITION_PROPS).join(", ")}`);
    }
    props.push(...lvProps);

    const times: number[] = [];
    let path = "RP_PATH_EASE_IN_OUT";
    for (const token of rest) {
      const time = parseTime(token);
      if (time !== undefined) times.push(time);
      else if (TRANSITION_EASING[token.toLowerCase()]) path = TRANSITION_EASING[token.toLowerCase()];
      else throw new StyleError(`Unsupported easing "${token}". Supported: ${Object.keys(TRANSITION_EASING).join(", ")}`);
    }
    if (times.length < 1 || times.length > 2) throw new StyleError("Expected `<property> <duration> [easing] [delay]`");

    const current = { timeMs: times[0], delayMs: times[1] ?? 0, path };
    if (shared && (shared.timeMs !== current.timeMs || shared.delayMs !== current.delayMs || shared.path !== current.path)) {
      throw new StyleError("LVGL uses one duration, delay and easing per transition. Make them the same for every property.");
    }
    shared = current;
  }

  out.push({ prop: "LV_STYLE_TRANSITION", value: { t: "transition", props: [...new Set(props)], ...shared! } });
}

/** Properties whose meaning depends on other declarations in the same rule. */
interface Combined {
  fontFamily?: { value: string; index: number };
  fontSize?: { value: number; index: number };
  flexDirection?: { value: string; index: number };
  flexWrap?: { value: string; index: number };
  alignItems?: StyleValue;
  alignContent?: boolean;
}

type Handler = (value: string, out: StyleDecl[], ctx: StyleContext, combined: Combined, index: number) => void;

function lengthProp(prop: string, opts: LengthOptions): Handler {
  return (value, out, ctx) => {
    const tokens = splitValue(value);
    if (tokens.length !== 1) throw new StyleError("Expected a single value");
    out.push({ prop, value: parseLength(tokens[0], ctx, opts) });
  };
}

function boxProp(prefix: "PAD" | "MARGIN", negative: boolean): Handler {
  return (value, out, ctx) => {
    const [top, right, bottom, left] = expandBox(splitValue(value));
    out.push({ prop: `LV_STYLE_${prefix}_TOP`, value: parseLength(top, ctx, { negative }) });
    out.push({ prop: `LV_STYLE_${prefix}_RIGHT`, value: parseLength(right, ctx, { negative }) });
    out.push({ prop: `LV_STYLE_${prefix}_BOTTOM`, value: parseLength(bottom, ctx, { negative }) });
    out.push({ prop: `LV_STYLE_${prefix}_LEFT`, value: parseLength(left, ctx, { negative }) });
  };
}

function colorProp(colorName: string, opaName: string): Handler {
  return (value, out) => emitColor(out, colorName, opaName, value.trim());
}

/** Shared by `border` and `outline`: `<width> <style> <color>` in any order. */
function lineShorthand(kind: "BORDER" | "OUTLINE"): Handler {
  return (value, out, ctx) => {
    const tokens = splitValue(value);
    if (tokens.length === 1 && tokens[0].toLowerCase() === "none") {
      out.push({ prop: `LV_STYLE_${kind}_WIDTH`, value: num(0) });
      return;
    }
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (lower === "solid") continue;
      if (lower === "none") {
        out.push({ prop: `LV_STYLE_${kind}_WIDTH`, value: num(0) });
      } else if (/^[\d.]/.test(lower)) {
        out.push({ prop: `LV_STYLE_${kind}_WIDTH`, value: parseLength(token, ctx) });
      } else if (["dashed", "dotted", "double", "groove", "ridge", "inset", "outset"].includes(lower)) {
        throw new StyleError(`Border style "${token}" isn't supported. LVGL only draws solid borders.`);
      } else {
        emitColor(out, `LV_STYLE_${kind}_COLOR`, `LV_STYLE_${kind}_OPA`, token);
      }
    }
  };
}

const HANDLERS: Record<string, Handler> = {
  width: lengthProp("LV_STYLE_WIDTH", { pct: true, content: true }),
  height: lengthProp("LV_STYLE_HEIGHT", { pct: true, content: true }),
  "min-width": lengthProp("LV_STYLE_MIN_WIDTH", { pct: true }),
  "max-width": lengthProp("LV_STYLE_MAX_WIDTH", { pct: true }),
  "min-height": lengthProp("LV_STYLE_MIN_HEIGHT", { pct: true }),
  "max-height": lengthProp("LV_STYLE_MAX_HEIGHT", { pct: true }),

  padding: boxProp("PAD", false),
  "padding-top": lengthProp("LV_STYLE_PAD_TOP", {}),
  "padding-right": lengthProp("LV_STYLE_PAD_RIGHT", {}),
  "padding-bottom": lengthProp("LV_STYLE_PAD_BOTTOM", {}),
  "padding-left": lengthProp("LV_STYLE_PAD_LEFT", {}),
  margin: boxProp("MARGIN", true),
  "margin-top": lengthProp("LV_STYLE_MARGIN_TOP", { negative: true }),
  "margin-right": lengthProp("LV_STYLE_MARGIN_RIGHT", { negative: true }),
  "margin-bottom": lengthProp("LV_STYLE_MARGIN_BOTTOM", { negative: true }),
  "margin-left": lengthProp("LV_STYLE_MARGIN_LEFT", { negative: true }),
  gap: (value, out, ctx) => {
    const tokens = splitValue(value);
    if (tokens.length < 1 || tokens.length > 2) throw new StyleError("Expected 1 or 2 values");
    out.push({ prop: "LV_STYLE_PAD_ROW", value: parseLength(tokens[0], ctx) });
    out.push({ prop: "LV_STYLE_PAD_COLUMN", value: parseLength(tokens[1] ?? tokens[0], ctx) });
  },
  "row-gap": lengthProp("LV_STYLE_PAD_ROW", {}),
  "column-gap": lengthProp("LV_STYLE_PAD_COLUMN", {}),

  "background-color": colorProp("LV_STYLE_BG_COLOR", "LV_STYLE_BG_OPA"),
  background: (value, out) => {
    const tokens = splitValue(value);
    if (tokens.length !== 1) throw new StyleError("Only a single background color is supported");
    emitColor(out, "LV_STYLE_BG_COLOR", "LV_STYLE_BG_OPA", tokens[0]);
  },
  color: colorProp("LV_STYLE_TEXT_COLOR", "LV_STYLE_TEXT_OPA"),
  opacity: (value, out) => out.push({ prop: "LV_STYLE_OPA", value: num(parseOpacity(value)) }),

  border: lineShorthand("BORDER"),
  "border-width": lengthProp("LV_STYLE_BORDER_WIDTH", {}),
  "border-color": colorProp("LV_STYLE_BORDER_COLOR", "LV_STYLE_BORDER_OPA"),
  "border-style": (value, out) => {
    const v = value.trim().toLowerCase();
    if (v === "solid") return;
    if (v === "none") {
      out.push({ prop: "LV_STYLE_BORDER_WIDTH", value: num(0) });
      return;
    }
    throw new StyleError(`Border style "${value}" isn't supported. LVGL only draws solid borders.`);
  },
  "border-radius": (value, out, ctx) => {
    const v = value.trim();
    if (v.endsWith("%")) {
      if (v !== "50%") throw new StyleError(`Only "50%" (a full circle) is supported as a percentage radius`);
      out.push({ prop: "LV_STYLE_RADIUS", value: constant("LV_RADIUS_CIRCLE") });
      return;
    }
    out.push({ prop: "LV_STYLE_RADIUS", value: parseLength(v, ctx) });
  },
  outline: lineShorthand("OUTLINE"),
  "outline-width": lengthProp("LV_STYLE_OUTLINE_WIDTH", {}),
  "outline-color": colorProp("LV_STYLE_OUTLINE_COLOR", "LV_STYLE_OUTLINE_OPA"),
  "outline-offset": lengthProp("LV_STYLE_OUTLINE_PAD", {}),

  "box-shadow": (value, out, ctx) => {
    const tokens = splitValue(value);
    if (tokens.length === 1 && tokens[0].toLowerCase() === "none") {
      out.push({ prop: "LV_STYLE_SHADOW_WIDTH", value: num(0) });
      return;
    }
    if (hasTopLevelComma(value)) throw new StyleError("Only a single shadow is supported");
    const lengths: string[] = [];
    let color: string | undefined;
    for (const token of tokens) {
      if (token.toLowerCase() === "inset") throw new StyleError("Inset shadows aren't supported");
      if (/^-?[\d.]/.test(token)) lengths.push(token);
      else color = token;
    }
    if (lengths.length < 2 || lengths.length > 4) {
      throw new StyleError("Expected <offset-x> <offset-y> [blur] [spread] [color]");
    }
    const [x, y, blur = "0", spread = "0"] = lengths;
    out.push({ prop: "LV_STYLE_SHADOW_OFFSET_X", value: parseLength(x, ctx, { negative: true }) });
    out.push({ prop: "LV_STYLE_SHADOW_OFFSET_Y", value: parseLength(y, ctx, { negative: true }) });
    out.push({ prop: "LV_STYLE_SHADOW_WIDTH", value: parseLength(blur, ctx) });
    out.push({ prop: "LV_STYLE_SHADOW_SPREAD", value: parseLength(spread, ctx, { negative: true }) });
    emitColor(out, "LV_STYLE_SHADOW_COLOR", "LV_STYLE_SHADOW_OPA", color ?? "black");
  },

  "image-recolor": colorProp("LV_STYLE_IMAGE_RECOLOR", "LV_STYLE_IMAGE_RECOLOR_OPA"),
  "arc-color": colorProp("LV_STYLE_ARC_COLOR", "LV_STYLE_ARC_OPA"),
  "arc-width": lengthProp("LV_STYLE_ARC_WIDTH", {}),
  transition: (value, out) => parseTransition(value, out),

  "font-family": (value, _out, _ctx, combined, index) => {
    const families = value.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    if (families.length > 1) {
      throw new StyleError("Font fallback lists aren't supported. Name a single font family.");
    }
    combined.fontFamily = { value: families[0], index };
  },
  "font-size": (value, _out, ctx, combined, index) => {
    const v = parseLength(value.trim(), ctx);
    if (v.t !== "num") throw new StyleError("Expected a font size in px or rem");
    combined.fontSize = { value: v.v, index };
  },
  font: (value, _out, ctx, combined, index) => {
    const tokens = splitValue(value);
    const sizeIndex = tokens.findIndex((t) => /^[\d.]/.test(t));
    if (sizeIndex < 0) throw new StyleError("Expected `font: <size> <family>`");
    const extra = tokens.slice(0, sizeIndex).filter((t) => t.toLowerCase() !== "normal");
    if (extra.length) {
      throw new StyleError(`"${extra.join(" ")}" isn't supported. Weights and styles are separate fonts in LVGL.`);
    }
    const size = parseLength(tokens[sizeIndex], ctx);
    if (size.t !== "num") throw new StyleError("Expected a font size in px or rem");
    combined.fontSize = { value: size.v, index };
    const family = tokens.slice(sizeIndex + 1).join(" ").replace(/^["']|["']$/g, "");
    if (family) combined.fontFamily = { value: family, index };
  },
  "text-align": (value, out) => out.push({ prop: "LV_STYLE_TEXT_ALIGN", value: pick(value, TEXT_ALIGN, "text-align") }),
  "text-decoration": (value, out) =>
    out.push({ prop: "LV_STYLE_TEXT_DECOR", value: pick(value, TEXT_DECOR, "text-decoration") }),
  "letter-spacing": lengthProp("LV_STYLE_TEXT_LETTER_SPACE", { negative: true }),

  display: (value, out) => {
    const v = value.trim().toLowerCase();
    if (v === "flex") out.push({ prop: "LV_STYLE_LAYOUT", value: constant("LV_LAYOUT_FLEX") });
    else if (v === "block") out.push({ prop: "LV_STYLE_LAYOUT", value: constant("LV_LAYOUT_NONE") });
    else if (v === "none") throw new StyleError(`Use the \`hidden\` prop instead of "display: none"`);
    else if (v === "grid") throw new StyleError("Grid layout isn't supported yet. Use flex.");
    else throw new StyleError(`Unsupported display "${value}". Supported: flex, block`);
  },
  "flex-direction": (value, _out, _ctx, combined, index) => {
    const v = value.trim().toLowerCase();
    if (!["row", "column", "row-reverse", "column-reverse"].includes(v)) {
      throw new StyleError(`Unsupported flex-direction "${value}"`);
    }
    combined.flexDirection = { value: v, index };
  },
  "flex-wrap": (value, _out, _ctx, combined, index) => {
    const v = value.trim().toLowerCase();
    if (v === "wrap-reverse") throw new StyleError(`"wrap-reverse" isn't supported`);
    if (v !== "wrap" && v !== "nowrap") throw new StyleError(`Unsupported flex-wrap "${value}"`);
    combined.flexWrap = { value: v, index };
  },
  "flex-flow": (value, out, ctx, combined, index) => {
    for (const token of splitValue(value)) {
      if (token.includes("wrap")) HANDLERS["flex-wrap"](token, out, ctx, combined, index);
      else HANDLERS["flex-direction"](token, out, ctx, combined, index);
    }
  },
  "justify-content": (value, out) =>
    out.push({ prop: "LV_STYLE_FLEX_MAIN_PLACE", value: pick(value, FLEX_ALIGN, "justify-content") }),
  "align-items": (value, out, _ctx, combined) => {
    if (value.trim().toLowerCase() === "stretch") {
      throw new StyleError(`LVGL flex can't stretch items. Use "width: 100%" or "height: 100%" on the children.`);
    }
    const place = pick(value, FLEX_CROSS_ALIGN, "align-items");
    out.push({ prop: "LV_STYLE_FLEX_CROSS_PLACE", value: place });
    combined.alignItems = place;
  },
  "align-content": (value, out, _ctx, combined) => {
    out.push({ prop: "LV_STYLE_FLEX_TRACK_PLACE", value: pick(value, FLEX_ALIGN, "align-content") });
    combined.alignContent = true;
  },
  "flex-grow": (value, out) => out.push({ prop: "LV_STYLE_FLEX_GROW", value: num(parseInteger(value, 0)) }),
  flex: (value, out) => {
    const tokens = splitValue(value);
    if (tokens.length !== 1) throw new StyleError("Only `flex: <grow>` is supported");
    out.push({ prop: "LV_STYLE_FLEX_GROW", value: num(parseInteger(tokens[0], 0)) });
  },

  translate: (value, out, ctx) => {
    const tokens = splitValue(value);
    if (tokens.length < 1 || tokens.length > 2) throw new StyleError("Expected `translate: <x> [y]`");
    out.push({ prop: "LV_STYLE_TRANSLATE_X", value: parseLength(tokens[0], ctx, { negative: true, pct: true }) });
    out.push({
      prop: "LV_STYLE_TRANSLATE_Y",
      value: parseLength(tokens[1] ?? "0", ctx, { negative: true, pct: true }),
    });
  },
};

/** CSS properties this translator understands. */
export const SUPPORTED_PROPERTIES = Object.keys(HANDLERS);

function flexFlowName(direction = "row", wrap = "nowrap"): string {
  const base = direction.startsWith("column") ? "COLUMN" : "ROW";
  return `LV_FLEX_FLOW_${base}${wrap === "wrap" ? "_WRAP" : ""}${direction.endsWith("reverse") ? "_REVERSE" : ""}`;
}

/**
 * Translates the declarations of one rule (or one inline style) into LVGL
 * style declarations. Errors carry the index of the offending declaration.
 */
export function translateDeclarations(decls: CssDeclaration[], ctx: StyleContext): StyleDecl[] {
  const out: StyleDecl[] = [];
  const combined: Combined = {};

  decls.forEach((decl, index) => {
    const prop = decl.prop.trim().toLowerCase();
    const value = decl.value.trim();
    try {
      if (prop.startsWith("--")) throw new StyleError("CSS custom properties aren't supported yet");
      if (/!important/i.test(value)) throw new StyleError("!important isn't supported");
      if (/\bvar\(/.test(value)) throw new StyleError("var() isn't supported yet");
      const handler = HANDLERS[prop];
      if (!handler) throw new StyleError(`Unsupported CSS property "${decl.prop}"`);
      handler(value, out, ctx, combined, index);
    } catch (err) {
      if (err instanceof StyleError) {
        err.declIndex ??= index;
        if (!err.message.startsWith(`${decl.prop}:`)) err.message = `${decl.prop}: ${err.message}`;
      }
      throw err;
    }
  });

  if (combined.fontFamily || combined.fontSize) {
    const family = combined.fontFamily?.value ?? ctx.defaultFont.family;
    const size = combined.fontSize?.value ?? ctx.defaultFont.size;
    const index = Math.max(combined.fontFamily?.index ?? -1, combined.fontSize?.index ?? -1);
    const sizes = ctx.fonts[family];
    if (!sizes) {
      throw new StyleError(
        `Unknown font family "${family}". Available: ${Object.keys(ctx.fonts).join(", ")}. ` +
          `Add custom fonts under \`fonts\` in rippel.config.ts.`,
        index,
      );
    }
    if (!sizes.includes(size)) {
      throw new StyleError(
        `Font "${family}" isn't available at ${size}px. Available sizes: ${sizes.join(", ")}.`,
        index,
      );
    }
    out.push({ prop: "LV_STYLE_TEXT_FONT", value: { t: "font", family, size } });
  }

  if (combined.flexDirection || combined.flexWrap) {
    out.push({
      prop: "LV_STYLE_FLEX_FLOW",
      value: constant(flexFlowName(combined.flexDirection?.value, combined.flexWrap?.value)),
    });
  }

  // LVGL's cross place only aligns items within their track, and a track is as
  // wide as its widest item. CSS aligns a single line against the whole
  // container, so the track has to be placed the same way.
  if (combined.alignItems && !combined.alignContent && combined.flexWrap?.value !== "wrap") {
    out.push({ prop: "LV_STYLE_FLEX_TRACK_PLACE", value: combined.alignItems });
  }

  return out;
}

const UNITLESS = new Set(["opacity", "flex-grow", "flex"]);

/** Turns an inline `style` object into CSS declarations. Numbers are px, except unitless properties. */
export function inlineDeclarations(style: Record<string, string | number | undefined>): CssDeclaration[] {
  return Object.entries(style)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => {
      const prop = cssPropertyName(key);
      return { prop, value: typeof value === "number" && !UNITLESS.has(prop) ? `${value}px` : String(value) };
    });
}

/** Converts a camelCase inline style key (`backgroundColor`) to its CSS name (`background-color`). */
export function cssPropertyName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
