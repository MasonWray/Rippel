#!/usr/bin/env node
/**
 * rippel dev    Start the browser dev runtime (simulated display + firmware mock panel).
 * rippel check  Validate UI code and styles, and compile them without writing anything.
 * rippel build  Generate the C code for the device.
 */
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { buildProject } from "./codegen/build.js";
import { checkProject, locatedError } from "./node/check.js";
import { ConfigError, loadConfig } from "./node/load-config.js";
import { rippel } from "./vite/plugin.js";

const HELP = `Usage: rippel <command> [options]

Commands:
  dev      Start the dev runtime in the browser
  check    Check that the UI builds for the device, without writing files
  build    Generate C code for the device into output.dir

Options:
  --port <n>   Port for the dev server (default 5173)
  --host       Listen on all network interfaces
  --out <dir>  Where build writes (default: output.dir in rippel.config.ts)
  --entry <f>  Build this root component instead of the configured entry
  --target <t> Use a target from \`targets\` in rippel.config.ts
  -h, --help   Show this help
`;

/** The target selected with --target, if any. */
let target: string | undefined;

async function dev(root: string, port: number | undefined, host: boolean) {
  const config = await loadConfig(root, target);
  const server = await createServer({
    root,
    configFile: false,
    plugins: [rippel(config)],
    server: { port: port ?? 5173, host: host || undefined },
    clearScreen: false,
  });
  await server.listen();
  console.log(`\n  Rippel dev: ${config.display.name} (${config.display.width}×${config.display.height})\n`);
  server.printUrls();
  server.bindCLIShortcuts({ print: true });
}

/** Prints each problem. Returns the exit code. */
async function check(root: string, compile = true): Promise<number> {
  const config = await loadConfig(root, target);
  const { problems, warnings } = await checkProject(config, { compile });
  for (const line of problems) console.log(line);
  for (const warning of warnings) console.log(`Warning: ${warning}`);
  const n = problems.length;
  // Without the compile step, "no problems" would speak too soon: build says how it went.
  if (n) console.log(`\n${n} problem${n === 1 ? "" : "s"} found.`);
  else if (compile) console.log("No problems found.");
  return n ? 1 : 0;
}

async function build(root: string, out: string | undefined, entry: string | undefined): Promise<number> {
  if ((await check(root, false)) !== 0) return 1;
  const config = await loadConfig(root, target);
  if (entry) config.entry = resolve(root, entry);
  try {
    const result = await buildProject(config, out);
    for (const warning of result.warnings) console.log(`Warning: ${warning}`);
    console.log(`Generated ${result.files.length} files in ${relative(root, result.outDir) || "."}`);
    if (result.images.length) {
      const total = result.images.reduce((sum, image) => sum + image.bytes, 0);
      console.log(`Images: ${result.images.length}, using ${(total / 1024).toFixed(1)} KB of flash`);
    }
    return 0;
  } catch (err) {
    const located = locatedError(root, err);
    if (!located) throw err;
    console.log(located);
    return 1;
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      out: { type: "string" },
      entry: { type: "string" },
      target: { type: "string" },
      host: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];
  target = values.target;
  const root = process.cwd();

  if (values.help || !command) {
    console.log(HELP);
    return;
  }
  if (command === "dev") {
    await dev(root, values.port ? Number(values.port) : undefined, values.host ?? false);
  } else if (command === "check") {
    process.exitCode = await check(root);
  } else if (command === "build") {
    process.exitCode = await build(root, values.out, values.entry);
  } else {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? `Config error: ${err.message}` : err);
  process.exitCode = 1;
});
