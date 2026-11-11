/**
 * Compiles a CSS file into Rippel's style IR. Node-only (uses postcss).
 *
 * Supported selectors are a single class with optional LVGL states and one
 * part, e.g. `.card`, `.button:active`, `.slider::knob`, `.slider::knob:active`.
 */
import postcss, { type AtRule, type ChildNode, type Declaration, type Rule } from "postcss";
import type { StyleContext, StyleRule, StyleSelector, StyleSheet } from "./ir.js";
import { StyleError, translateDeclarations } from "./translate.js";

const STATES: Record<string, string> = {
  active: "LV_STATE_PRESSED",
  focus: "LV_STATE_FOCUSED",
  "focus-visible": "LV_STATE_FOCUS_KEY",
  checked: "LV_STATE_CHECKED",
  disabled: "LV_STATE_DISABLED",
  hover: "LV_STATE_HOVERED",
};

const PARTS: Record<string, string> = {
  indicator: "LV_PART_INDICATOR",
  knob: "LV_PART_KNOB",
  scrollbar: "LV_PART_SCROLLBAR",
  selected: "LV_PART_SELECTED",
  items: "LV_PART_ITEMS",
  cursor: "LV_PART_CURSOR",
};

/** An error with a source location, which Vite shows in its error overlay. */
export class CssError extends Error {
  loc: { file: string; line: number; column: number };
  constructor(message: string, file: string, line: number, column: number) {
    super(`${message}\n  at ${file}:${line}:${column}`);
    this.name = "CssError";
    this.loc = { file, line, column };
  }
}

function parseSelector(selector: string): { className: string; selector: StyleSelector } {
  const m = /^\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)((?::{1,2}[a-zA-Z-]+)*)$/.exec(selector.trim());
  if (!m) {
    throw new StyleError(
      `Unsupported selector "${selector}". Use a single class, optionally with states and a part, ` +
        `like ".card", ".button:active" or ".slider::knob".`,
    );
  }
  let part = "LV_PART_MAIN";
  let partSeen = false;
  const states: string[] = [];
  for (const pseudo of m[2].match(/::?[a-zA-Z-]+/g) ?? []) {
    if (pseudo.startsWith("::")) {
      const name = pseudo.slice(2).toLowerCase();
      if (partSeen) throw new StyleError(`Only one part per selector is supported ("${selector}")`);
      if (!PARTS[name]) {
        throw new StyleError(`Unknown part "${pseudo}". Supported: ${Object.keys(PARTS).map((p) => `::${p}`).join(", ")}`);
      }
      part = PARTS[name];
      partSeen = true;
    } else {
      const name = pseudo.slice(1).toLowerCase();
      if (!STATES[name]) {
        throw new StyleError(`Unknown state "${pseudo}". Supported: ${Object.keys(STATES).map((s) => `:${s}`).join(", ")}`);
      }
      states.push(STATES[name]);
    }
  }
  return { className: m[1], selector: { part, states } };
}

function pixels(value: string, ctx: StyleContext): number {
  const m = /^(\d+\.?\d*|\.\d+)(px|rem)$/.exec(value);
  if (!m) throw new StyleError(`Expected a length in px or rem, got "${value}"`);
  return Number(m[1]) * (m[2] === "rem" ? ctx.rem : 1);
}

function featureMatches(feature: string, value: string | undefined, ctx: StyleContext, display: { width: number; height: number }): boolean {
  if (value === undefined) throw new StyleError(`Media feature "${feature}" needs a value, like (${feature}: 480px)`);
  switch (feature) {
    case "width": return display.width === pixels(value, ctx);
    case "min-width": return display.width >= pixels(value, ctx);
    case "max-width": return display.width <= pixels(value, ctx);
    case "height": return display.height === pixels(value, ctx);
    case "min-height": return display.height >= pixels(value, ctx);
    case "max-height": return display.height <= pixels(value, ctx);
    case "orientation":
      if (value !== "landscape" && value !== "portrait") throw new StyleError(`Orientation must be landscape or portrait, not "${value}"`);
      return (display.width >= display.height ? "landscape" : "portrait") === value;
    default:
      throw new StyleError(`Unsupported media feature "${feature}". Supported: width, height, min-width, max-width, min-height, max-height, orientation`);
  }
}

/**
 * Decides whether an @media query matches the display being built for.
 * The display can't change at runtime, so each query is settled at compile time.
 */
export function mediaMatches(params: string, ctx: StyleContext): boolean {
  const display = ctx.display;
  if (!display) throw new StyleError("@media needs to know the display size");
  // Evaluates every part, so a typo is an error even in a list that already matched.
  return params
    .split(",")
    .map((query) =>
      query
        .trim()
        .toLowerCase()
        .split(/\s+and\s+/)
        .map((term) => {
          if (term === "screen" || term === "all") return true;
          const m = /^\(\s*([a-z-]+)\s*(?::\s*([^)]*?)\s*)?\)$/.exec(term);
          if (!m) throw new StyleError(`Unsupported media query "${term}". Use forms like (min-width: 480px), joined with "and" or commas.`);
          return featureMatches(m[1], m[2], ctx, display);
        })
        .every(Boolean),
    )
    .some(Boolean);
}

function location(node: ChildNode): { line: number; column: number } {
  return { line: node.source?.start?.line ?? 1, column: node.source?.start?.column ?? 1 };
}

export function compileStyleSheet(source: string, file: string, ctx: StyleContext): StyleSheet {
  let root;
  try {
    root = postcss.parse(source, { from: file });
  } catch (err) {
    const e = err as { reason?: string; message: string; line?: number; column?: number };
    throw new CssError(e.reason ?? e.message, file, e.line ?? 1, e.column ?? 1);
  }

  const rules: StyleRule[] = [];
  const visit = (nodes: ChildNode[]) => {
  for (const node of nodes) {
    const { line, column } = location(node);
    if (node.type === "comment") continue;
    if (node.type === "atrule") {
      const at = node as AtRule;
      if (at.name.toLowerCase() !== "media") {
        throw new CssError(`At-rules like "@${at.name}" aren't supported. Only @media is.`, file, line, column);
      }
      let matches: boolean;
      try {
        matches = mediaMatches(at.params, ctx);
      } catch (err) {
        if (err instanceof StyleError) throw new CssError(err.message, file, line, column);
        throw err;
      }
      // Rules stay at their place in the source, so the cascade works as in a browser.
      if (matches) visit(at.nodes ?? []);
      continue;
    }
    if (node.type !== "rule") continue;

    const rule = node as Rule;
    const decls: Declaration[] = [];
    for (const child of rule.nodes) {
      if (child.type === "decl") decls.push(child);
      else if (child.type === "rule" || child.type === "atrule") {
        const loc = location(child);
        throw new CssError("Nested rules aren't supported", file, loc.line, loc.column);
      }
    }

    let translated;
    try {
      translated = translateDeclarations(
        decls.map((d) => ({ prop: d.prop, value: d.important ? `${d.value} !important` : d.value })),
        ctx,
      );
    } catch (err) {
      if (err instanceof StyleError) {
        const at = err.declIndex !== undefined ? location(decls[err.declIndex]) : { line, column };
        throw new CssError(err.message, file, at.line, at.column);
      }
      throw err;
    }

    for (const selector of rule.selectors) {
      let parsed;
      try {
        parsed = parseSelector(selector);
      } catch (err) {
        if (err instanceof StyleError) throw new CssError(err.message, file, line, column);
        throw err;
      }
      // LVGL's theme tints disabled widgets grey. A :disabled rule states the
      // look it wants, so turn the tint off and show exactly those colors.
      const decls = parsed.selector.states.includes("LV_STATE_DISABLED")
        ? [...translated, { prop: "LV_STYLE_RECOLOR_OPA", value: { t: "num" as const, v: 0 } }]
        : translated;
      rules.push({ className: parsed.className, selector: parsed.selector, decls });
    }
  }
  };
  visit(root.nodes);
  return { file, rules };
}
