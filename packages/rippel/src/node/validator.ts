/**
 * Subset validator (first version): flags code the C backend won't be able
 * to compile, so the dev runtime never accepts what a device build would reject.
 *
 * It checks syntax and imports only. Type checking stays with tsc and the editor.
 */
import { parseSync, traverse, type NodePath, type types as t } from "@babel/core";

export interface ValidationIssue {
  message: string;
  line: number;
  column: number;
}

/** Browser and JS-engine globals that don't exist on the device. */
const UNAVAILABLE_GLOBALS = new Set([
  "fetch", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame",
  "queueMicrotask", "window", "document", "globalThis", "localStorage", "sessionStorage",
  "XMLHttpRequest", "WebSocket", "eval", "Function", "Promise", "Date", "Intl", "Reflect", "Proxy",
  "Symbol", "WeakMap", "WeakSet", "Map", "Set", "JSON", "RegExp",
]);

/** TS expression wrappers whose operand is a value, not a type. */
const VALUE_TS_NODES = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion"]);

function inTypePosition(path: NodePath): boolean {
  return Boolean(path.findParent((p) => p.node.type.startsWith("TS") && !VALUE_TS_NODES.has(p.node.type)));
}

const ALLOWED_PACKAGES = ["rippel", "rippel/contract"];

function isAllowedImport(source: string): boolean {
  return ALLOWED_PACKAGES.includes(source) || source.startsWith("./") || source.startsWith("../");
}

const MESSAGES = {
  class: "Classes can't be compiled for the device. Use functions and signals.",
  async: "Async functions aren't supported in UI code. Do async work in firmware and send results through a contract signal.",
  generator: "Generators aren't supported in UI code.",
  exceptions: "Exceptions (try/catch/throw) aren't supported in UI code.",
  regex: "Regular expressions aren't supported in UI code.",
  new: "`new` isn't supported in UI code. Objects like Date, Map and Promise aren't available on the device.",
  delete: "`delete` isn't supported in UI code.",
  dynamicImport: "Dynamic import() isn't supported in UI code.",
  import: (source: string) =>
    `Can't import "${source}". UI code can import from ${ALLOWED_PACKAGES.map((p) => `"${p}"`).join(", ")} and your own files.`,
  global: (name: string) => `"${name}" isn't available on the device.`,
};

export function validateSource(code: string, filename: string): ValidationIssue[] {
  const ast = parseSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: "module",
    parserOpts: { plugins: ["jsx", "typescript"] },
  });
  if (!ast) return [];

  const issues: ValidationIssue[] = [];
  const report = (path: NodePath, message: string) => {
    const loc = path.node.loc?.start;
    issues.push({ message, line: loc?.line ?? 1, column: (loc?.column ?? 0) + 1 });
  };
  const checkFunction = (path: NodePath<t.Function>) => {
    if (path.node.async) report(path, MESSAGES.async);
    if (path.node.generator) report(path, MESSAGES.generator);
  };

  traverse(ast, {
    ImportDeclaration(path) {
      if (path.node.importKind === "type") return;
      const source = path.node.source.value;
      if (!isAllowedImport(source)) report(path.get("source"), MESSAGES.import(source));
    },
    ExportNamedDeclaration(path) {
      const source = path.node.source?.value;
      if (source && path.node.exportKind !== "type" && !isAllowedImport(source)) report(path, MESSAGES.import(source));
    },
    ExportAllDeclaration(path) {
      const source = path.node.source.value;
      if (path.node.exportKind !== "type" && !isAllowedImport(source)) report(path, MESSAGES.import(source));
    },
    Import(path) {
      report(path.parentPath, MESSAGES.dynamicImport);
    },
    Class(path) {
      report(path, MESSAGES.class);
    },
    Function: checkFunction,
    TryStatement(path) {
      report(path, MESSAGES.exceptions);
    },
    ThrowStatement(path) {
      report(path, MESSAGES.exceptions);
    },
    RegExpLiteral(path) {
      report(path, MESSAGES.regex);
    },
    NewExpression(path) {
      report(path, MESSAGES.new);
    },
    UnaryExpression(path) {
      if (path.node.operator === "delete") report(path, MESSAGES.delete);
    },
    Identifier(path) {
      const name = path.node.name;
      if (!UNAVAILABLE_GLOBALS.has(name)) return;
      if (!path.isReferencedIdentifier() || path.scope.hasBinding(name) || inTypePosition(path)) return;
      // `new Date()` is reported once, as a `new` expression.
      if (path.parentPath.isNewExpression() && path.key === "callee") return;
      report(path, MESSAGES.global(name));
    },
  });

  return issues.sort((a, b) => a.line - b.line || a.column - b.column);
}
