/**
 * `rippel check`: finds what the device build can't compile, without writing
 * anything. It validates every source file and stylesheet, then runs the
 * compiler, so code that passes check builds.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { compileProject } from "../codegen/build.js";
import { CodegenError } from "../codegen/compile.js";
import { CssError, compileStyleSheet } from "../style/css.js";
import { styleContext, type ResolvedConfig } from "./load-config.js";
import { validateSource } from "./validator.js";

export interface CheckResult {
  /** One line per problem: `file:line:column  message`, relative to the project root. */
  problems: string[];
  warnings: string[];
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** A compile or CSS error as `file:line:column  message`, or undefined for any other error. */
export function locatedError(root: string, err: unknown): string | undefined {
  if (err instanceof CodegenError) return `${relative(root, err.file)}:${err.line}:${err.column}  ${err.message}`;
  if (err instanceof CssError) return `${relative(root, err.loc.file)}:${err.loc.line}:${err.loc.column}  ${err.message.split("\n")[0]}`;
  return undefined;
}

/**
 * Checks a project. `compile: false` skips the compile step, for `rippel build`,
 * which compiles for real straight after.
 */
export async function checkProject(config: ResolvedConfig, { compile = true } = {}): Promise<CheckResult> {
  const { root } = config;
  const ctx = styleContext(config);
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const file of listFiles(join(root, "src"))) {
    // The mock is dev-only JS that plays the firmware. It never reaches the device.
    if (config.mock && resolve(file) === resolve(config.mock)) continue;
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      for (const issue of validateSource(readFileSync(file, "utf8"), file)) {
        problems.push(`${relative(root, file)}:${issue.line}:${issue.column}  ${issue.message}`);
      }
    } else if (file.endsWith(".css")) {
      try {
        compileStyleSheet(readFileSync(file, "utf8"), file, ctx);
      } catch (err) {
        problems.push(locatedError(root, err) ?? rethrow(err));
      }
    }
  }

  // The compiler stops at its first error, so it only runs once the rest is clean.
  if (compile && !problems.length) {
    try {
      warnings.push(...(await compileProject(config)).program.warnings);
    } catch (err) {
      problems.push(locatedError(root, err) ?? rethrow(err));
    }
  }
  return { problems, warnings };
}

function rethrow(err: unknown): never {
  throw err;
}
