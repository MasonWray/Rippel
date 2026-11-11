/**
 * Solid universal renderer that builds LVGL objects through the bridge.
 *
 * Compiled JSX imports its helpers (createElement, insert, setProp, ...) from
 * this module ("rippel/renderer"). Each element node owns one LVGL object.
 * Text nodes have no LVGL object: their text becomes the text of the
 * <label> they're in, or of an implicit label inside a <button>.
 */
import { createRenderer } from "solid-js/universal";
import { EVENT, WIDGET, type Ptr, type WidgetType } from "./lvgl.js";
import { lvgl } from "./host.js";
import { forgetNode, setClasses, setInlineStyle, type InlineStyle, type StyledNode } from "./styles.js";

type Handler = (value?: number) => void;

export class TextNode {
  readonly kind = "text";
  parent: ElementNode | undefined;
  constructor(public text: string) {}
}

export class ElementNode implements StyledNode {
  readonly kind = "element";
  parent: ElementNode | undefined;
  children: RNode[] = [];
  classes: string[] = [];
  appliedRules: StyledNode["appliedRules"] = [];
  localProps: StyledNode["localProps"] = [];
  handlers: Partial<Record<string, Handler>> = {};
  listening = false;
  /** LVGL label created inside a <button> to show its text children. */
  implicitLabel: Ptr = 0;
  /** Min and max of a slider, arc or bar. */
  range: [number, number] = [0, 100];
  name: string | undefined;
  dead = false;
  constructor(
    public readonly type: WidgetType | "root",
    public readonly obj: Ptr,
  ) {}
}

export type RNode = ElementNode | TextNode;

/** LVGL object pointer -> node, for routing events. */
const nodesByObj = new Map<Ptr, ElementNode>();
/** Removed nodes awaiting deletion, unless they're inserted again first. */
const pendingDelete = new Set<ElementNode>();
let flushScheduled = false;

function elementIndex(parent: ElementNode, node: ElementNode): number {
  let index = parent.implicitLabel ? 1 : 0;
  for (const child of parent.children) {
    if (child === node) return index;
    if (child.kind === "element") index++;
  }
  return -1;
}

function markDead(node: ElementNode) {
  node.dead = true;
  nodesByObj.delete(node.obj);
  forgetNode(node);
  for (const child of node.children) if (child.kind === "element") markDead(child);
}

/** Deletes removed objects after the current LVGL event or render pass has finished. */
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    const lv = lvgl();
    for (const node of pendingDelete) {
      if (node.parent || node.dead) continue;
      markDead(node);
      lv.objDelete(node.obj);
    }
    pendingDelete.clear();
  });
}

/** Recomputes the text shown by an element from its text children. */
function syncText(node: ElementNode) {
  const lv = lvgl();
  const texts = node.children.filter((c): c is TextNode => c.kind === "text");
  const text = texts.map((t) => t.text).join("");
  if (node.type === "label") {
    lv.labelSetText(node.obj, text);
  } else if (node.type === "button") {
    if (!node.implicitLabel && texts.length) {
      node.implicitLabel = lv.objCreate("label", node.obj);
      lv.objSetParent(node.implicitLabel, node.obj, 0);
      lv.objCenter(node.implicitLabel);
    }
    if (node.implicitLabel) lv.labelSetText(node.implicitLabel, text);
  } else if (text) {
    // Empty text nodes are fine: Solid leaves one as a marker where a <Show> renders nothing.
    throw new Error(`Text can't go directly inside <${node.type}>. Wrap it in a <label>.`);
  }
}

function ensureListening(node: ElementNode) {
  if (node.listening) return;
  lvgl().objListen(node.obj);
  node.listening = true;
}

function dispatchEvent(obj: Ptr, event: number, value: number) {
  const node = nodesByObj.get(obj);
  if (!node || node.dead) return;
  const h = node.handlers;
  switch (event) {
    case EVENT.click: h.onClick?.(); break;
    case EVENT.press: h.onPress?.(); break;
    case EVENT.release:
      h.onRelease?.();
      if (node.type === "slider" || node.type === "arc") h.onChange?.(value);
      break;
    case EVENT.longPress: h.onLongPress?.(); break;
    case EVENT.valueChanged: h.onInput?.(value); break;
    case EVENT.focus: h.onFocus?.(); break;
    case EVENT.blur: h.onBlur?.(); break;
  }
}

const COMMON_EVENTS = ["onClick", "onPress", "onRelease", "onLongPress", "onFocus", "onBlur"];
const VALUE_EVENTS = ["onInput", "onChange"];

/** Setters for widgets that have a range and a value. */
function rangedSetters(type: WidgetType | "root") {
  const lv = lvgl();
  switch (type) {
    case "slider": return { range: lv.sliderSetRange, value: lv.sliderSetValue };
    case "arc": return { range: lv.arcSetRange, value: lv.arcSetValue };
    case "bar": return { range: lv.barSetRange, value: lv.barSetValue };
    default: return undefined;
  }
}

function setProperty(node: RNode, name: string, value: unknown): void {
  if (node.kind !== "element") return;
  const lv = lvgl();

  if (name.startsWith("on")) {
    const allowed = node.type === "slider" || node.type === "arc" ? [...COMMON_EVENTS, ...VALUE_EVENTS] : COMMON_EVENTS;
    if (!allowed.includes(name)) throw new Error(`<${node.type}> has no "${name}" event`);
    if (value !== undefined && typeof value !== "function") {
      throw new Error(`"${name}" on <${node.type}> must be a function`);
    }
    node.handlers[name] = value as Handler | undefined;
    if (value) ensureListening(node);
    return;
  }

  switch (name) {
    case "class":
      setClasses(node, value as string | undefined);
      return;
    case "style":
      setInlineStyle(node, value as InlineStyle | undefined);
      return;
    case "id":
      node.name = value as string | undefined;
      return;
    case "hidden":
      lv.objSetHidden(node.obj, Boolean(value));
      return;
    case "disabled":
      lv.objSetState(node.obj, lv.constant("LV_STATE_DISABLED"), Boolean(value));
      return;
    case "checked":
      lv.objSetState(node.obj, lv.constant("LV_STATE_CHECKED"), Boolean(value));
      return;
  }

  const ranged = rangedSetters(node.type);
  if (ranged) {
    switch (name) {
      case "min":
      case "max": {
        const n = Math.round(Number(value ?? (name === "min" ? 0 : 100)));
        if (name === "min") node.range[0] = n;
        else node.range[1] = n;
        ranged.range(node.obj, node.range[0], node.range[1]);
        return;
      }
      case "value":
        ranged.value(node.obj, Math.round(Number(value ?? 0)));
        return;
    }
  }

  if (node.type === "arc" && name === "readonly") {
    lv.arcSetReadonly(node.obj, Boolean(value));
    return;
  }

  if (node.type === "view" && name === "scroll") {
    lv.viewSetScroll(node.obj, Boolean(value));
    return;
  }

  throw new Error(`Unknown prop "${name}" on <${node.type}>`);
}

function nextSiblingOf(node: RNode): RNode | undefined {
  if (!node.parent) return undefined;
  const siblings = node.parent.children;
  return siblings[siblings.indexOf(node) + 1];
}

export const {
  render,
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = createRenderer<RNode>({
  createElement(tag) {
    if (!(tag in WIDGET)) {
      throw new Error(`Unknown element <${tag}>. Available: ${Object.keys(WIDGET).map((t) => `<${t}>`).join(", ")}`);
    }
    const lv = lvgl();
    const node = new ElementNode(tag as WidgetType, lv.objCreate(tag as WidgetType, lv.detachedRoot()));
    nodesByObj.set(node.obj, node);
    return node;
  },

  createTextNode(value) {
    return new TextNode(value);
  },

  replaceText(node, value) {
    if (node.kind !== "text") return;
    node.text = value;
    if (node.parent) syncText(node.parent);
  },

  isTextNode(node) {
    return node.kind === "text";
  },

  setProperty(node, name, value) {
    setProperty(node, name, value);
  },

  insertNode(parent, node, anchor) {
    if (parent.kind !== "element") throw new Error("Can't insert into a text node");
    // Inserting a node before itself means it stays put, as in the DOM.
    if (anchor === node) anchor = nextSiblingOf(node);
    const previousParent = node.parent;
    if (previousParent) {
      previousParent.children.splice(previousParent.children.indexOf(node), 1);
    }
    const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1;
    if (anchorIndex >= 0) parent.children.splice(anchorIndex, 0, node);
    else parent.children.push(node);
    node.parent = parent;

    if (node.kind === "text") {
      if (previousParent && previousParent !== parent) syncText(previousParent);
      syncText(parent);
      return;
    }
    pendingDelete.delete(node);
    lvgl().objSetParent(node.obj, parent.obj, elementIndex(parent, node));
  },

  removeNode(parent, node) {
    if (parent.kind !== "element") return;
    const index = parent.children.indexOf(node);
    if (index >= 0) parent.children.splice(index, 1);
    node.parent = undefined;

    if (node.kind === "text") {
      syncText(parent);
      return;
    }
    lvgl().objSetParent(node.obj, lvgl().detachedRoot(), -1);
    pendingDelete.add(node);
    scheduleFlush();
  },

  getParentNode(node) {
    return node.parent;
  },

  getFirstChild(node) {
    return node.kind === "element" ? node.children[0] : undefined;
  },

  getNextSibling(node) {
    return nextSiblingOf(node);
  },
});

/** Wraps the active screen as the renderer's root node and routes LVGL events to handlers. */
export function createRoot(): ElementNode {
  const lv = lvgl();
  lv.onEvent = dispatchEvent;
  const root = new ElementNode("root", lv.screen());
  nodesByObj.set(root.obj, root);
  return root;
}
