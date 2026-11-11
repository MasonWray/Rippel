#!/usr/bin/env node
/**
 * rippel dev    Start the browser dev runtime (simulated display + firmware mock panel).
 * rippel check  Validate UI code and styles without starting a server.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import { ConfigError, loadConfig, styleContext } from "./node/load-config.js";
import { validateSource } from "./node/validator.js";
import { CssError, compileStyleSheet } from "./style/css.js";
import { rippel } from "./vite/plugin.js";

const HELP = `Usage: rippel <command> [options]

Commands:
  dev      Start the dev runtime in the browser
  check    Check UI code and styles for anything the device build can't compile

Options:
  --port <n>   Port for the dev server (default 5173)
  --host       Listen on all network interfaces
  -h, --help   Show this help
`;

async function dev(root: string, port: number | undefined, host: boolean) {
  const config = await loadConfig(root);
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

async function check(root: string): Promise<number> {
  const config = await loadConfig(root);
  const srcDir = join(root, "src");
  const ctx = styleContext(config);
  let problems = 0;

  for (const file of listFiles(srcDir)) {
    const rel = relative(root, file);
    // The mock is dev-only JS that plays the firmware. It never reaches the device.
    if (config.mock && resolve(file) === resolve(config.mock)) continue;
    if (/\.[cm]?[jt]sx?$/.test(file)) {
      for (const issue of validateSource(readFileSync(file, "utf8"), file)) {
        console.log(`${rel}:${issue.line}:${issue.column}  ${issue.message}`);
        problems++;
      }
    } else if (file.endsWith(".css")) {
      try {
        compileStyleSheet(readFileSync(file, "utf8"), file, ctx);
      } catch (err) {
        if (!(err instanceof CssError)) throw err;
        console.log(`${relative(root, err.loc.file)}:${err.loc.line}:${err.loc.column}  ${err.message.split("\n")[0]}`);
        problems++;
      }
    }
  }

  console.log(problems ? `\n${problems} problem${problems === 1 ? "" : "s"} found.` : "No problems found.");
  return problems ? 1 : 0;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: "string" },
      host: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const command = positionals[0];
  const root = process.cwd();

  if (values.help || !command) {
    console.log(HELP);
    return;
  }
  if (command === "dev") {
    await dev(root, values.port ? Number(values.port) : undefined, values.host ?? false);
  } else if (command === "check") {
    process.exitCode = await check(root);
  } else {
    console.error(`Unknown command "${command}".\n\n${HELP}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof ConfigError ? `Config error: ${err.message}` : err);
  process.exitCode = 1;
});
