#!/usr/bin/env node
// Starts the compiled CLI. This file is committed so npm can link the `rippel` command in a fresh clone, before
// `dist/` exists. npm skips a bin whose file is missing at install time and doesn't link it again after a build.
import { existsSync } from "node:fs";

const cli = new URL("../dist/cli.js", import.meta.url);
if (!existsSync(cli)) {
  console.error("rippel isn't built yet. Run `npm run build` in the repository root first.");
  process.exit(1);
}
await import(cli.href);
