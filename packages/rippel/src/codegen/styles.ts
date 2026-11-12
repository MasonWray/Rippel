/**
 * Emits the style IR as C: one static lv_style_t per CSS rule, in source order.
 */
import type { StyleDecl, StyleRule, StyleSelector, StyleValue } from "../style/ir.js";

export interface EmittedRule {
  className: string;
  /** Set if the rule has `position`. */
  floating?: boolean;
  /** Name of the lv_style_t variable. */
  name: string;
  /** C expression for the part and state selector. */
  selector: string;
}

export interface EmittedStyles {
  rules: EmittedRule[];
  /** File-scope declarations. */
  declarations: string[];
  /** Statements for the body of the style init function. */
  init: string[];
  /** Custom fonts the styles use, as C variable names. */
  fonts: Set<string>;
}

export function fontSymbol(family: string, size: number): string {
  if (family === "montserrat") return `lv_font_montserrat_${size}`;
  return `rp_font_${family.replaceAll("-", "_")}_${size}`;
}

function selectorExpr(selector: StyleSelector): string {
  return [selector.part, ...selector.states].join(" | ");
}

function hex(rgb: number): string {
  return `0x${rgb.toString(16).padStart(6, "0")}`;
}

function numberExpr(value: Extract<StyleValue, { t: "num" | "pct" | "content" | "const" }>): string {
  switch (value.t) {
    case "num": return String(value.v);
    case "pct": return `lv_pct(${value.v})`;
    case "content": return "LV_SIZE_CONTENT";
    case "const": return value.v;
  }
}

function emitDecl(name: string, decl: StyleDecl, index: number, out: EmittedStyles): void {
  const { prop, value } = decl;
  switch (value.t) {
    case "color":
      out.init.push(`rp_style_set_color(&${name}, ${prop}, ${hex(value.v)});`);
      return;
    case "font": {
      const symbol = fontSymbol(value.family, value.size);
      if (value.family !== "montserrat") out.fonts.add(symbol);
      out.init.push(`rp_style_set_ptr(&${name}, ${prop}, &${symbol});`);
      return;
    }
    case "transition": {
      const props = `${name}_transition_${index}`;
      out.declarations.push(`static const int32_t ${props}[] = { ${value.props.join(", ")} };`);
      out.init.push(
        `rp_style_set_transition(&${name}, ${props}, ${value.props.length}, ${value.timeMs}, ${value.delayMs}, ${value.path});`,
      );
      return;
    }
    default:
      out.init.push(`rp_style_set_num(&${name}, ${prop}, ${numberExpr(value)});`);
  }
}

/** Rules must be in cascade order: stylesheets in import order, rules in source order. */
export function emitStyles(rules: StyleRule[]): EmittedStyles {
  const out: EmittedStyles = { rules: [], declarations: [], init: [], fonts: new Set() };
  rules.forEach((rule, i) => {
    const name = `st_${i}_${rule.className.replaceAll("-", "_")}`;
    out.declarations.push(`static lv_style_t ${name};`);
    out.init.push(`lv_style_init(&${name});`);
    let floating: boolean | undefined;
    rule.decls.forEach((decl, index) => {
      if (decl.prop === "RP_FLOATING") floating = decl.value.t === "num" && decl.value.v === 1;
      else emitDecl(name, decl, index, out);
    });
    out.rules.push({ className: rule.className, name, selector: selectorExpr(rule.selector), floating });
  });
  return out;
}
