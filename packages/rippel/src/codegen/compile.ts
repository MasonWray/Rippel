/**
 * The C backend's front half: reads the TSX source and turns it into a flat
 * program of objects, signals, bindings and event handlers.
 *
 * Nothing runs at compile time. Components are inlined at each use, and every
 * reactive JSX expression becomes one binding that re-runs when a signal it
 * reads changes. <Show> and <Switch> build all their branches up front and
 * hide the inactive ones.
 *
 * Anything outside the supported subset is a CodegenError with a location.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { parseSync, type types as t } from "@babel/core";
import { translateDeclarations, inlineDeclarations } from "../style/translate.js";
import type { StyleContext, StyleDecl } from "../style/ir.js";

export class CodegenError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(message);
    this.name = "CodegenError";
  }
}

export type Base = "int" | "float" | "bool" | "string";

export interface ValueInfo {
  base: Base;
  /** C type, for numbers and bools. */
  ctype: string;
  unsigned?: boolean;
  maxLength?: number;
}

export interface Signal {
  name: string;
  kind: "firmware" | "local" | "list";
  /** C expression for the value, when it isn't a variable of its own. */
  code?: string;
  value: ValueInfo;
  /** C initializer. */
  initial: string;
  binds: Bind[];
}

export interface ActionParam extends ValueInfo {
  name: string;
}

export interface Action {
  name: string;
  params: ActionParam[];
}

export interface Bind {
  name: string;
  body: string[];
}

export interface Handler {
  name: string;
  body: string[];
  /** C declaration that reads the widget's current value into `value`. */
  valueDecl?: string;
}

/** The C expression that reads a signal. */
export const sigRef = (signal: Signal) => signal.code ?? `sig_${signal.name}`;

export type Widget = "view" | "label" | "button" | "slider" | "arc" | "bar" | "image" | "switch" | "checkbox" | "dropdown";

export interface Obj {
  name: string;
  /** Referenced after init, so it needs file scope. */
  isStatic: boolean;
  handle?: string;
}

export type InitOp =
  | { op: "create"; obj: Obj; widget: Widget; parent: Obj | "root" }
  | { op: "line"; text: string };

/** A class list that depends on signals. Exactly one alternative applies at a time. */
export interface ClassApply {
  obj: Obj;
  classes: string[];
}

export interface UiProgram {
  signals: Signal[];
  actions: Action[];
  binds: Bind[];
  handlers: Handler[];
  objects: Obj[];
  init: InitOp[];
  /** Style rules are referenced by class name through this callback at emit time. */
  usedWidgets: Set<Widget>;
  usedFonts: Set<string>;
  /** Image files the UI uses: absolute path -> C symbol. */
  images: Map<string, string>;
  warnings: string[];
  tables: { key: string; name: string; ctype: string; values: string[] }[];
  lists: { storage: string; capacity: number; fields: string[]; rows: string[]; nextId: number }[];
  /** Generated helpers, callable from bindings and handlers. */
  functions: { signature: string; body: string[] }[];
  declarations: string[];
}

/** C for adding or removing the styles of a set of classes, in cascade order. */
export interface StyleLookup {
  add(obj: string, classes: string[]): string[];
  remove(obj: string, classes: string[]): string[];
}

export interface CompileInput {
  entry: string;
  contract: string | undefined;
  fpu: "none" | "single" | "double";
  styleContext: StyleContext;
  styles: StyleLookup;
  fontSymbol(family: string, size: number): string;
}

/** A compiled expression. */
interface Expr {
  type: Base;
  /** C expression. For strings, a `const char *`, if the string doesn't need formatting. */
  code: string;
  deps: Set<Signal>;
  unsigned?: boolean;
  str?: StrNode;
}

type StrNode =
  | { k: "lit"; v: string }
  | { k: "ptr"; code: string; max: number }
  | { k: "int"; code: string; unsigned?: boolean }
  | { k: "float"; code: string; decimals?: number }
  | { k: "cond"; c: string; a: StrNode; b: StrNode }
  | { k: "cat"; parts: StrNode[] };

type Scope = Map<string, Binding> & { parent?: Scope };
type FuncNode = t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;

type Binding =
  | { k: "signal"; signal: Signal }
  | { k: "setter"; signal: Signal }
  | { k: "action"; action: Action }
  | { k: "func"; node: FuncNode; scope: Scope; module: Module }
  | { k: "lazy"; node: t.Expression; scope: Scope; module: Module; name?: string; cached?: ConstValue; hasCached?: boolean }
  | { k: "const"; value: ConstValue }
  | { k: "getter"; value: ConstValue }
  | { k: "unsupported"; message: string }
  | { k: "list"; list: ListInfo }
  | { k: "listItem"; list: ListInfo; slot: number }
  | { k: "listItemAt"; list: ListInfo; index: string; reads: Set<string> }
  | { k: "children"; nodes: JsxChild[]; scope: Scope; module: Module }
  | { k: "value"; expr: Expr }
  | { k: "props"; props: Map<string, Binding>; children?: Binding }
  | { k: "rippel"; name: string };

type JsxChild = t.JSXElement["children"][number];

/** A value known at compile time. Opaque wraps things like functions and signals. */
type ConstValue = number | string | boolean | null | undefined | ConstValue[] | { [key: string]: ConstValue } | Opaque;

class Opaque {
  constructor(public readonly binding: Binding) {}
}

/** Thrown while evaluating something that depends on runtime state. */
class NotConstant extends Error {
  constructor(public readonly split?: { signal: Signal; size: number }) {
    super("not constant");
  }
}

interface ListSlot {
  fields: Map<string, Signal>;
  id: Signal;
  used: Signal;
}

interface ListInfo {
  name: string;
  storage: string;
  capacity: number;
  fields: Map<string, { c: string; value: ValueInfo }>;
  slots: ListSlot[];
  size: Signal;
}

interface ListView {
  list: ListInfo;
  compare?: FuncNode;
  scope: Scope;
  module: Module;
}

type Folded = { k: "const"; value: ConstValue } | { k: "split"; signal: Signal; values: ConstValue[] };

interface Module {
  file: string;
  scope: Scope;
  defaultExport?: Binding;
  exports: Map<string, Binding>;
}

/** Where a piece of UI is being built. */
interface Place {
  parent: Obj | "root";
  /** Only build when this holds (inside a <Show> or <Switch> branch). */
  guard: Expr | undefined;
  /** Collects the top-level objects of the current branch. */
  roots: Obj[] | undefined;
  /** Collects local signals that reset when the current branch reopens. */
  resets: Signal[] | undefined;
}

const CONTRACT_TYPES: Record<string, ValueInfo> = {
  i8: { base: "int", ctype: "int8_t" },
  u8: { base: "int", ctype: "uint8_t", unsigned: true },
  i16: { base: "int", ctype: "int16_t" },
  u16: { base: "int", ctype: "uint16_t", unsigned: true },
  i32: { base: "int", ctype: "int32_t" },
  u32: { base: "int", ctype: "uint32_t", unsigned: true },
  f32: { base: "float", ctype: "float" },
  bool: { base: "bool", ctype: "bool" },
};

const LATER = "isn't supported by `rippel build` yet";
const LATER_MANY = "aren't supported by `rippel build` yet";
const WIDGETS: Record<string, Widget> = { view: "view", label: "label", button: "button", slider: "slider", arc: "arc", bar: "bar", image: "image", switch: "switch", checkbox: "checkbox", dropdown: "dropdown" };
const IMAGE_FIT: Record<string, string> = {
  none: "LV_IMAGE_ALIGN_CENTER",
  contain: "LV_IMAGE_ALIGN_CONTAIN",
  cover: "LV_IMAGE_ALIGN_COVER",
  fill: "LV_IMAGE_ALIGN_STRETCH",
};
const WIDGET_ENUM: Record<Widget, string> = {
  view: "RP_WIDGET_VIEW",
  label: "RP_WIDGET_LABEL",
  button: "RP_WIDGET_BUTTON",
  slider: "RP_WIDGET_SLIDER",
  arc: "RP_WIDGET_ARC",
  bar: "RP_WIDGET_BAR",
  image: "RP_WIDGET_IMAGE",
  switch: "RP_WIDGET_SWITCH",
  checkbox: "RP_WIDGET_CHECKBOX",
  dropdown: "RP_WIDGET_DROPDOWN",
};
export const widgetEnum = (w: Widget) => WIDGET_ENUM[w];

export const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Escapes text for a C string literal. Non-ASCII goes out as hex bytes. */
export function cString(text: string): string {
  let out = "";
  const bytes = Buffer.from(text, "utf8");
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += "\\\\";
    else if (b === 0x0a) out += "\\n";
    else if (b < 0x20 || b >= 0x7f) {
      out += `\\x${b.toString(16).padStart(2, "0")}`;
      const next = bytes[i + 1];
      // A hex escape swallows any hex digits after it, so end the literal.
      if (next !== undefined && next < 0x7f && /[0-9a-fA-F]/.test(String.fromCharCode(next))) out += '" "';
    } else out += String.fromCharCode(b);
  }
  return `"${out}"`;
}

const fmtEscape = (s: string) => s.replaceAll("%", "%%");
const utf8Length = (s: string) => Buffer.byteLength(s, "utf8");

function floatLiteral(v: number): string {
  const s = String(v);
  return /[.e]/.test(s) ? `${s}f` : `${s}.0f`;
}

/** Collapses JSX text whitespace the way Solid's compiler does. */
function trimJsxText(text: string): string {
  let s = text.replace(/\r/g, "");
  if (s.includes("\n")) {
    s = s
      .split("\n")
      .map((line, i) => (i ? line.replace(/^\s*/g, "") : line))
      .filter((line) => !/^\s*$/.test(line))
      .join(" ");
  }
  return s.replace(/\s+/g, " ");
}

function strBound(node: StrNode): number {
  switch (node.k) {
    case "lit": return utf8Length(node.v);
    case "ptr": return node.max;
    case "int": return 11;
    case "float": return 32;
    case "cond": return Math.max(strBound(node.a), strBound(node.b));
    case "cat": return node.parts.reduce((sum, p) => sum + strBound(p), 0);
  }
}

function flattenStr(node: StrNode): StrNode[] {
  return node.k === "cat" ? node.parts.flatMap(flattenStr) : [node];
}

function isPlain(node: StrNode): boolean {
  return node.k === "lit" || node.k === "ptr" || (node.k === "cond" && isPlain(node.a) && isPlain(node.b));
}

function plainCode(node: StrNode): string {
  switch (node.k) {
    case "lit": return cString(node.v);
    case "ptr": return node.code;
    case "cond": return `(${node.c} ? ${plainCode(node.a)} : ${plainCode(node.b)})`;
    default: throw new Error("Not a plain string");
  }
}

function strPiece(node: StrNode): { format: string; args: string[] } | undefined {
  switch (node.k) {
    case "lit": return { format: fmtEscape(node.v), args: [] };
    case "ptr": return { format: "%s", args: [node.code] };
    case "int": return node.unsigned ? { format: "%u", args: [`(unsigned)${wrap(node.code)}`] } : { format: "%d", args: [`(int)${wrap(node.code)}`] };
    case "float": return { format: node.decimals === undefined ? "%g" : `%.${node.decimals}f`, args: [`(double)${wrap(node.code)}`] };
    case "cond": return isPlain(node) ? { format: "%s", args: [plainCode(node)] } : undefined;
    case "cat": return undefined;
  }
}

/** True if the whole of `code` is one parenthesized group. */
function isParenthesized(code: string): boolean {
  if (!code.startsWith("(")) return false;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i === code.length - 1;
  }
  return false;
}

function wrap(code: string): string {
  return /^[\w.[\]]+$/.test(code) || isParenthesized(code) ? code : `(${code})`;
}

/** Statements that format `node` into the char buffer `text`, using `n` as the write position. */
function appendStr(node: StrNode, indent: string): string[] {
  const out: string[] = [];
  let format = "";
  let args: string[] = [];
  const flush = () => {
    if (!format) return;
    out.push(`${indent}n += snprintf(text + n, sizeof(text) - n, ${[cString(format), ...args].join(", ")});`);
    format = "";
    args = [];
  };
  for (const part of flattenStr(node)) {
    const piece = strPiece(part);
    if (piece) {
      format += piece.format;
      args.push(...piece.args);
      continue;
    }
    if (part.k !== "cond") throw new Error("Unexpected string node");
    flush();
    out.push(`${indent}if(${part.c}) {`, ...appendStr(part.a, indent + "    "), `${indent}}`, `${indent}else {`, ...appendStr(part.b, indent + "    "), `${indent}}`);
  }
  flush();
  return out;
}

/** Statements that set a label to a string expression. */
function setText(obj: string, node: StrNode, setter = "rp_label_set_text"): string[] {
  const parts = flattenStr(node);
  if (parts.every((p) => p.k === "lit")) {
    return [`${setter}(${obj}, ${cString(parts.map((p) => (p as { v: string }).v).join(""))});`];
  }
  if (parts.length === 1 && isPlain(parts[0])) return [`${setter}(${obj}, ${plainCode(parts[0])});`];

  const size = strBound(node) + 1;
  if (parts.every((p) => strPiece(p))) {
    const pieces = parts.map((p) => strPiece(p)!);
    const format = pieces.map((p) => p.format).join("");
    const args = pieces.flatMap((p) => p.args);
    return [`char text[${size}];`, `snprintf(text, sizeof(text), ${[cString(format), ...args].join(", ")});`, `${setter}(${obj}, text);`];
  }
  return [`char text[${size}];`, "int n = 0;", ...appendStr(node, ""), `${setter}(${obj}, text);`];
}

function toStr(e: Expr): StrNode {
  switch (e.type) {
    case "string": return e.str!;
    case "int": return /^-?\d+$/.test(e.code) ? { k: "lit", v: e.code } : { k: "int", code: e.code, unsigned: e.unsigned };
    case "float": return { k: "float", code: e.code };
    case "bool": return { k: "cond", c: e.code, a: { k: "lit", v: "true" }, b: { k: "lit", v: "false" } };
  }
}

function union(...exprs: (Expr | undefined)[]): Set<Signal> {
  const deps = new Set<Signal>();
  for (const e of exprs) if (e) for (const d of e.deps) deps.add(d);
  return deps;
}

const noDeps = () => new Set<Signal>();
const intLit = (v: number): Expr => ({ type: "int", code: String(v), deps: noDeps() });
const boolExpr = (code: string, deps: Set<Signal>): Expr => ({ type: "bool", code, deps });

function strExpr(str: StrNode, deps: Set<Signal>): Expr {
  return { type: "string", code: isPlain(str) ? plainCode(str) : "", deps, str };
}

function newScope(parent?: Scope): Scope {
  const scope = new Map<string, Binding>() as Scope;
  scope.parent = parent;
  return scope;
}

function lookup(scope: Scope | undefined, name: string): Binding | undefined {
  for (let s = scope; s; s = s.parent) {
    const found = s.get(name);
    if (found) return found;
  }
  return undefined;
}

const unwrap = (node: t.Node): t.Node => {
  let current = node;
  while (
    current.type === "TSAsExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "TSSatisfiesExpression" ||
    current.type === "ParenthesizedExpression"
  ) {
    current = current.expression;
  }
  return current;
};

function isFunc(node: t.Node): node is FuncNode {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration";
}

class Compiler {
  readonly program: UiProgram = {
    signals: [],
    actions: [],
    binds: [],
    handlers: [],
    objects: [],
    init: [],
    usedWidgets: new Set(),
    usedFonts: new Set(),
    images: new Map(),
    warnings: [],
    tables: [],
    lists: [],
    functions: [],
    declarations: [],
  };
  private readonly modules = new Map<string, Module>();
  private readonly contract = new Map<string, Binding>();
  private readonly names = new Set<string>();
  private instance = 0;
  private counter = 0;
  /** Signals pinned to one table row while a value is evaluated per row. */
  private readonly overrides = new Map<Signal, number>();
  /** Array indexes pinned while a call through a runtime index is expanded. */
  private readonly indexOverrides = new Map<t.Node, number>();
  private signalHint: string | undefined;
  /** When set, collects every signal read, for effects. */
  private collect: Set<Signal> | undefined;
  private inlineDepth = 0;

  constructor(
    private readonly input: CompileInput,
    /** Local number signals known to hold fractions, from earlier passes. */
    private readonly floatSignals: Set<string>,
    private readonly onDemote: (key: string) => void,
  ) {}

  run(): UiProgram {
    if (this.input.contract) this.loadContract(this.input.contract);
    const entry = this.loadModule(this.input.entry);
    const root = entry.defaultExport;
    if (!root || root.k !== "func") {
      throw new CodegenError("The entry module must default-export the root component.", entry.file, 1, 1);
    }
    this.inlineComponent(root, { k: "props", props: new Map() }, entry, { parent: "root", guard: undefined, roots: undefined, resets: undefined });
    return this.program;
  }

  private fail(node: t.Node, module: Module, message: string): never {
    const loc = node.loc?.start;
    throw new CodegenError(message, module.file, loc?.line ?? 1, (loc?.column ?? 0) + 1);
  }

  private unique(base: string): string {
    let name = base;
    for (let i = 2; this.names.has(name); i++) name = `${base}_${i}`;
    this.names.add(name);
    return name;
  }

  // ---------- Modules ----------

  private parse(file: string): t.File {
    const ast = parseSync(readFileSync(file, "utf8"), {
      filename: file,
      babelrc: false,
      configFile: false,
      sourceType: "module",
      parserOpts: { plugins: ["jsx", "typescript"] },
    });
    if (!ast) throw new CodegenError("Couldn't parse this file", file, 1, 1);
    return ast;
  }

  private loadContract(file: string) {
    const module: Module = { file, scope: newScope(), exports: new Map() };
    const typeOf = (node: t.Node): ValueInfo => this.contractType(node, module);

    for (const statement of this.parse(file).program.body) {
      if (statement.type === "ImportDeclaration") continue;
      if (statement.type !== "ExportNamedDeclaration" || statement.declaration?.type !== "VariableDeclaration") {
        this.fail(statement, module, "A contract only exports signals and actions");
      }
      for (const decl of statement.declaration.declarations) {
        const init = decl.init && unwrap(decl.init);
        if (decl.id.type !== "Identifier" || init?.type !== "CallExpression" || init.callee.type !== "Identifier") {
          this.fail(decl, module, "Expected `export const name = signal(...)` or `action(...)`");
        }
        const name = decl.id.name;
        if (init.callee.name === "signal") {
          const value = typeOf(init.arguments[0]);
          const signal: Signal = { name: snake(name), kind: "firmware", value, initial: this.contractInitial(init.arguments[1], value, module), binds: [] };
          this.program.signals.push(signal);
          this.contract.set(name, { k: "signal", signal });
        } else if (init.callee.name === "action") {
          const shape = init.arguments[0];
          if (shape?.type !== "ObjectExpression") this.fail(init, module, "action() takes an object of parameter types");
          const params = shape.properties.map((p) => {
            if (p.type !== "ObjectProperty" || p.key.type !== "Identifier") this.fail(p, module, "Expected `name: type`");
            return { name: snake(p.key.name), jsName: p.key.name, ...typeOf(p.value) };
          });
          const action: Action = { name: snake(name), params };
          this.program.actions.push(action);
          this.contract.set(name, { k: "action", action });
        } else {
          this.fail(init, module, "Expected `signal(...)` or `action(...)`");
        }
      }
    }
  }

  private contractInitial(options: t.Node | undefined, value: ValueInfo, module: Module): string {
    let literal: t.Node | undefined;
    if (options) {
      if (options.type !== "ObjectExpression") this.fail(options, module, "Expected `{ initial: ... }`");
      for (const p of options.properties) {
        if (p.type === "ObjectProperty" && p.key.type === "Identifier" && p.key.name === "initial") literal = unwrap(p.value);
      }
    }
    switch (value.base) {
      case "bool":
        if (literal && literal.type !== "BooleanLiteral") this.fail(literal, module, "Expected true or false");
        return literal?.type === "BooleanLiteral" && literal.value ? "true" : "false";
      case "string":
        if (literal && literal.type !== "StringLiteral") this.fail(literal, module, "Expected a string");
        return cString(literal?.type === "StringLiteral" ? literal.value : "");
      default: {
        let v = 0;
        if (literal?.type === "NumericLiteral") v = literal.value;
        else if (literal?.type === "UnaryExpression" && literal.operator === "-" && literal.argument.type === "NumericLiteral") v = -literal.argument.value;
        else if (literal) this.fail(literal, module, "Expected a number");
        return value.base === "float" ? floatLiteral(v) : String(Math.trunc(v));
      }
    }
  }

  private resolveImport(from: string, source: string, node: t.Node, module: Module): string {
    const base = resolve(dirname(from), source);
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
    }
    this.fail(node, module, `Can't find "${source}"`);
  }

  private loadModule(file: string): Module {
    const existing = this.modules.get(file);
    if (existing) return existing;
    const module: Module = { file, scope: newScope(), exports: new Map() };
    this.modules.set(file, module);

    const body = this.parse(file).program.body;
    for (const statement of body) {
      if (statement.type === "ImportDeclaration") this.bindImport(statement, module);
    }
    for (const statement of body) {
      switch (statement.type) {
        case "ImportDeclaration":
        case "TSTypeAliasDeclaration":
        case "TSInterfaceDeclaration":
          break;
        case "ExportNamedDeclaration":
          if (statement.exportKind === "type" || !statement.declaration) break;
          for (const [name, binding] of this.declare(statement.declaration, module.scope, module)) module.exports.set(name, binding);
          break;
        case "ExportDefaultDeclaration": {
          const decl = statement.declaration;
          if (decl.type === "FunctionDeclaration" || decl.type === "ArrowFunctionExpression" || decl.type === "FunctionExpression") {
            const binding: Binding = { k: "func", node: decl, scope: module.scope, module };
            module.defaultExport = binding;
            if (decl.type === "FunctionDeclaration" && decl.id) module.scope.set(decl.id.name, binding);
          } else if (decl.type === "Identifier") {
            module.defaultExport = lookup(module.scope, decl.name);
          } else {
            this.fail(decl, module, "Default-export a function");
          }
          break;
        }
        default:
          this.declare(statement, module.scope, module);
      }
    }
    return module;
  }

  private bindImport(statement: t.ImportDeclaration, module: Module) {
    if (statement.importKind === "type") return;
    const source = statement.source.value;
    if (source.endsWith(".css")) return;
    if (/\.(jpe?g|gif|webp|bmp|svg)$/i.test(source)) this.fail(statement, module, "Only .png images are supported for now");
    if (/\.png$/i.test(source)) {
      const file = resolve(dirname(module.file), source);
      if (!existsSync(file)) this.fail(statement, module, `Can't find "${source}"`);
      for (const spec of statement.specifiers) {
        if (spec.type !== "ImportDefaultSpecifier") this.fail(spec, module, "Import an image as a default import");
        module.scope.set(spec.local.name, { k: "const", value: { __image: file } });
      }
      return;
    }
    if (source === "rippel" || source === "rippel/contract") {
      for (const spec of statement.specifiers) {
        if (spec.type === "ImportSpecifier" && spec.importKind !== "type" && spec.imported.type === "Identifier") {
          module.scope.set(spec.local.name, { k: "rippel", name: spec.imported.name });
        }
      }
      return;
    }
    const target = this.resolveImport(module.file, source, statement, module);
    if (this.input.contract && resolve(target) === resolve(this.input.contract)) {
      for (const spec of statement.specifiers) {
        if (spec.type !== "ImportSpecifier" || spec.imported.type !== "Identifier") {
          this.fail(spec, module, "Import contract signals and actions by name");
        }
        const binding = this.contract.get(spec.imported.name);
        if (binding) module.scope.set(spec.local.name, binding);
        else if (spec.importKind !== "type") this.fail(spec, module, `The contract has no "${spec.imported.name}"`);
      }
      return;
    }
    const imported = this.loadModule(target);
    for (const spec of statement.specifiers) {
      if (spec.type === "ImportNamespaceSpecifier") this.fail(spec, module, `\`import * as\` ${LATER}`);
      if (spec.type === "ImportDefaultSpecifier") {
        if (!imported.defaultExport) this.fail(spec, module, `"${source}" has no default export`);
        module.scope.set(spec.local.name, imported.defaultExport);
      } else if (spec.importKind !== "type" && spec.imported.type === "Identifier") {
        const binding = imported.exports.get(spec.imported.name);
        if (!binding) this.fail(spec, module, `"${source}" doesn't export "${spec.imported.name}"`);
        module.scope.set(spec.local.name, binding);
      }
    }
  }

  /** Declares a function or `const` in `scope` and returns what it bound. */
  private declare(statement: t.Statement | t.Declaration, scope: Scope, module: Module, place?: Place): Map<string, Binding> {
    const bound = new Map<string, Binding>();
    const add = (name: string, binding: Binding) => {
      scope.set(name, binding);
      bound.set(name, binding);
    };

    if (statement.type === "FunctionDeclaration") {
      if (statement.id) add(statement.id.name, { k: "func", node: statement, scope, module });
      return bound;
    }
    if (statement.type === "TSTypeAliasDeclaration" || statement.type === "TSInterfaceDeclaration") return bound;
    if (statement.type === "ExpressionStatement") {
      this.effectStatement(statement.expression, scope, module);
      return bound;
    }
    if (statement.type !== "VariableDeclaration") this.fail(statement, module, `This statement ${LATER} here`);
    if (statement.kind !== "const") {
      // Module state only matters if the UI that's being built reaches it.
      if (scope !== module.scope) this.fail(statement, module, "Use `const` here. Reactive state goes in a signal.");
      for (const decl of statement.declarations) {
        if (decl.id.type === "Identifier") add(decl.id.name, { k: "unsupported", message: `Module-level \`${statement.kind}\` variables ${LATER_MANY}` });
      }
      return bound;
    }

    for (const decl of statement.declarations) {
      const init = decl.init && unwrap(decl.init);
      if (!init) this.fail(decl, module, "Expected an initial value");

      if (decl.id.type === "ArrayPattern") {
        if (init.type !== "CallExpression" || init.callee.type !== "Identifier" || lookup(scope, init.callee.name)?.k !== "rippel") {
          this.fail(decl, module, "Array destructuring only works with createSignal");
        }
        const [getter, setter] = decl.id.elements;
        if (getter?.type !== "Identifier") this.fail(decl, module, "Expected `const [value, setValue] = createSignal(...)`");
        const seed = init.arguments[0] && unwrap(init.arguments[0]);
        if (seed?.type === "ArrayExpression" || seed?.type === "ObjectExpression") {
          const unsupported: Binding = { k: "unsupported", message: `Signals that hold lists or objects ${LATER_MANY}. They're planned for M3.` };
          add(getter.name, unsupported);
          if (setter?.type === "Identifier") add(setter.name, unsupported);
          continue;
        }
        const signal = this.createLocalSignal(getter.name, init, scope, module);
        place?.resets?.push(signal);
        add(getter.name, { k: "signal", signal });
        if (setter?.type === "Identifier") add(setter.name, { k: "setter", signal });
        continue;
      }

      if (decl.id.type === "ObjectPattern") {
        for (const prop of decl.id.properties) {
          if (prop.type !== "ObjectProperty" || prop.key.type !== "Identifier" || prop.value.type !== "Identifier") {
            this.fail(prop, module, `This kind of destructuring ${LATER}`);
          }
          const member: t.MemberExpression = { type: "MemberExpression", object: init as t.Expression, property: prop.key, computed: false, loc: prop.loc } as t.MemberExpression;
          add(prop.value.name, { k: "lazy", node: member, scope, module });
        }
        continue;
      }

      if (decl.id.type !== "Identifier") this.fail(decl, module, `This kind of destructuring ${LATER}`);
      const name = decl.id.name;
      if (isFunc(init)) {
        add(name, { k: "func", node: init, scope, module });
      } else if (init.type === "CallExpression" && init.callee.type === "Identifier" && lookup(scope, init.callee.name)?.k === "rippel") {
        const helper = lookup(scope, init.callee.name) as { name: string };
        if (helper.name === "createList") {
          add(name, { k: "lazy", node: init as t.Expression, scope, module, name });
          continue;
        }
        const arg = init.arguments[0] && unwrap(init.arguments[0]);
        if (helper.name !== "createMemo" || !arg || !isFunc(arg)) this.fail(init, module, `${helper.name}() ${LATER} here`);
        add(name, { k: "func", node: arg, scope, module });
      } else {
        add(name, { k: "lazy", node: init as t.Expression, scope, module, name });
      }
    }
    return bound;
  }

  private createLocalSignal(name: string, call: t.CallExpression, scope: Scope, module: Module): Signal {
    const helper = lookup(scope, (call.callee as t.Identifier).name) as { name: string };
    if (helper.name !== "createSignal") this.fail(call, module, `${helper.name}() ${LATER} here`);
    const arg = call.arguments[0];
    if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") this.fail(call, module, "createSignal needs an initial value for the device build");
    const initial = this.expr(arg as t.Expression, scope, module);
    if (initial.deps.size) this.fail(arg, module, "A signal's initial value can't read other signals in the device build");
    if (initial.type === "string" && !initial.code) this.fail(arg, module, "A string signal's initial value must be a plain string");

    const cName = this.unique(snake(name));
    const key = `${this.instance}:${cName}`;
    let value: ValueInfo;
    let code = initial.code;
    if (initial.type === "string") value = { base: "string", ctype: "const char *", maxLength: 32 };
    else if (initial.type === "bool") value = { base: "bool", ctype: "bool" };
    else if (initial.type === "float" || this.floatSignals.has(key)) {
      value = { base: "float", ctype: "float" };
      if (initial.type === "int") code = floatLiteral(Number(initial.code));
    } else value = { base: "int", ctype: "int32_t" };

    const signal: Signal & { key: string } = { name: cName, kind: "local", value, initial: code, binds: [], key };
    this.program.signals.push(signal);
    return signal;
  }

  // ---------- Expressions ----------

  private resolveBinding(node: t.Node, scope: Scope, module: Module): { binding: Binding; module: Module } | undefined {
    const n = unwrap(node);
    if (n.type === "Identifier") {
      const binding = lookup(scope, n.name);
      if (!binding) return undefined;
      if (binding.k === "unsupported") this.fail(n, module, binding.message);
      if (binding.k === "const" && binding.value instanceof Opaque) return { binding: binding.value.binding, module };
      if (binding.k === "lazy") {
        const inner = this.resolveBinding(binding.node, binding.scope, binding.module);
        return inner ?? { binding, module };
      }
      return { binding, module };
    }
    if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier") {
      const object = this.resolveBinding(n.object, scope, module);
      if (object?.binding.k === "listItem") {
        const { list, slot } = object.binding;
        const name = n.property.name;
        const signal = name === "id" ? list.slots[slot].id : list.slots[slot].fields.get(name);
        if (!signal) this.fail(n, module, `${list.name} items have no field "${name}"`);
        return { binding: { k: "signal", signal }, module };
      }
      if (object?.binding.k === "listItemAt") {
        const { list, index, reads } = object.binding;
        const name = n.property.name;
        const info = name === "id" ? { c: "id", value: { base: "int", ctype: "int32_t" } as ValueInfo } : list.fields.get(name);
        if (!info) this.fail(n, module, `${list.name} items have no field "${name}"`);
        reads.add(name);
        const code = `${list.storage}[${index}].${info.c}`;
        const expr: Expr =
          info.value.base === "string"
            ? strExpr({ k: "ptr", code, max: info.value.maxLength ?? 0 }, noDeps())
            : { type: info.value.base, code, deps: noDeps(), unsigned: info.value.unsigned };
        return { binding: { k: "value", expr }, module };
      }
      if (object?.binding.k === "props") {
        if (n.property.name === "children") return object.binding.children ? { binding: object.binding.children, module } : undefined;
        const binding = object.binding.props.get(n.property.name);
        if (!binding) return undefined;
        if (binding.k === "lazy") {
          const inner = this.resolveBinding(binding.node, binding.scope, binding.module);
          return inner ?? { binding, module };
        }
        return { binding, module };
      }
    }
    // Signals and setters can also live in constant arrays, like `columns[3][0]`.
    if (n.type === "MemberExpression") {
      const value = this.tryConst(n, scope, module);
      if (value?.value instanceof Opaque) return { binding: value.value.binding, module };
    }
    return undefined;
  }

  private bindParams(func: FuncNode, args: Binding[], scope: Scope, module: Module): Scope {
    const inner = newScope(scope);
    func.params.forEach((param, i) => {
      const p = param.type === "AssignmentPattern" ? param.left : param;
      if (p.type === "Identifier") {
        const arg = args[i];
        if (arg) inner.set(p.name, arg);
      } else if (p.type === "ObjectPattern" && args[i]?.k === "props") {
        const props = args[i] as Extract<Binding, { k: "props" }>;
        for (const prop of p.properties) {
          if (prop.type !== "ObjectProperty" || prop.key.type !== "Identifier" || prop.value.type !== "Identifier") {
            this.fail(prop, module, `This kind of destructuring ${LATER}`);
          }
          const value = prop.key.name === "children" ? props.children : props.props.get(prop.key.name);
          if (value) inner.set(prop.value.name, value);
        }
      } else {
        this.fail(param, module, `This kind of parameter ${LATER}`);
      }
    });
    return inner;
  }

  /** The expression a function evaluates to, if its body is that simple. */
  private returned(func: FuncNode, module: Module): { value: t.Node; statements: t.Statement[] } {
    if (func.body.type !== "BlockStatement") return { value: func.body, statements: [] };
    const body = func.body.body;
    const last = body[body.length - 1];
    if (last?.type !== "ReturnStatement" || !last.argument) this.fail(func, module, "Expected the function to end with a return");

    // Early returns become a chain of ?: expressions.
    let value: t.Node = last.argument;
    const statements: t.Statement[] = [];
    for (let i = body.length - 2; i >= 0; i--) {
      const s = body[i];
      if (s.type !== "IfStatement") {
        statements.unshift(s);
        continue;
      }
      const inner = s.consequent.type === "BlockStatement" && s.consequent.body.length === 1 ? s.consequent.body[0] : s.consequent;
      if (s.alternate || inner.type !== "ReturnStatement" || !inner.argument) this.fail(s, module, `This kind of \`if\` ${LATER} in a function that returns a value`);
      value = { type: "ConditionalExpression", test: s.test, consequent: inner.argument, alternate: value as t.Expression, loc: s.loc } as t.ConditionalExpression;
    }
    return { value, statements };
  }

  private inlineValue(func: FuncNode, scope: Scope, args: Binding[], module: Module, compile: (value: t.Node, inner: Scope) => Expr): Expr {
    const inner = this.bindParams(func, args, scope, module);
    const { value, statements } = this.returned(func, module);
    for (const statement of statements) this.declare(statement, inner, module);
    return compile(value, inner);
  }

  private expr(node: t.Node, scope: Scope, module: Module): Expr {
    const n = unwrap(node);
    if (n.type !== "NumericLiteral" && n.type !== "StringLiteral" && n.type !== "BooleanLiteral") {
      const folded = this.evalSplit(n, scope, module);
      if (folded?.k === "const" && (typeof folded.value === "number" || typeof folded.value === "string" || typeof folded.value === "boolean")) {
        return this.constExpr(folded.value, n, module);
      }
      if (folded?.k === "split") return this.splitExpr(folded, n, module);
    }
    switch (n.type) {
      case "NumericLiteral":
        return Number.isInteger(n.value) ? intLit(n.value) : { type: "float", code: floatLiteral(n.value), deps: noDeps() };
      case "BooleanLiteral":
        return boolExpr(n.value ? "true" : "false", noDeps());
      case "StringLiteral":
        return strExpr({ k: "lit", v: n.value }, noDeps());
      case "TemplateLiteral": {
        const parts: StrNode[] = [];
        const deps = noDeps();
        n.quasis.forEach((quasi, i) => {
          if (quasi.value.cooked) parts.push({ k: "lit", v: quasi.value.cooked });
          const e = n.expressions[i];
          if (e) {
            const value = this.expr(e, scope, module);
            parts.push(toStr(value));
            for (const d of value.deps) deps.add(d);
          }
        });
        return strExpr(parts.length === 1 ? parts[0] : { k: "cat", parts }, deps);
      }
      case "Identifier": {
        if (n.name === "undefined") this.fail(n, module, `undefined ${LATER}`);
        const found = lookup(scope, n.name);
        if (!found) this.fail(n, module, `"${n.name}" isn't defined`);
        if (found.k === "value") return found.expr;
        if (found.k === "lazy") return this.expr(found.node, found.scope, found.module);
        this.fail(n, module, `"${n.name}" can't be used as a value here. Signals are read by calling them: ${n.name}().`);
        break;
      }
      case "MemberExpression": {
        const resolved = this.resolveBinding(n, scope, module);
        if (resolved?.binding.k === "lazy") return this.expr(resolved.binding.node, resolved.binding.scope, resolved.binding.module);
        if (resolved?.binding.k === "value") return resolved.binding.expr;
        if (resolved?.binding.k === "signal") return this.readSignal(resolved.binding.signal);
        if (n.object.type === "Identifier" && n.object.name === "Math" && n.property.type === "Identifier" && n.property.name === "PI") {
          return { type: "float", code: "3.14159265f", deps: noDeps() };
        }
        this.fail(n, module, `This property access ${LATER}`);
        break;
      }
      case "UnaryExpression": {
        const value = this.expr(n.argument, scope, module);
        if (n.operator === "!") return boolExpr(`!${wrap(this.truthy(value, n, module))}`, value.deps);
        if (n.operator === "-" && (value.type === "int" || value.type === "float")) return { ...value, code: `-${wrap(value.code)}`, unsigned: false };
        if (n.operator === "+" && (value.type === "int" || value.type === "float")) return value;
        this.fail(n, module, `The operator "${n.operator}" ${LATER}`);
        break;
      }
      case "ConditionalExpression": {
        const c = this.expr(n.test, scope, module);
        const a = this.expr(n.consequent, scope, module);
        const b = this.expr(n.alternate, scope, module);
        const cond = this.truthy(c, n.test, module);
        const deps = union(c, a, b);
        if (a.type === "string" || b.type === "string") {
          return strExpr({ k: "cond", c: cond, a: toStr(a), b: toStr(b) }, deps);
        }
        if (a.type === "bool" && b.type === "bool") return boolExpr(`(${cond} ? ${a.code} : ${b.code})`, deps);
        if (a.type === "bool" || b.type === "bool") this.fail(n, module, "Both sides of this ?: need the same type for the device build");
        const type: Base = a.type === "float" || b.type === "float" ? "float" : "int";
        return { type, code: `(${cond} ? ${a.code} : ${b.code})`, deps };
      }
      case "LogicalExpression": {
        const a = this.expr(n.left, scope, module);
        const b = this.expr(n.right, scope, module);
        if (n.operator === "??") this.fail(n, module, `The ?? operator ${LATER}`);
        if (a.type !== "bool" || b.type !== "bool") {
          this.fail(n, module, `${n.operator} needs true/false values on both sides for the device build. Compare explicitly, or use ?:.`);
        }
        return boolExpr(`(${a.code} ${n.operator} ${b.code})`, union(a, b));
      }
      case "BinaryExpression":
        return this.binary(n, scope, module);
      case "CallExpression":
        return this.call(n, scope, module);
      default:
        this.fail(n, module, `This expression (${n.type}) ${LATER}`);
    }
  }

  private truthy(e: Expr, node: t.Node, module: Module): string {
    switch (e.type) {
      case "bool": return e.code;
      case "int":
      case "float": return `(${e.code} != 0)`;
      case "string":
        if (!e.code) this.fail(node, module, "This string can't be used as a condition");
        return `(${wrap(e.code)}[0] != '\\0')`;
    }
  }

  private binary(n: t.BinaryExpression, scope: Scope, module: Module): Expr {
    const a = this.expr(n.left, scope, module);
    const b = this.expr(n.right, scope, module);
    const deps = union(a, b);
    const isNumber = (e: Expr) => e.type === "int" || e.type === "float";

    switch (n.operator) {
      case "+":
        if (a.type === "string" || b.type === "string") return strExpr({ k: "cat", parts: [toStr(a), toStr(b)] }, deps);
      // falls through
      case "-":
      case "*":
      case "%": {
        if (!isNumber(a) || !isNumber(b)) this.fail(n, module, `"${n.operator}" needs numbers`);
        if (n.operator === "%") {
          if (a.type === "float" || b.type === "float") return { type: "float", code: `fmodf(${a.code}, ${b.code})`, deps };
        }
        return { type: a.type === "float" || b.type === "float" ? "float" : "int", code: `(${a.code} ${n.operator} ${b.code})`, deps };
      }
      case "/":
        if (!isNumber(a) || !isNumber(b)) this.fail(n, module, `"/" needs numbers`);
        return { type: "float", code: `((float)${wrap(a.code)} / ${wrap(b.code)})`, deps };
      case "===":
      case "!==":
      case "==":
      case "!=": {
        const op = n.operator.startsWith("=") ? "==" : "!=";
        if (a.type === "string" || b.type === "string") {
          if (!a.code || !b.code) this.fail(n, module, "Only plain strings can be compared on the device");
          return boolExpr(`(strcmp(${a.code}, ${b.code}) ${op} 0)`, deps);
        }
        return boolExpr(`(${a.code} ${op} ${b.code})`, deps);
      }
      case "<":
      case ">":
      case "<=":
      case ">=":
        if (!isNumber(a) || !isNumber(b)) this.fail(n, module, `"${n.operator}" needs numbers`);
        return boolExpr(`(${a.code} ${n.operator} ${b.code})`, deps);
      default:
        this.fail(n, module, `The operator "${n.operator}" ${LATER}`);
    }
  }

  private call(n: t.CallExpression, scope: Scope, module: Module): Expr {
    const callee = unwrap(n.callee);

    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
      const method = callee.property.name;
      if (callee.object.type === "Identifier" && callee.object.name === "Math") return this.mathCall(method, n, scope, module);
      const list = this.listOf(callee.object, scope, module);
      if (list) return this.listExpr(list, method, n, scope, module);
      if (method === "toFixed") {
        const value = this.expr(callee.object, scope, module);
        const digits = n.arguments[0] ?? { type: "NumericLiteral", value: 0 };
        if (digits.type !== "NumericLiteral") this.fail(n, module, "toFixed needs a literal number of digits");
        return strExpr({ k: "float", code: value.code, decimals: digits.value }, value.deps);
      }
      if (method === "toString" && n.arguments.length === 0) {
        const value = this.expr(callee.object, scope, module);
        return strExpr(toStr(value), value.deps);
      }
    }

    if (callee.type === "Identifier" && callee.name === "String" && !lookup(scope, "String")) {
      const value = this.expr(n.arguments[0], scope, module);
      return strExpr(toStr(value), value.deps);
    }

    const resolved = this.resolveBinding(callee, scope, module);
    if (resolved?.binding.k === "signal") {
      return this.readSignal(resolved.binding.signal);
    }
    if (resolved?.binding.k === "func") {
      const { node: func, scope: funcScope, module: funcModule } = resolved.binding;
      const args: Binding[] = n.arguments.map((a) => ({ k: "lazy", node: a as t.Expression, scope, module }));
      return this.inlineValue(func, funcScope, args, funcModule, (value, inner) => this.expr(value, inner, funcModule));
    }
    this.fail(n, module, `This call ${LATER} in an expression`);
  }

  private mathCall(method: string, n: t.CallExpression, scope: Scope, module: Module): Expr {
    const args = n.arguments.map((a) => this.expr(a, scope, module));
    const deps = union(...args);
    const [a, b] = args;
    switch (method) {
      case "round":
        if (a.type === "int") return a;
        return { type: "int", code: `(int32_t)floorf(${a.code} + 0.5f)`, deps };
      case "floor":
        return a.type === "int" ? a : { type: "int", code: `(int32_t)floorf(${a.code})`, deps };
      case "ceil":
        return a.type === "int" ? a : { type: "int", code: `(int32_t)ceilf(${a.code})`, deps };
      case "trunc":
        return a.type === "int" ? a : { type: "int", code: `(int32_t)${wrap(a.code)}`, deps };
      case "abs":
        return a.type === "int" ? { type: "int", code: `LV_ABS(${a.code})`, deps } : { type: "float", code: `fabsf(${a.code})`, deps };
      case "min":
      case "max": {
        if (args.length !== 2) this.fail(n, module, `Math.${method} needs exactly two arguments on the device`);
        const type: Base = a.type === "float" || b.type === "float" ? "float" : "int";
        return { type, code: `LV_${method.toUpperCase()}(${a.code}, ${b.code})`, deps };
      }
      default:
        this.fail(n, module, `Math.${method} ${LATER}`);
    }
  }

  // ---------- Statements (event handlers) ----------

  // ---------- Compile-time evaluation ----------

  /** Evaluates an expression now, if nothing in it depends on runtime state. */
  private tryConst(node: t.Node, scope: Scope, module: Module): { value: ConstValue } | undefined {
    try {
      return { value: this.ce(node, scope, module) };
    } catch (err) {
      if (err instanceof NotConstant) return undefined;
      throw err;
    }
  }

  /**
   * Like tryConst, but also handles a value picked from a constant table by a
   * signal, like `RECIPES[recipeIndex()].name`: it's evaluated once per row.
   */
  private evalSplit(node: t.Node, scope: Scope, module: Module): Folded | undefined {
    try {
      return { k: "const", value: this.ce(node, scope, module) };
    } catch (err) {
      if (!(err instanceof NotConstant)) throw err;
      if (!err.split) return undefined;
      const { signal, size } = err.split;
      const values: ConstValue[] = [];
      for (let i = 0; i < size; i++) {
        this.overrides.set(signal, i);
        try {
          values.push(this.ce(node, scope, module));
        } catch (inner) {
          if (inner instanceof NotConstant) return undefined;
          throw inner;
        } finally {
          this.overrides.delete(signal);
        }
      }
      return { k: "split", signal, values };
    }
  }

  private bindingValue(b: Binding): ConstValue {
    switch (b.k) {
      case "const":
        return b.value;
      case "lazy": {
        if (b.hasCached) return b.cached;
        const previous = this.signalHint;
        this.signalHint = b.name ?? previous;
        try {
          const value = this.ce(b.node, b.scope, b.module);
          // A value computed for one row of a table isn't the value in general.
          if (this.overrides.size === 0) {
            b.cached = value;
            b.hasCached = true;
          }
          return value;
        } finally {
          this.signalHint = previous;
        }
      }
      case "value":
      case "unsupported":
        throw new NotConstant();
      default:
        return new Opaque(b);
    }
  }

  /** The signal this expression reads, if reading one is all it does. */
  private directSignal(node: t.Node, scope: Scope, module: Module): Signal | undefined {
    const n = unwrap(node);
    if (n.type === "MemberExpression") {
      const resolved = this.resolveBinding(n, scope, module);
      return resolved?.binding.k === "signal" ? resolved.binding.signal : undefined;
    }
    if (n.type !== "CallExpression" || n.arguments.length) return undefined;
    const callee = unwrap(n.callee);
    if (callee.type !== "Identifier") return undefined;
    const b = lookup(scope, callee.name);
    return b?.k === "signal" ? b.signal : undefined;
  }

  private ce(node: t.Node, scope: Scope, module: Module): ConstValue {
    const n = unwrap(node);
    switch (n.type) {
      case "NumericLiteral":
      case "StringLiteral":
      case "BooleanLiteral":
        return n.value;
      case "NullLiteral":
        return null;
      case "TemplateLiteral":
        return n.quasis.map((q, i) => (q.value.cooked ?? "") + (n.expressions[i] ? String(this.ce(n.expressions[i], scope, module)) : "")).join("");
      case "Identifier": {
        if (n.name === "undefined") return undefined;
        const b = lookup(scope, n.name);
        if (!b) throw new NotConstant();
        return this.bindingValue(b);
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression":
        return new Opaque({ k: "func", node: n, scope, module });
      case "ArrayExpression":
        return n.elements.flatMap((e) => {
          if (!e) return [undefined];
          if (e.type === "SpreadElement") return this.ce(e.argument, scope, module) as ConstValue[];
          return [this.ce(e, scope, module)];
        });
      case "ObjectExpression": {
        const out: Record<string, ConstValue> = {};
        for (const p of n.properties) {
          if (p.type !== "ObjectProperty" || p.computed || (p.key.type !== "Identifier" && p.key.type !== "StringLiteral")) throw new NotConstant();
          out[p.key.type === "Identifier" ? p.key.name : p.key.value] = this.ce(p.value, scope, module);
        }
        return out;
      }
      case "MemberExpression":
        return this.ceMember(n, scope, module);
      case "UnaryExpression": {
        const v = this.ce(n.argument, scope, module);
        switch (n.operator) {
          case "!": return !v;
          case "-": return -(v as number);
          case "+": return +(v as number);
          default: throw new NotConstant();
        }
      }
      case "ConditionalExpression":
        return this.ce(n.test, scope, module) ? this.ce(n.consequent, scope, module) : this.ce(n.alternate, scope, module);
      case "LogicalExpression": {
        const left = this.ce(n.left, scope, module);
        if (n.operator === "&&") return left ? this.ce(n.right, scope, module) : left;
        if (n.operator === "||") return left ? left : this.ce(n.right, scope, module);
        return left ?? this.ce(n.right, scope, module);
      }
      case "BinaryExpression": {
        const a = this.ce(n.left, scope, module) as number;
        const b = this.ce(n.right, scope, module) as number;
        switch (n.operator) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return a / b;
          case "%": return a % b;
          case "<": return a < b;
          case ">": return a > b;
          case "<=": return a <= b;
          case ">=": return a >= b;
          case "===":
          case "==": return a === b;
          case "!==":
          case "!=": return a !== b;
          default: throw new NotConstant();
        }
      }
      case "CallExpression":
        return this.ceCall(n, scope, module);
      default:
        throw new NotConstant();
    }
  }

  private ceMember(n: t.MemberExpression, scope: Scope, module: Module): ConstValue {
    if (n.object.type === "Identifier" && n.object.name === "Math" && !lookup(scope, "Math")) {
      if (n.property.type === "Identifier" && n.property.name === "PI") return Math.PI;
      throw new NotConstant();
    }
    const object = this.ce(n.object, scope, module);

    if (!n.computed && n.property.type === "Identifier") {
      const name = n.property.name;
      if (object instanceof Opaque) {
        if (object.binding.k !== "props" || name === "children") throw new NotConstant();
        const prop = object.binding.props.get(name);
        return prop ? this.bindingValue(prop) : undefined;
      }
      if (object === null || object === undefined) throw new NotConstant();
      return (object as unknown as Record<string, ConstValue>)[name];
    }

    let key: ConstValue;
    const override = this.indexOverrides.get(n.property);
    if (override !== undefined) key = override;
    else {
      const signal = this.directSignal(n.property, scope, module);
      if (signal) {
        const row = this.overrides.get(signal);
        if (row === undefined) throw new NotConstant(Array.isArray(object) ? { signal, size: object.length } : undefined);
        key = row;
      } else key = this.ce(n.property, scope, module);
    }
    if (object === null || object === undefined || object instanceof Opaque) throw new NotConstant();
    return (object as unknown as Record<string, ConstValue>)[key as string];
  }

  private ceCall(n: t.CallExpression, scope: Scope, module: Module): ConstValue {
    const callee = unwrap(n.callee);
    const args = () =>
      n.arguments.flatMap((a) => {
        if (a.type === "SpreadElement") return this.ce(a.argument, scope, module) as ConstValue[];
        return [this.ce(a, scope, module)];
      });

    if (callee.type === "Identifier") {
      const b = lookup(scope, callee.name);
      if (!b) {
        if (callee.name === "String") return String(args()[0]);
        if (callee.name === "Number") return Number(args()[0]);
        throw new NotConstant();
      }
      if (b.k === "rippel") {
        if (b.name === "createList") return new Opaque({ k: "list", list: this.createList(this.signalHint ?? "list", n, scope, module) });
        if (b.name === "createSignal") {
          const signal = this.createLocalSignal(this.signalHint ?? "signal", n, scope, module);
          return [new Opaque({ k: "signal", signal }), new Opaque({ k: "setter", signal })];
        }
        throw new NotConstant();
      }
    }

    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
      const method = callee.property.name;
      if (callee.object.type === "Identifier" && !lookup(scope, callee.object.name)) {
        if (callee.object.name === "Math") {
          const fn = (Math as unknown as Record<string, ((...v: number[]) => number) | undefined>)[method];
          if (!fn) throw new NotConstant();
          return fn(...(args() as number[]));
        }
        if (callee.object.name === "Array" && method === "from") {
          const [spec, fn] = args();
          const length = (spec as { length: number }).length;
          return Array.from({ length }, (_, i) => (fn ? this.invoke(fn, [undefined, i]) : undefined));
        }
        throw new NotConstant();
      }
      const object = this.ce(callee.object, scope, module);
      if (Array.isArray(object)) {
        const [first] = args();
        switch (method) {
          case "map": return object.map((v, i) => this.invoke(first, [v, i]));
          case "filter": return object.filter((v, i) => this.invoke(first, [v, i]));
          case "indexOf": return object.indexOf(first);
          case "includes": return object.includes(first);
          default: throw new NotConstant();
        }
      }
      if (typeof object === "number" && method === "toFixed") return object.toFixed(args()[0] as number);
      if ((typeof object === "number" || typeof object === "string") && method === "toString") return String(object);
    }

    return this.invoke(this.ce(callee, scope, module), args());
  }

  private invoke(fn: ConstValue, args: ConstValue[]): ConstValue {
    if (!(fn instanceof Opaque)) throw new NotConstant();
    const b = fn.binding;
    if (b.k === "getter") return b.value;
    if (b.k === "signal") {
      const row = this.overrides.get(b.signal);
      if (row === undefined) throw new NotConstant();
      return row;
    }
    if (b.k !== "func") throw new NotConstant();

    const inner = this.bindParams(b.node, args.map((value) => ({ k: "const", value })), b.scope, b.module);
    if (b.node.body.type !== "BlockStatement") return this.ce(b.node.body, inner, b.module);
    const result = this.ceBlock(b.node.body.body, inner, b.module);
    return result?.value;
  }

  private ceBlock(statements: t.Statement[], parent: Scope, module: Module): { value: ConstValue } | undefined {
    const scope = newScope(parent);
    for (const s of statements) {
      const result = this.ceStatement(s, scope, module);
      if (result) return result;
    }
    return undefined;
  }

  private ceStatement(s: t.Statement, scope: Scope, module: Module): { value: ConstValue } | undefined {
    switch (s.type) {
      case "ReturnStatement":
        return { value: s.argument ? this.ce(s.argument, scope, module) : undefined };
      case "BlockStatement":
        return this.ceBlock(s.body, scope, module);
      case "IfStatement":
        if (this.ce(s.test, scope, module)) return this.ceStatement(s.consequent, scope, module);
        return s.alternate ? this.ceStatement(s.alternate, scope, module) : undefined;
      case "VariableDeclaration":
        if (s.kind !== "const") throw new NotConstant();
        for (const decl of s.declarations) {
          if (decl.id.type !== "Identifier" || !decl.init) throw new NotConstant();
          scope.set(decl.id.name, { k: "const", value: this.ce(decl.init, scope, module) });
        }
        return undefined;
      case "ForOfStatement": {
        const items = this.ce(s.right, scope, module);
        if (!Array.isArray(items) || s.left.type !== "VariableDeclaration") throw new NotConstant();
        const id = s.left.declarations[0].id;
        if (id.type !== "Identifier") throw new NotConstant();
        for (const item of items) {
          const inner = newScope(scope);
          inner.set(id.name, { k: "const", value: item });
          const result = this.ceStatement(s.body, inner, module);
          if (result) return result;
        }
        return undefined;
      }
      default:
        throw new NotConstant();
    }
  }

  /** Turns a compile-time value into a C expression. */
  private constExpr(value: ConstValue, node: t.Node, module: Module): Expr {
    switch (typeof value) {
      case "number":
        return Number.isInteger(value) ? intLit(value) : { type: "float", code: floatLiteral(value), deps: noDeps() };
      case "boolean":
        return boolExpr(value ? "true" : "false", noDeps());
      case "string":
        return strExpr({ k: "lit", v: value }, noDeps());
      default:
        this.fail(node, module, "This value can't be used in the device build");
    }
  }

  private lookupTable(ctype: string, items: string[]): string {
    const key = `${ctype}:${items.join(",")}`;
    let found = this.program.tables.find((x) => x.key === key);
    if (!found) {
      found = { key, name: `lut_${this.program.tables.length}`, ctype, values: items };
      this.program.tables.push(found);
    }
    return found.name;
  }

  private imageSymbol(value: ConstValue): string | undefined {
    if (typeof value !== "object" || value === null || value instanceof Opaque || Array.isArray(value)) return undefined;
    const file = value.__image;
    if (typeof file !== "string") return undefined;
    let symbol = this.program.images.get(file);
    if (!symbol) {
      const base = `rp_img_${basename(file, extname(file)).replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}`;
      symbol = this.unique(base);
      this.program.images.set(file, symbol);
    }
    return symbol;
  }

  /** A C expression for an <image src>: one image, or one picked at runtime. */
  private imageSource(node: t.Node, scope: Scope, module: Module): { code: string; deps: Set<Signal> } {
    const n = unwrap(node);
    const folded = this.evalSplit(n, scope, module);
    if (folded?.k === "const") {
      const symbol = this.imageSymbol(folded.value);
      if (symbol) return { code: `&${symbol}`, deps: noDeps() };
    }
    if (folded?.k === "split") {
      const symbols = folded.values.map((v) => this.imageSymbol(v));
      if (symbols.every(Boolean)) {
        this.collect?.add(folded.signal);
        const table = this.lookupTable("void * const", symbols.map((s) => `&${s}`));
        return { code: `${table}[${sigRef(folded.signal)}]`, deps: new Set([folded.signal]) };
      }
    }
    if (n.type === "ConditionalExpression") {
      const c = this.expr(n.test, scope, module);
      const a = this.imageSource(n.consequent, scope, module);
      const b = this.imageSource(n.alternate, scope, module);
      return { code: `(${this.truthy(c, n.test, module)} ? ${a.code} : ${b.code})`, deps: new Set([...c.deps, ...a.deps, ...b.deps]) };
    }
    this.fail(n, module, "`src` must be an imported .png file");
  }

  /** A value picked from a constant table by a signal becomes a lookup table in C. */
  private splitExpr(folded: Extract<Folded, { k: "split" }>, node: t.Node, module: Module): Expr {
    const { signal, values } = folded;
    this.collect?.add(signal);
    const deps = new Set([signal]);
    const index = sigRef(signal);
    const table = (ctype: string, items: string[]) => `${this.lookupTable(ctype, items)}[${index}]`;

    if (values.every((v) => typeof v === "string")) {
      const strings = values as string[];
      return strExpr({ k: "ptr", code: table("char * const", strings.map(cString)), max: Math.max(...strings.map(utf8Length)) }, deps);
    }
    if (values.every((v) => typeof v === "boolean")) {
      return boolExpr(table("bool", values.map((v) => (v ? "true" : "false"))), deps);
    }
    if (values.every((v) => typeof v === "number")) {
      const numbers = values as number[];
      if (numbers.every(Number.isInteger)) return { type: "int", code: table("int32_t", numbers.map(String)), deps };
      return { type: "float", code: table("float", numbers.map(floatLiteral)), deps };
    }
    this.fail(node, module, "Only numbers, strings and booleans can be read from a table by a signal");
  }

  // ---------- Runtime lists ----------

  /** The list an expression refers to, if any. */
  private listOf(node: t.Node, scope: Scope, module: Module): ListInfo | undefined {
    const value = this.tryConst(node, scope, module);
    return value?.value instanceof Opaque && value.value.binding.k === "list" ? value.value.binding.list : undefined;
  }

  private contractType(node: t.Node, module: Module): ValueInfo {
    const n = unwrap(node);
    if (n.type === "Identifier" && CONTRACT_TYPES[n.name]) return CONTRACT_TYPES[n.name];
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "str") {
      const size = n.arguments[0];
      if (size?.type === "NumericLiteral") return { base: "string", ctype: "char", maxLength: size.value };
    }
    this.fail(n, module, "Expected a contract type like u8, f32, bool or str(32)");
  }

  private fieldLiteral(value: ValueInfo, v: ConstValue): string {
    switch (value.base) {
      case "bool": return v ? "true" : "false";
      case "string": return cString(String(v ?? ""));
      case "float": return floatLiteral(Number(v ?? 0));
      default: return String(Math.trunc(Number(v ?? 0)));
    }
  }

  /** Reserves storage for a list, with one set of signals per slot, and generates its `add`. */
  private createList(hint: string, n: t.CallExpression, scope: Scope, module: Module): ListInfo {
    const options = n.arguments[0] && unwrap(n.arguments[0]);
    if (options?.type !== "ObjectExpression") this.fail(n, module, "createList takes `{ capacity, fields, initial }`");
    const option = (key: string) => {
      for (const p of options.properties) {
        if (p.type === "ObjectProperty" && p.key.type === "Identifier" && p.key.name === key) return p.value;
      }
      return undefined;
    };

    const capacityNode = option("capacity");
    const capacity = capacityNode && this.tryConst(capacityNode, scope, module)?.value;
    if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1) this.fail(n, module, "createList needs a constant whole-number `capacity`");

    let fieldsNode = option("fields") && unwrap(option("fields") as t.Node);
    if (fieldsNode?.type === "Identifier") {
      const b = lookup(scope, fieldsNode.name);
      if (b?.k === "lazy") fieldsNode = unwrap(b.node);
    }
    if (fieldsNode?.type !== "ObjectExpression") this.fail(n, module, "createList needs `fields`, an object of contract types like `{ rating: u8 }`");

    const fields = new Map<string, { c: string; value: ValueInfo }>();
    for (const p of fieldsNode.properties) {
      if (p.type !== "ObjectProperty" || p.key.type !== "Identifier") this.fail(p, module, "Expected `name: type`");
      if (p.key.name === "id" || p.key.name === "used") this.fail(p, module, `"${p.key.name}" is reserved in a list item`);
      fields.set(p.key.name, { c: snake(p.key.name), value: this.contractType(p.value, module) });
    }

    const initialNode = option("initial");
    const known = initialNode ? this.tryConst(initialNode, scope, module) : { value: [] as ConstValue[] };
    if (!known || !Array.isArray(known.value)) this.fail(initialNode ?? n, module, "`initial` must be a constant list");
    const initial = known.value as Record<string, ConstValue>[];
    if (initial.length > capacity) this.fail(initialNode ?? n, module, `${initial.length} initial items don't fit a capacity of ${capacity}`);

    const name = this.unique(snake(hint));
    const storage = `list_${name}`;
    const makeSignal = (slot: number, field: string, c: string, value: ValueInfo, literal: string): Signal => {
      const signal: Signal = { name: `${name}_${slot}_${c}`, kind: "list", value, initial: literal, binds: [], code: `${storage}[${slot}].${c}` };
      this.program.signals.push(signal);
      void field;
      return signal;
    };

    const INT: ValueInfo = { base: "int", ctype: "int32_t" };
    const BOOL: ValueInfo = { base: "bool", ctype: "bool" };
    const slots: ListSlot[] = [];
    const rows: string[] = [];
    for (let slot = 0; slot < capacity; slot++) {
      const item = initial[slot];
      const signals = new Map<string, Signal>();
      const parts: string[] = [];
      for (const [field, info] of fields) {
        const literal = this.fieldLiteral(info.value, item?.[field]);
        signals.set(field, makeSignal(slot, field, info.c, info.value, literal));
        parts.push(`.${info.c} = ${literal}`);
      }
      const id = makeSignal(slot, "id", "id", INT, String(item ? slot + 1 : 0));
      const used = makeSignal(slot, "used", "used", BOOL, item ? "true" : "false");
      slots.push({ fields: signals, id, used });
      if (item) rows.push(`[${slot}] = { ${parts.join(", ")}, .id = ${slot + 1}, .used = true }`);
    }

    const size: Signal = { name: this.unique(`${name}_size`), kind: "local", value: INT, initial: String(initial.length), binds: [] };
    this.program.signals.push(size);

    const declare = (info: { c: string; value: ValueInfo }) =>
      info.value.base === "string" ? `char ${info.c}[${(info.value.maxLength ?? 0) + 1}];` : `${info.value.ctype} ${info.c};`;
    this.program.lists.push({ storage, capacity, fields: [...[...fields.values()].map(declare), "int32_t id;", "bool used;"], rows, nextId: initial.length + 1 });

    const list: ListInfo = { name, storage, capacity, fields, slots, size };
    this.emitListHelpers(list);
    return list;
  }

  private emitListHelpers(list: ListInfo) {
    const { name, storage, capacity, fields, slots, size } = list;
    const paramType = (v: ValueInfo) => (v.base === "string" ? "const char *" : v.ctype);
    const params = [...fields.values()].map((f) => `${paramType(f.value)} ${f.c}`).join(", ") || "void";

    this.program.functions.push({
      signature: `static void ${name}_refresh_size(void)`,
      body: [
        "int32_t count = 0;",
        `for(int32_t i = 0; i < ${capacity}; i++) {`,
        `if(${storage}[i].used) count++;`,
        "}",
        `set_${size.name}(count);`,
      ],
    });

    const cases: string[] = [];
    slots.forEach((slot, i) => {
      cases.push(`case ${i}:`);
      for (const [field, info] of fields) cases.push(`set_${slot.fields.get(field)!.name}(${info.c});`);
      cases.push(`set_${slot.id.name}(id);`, `set_${slot.used.name}(true);`, "break;");
    });
    this.program.functions.push({
      signature: `static void ${name}_add(${params})`,
      body: [
        `static int32_t next_id = ${this.program.lists[this.program.lists.length - 1].nextId};`,
        "int32_t slot = -1;",
        `for(int32_t i = 0; i < ${capacity} && slot < 0; i++) {`,
        `if(!${storage}[i].used) slot = i;`,
        "}",
        "if(slot < 0) {",
        "/* Full: the oldest item makes room. */",
        "slot = 0;",
        `for(int32_t i = 1; i < ${capacity}; i++) {`,
        `if(${storage}[i].id < ${storage}[slot].id) slot = i;`,
        "}",
        "}",
        "const int32_t id = next_id++;",
        "switch(slot) {",
        ...cases,
        "default:",
        "break;",
        "}",
        `${name}_refresh_size();`,
      ],
    });
  }

  private itemSlot(node: t.Node, scope: Scope, module: Module): number {
    const resolved = this.resolveBinding(node, scope, module);
    if (resolved?.binding.k !== "listItem") this.fail(node, module, "Expected an item of this list");
    return resolved.binding.slot;
  }

  /** `list.add`, `list.remove` and `list.update` in a handler. Returns false if this isn't one. */
  private listEffect(n: t.CallExpression, scope: Scope, module: Module, indent: string, out: string[]): boolean {
    const callee = unwrap(n.callee);
    if (callee.type !== "MemberExpression" || callee.computed || callee.property.type !== "Identifier") return false;
    const list = this.listOf(callee.object, scope, module);
    if (!list) return false;
    const method = callee.property.name;

    const numberOrString = (node: t.Node, value: ValueInfo): string => {
      const e = this.expr(node, scope, module);
      if (value.base === "string") {
        if (!e.code) this.fail(node, module, "List strings must be plain strings on the device");
        return e.code;
      }
      if (value.base === "bool") return this.truthy(e, node, module);
      return `(${value.ctype})${wrap(e.code)}`;
    };
    const objectArg = (node: t.Node | undefined): Map<string, t.Node> => {
      const shape = node && unwrap(node);
      if (shape?.type !== "ObjectExpression") this.fail(n, module, `list.${method} needs an object of field values`);
      const given = new Map<string, t.Node>();
      for (const p of shape.properties) {
        if (p.type !== "ObjectProperty" || p.key.type !== "Identifier") this.fail(p, module, `This kind of property ${LATER}`);
        given.set(p.key.name, p.value);
      }
      return given;
    };

    switch (method) {
      case "add": {
        const given = objectArg(n.arguments[0]);
        const args = [...list.fields].map(([field, info]) => {
          const node = given.get(field);
          if (!node) this.fail(n, module, `Missing field "${field}" for ${list.name}.add`);
          return numberOrString(node, info.value);
        });
        out.push(`${indent}${list.name}_add(${args.join(", ")});`);
        return true;
      }
      case "remove": {
        const slot = this.itemSlot(n.arguments[0], scope, module);
        out.push(`${indent}set_${list.slots[slot].used.name}(false);`, `${indent}${list.name}_refresh_size();`);
        return true;
      }
      case "update": {
        const slot = this.itemSlot(n.arguments[0], scope, module);
        for (const [field, node] of objectArg(n.arguments[1])) {
          const info = list.fields.get(field);
          if (!info) this.fail(node, module, `${list.name} has no field "${field}"`);
          out.push(`${indent}set_${list.slots[slot].fields.get(field)!.name}(${numberOrString(node, info.value)});`);
        }
        return true;
      }
      default:
        this.fail(n, module, `list.${method}() can't be called from a handler`);
    }
  }

  /** Signals a computation over the whole list depends on. */
  private listDeps(list: ListInfo, reads: Set<string>, collected: Set<Signal>): Set<Signal> {
    const deps = new Set<Signal>(collected);
    for (const slot of list.slots) {
      deps.add(slot.used);
      deps.add(slot.id);
      for (const field of reads) {
        const signal = slot.fields.get(field);
        if (signal) deps.add(signal);
      }
    }
    return deps;
  }

  /** Compiles a callback that reads list items by index, tracking what it reads. */
  private listCallback(
    func: FuncNode,
    list: ListInfo,
    indexes: string[],
    scope: Scope,
    module: Module,
  ): { e: Expr; reads: Set<string>; collected: Set<Signal> } {
    const reads = new Set<string>();
    const collected = new Set<Signal>();
    const previous = this.collect;
    this.collect = collected;
    const inner = this.bindParams(func, indexes.map((index) => ({ k: "listItemAt", list, index, reads })), scope, module);
    const { value, statements } = this.returned(func, module);
    for (const statement of statements) this.declare(statement, inner, module);
    const e = this.expr(value, inner, module);
    this.collect = previous;
    return { e, reads, collected };
  }

  /** `list.size()` and `list.sum(fn)` in an expression. */
  private listExpr(list: ListInfo, method: string, n: t.CallExpression, scope: Scope, module: Module): Expr {
    if (method === "size") return this.readSignal(list.size);
    if (method !== "sum") this.fail(n, module, `list.${method}() can't be used as a value here`);

    const arg = n.arguments[0] && unwrap(n.arguments[0]);
    if (!arg || !isFunc(arg)) this.fail(n, module, "list.sum needs a function");
    const { e, reads, collected } = this.listCallback(arg, list, ["i"], scope, module);
    if (e.type === "string" || e.type === "bool") this.fail(arg, module, "list.sum needs a function that returns a number");

    const name = `sum_${this.program.functions.length}`;
    this.program.functions.push({
      signature: `static float ${name}(void)`,
      body: [
        "float total = 0;",
        `for(int32_t i = 0; i < ${list.capacity}; i++) {`,
        `if(${list.storage}[i].used) total += ${e.code};`,
        "}",
        "return total;",
      ],
    });
    const deps = this.listDeps(list, reads, collected);
    for (const d of deps) this.collect?.add(d);
    return { type: "float", code: `${name}()`, deps };
  }

  /** Works out which list and order a <For each={...}> shows. */
  private listView(node: t.Node, scope: Scope, module: Module): ListView | undefined {
    const n = unwrap(node);
    if (n.type !== "CallExpression") return undefined;
    const callee = unwrap(n.callee);
    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
      const list = this.listOf(callee.object, scope, module);
      if (list) {
        if (callee.property.name === "items") return { list, scope, module };
        if (callee.property.name !== "sorted") return undefined;
        const arg = n.arguments[0] && unwrap(n.arguments[0]);
        if (!arg || !isFunc(arg)) this.fail(n, module, "list.sorted needs a function");
        return { list, compare: arg, scope, module };
      }
    }
    const resolved = this.resolveBinding(callee, scope, module);
    if (resolved?.binding.k !== "func") return undefined;
    const { node: func, scope: funcScope, module: funcModule } = resolved.binding;
    const inner = this.bindParams(func, n.arguments.map((a) => ({ k: "lazy", node: a as t.Expression, scope, module })), funcScope, funcModule);
    const { value, statements } = this.returned(func, funcModule);
    for (const statement of statements) this.declare(statement, inner, funcModule);
    return this.listView(value, inner, funcModule);
  }

  /** One prebuilt row per slot, shown while the slot is in use and moved to keep the list in order. */
  private runtimeFor(view: ListView, func: Extract<Binding, { k: "func" }>, el: t.JSXElement, place: Place, module: Module) {
    const { list } = view;
    if (func.node.params.length > 1) this.fail(el, module, `The index argument ${LATER} on a list that changes at runtime`);

    const rows: Obj[] = [];
    list.slots.forEach((slot, i) => {
      const roots: Obj[] = [];
      this.branches(
        [
          {
            test: this.readSignal(slot.used),
            body: (p) => {
              this.instance++;
              const inner = this.bindParams(func.node, [{ k: "listItem", list, slot: i }], func.scope, func.module);
              const { value, statements } = this.returned(func.node, func.module);
              for (const statement of statements) this.declare(statement, inner, func.module, p);
              this.child(value, inner, func.module, p);
            },
          },
        ],
        { ...place, roots },
        el,
        module,
      );
      if (roots.length !== 1) this.fail(el, module, "Each row of a list that changes at runtime must be a single element");
      rows.push(roots[0]);
    });
    place.roots?.push(...rows);

    const id = this.program.functions.length;
    const compareName = `compare_${id}`;
    let reads = new Set<string>();
    let collected = new Set<Signal>();
    let compareBody = ["LV_UNUSED(ia);", "LV_UNUSED(ib);", "return 0;"];
    if (view.compare) {
      const compiled = this.listCallback(view.compare, list, ["ia", "ib"], view.scope, view.module);
      if (compiled.e.type === "string" || compiled.e.type === "bool") this.fail(view.compare, view.module, "A sort function must return a number");
      ({ reads, collected } = compiled);
      compareBody = [`const ${compiled.e.type === "float" ? "float" : "int32_t"} order = ${compiled.e.code};`, "return order < 0 ? -1 : order > 0 ? 1 : 0;"];
    }
    this.program.functions.push({ signature: `static int32_t ${compareName}(int32_t ia, int32_t ib)`, body: compareBody });

    const rowsName = `view_${id}_rows`;
    const baseName = `view_${id}_base`;
    this.program.declarations.push(`static lv_obj_t * ${rowsName}[${list.capacity}];`, `static int32_t ${baseName};`);
    rows.forEach((row, i) => this.line(`${rowsName}[${i}] = ${row.name};`));
    this.line(`${baseName} = lv_obj_get_index(${rowsName}[0]);`);

    const { storage, capacity } = list;
    this.bind("view", this.listDeps(list, reads, collected), undefined, [
      `int32_t order[${capacity}];`,
      "int32_t count = 0;",
      `for(int32_t i = 0; i < ${capacity}; i++) {`,
      `if(${storage}[i].used) order[count++] = i;`,
      "}",
      "/* A stable insertion sort: equal items stay oldest first, as in JS. */",
      "for(int32_t i = 1; i < count; i++) {",
      "const int32_t item = order[i];",
      "int32_t j = i - 1;",
      "while(j >= 0) {",
      `const int32_t c = ${compareName}(order[j], item);`,
      `if(c < 0 || (c == 0 && ${storage}[order[j]].id < ${storage}[item].id)) break;`,
      "order[j + 1] = order[j];",
      "j--;",
      "}",
      "order[j + 1] = item;",
      "}",
      `static int32_t shown[${capacity}];`,
      "static int32_t shown_count = -1;",
      "if(count == shown_count && memcmp(order, shown, sizeof(int32_t) * (size_t)count) == 0) return;",
      "shown_count = count;",
      `memcpy(shown, order, sizeof(order));`,
      "for(int32_t k = 0; k < count; k++) {",
      `lv_obj_move_to_index(${rowsName}[order[k]], ${baseName} + k);`,
      "}",
    ]);
  }

  private readSignal(signal: Signal): Expr {
    this.collect?.add(signal);
    const deps = new Set([signal]);
    const code = sigRef(signal);
    if (signal.value.base === "string") return strExpr({ k: "ptr", code, max: signal.value.maxLength ?? 0 }, deps);
    return { type: signal.value.base, code, deps, unsigned: signal.value.unsigned };
  }

  private statements(list: t.Statement[], scope: Scope, module: Module, indent: string, out: string[]) {
    const inner = newScope(scope);
    for (const statement of list) this.statement(statement, inner, module, indent, out);
  }

  private statement(s: t.Statement, scope: Scope, module: Module, indent: string, out: string[]) {
    switch (s.type) {
      case "ExpressionStatement":
        this.effect(s.expression, scope, module, indent, out);
        return;
      case "BlockStatement":
        this.statements(s.body, scope, module, indent, out);
        return;
      case "IfStatement": {
        const c = this.expr(s.test, scope, module);
        out.push(`${indent}if(${this.truthy(c, s.test, module)}) {`);
        this.statement(s.consequent, scope, module, indent + "    ", out);
        out.push(`${indent}}`);
        if (s.alternate) {
          out.push(`${indent}else {`);
          this.statement(s.alternate, scope, module, indent + "    ", out);
          out.push(`${indent}}`);
        }
        return;
      }
      case "VariableDeclaration": {
        for (const decl of s.declarations) {
          const init = decl.init && unwrap(decl.init);
          if (decl.id.type !== "Identifier" || !init || s.kind !== "const") this.fail(decl, module, "Only `const name = value` is supported in handlers");
          if (isFunc(init)) {
            scope.set(decl.id.name, { k: "func", node: init, scope, module });
            continue;
          }
          const known = this.tryConst(init, scope, module);
          if (known && typeof known.value === "object") {
            scope.set(decl.id.name, { k: "const", value: known.value });
            continue;
          }
          const value = this.expr(init, scope, module);
          if (value.type === "string") this.fail(decl, module, `String locals in handlers ${LATER_MANY}`);
          const name = `local_${snake(decl.id.name)}_${this.counter++}`;
          const ctype = value.type === "bool" ? "bool" : value.type === "float" ? "float" : "int32_t";
          out.push(`${indent}const ${ctype} ${name} = ${value.code};`);
          scope.set(decl.id.name, { k: "value", expr: { type: value.type, code: name, deps: noDeps() } });
        }
        return;
      }
      case "ReturnStatement":
        if (s.argument) this.fail(s, module, "Event handlers can't return a value");
        // A function inlined into a handler can't end the handler early.
        if (this.inlineDepth > 1) this.fail(s, module, `An early return in a function called from a handler ${LATER}`);
        out.push(`${indent}return;`);
        return;
      case "ForOfStatement": {
        const items = this.tryConst(s.right, scope, module);
        if (!items || !Array.isArray(items.value) || s.left.type !== "VariableDeclaration") {
          this.fail(s, module, `A for loop over a list that changes at runtime ${LATER}`);
        }
        const id = s.left.declarations[0].id;
        for (const item of items.value) {
          const inner = newScope(scope);
          if (id.type === "Identifier") inner.set(id.name, { k: "const", value: item });
          else if (id.type === "ArrayPattern") {
            id.elements.forEach((element, i) => {
              if (element?.type === "Identifier") inner.set(element.name, { k: "const", value: (item as ConstValue[])[i] });
            });
          } else this.fail(id, module, `This kind of loop variable ${LATER}`);
          this.statement(s.body, inner, module, indent, out);
        }
        return;
      }
      default:
        this.fail(s, module, `This statement (${s.type}) ${LATER} in a handler`);
    }
  }

  /** An expression evaluated for what it does: setting a signal, calling an action. */
  private effect(node: t.Node, scope: Scope, module: Module, indent: string, out: string[]) {
    const n = unwrap(node);
    if (n.type === "LogicalExpression" && n.operator === "&&") {
      const c = this.expr(n.left, scope, module);
      out.push(`${indent}if(${this.truthy(c, n.left, module)}) {`);
      this.effect(n.right, scope, module, indent + "    ", out);
      out.push(`${indent}}`);
      return;
    }
    if (n.type === "ConditionalExpression") {
      const c = this.expr(n.test, scope, module);
      out.push(`${indent}if(${this.truthy(c, n.test, module)}) {`);
      this.effect(n.consequent, scope, module, indent + "    ", out);
      out.push(`${indent}}`, `${indent}else {`);
      this.effect(n.alternate, scope, module, indent + "    ", out);
      out.push(`${indent}}`);
      return;
    }
    if (n.type !== "CallExpression") this.fail(n, module, "Handlers can only call functions, set signals and call actions");
    if (this.listEffect(n, scope, module, indent, out)) return;

    const dynamic = this.runtimeIndex(n.callee, scope, module);
    if (dynamic) {
      out.push(`${indent}switch(${this.expr(dynamic.node, scope, module).code}) {`);
      for (let i = 0; i < dynamic.size; i++) {
        this.indexOverrides.set(dynamic.node, i);
        out.push(`${indent}case ${i}:`);
        this.effect(n, scope, module, indent + "    ", out);
        out.push(`${indent}break;`);
        this.indexOverrides.delete(dynamic.node);
      }
      out.push(`${indent}}`);
      return;
    }

    const resolved = this.resolveBinding(n.callee, scope, module);
    if (!resolved) this.fail(n, module, `This call ${LATER} in a handler`);
    const { binding } = resolved;
    switch (binding.k) {
      case "setter":
        this.setterCall(binding.signal, n.arguments[0], scope, module, indent, out);
        return;
      case "action":
        this.actionCall(binding.action, n, scope, module, indent, out);
        return;
      case "func": {
        const args: Binding[] = n.arguments.map((a) => ({ k: "lazy", node: a as t.Expression, scope, module }));
        this.inlineHandler(binding, args, indent, out);
        return;
      }
      case "rippel": {
        const arg = n.arguments[0] && unwrap(n.arguments[0]);
        if (binding.name !== "batch" || !arg || !isFunc(arg)) this.fail(n, module, `${binding.name}() ${LATER} in a handler`);
        // Updates already reach the screen together: LVGL only draws after the handler returns.
        this.inlineHandler({ k: "func", node: arg, scope, module }, [], indent, out);
        return;
      }
      default:
        this.fail(n, module, "Only setters, actions and your own functions can be called from a handler");
    }
  }

  /** Finds an array index in a callee that's only known at runtime, like `setters[current()]`. */
  private runtimeIndex(node: t.Node, scope: Scope, module: Module): { node: t.Node; size: number } | undefined {
    let n = unwrap(node);
    while (n.type === "MemberExpression") {
      if (n.computed && !this.indexOverrides.has(n.property) && !this.tryConst(n.property, scope, module)) {
        const array = this.tryConst(n.object, scope, module);
        if (array && Array.isArray(array.value)) return { node: n.property, size: array.value.length };
      }
      n = unwrap(n.object);
    }
    return undefined;
  }

  private inlineHandler(func: Extract<Binding, { k: "func" }>, args: Binding[], indent: string, out: string[]) {
    const inner = this.bindParams(func.node, args, func.scope, func.module);
    this.inlineDepth++;
    if (func.node.body.type === "BlockStatement") this.statements(func.node.body.body, inner, func.module, indent, out);
    else this.effect(func.node.body, inner, func.module, indent, out);
    this.inlineDepth--;
  }

  /** `createEffect(fn)`: fn becomes a binding that re-runs when any signal it reads changes. */
  private effectStatement(expression: t.Expression, scope: Scope, module: Module) {
    const n = unwrap(expression);
    const helper = n.type === "CallExpression" && n.callee.type === "Identifier" ? lookup(scope, n.callee.name) : undefined;
    if (n.type !== "CallExpression" || helper?.k !== "rippel" || helper.name !== "createEffect") {
      this.fail(n, module, `This statement ${LATER} here`);
    }
    const arg = unwrap(n.arguments[0]);
    const func: Binding | undefined = isFunc(arg) ? { k: "func", node: arg, scope, module } : this.resolveBinding(arg, scope, module)?.binding;
    if (func?.k !== "func") this.fail(n, module, "createEffect needs a function");

    const body: string[] = [];
    const deps = new Set<Signal>();
    const previous = this.collect;
    this.collect = deps;
    this.inlineHandler(func, [], "", body);
    this.collect = previous;
    this.bind("effect", deps, undefined, body);
  }

  private setterCall(signal: Signal, arg: t.Node | undefined, scope: Scope, module: Module, indent: string, out: string[]) {
    if (!arg) this.fail(arg ?? ({} as t.Node), module, "A setter needs a value");
    if (isFunc(unwrap(arg))) this.fail(arg, module, `Passing a function to a setter ${LATER}. Read the signal instead.`);
    const value = this.expr(arg, scope, module);
    if (value.type === "float" && signal.value.base === "int" && signal.kind === "local") {
      this.onDemote((signal as Signal & { key: string }).key);
    }
    if (signal.value.base === "string") {
      if (value.type !== "string" || !value.code) this.fail(arg, module, "String signals can only be set to plain strings on the device");
    } else if (value.type === "string" || (value.type === "bool") !== (signal.value.base === "bool")) {
      this.fail(arg, module, `This value doesn't match the signal's type (${signal.value.base})`);
    }
    out.push(`${indent}set_${signal.name}(${value.code});`);
  }

  private actionCall(action: Action, n: t.CallExpression, scope: Scope, module: Module, indent: string, out: string[]) {
    const shape = n.arguments[0] && unwrap(n.arguments[0]);
    if (shape?.type !== "ObjectExpression") this.fail(n, module, "Call actions with an object of named arguments");
    const given = new Map<string, t.Node>();
    for (const p of shape.properties) {
      if (p.type === "ObjectProperty" && p.key.type === "Identifier") {
        given.set(snake(p.key.name), p.value);
      } else if (p.type === "ObjectMethod" || p.type === "SpreadElement" || p.type === "ObjectProperty") {
        this.fail(p, module, `This kind of property ${LATER}`);
      }
    }
    const args = action.params.map((param) => {
      const arg = given.get(param.name);
      if (!arg) this.fail(n, module, `Missing argument "${param.name}" for ${action.name}`);
      const value = this.expr(arg, scope, module);
      if (param.base === "string") {
        if (!value.code) this.fail(arg, module, "Action strings must be plain strings on the device");
        return value.code;
      }
      return `(${param.ctype})${wrap(value.code)}`;
    });
    out.push(`${indent}if(actions.${action.name}) actions.${action.name}(${args.join(", ")});`);
  }

  // ---------- JSX ----------

  private newObject(widget: Widget, base: string, place: Place): Obj {
    const name = this.unique(`o_${base.replace(/[^a-zA-Z0-9]/g, "_")}`);
    const obj: Obj = { name, isStatic: false };
    this.program.objects.push(obj);
    this.program.usedWidgets.add(widget);
    this.program.init.push({ op: "create", obj, widget, parent: place.parent });
    if (place.roots) place.roots.push(obj);
    return obj;
  }

  private line(text: string) {
    this.program.init.push({ op: "line", text });
  }

  /** Runs `body` now if nothing can change it, and whenever a dependency changes otherwise. */
  private bind(kind: string, deps: Set<Signal>, obj: Obj | undefined, body: string[]) {
    if (deps.size === 0) {
      this.line(body.length > 1 ? `{ ${body.join(" ")} }` : body[0]);
      return;
    }
    if (obj) obj.isStatic = true;
    const bind: Bind = { name: `bind_${this.program.binds.length}_${kind}`, body };
    this.program.binds.push(bind);
    for (const signal of deps) signal.binds.push(bind);
  }

  private inlineComponent(func: Extract<Binding, { k: "func" }>, props: Binding, caller: Module, place: Place) {
    void caller;
    this.instance++;
    const inner = this.bindParams(func.node, [props], func.scope, func.module);
    const { value, statements } = this.returned(func.node, func.module);
    for (const statement of statements) this.declare(statement, inner, func.module, place);
    this.child(value, inner, func.module, place);
  }

  /** True for `props.children` when the component was used with no children. */
  private isEmptyChildren(n: t.Node, scope: Scope, module: Module): boolean {
    if (n.type !== "MemberExpression" || n.computed || n.property.type !== "Identifier" || n.property.name !== "children") return false;
    const object = this.resolveBinding(n.object, scope, module);
    return object?.binding.k === "props" && !object.binding.children;
  }

  private isJsxLike(node: t.Node, scope: Scope, module: Module): boolean {
    const n = unwrap(node);
    switch (n.type) {
      case "JSXElement":
      case "JSXFragment":
        return true;
      case "ConditionalExpression":
        return this.isJsxLike(n.consequent, scope, module) || this.isJsxLike(n.alternate, scope, module);
      case "LogicalExpression":
        return this.isJsxLike(n.right, scope, module);
      case "MemberExpression":
      case "Identifier": {
        if (this.isEmptyChildren(n, scope, module)) return true;
        const resolved = this.resolveBinding(n, scope, module);
        if (resolved?.binding.k === "children") return true;
        if (resolved?.binding.k === "lazy") return this.isJsxLike(resolved.binding.node, resolved.binding.scope, resolved.binding.module);
        return false;
      }
      case "CallExpression": {
        const resolved = this.resolveBinding(n.callee, scope, module);
        if (resolved?.binding.k !== "func") return false;
        const { value } = this.returned(resolved.binding.node, resolved.binding.module);
        return this.isJsxLike(value, resolved.binding.scope, resolved.binding.module);
      }
      default:
        return false;
    }
  }

  private child(node: t.Node, scope: Scope, module: Module, place: Place) {
    const n = unwrap(node);
    switch (n.type) {
      case "JSXElement":
        this.element(n, scope, module, place);
        return;
      case "JSXFragment":
        this.children(n.children, scope, module, place);
        return;
      case "ConditionalExpression":
        this.branches(
          [
            { test: this.expr(n.test, scope, module), body: (p) => this.child(n.consequent, scope, module, p) },
            { test: undefined, body: (p) => this.child(n.alternate, scope, module, p) },
          ],
          place,
          n,
          module,
        );
        return;
      case "LogicalExpression":
        if (n.operator !== "&&") this.fail(n, module, `${n.operator} ${LATER} around JSX`);
        this.branches([{ test: this.expr(n.left, scope, module), body: (p) => this.child(n.right, scope, module, p) }], place, n, module);
        return;
      case "Identifier":
      case "MemberExpression": {
        if (this.isEmptyChildren(n, scope, module)) return;
        const resolved = this.resolveBinding(n, scope, module);
        if (resolved?.binding.k === "children") {
          this.children(resolved.binding.nodes, resolved.binding.scope, resolved.binding.module, place);
          return;
        }
        if (resolved?.binding.k === "lazy") {
          this.child(resolved.binding.node, resolved.binding.scope, resolved.binding.module, place);
          return;
        }
        this.fail(n, module, "Expected an element here");
        break;
      }
      case "CallExpression": {
        const resolved = this.resolveBinding(n.callee, scope, module);
        if (resolved?.binding.k !== "func") this.fail(n, module, "Expected an element here");
        const args: Binding[] = n.arguments.map((a) => ({ k: "lazy", node: a as t.Expression, scope, module }));
        const inner = this.bindParams(resolved.binding.node, args, resolved.binding.scope, resolved.binding.module);
        const { value, statements } = this.returned(resolved.binding.node, resolved.binding.module);
        for (const statement of statements) this.declare(statement, inner, resolved.binding.module, place);
        this.child(value, inner, resolved.binding.module, place);
        return;
      }
      default:
        this.fail(n, module, `This (${n.type}) can't be a child here`);
    }
  }

  private children(nodes: JsxChild[], scope: Scope, module: Module, place: Place) {
    for (const node of nodes) {
      if (node.type === "JSXText") {
        if (trimJsxText(node.value).trim()) this.fail(node, module, "Text can't go directly inside this element. Wrap it in a <label>.");
      } else if (node.type === "JSXExpressionContainer") {
        if (node.expression.type !== "JSXEmptyExpression") this.child(node.expression, scope, module, place);
      } else if (node.type === "JSXSpreadChild") {
        this.fail(node, module, `Spread children ${LATER_MANY}`);
      } else {
        this.child(node, scope, module, place);
      }
    }
  }

  /** <Show>, <Switch> and conditional JSX: builds every branch and shows the first that matches. */
  private branches(list: { test: Expr | undefined; body: (place: Place) => void }[], place: Place, node: t.Node, module: Module) {
    const chain: string[] = [];
    const deps = union(place.guard, ...list.map((b) => b.test));
    const roots: Obj[][] = [];
    const resets: Signal[][] = [];

    list.forEach((branch, index) => {
      const test = branch.test ? this.truthy(branch.test, node, module) : "true";
      const earlier = chain.map((c) => `!${wrap(c)}`);
      const conds = [...(place.guard ? [place.guard.code] : []), ...earlier, test];
      chain.push(test);
      const guard = boolExpr(conds.length > 1 ? `(${conds.join(" && ")})` : conds[0], deps);
      const branchRoots: Obj[] = [];
      const branchResets: Signal[] = [];
      branch.body({ parent: place.parent, guard, roots: branchRoots, resets: branchResets });
      roots.push(branchRoots);
      resets.push(branchResets);
      if (place.roots) place.roots.push(...branchRoots);
      place.resets?.push(...branchResets);
      void index;
    });

    let select = "-1";
    for (let i = list.length - 1; i >= 0; i--) select = `${wrap(chain[i])} ? ${i} : ${select}`;
    if (place.guard) select = `${wrap(place.guard.code)} ? (${select}) : -1`;

    const body = [`int32_t active = ${select};`];
    roots.forEach((branchRoots, i) => {
      for (const obj of branchRoots) {
        obj.isStatic = true;
        body.push(`lv_obj_set_hidden(${obj.name}, active != ${i});`);
      }
    });
    if (deps.size === 0) {
      this.line(`{ ${body.join(" ")} }`);
      return;
    }
    // The dev runtime rebuilds a branch when it reopens, so its local signals start over.
    if (resets.some((r) => r.length)) {
      body.push("static int32_t shown = -2;", "if(active != shown) {", "shown = active;", "switch(active) {");
      resets.forEach((signals, i) => {
        if (signals.length) body.push(`case ${i}:`, ...signals.map((s) => `set_${s.name}(${s.initial});`), "break;");
      });
      body.push("default:", "break;", "}", "}");
    }
    this.bind("branch", deps, undefined, body);
  }

  private attributes(el: t.JSXElement, module: Module) {
    const attrs: { name: string; value: t.Node | undefined; node: t.Node }[] = [];
    for (const attr of el.openingElement.attributes) {
      if (attr.type === "JSXSpreadAttribute") this.fail(attr, module, `Spread props ${LATER_MANY}`);
      if (attr.name.type !== "JSXIdentifier") this.fail(attr, module, `Namespaced props ${LATER_MANY}`);
      let value: t.Node | undefined;
      if (attr.value?.type === "JSXExpressionContainer") value = attr.value.expression;
      else if (attr.value) value = attr.value;
      attrs.push({ name: attr.name.name, value, node: attr });
    }
    return attrs;
  }

  private element(el: t.JSXElement, scope: Scope, module: Module, place: Place) {
    const nameNode = el.openingElement.name;
    if (nameNode.type !== "JSXIdentifier") this.fail(nameNode, module, `This element name ${LATER}`);
    const tag = nameNode.name;
    const widget = WIDGETS[tag];
    if (widget) {
      this.widget(el, widget, scope, module, place);
      return;
    }

    const binding = lookup(scope, tag);
    if (binding?.k === "rippel") {
      this.builtin(el, binding.name, scope, module, place);
      return;
    }
    if (binding?.k !== "func") this.fail(nameNode, module, `Unknown element <${tag}>`);

    const props = new Map<string, Binding>();
    for (const { name, value } of this.attributes(el, module)) {
      const node = (value ?? { type: "BooleanLiteral", value: true }) as t.Expression;
      if (node.type === "StringLiteral" || value === undefined) {
        props.set(name, { k: "lazy", node, scope, module });
      } else if (isFunc(unwrap(node))) {
        props.set(name, { k: "func", node: unwrap(node) as FuncNode, scope, module });
      } else {
        props.set(name, { k: "lazy", node, scope, module });
      }
    }
    const children: Binding | undefined = el.children.length ? { k: "children", nodes: el.children, scope, module } : undefined;
    this.inlineComponent(binding, { k: "props", props, children }, module, place);
  }

  private builtin(el: t.JSXElement, name: string, scope: Scope, module: Module, place: Place) {
    const attrs = this.attributes(el, module);
    const attr = (key: string) => attrs.find((a) => a.name === key)?.value;

    if (name === "Show") {
      const when = attr("when");
      if (!when) this.fail(el, module, "<Show> needs a `when` prop");
      const fallback = attr("fallback");
      const list: Parameters<Compiler["branches"]>[0] = [
        { test: this.expr(when, scope, module), body: (p) => this.children(el.children, scope, module, p) },
      ];
      if (fallback) list.push({ test: undefined, body: (p) => this.child(fallback, scope, module, p) });
      this.branches(list, place, el, module);
      return;
    }

    if (name === "Switch") {
      const list: Parameters<Compiler["branches"]>[0] = [];
      for (const child of el.children) {
        if (child.type === "JSXText" && !child.value.trim()) continue;
        const nameNode = child.type === "JSXElement" ? child.openingElement.name : undefined;
        const isMatch = nameNode?.type === "JSXIdentifier" && lookup(scope, nameNode.name)?.k === "rippel" && (lookup(scope, nameNode.name) as { name: string }).name === "Match";
        if (child.type !== "JSXElement" || !isMatch) this.fail(child, module, "<Switch> can only contain <Match> elements");
        const when = this.attributes(child, module).find((a) => a.name === "when")?.value;
        if (!when) this.fail(child, module, "<Match> needs a `when` prop");
        list.push({ test: this.expr(when, scope, module), body: (p) => this.children(child.children, scope, module, p) });
      }
      const fallback = attr("fallback");
      if (fallback) list.push({ test: undefined, body: (p) => this.child(fallback, scope, module, p) });
      this.branches(list, place, el, module);
      return;
    }

    if (name === "For" || name === "Index") {
      const each = attr("each");
      const items = each && this.tryConst(each, scope, module);
      const content = el.children.find((c) => c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression") as t.JSXExpressionContainer | undefined;
      const fn = content && unwrap(content.expression);
      const func: Binding | undefined = fn && (isFunc(fn) ? { k: "func", node: fn, scope, module } : this.resolveBinding(fn, scope, module)?.binding);
      if (func?.k !== "func") this.fail(el, module, `<${name}> needs a function as its child`);

      if (!items || !Array.isArray(items.value)) {
        const view = name === "For" && each ? this.listView(each, scope, module) : undefined;
        if (!view) this.fail(el, module, `<${name}> needs a constant list, or the items of a list made with createList.`);
        this.runtimeFor(view, func, el, place, module);
        return;
      }

      items.value.forEach((item, i) => {
        this.instance++;
        const args: Binding[] =
          name === "For"
            ? [{ k: "const", value: item }, { k: "getter", value: i }]
            : [{ k: "getter", value: item }, { k: "const", value: i }];
        const inner = this.bindParams(func.node, args, func.scope, func.module);
        const { value, statements } = this.returned(func.node, func.module);
        for (const statement of statements) this.declare(statement, inner, func.module, place);
        this.child(value, inner, func.module, place);
      });
      return;
    }

    this.fail(el, module, `<${name}> ${LATER}. It's planned for M3.`);
  }

  private widget(el: t.JSXElement, widget: Widget, scope: Scope, module: Module, place: Place) {
    const attrs = this.attributes(el, module);
    const classAttr = attrs.find((a) => a.name === "class");
    const firstClass = classAttr?.value?.type === "StringLiteral" ? classAttr.value.value.trim().split(/\s+/)[0] : undefined;
    const obj = this.newObject(widget, firstClass ?? widget, place);
    const childPlace: Place = { parent: obj, guard: place.guard, roots: undefined, resets: place.resets };

    const range = { min: undefined as Expr | undefined, max: undefined as Expr | undefined };
    let rangeEmitted = false;
    const ranged = widget === "slider" || widget === "arc" || widget === "bar";
    const emitRange = () => {
      if (rangeEmitted || (!range.min && !range.max)) return;
      rangeEmitted = true;
      const min = range.min ?? intLit(0);
      const max = range.max ?? intLit(100);
      this.bind("range", union(min, max), obj, [`rp_${widget}_set_range(${obj.name}, ${min.code}, ${max.code});`]);
    };

    for (const { name, value, node } of attrs) {
      const boolValue = (): Expr => {
        if (!value) return boolExpr("true", noDeps());
        const e = this.expr(value, scope, module);
        return boolExpr(this.truthy(e, node, module), e.deps);
      };

      if (name.startsWith("on")) {
        this.eventHandler(obj, widget, name, value, scope, module);
        continue;
      }

      switch (name) {
        case "class":
          this.classes(obj, value, scope, module);
          break;
        case "style":
          this.inlineStyle(obj, value, scope, module);
          break;
        case "id": {
          if (value?.type !== "StringLiteral") this.fail(node, module, "`id` must be a string");
          obj.handle = snake(value.value).toUpperCase();
          obj.isStatic = true;
          break;
        }
        case "hidden": {
          if (place.roots) this.fail(node, module, "`hidden` can't be used on the top element of a <Show> or <Switch> branch in the device build");
          const e = boolValue();
          this.bind("hidden", e.deps, obj, [`lv_obj_set_hidden(${obj.name}, ${e.code});`]);
          break;
        }
        case "disabled": {
          const e = boolValue();
          this.bind("disabled", e.deps, obj, [`rp_obj_set_state(${obj.name}, LV_STATE_DISABLED, ${e.code});`]);
          break;
        }
        case "checked": {
          const e = boolValue();
          this.bind("checked", e.deps, obj, [`rp_obj_set_state(${obj.name}, LV_STATE_CHECKED, ${e.code});`]);
          break;
        }
        case "min":
        case "max":
          if (!ranged || !value) this.fail(node, module, `<${widget}> has no "${name}" prop`);
          range[name] = this.number(value, scope, module);
          break;
        case "value": {
          if (!ranged || !value) this.fail(node, module, `<${widget}> has no "value" prop`);
          emitRange();
          const e = this.number(value, scope, module);
          this.bind("value", e.deps, obj, [`rp_${widget}_set_value(${obj.name}, ${e.code});`]);
          break;
        }
        case "options": {
          const known = widget === "dropdown" && value ? this.tryConst(value, scope, module) : undefined;
          if (!known || !Array.isArray(known.value) || !known.value.every((o) => typeof o === "string")) {
            this.fail(node, module, "`options` must be a list of strings known at build time");
          }
          this.line(`rp_dropdown_set_options(${obj.name}, ${cString(known.value.join("\n"))});`);
          break;
        }
        case "selected": {
          if (widget !== "dropdown" || !value) this.fail(node, module, `<${widget}> has no "selected" prop`);
          const e = this.number(value, scope, module);
          this.bind("selected", e.deps, obj, [`rp_dropdown_set_selected(${obj.name}, ${e.code});`]);
          break;
        }
        case "src": {
          if (widget !== "image" || !value) this.fail(node, module, `<${widget}> has no "src" prop`);
          const src = this.imageSource(value, scope, module);
          this.bind("src", src.deps, obj, [`rp_image_set_src(${obj.name}, ${src.code});`]);
          break;
        }
        case "fit": {
          const known = widget === "image" && value ? this.tryConst(value, scope, module) : undefined;
          const fit = typeof known?.value === "string" ? IMAGE_FIT[known.value] : undefined;
          if (!fit) this.fail(node, module, `"fit" must be one of ${Object.keys(IMAGE_FIT).join(", ")}, and known at build time`);
          this.line(`rp_image_set_fit(${obj.name}, ${fit});`);
          break;
        }
        case "readonly": {
          if (widget !== "arc") this.fail(node, module, `<${widget}> has no "readonly" prop`);
          const e = boolValue();
          this.bind("readonly", e.deps, obj, [`rp_arc_set_readonly(${obj.name}, ${e.code});`]);
          break;
        }
        case "scroll": {
          if (widget !== "view") this.fail(node, module, `<${widget}> has no "scroll" prop`);
          const e = boolValue();
          this.bind("scroll", e.deps, obj, [`rp_view_set_scroll(${obj.name}, ${e.code});`]);
          break;
        }
        default:
          this.fail(node, module, `Unknown prop "${name}" on <${widget}>`);
      }
    }
    emitRange();

    this.widgetChildren(el, widget, obj, childPlace, scope, module);
  }

  private number(node: t.Node, scope: Scope, module: Module): Expr {
    const e = this.expr(node, scope, module);
    if (e.type === "int") return e;
    if (e.type === "float") return { ...e, code: `(int32_t)floorf(${e.code} + 0.5f)`, type: "int" };
    this.fail(node, module, "Expected a number");
  }

  private textOf(children: JsxChild[], scope: Scope, module: Module): { node: StrNode; deps: Set<Signal> } | undefined {
    const parts: StrNode[] = [];
    const deps = noDeps();
    for (const child of children) {
      if (child.type === "JSXText") {
        const text = trimJsxText(child.value);
        if (text) parts.push({ k: "lit", v: text });
      } else if (child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression") {
        const value = this.expr(child.expression, scope, module);
        parts.push(toStr(value));
        for (const d of value.deps) deps.add(d);
      }
    }
    if (!parts.length) return undefined;
    return { node: parts.length === 1 ? parts[0] : { k: "cat", parts }, deps };
  }

  private widgetChildren(el: t.JSXElement, widget: Widget, obj: Obj, place: Place, scope: Scope, module: Module) {
    if (widget === "label") {
      const text = this.textOf(el.children, scope, module);
      if (text) this.bind("text", text.deps, obj, setText(obj.name, text.node));
      return;
    }

    if (widget === "checkbox") {
      const text = this.textOf(el.children, scope, module);
      if (text) this.bind("text", text.deps, obj, setText(obj.name, text.node, "rp_checkbox_set_text"));
      return;
    }

    if (widget === "button") {
      const isElement = (c: JsxChild) =>
        c.type === "JSXElement" ||
        c.type === "JSXFragment" ||
        (c.type === "JSXExpressionContainer" && c.expression.type !== "JSXEmptyExpression" && this.isJsxLike(c.expression, scope, module));
      const textChildren = el.children.filter((c) => !isElement(c));
      const text = this.textOf(textChildren, scope, module);
      if (text) {
        const label = this.newObject("label", `${obj.name.slice(2)}_text`, { parent: obj, guard: place.guard, roots: undefined, resets: undefined });
        this.line(`rp_obj_center(${label.name});`);
        this.bind("text", text.deps, label, setText(label.name, text.node));
      }
      this.children(el.children.filter(isElement), scope, module, place);
      return;
    }

    this.children(el.children, scope, module, place);
  }

  private eventHandler(obj: Obj, widget: Widget, name: string, value: t.Node | undefined, scope: Scope, module: Module) {
    const EVENTS: Record<string, string> = {
      onClick: "LV_EVENT_CLICKED",
      onPress: "LV_EVENT_PRESSED",
      onRelease: "LV_EVENT_RELEASED",
      onLongPress: "LV_EVENT_LONG_PRESSED",
      onFocus: "LV_EVENT_FOCUSED",
      onBlur: "LV_EVENT_DEFOCUSED",
    };
    const valued = widget === "slider" || widget === "arc";
    if (valued) {
      EVENTS.onInput = "LV_EVENT_VALUE_CHANGED";
      EVENTS.onChange = "LV_EVENT_RELEASED";
    }
    const toggle = widget === "switch" || widget === "checkbox";
    if (toggle || widget === "dropdown") EVENTS.onChange = "LV_EVENT_VALUE_CHANGED";
    const event = EVENTS[name];
    if (!event) this.fail(value ?? ({} as t.Node), module, `<${widget}> has no "${name}" event`);
    if (!value) this.fail({} as t.Node, module, `"${name}" needs a function`);

    const body: string[] = [];
    const takesValue = name === "onInput" || name === "onChange";
    const valueExpr: Expr = { type: toggle ? "bool" : "int", code: "value", deps: noDeps() };
    const args: Binding[] = takesValue ? [{ k: "value", expr: valueExpr }] : [];

    const n = unwrap(value);
    // An optional handler prop that wasn't passed.
    const known = !isFunc(n) ? this.tryConst(n, scope, module) : undefined;
    if (known && known.value === undefined) return;
    if (isFunc(n)) {
      this.inlineHandler({ k: "func", node: n, scope, module }, args, "", body);
    } else {
      const resolved = this.resolveBinding(n, scope, module);
      if (resolved?.binding.k === "setter") {
        if (!takesValue) this.fail(n, module, `${name} has no value to pass to a setter`);
        body.push(`set_${resolved.binding.signal.name}(value);`);
      } else if (resolved?.binding.k === "func") {
        this.inlineHandler(resolved.binding, args, "", body);
      } else {
        this.fail(n, module, `"${name}" needs a function`);
      }
    }

    const handler: Handler = { name: `on_${this.program.handlers.length}${snake(name.slice(2))}`, body };
    if (takesValue) {
      const target = "lv_event_get_target(e)";
      if (toggle) handler.valueDecl = `const bool value = lv_obj_has_state(${target}, LV_STATE_CHECKED);`;
      else if (widget === "dropdown") handler.valueDecl = `const int32_t value = (int32_t)lv_dropdown_get_selected(${target});`;
      else handler.valueDecl = `const int32_t value = lv_${widget}_get_value(${target});`;
    }
    this.program.handlers.push(handler);
    this.line(`rp_obj_on(${obj.name}, ${handler.name}, ${event});`);
  }

  private classes(obj: Obj, value: t.Node | undefined, scope: Scope, module: Module) {
    if (!value) return;
    const alternatives = this.classAlternatives(value, scope, module);
    const words = (text: string) => text.split(/\s+/).filter(Boolean);

    if (alternatives.length === 1 && alternatives[0].conds.length === 0) {
      for (const line of this.input.styles.add(obj.name, words(alternatives[0].text))) this.line(line);
      return;
    }

    const all = [...new Set(alternatives.flatMap((a) => words(a.text)))];
    const deps = union(...alternatives.flatMap((a) => a.conds));
    let select = `${alternatives.length - 1}`;
    for (let i = alternatives.length - 2; i >= 0; i--) {
      select = `${alternatives[i].conds.map((c) => wrap(c.code)).join(" && ")} ? ${i} : ${select}`;
    }

    const body = [
      "static int32_t applied = -1;",
      `const int32_t next = ${select};`,
      "if(next == applied) return;",
      "applied = next;",
      ...this.input.styles.remove(obj.name, all),
      "switch(next) {",
    ];
    alternatives.forEach((alt, i) => {
      body.push(`case ${i}:`, ...this.input.styles.add(obj.name, words(alt.text)), "break;");
    });
    body.push("}");
    this.bind("class", deps, obj, body);
  }

  /** Expands a class expression into every string it can produce and when it produces it. */
  private classAlternatives(node: t.Node, scope: Scope, module: Module): { conds: Expr[]; text: string }[] {
    const n = unwrap(node);
    const folded = this.evalSplit(n, scope, module);
    if (folded?.k === "const" && typeof folded.value === "string") return [{ conds: [], text: folded.value }];
    if (folded?.k === "split" && folded.values.every((v) => typeof v === "string")) {
      const deps = new Set([folded.signal]);
      return folded.values.map((text, i) => ({ conds: [boolExpr(`(${sigRef(folded.signal)} == ${i})`, deps)], text: text as string }));
    }
    switch (n.type) {
      case "StringLiteral":
        return [{ conds: [], text: n.value }];
      case "ConditionalExpression": {
        const c = this.expr(n.test, scope, module);
        const yes = boolExpr(this.truthy(c, n.test, module), c.deps);
        const no = boolExpr(`!${wrap(yes.code)}`, c.deps);
        return [
          ...this.classAlternatives(n.consequent, scope, module).map((a) => ({ conds: [yes, ...a.conds], text: a.text })),
          ...this.classAlternatives(n.alternate, scope, module).map((a) => ({ conds: [no, ...a.conds], text: a.text })),
        ];
      }
      case "TemplateLiteral": {
        let results: { conds: Expr[]; text: string }[] = [{ conds: [], text: "" }];
        n.quasis.forEach((quasi, i) => {
          results = results.map((r) => ({ ...r, text: r.text + (quasi.value.cooked ?? "") }));
          const e = n.expressions[i];
          if (e) {
            const options = this.classAlternatives(e, scope, module);
            results = results.flatMap((r) => options.map((o) => ({ conds: [...r.conds, ...o.conds], text: r.text + o.text })));
          }
        });
        return results;
      }
      case "Identifier":
      case "MemberExpression": {
        const resolved = this.resolveBinding(n, scope, module);
        if (resolved?.binding.k === "lazy") return this.classAlternatives(resolved.binding.node, resolved.binding.scope, resolved.binding.module);
        this.fail(n, module, "The device build needs to see every class name at compile time");
        break;
      }
      case "CallExpression": {
        const resolved = this.resolveBinding(n.callee, scope, module);
        if (resolved?.binding.k !== "func") this.fail(n, module, "The device build needs to see every class name at compile time");
        const args: Binding[] = n.arguments.map((a) => ({ k: "lazy", node: a as t.Expression, scope, module }));
        const inner = this.bindParams(resolved.binding.node, args, resolved.binding.scope, resolved.binding.module);
        const { value, statements } = this.returned(resolved.binding.node, resolved.binding.module);
        for (const statement of statements) this.declare(statement, inner, resolved.binding.module);
        return this.classAlternatives(value, inner, resolved.binding.module);
      }
      default:
        this.fail(n, module, "The device build needs to see every class name at compile time");
    }
  }

  private inlineStyle(obj: Obj, value: t.Node | undefined, scope: Scope, module: Module) {
    const n = value && unwrap(value);
    if (n?.type !== "ObjectExpression") this.fail(value ?? ({} as t.Node), module, "`style` must be an object literal");
    const style: Record<string, string | number> = {};
    for (const p of n.properties) {
      if (p.type !== "ObjectProperty" || p.key.type !== "Identifier") this.fail(p, module, `This kind of property ${LATER}`);
      const known = this.tryConst(p.value, scope, module);
      if (known && (typeof known.value === "string" || typeof known.value === "number")) {
        style[p.key.name] = known.value;
        continue;
      }

      // A length that changes at runtime: find its LVGL property by translating a sample value.
      const sample = translateDeclarations(inlineDeclarations({ [p.key.name]: 1 }), this.input.styleContext);
      if (sample.length !== 1 || sample[0].value.t !== "num" || sample[0].value.v !== 1) {
        this.fail(p.value, module, `"${p.key.name}" can't change at runtime in the device build yet. Lengths like width and height can.`);
      }
      const e = this.number(p.value, scope, module);
      this.bind("style", e.deps, obj, [`rp_obj_set_local_num(${obj.name}, ${sample[0].prop}, ${e.code}, LV_PART_MAIN);`]);
    }
    let decls: StyleDecl[];
    try {
      decls = translateDeclarations(inlineDeclarations(style), this.input.styleContext);
    } catch (err) {
      this.fail(n, module, err instanceof Error ? err.message : String(err));
    }
    for (const { prop, value: v } of decls) {
      switch (v.t) {
        case "num": this.line(`rp_obj_set_local_num(${obj.name}, ${prop}, ${v.v}, LV_PART_MAIN);`); break;
        case "pct": this.line(`rp_obj_set_local_num(${obj.name}, ${prop}, lv_pct(${v.v}), LV_PART_MAIN);`); break;
        case "content": this.line(`rp_obj_set_local_num(${obj.name}, ${prop}, LV_SIZE_CONTENT, LV_PART_MAIN);`); break;
        case "const": this.line(`rp_obj_set_local_num(${obj.name}, ${prop}, ${v.v}, LV_PART_MAIN);`); break;
        case "color": this.line(`rp_obj_set_local_color(${obj.name}, ${prop}, 0x${v.v.toString(16).padStart(6, "0")}, LV_PART_MAIN);`); break;
        case "font": this.line(`rp_obj_set_local_ptr(${obj.name}, ${prop}, &${this.input.fontSymbol(v.family, v.size)}, LV_PART_MAIN);`); break;
        case "transition": this.fail(n, module, "`transition` only works in a stylesheet");
      }
    }
  }
}

/**
 * Compiles the UI. Runs until local number signals have settled on int or
 * float, since a later assignment can turn a signal into a float.
 */
export function compileUi(input: CompileInput): UiProgram {
  const floats = new Set<string>();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    const compiler = new Compiler(input, floats, (key) => {
      if (!floats.has(key)) {
        floats.add(key);
        changed = true;
      }
    });
    const program = compiler.run();
    if (changed) continue;
    if (input.fpu === "none" && program.signals.some((s) => s.value.base === "float")) {
      program.warnings.push("The UI uses fractional numbers on an MCU with no FPU, so they'll be computed in software.");
    }
    return program;
  }
  throw new Error("Number types didn't settle while compiling the UI");
}

export function cssImportOrder(entry: string): string[] {
  const sheets: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const ast = parseSync(readFileSync(file, "utf8"), {
      filename: file,
      babelrc: false,
      configFile: false,
      sourceType: "module",
      parserOpts: { plugins: ["jsx", "typescript"] },
    });
    for (const statement of ast?.program.body ?? []) {
      if (statement.type !== "ImportDeclaration" || statement.importKind === "type") continue;
      const source = statement.source.value;
      if (!source.startsWith(".")) continue;
      const base = resolve(dirname(file), source);
      if (source.endsWith(".css")) {
        if (!seen.has(base)) {
          seen.add(base);
          sheets.push(base);
        }
        continue;
      }
      const target = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`].find((c) => existsSync(c) && /\.tsx?$/.test(c));
      if (target) visit(target);
    }
  };
  visit(entry);
  return sheets;
}
