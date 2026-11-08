/**
 * Applies CSS to LVGL objects.
 *
 * Stylesheets register their compiled rules here (one call per CSS module,
 * repeated on hot reload). Each rule becomes one shared lv_style_t. Elements
 * get the styles of their classes, ordered by source order like the CSS cascade.
 */
import type { StyleContext, StyleDecl, StyleRule } from "../style/ir.js";
import { cssPropertyName, translateDeclarations } from "../style/translate.js";
import { lvgl, resolveValue, selectorValue, whenLvglReady } from "./host.js";
import type { Lvgl, Ptr } from "./lvgl.js";

interface MaterializedRule {
  order: number;
  selector: number;
  style: Ptr;
}

interface Sheet {
  index: number;
  rules: StyleRule[];
}

/** The parts of a renderer node the style registry needs. */
export interface StyledNode {
  obj: Ptr;
  classes: string[];
  appliedRules: MaterializedRule[];
  localProps: { prop: number; selector: number }[];
}

const sheets = new Map<string, Sheet>();
let nextSheetIndex = 0;
let byClass = new Map<string, MaterializedRule[]>();
const styledNodes = new Set<StyledNode>();
let styleContext: StyleContext | undefined;

export function setStyleContext(ctx: StyleContext): void {
  styleContext = ctx;
}

function setStyleProp(lv: Lvgl, style: Ptr, decl: StyleDecl) {
  const prop = lv.constant(decl.prop);
  const value = resolveValue(lv, decl.value);
  if (value.kind === "color") lv.styleSetColor(style, prop, value.v);
  else if (value.kind === "ptr") lv.styleSetPtr(style, prop, value.v);
  else lv.styleSetNum(style, prop, value.v);
}

function removeApplied(lv: Lvgl, node: StyledNode) {
  for (const rule of node.appliedRules) lv.objRemoveStyle(node.obj, rule.style, rule.selector);
  node.appliedRules = [];
}

function applyClasses(lv: Lvgl, node: StyledNode) {
  const rules = node.classes.flatMap((c) => byClass.get(c) ?? []).sort((a, b) => a.order - b.order);
  for (const rule of rules) lv.objAddStyle(node.obj, rule.style, rule.selector);
  node.appliedRules = rules;
}

/** Recreates every shared style from the registered sheets and reapplies them. */
function rebuild(lv: Lvgl) {
  for (const node of styledNodes) removeApplied(lv, node);
  for (const rules of byClass.values()) for (const rule of rules) lv.styleDestroy(rule.style);

  byClass = new Map();
  const ordered = [...sheets.values()].sort((a, b) => a.index - b.index);
  for (const sheet of ordered) {
    sheet.rules.forEach((rule, i) => {
      const style = lv.styleCreate();
      for (const decl of rule.decls) setStyleProp(lv, style, decl);
      const materialized = { order: sheet.index * 100_000 + i, selector: selectorValue(lv, rule.selector), style };
      const list = byClass.get(rule.className) ?? [];
      list.push(materialized);
      byClass.set(rule.className, list);
    });
  }

  for (const node of styledNodes) applyClasses(lv, node);
}

/** Called by compiled CSS modules. Re-registering the same file (hot reload) replaces its rules. */
export function registerStyleSheet(file: string, rules: StyleRule[]): void {
  const index = sheets.get(file)?.index ?? nextSheetIndex++;
  sheets.set(file, { index, rules });
  whenLvglReady(rebuild);
}

export function setClasses(node: StyledNode, value: string | undefined): void {
  const lv = lvgl();
  removeApplied(lv, node);
  node.classes = (value ?? "").split(/\s+/).filter(Boolean);
  if (node.classes.length) styledNodes.add(node);
  else styledNodes.delete(node);
  applyClasses(lv, node);
}

export type InlineStyle = Record<string, string | number | undefined>;

const UNITLESS = new Set(["opacity", "flex-grow", "flex"]);

/** Applies an inline `style` object as LVGL local style properties, replacing the previous one. */
export function setInlineStyle(node: StyledNode, style: InlineStyle | undefined): void {
  const lv = lvgl();
  for (const { prop, selector } of node.localProps) lv.objRemoveLocal(node.obj, prop, selector);
  node.localProps = [];
  if (!style) return;
  if (!styleContext) throw new Error("Style context isn't set");

  const decls = Object.entries(style)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => {
      const prop = cssPropertyName(key);
      return { prop, value: typeof value === "number" && !UNITLESS.has(prop) ? `${value}px` : String(value) };
    });

  const selector = selectorValue(lv, { part: "LV_PART_MAIN", states: [] });
  for (const decl of translateDeclarations(decls, styleContext)) {
    const prop = lv.constant(decl.prop);
    const value = resolveValue(lv, decl.value);
    if (value.kind === "color") lv.objSetLocalColor(node.obj, prop, value.v, selector);
    else if (value.kind === "ptr") lv.objSetLocalPtr(node.obj, prop, value.v, selector);
    else lv.objSetLocalNum(node.obj, prop, value.v, selector);
    node.localProps.push({ prop, selector });
  }
}

/** Stops tracking a node whose LVGL object has been deleted. */
export function forgetNode(node: StyledNode): void {
  styledNodes.delete(node);
}
