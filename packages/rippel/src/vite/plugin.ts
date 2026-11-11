/**
 * Vite plugins behind `rippel dev`:
 * - serves the dev shell page and its client entry
 * - compiles CSS files to style IR modules (with hot reload)
 * - runs the subset validator on UI source
 * - serves fonts converted by lv_font_conv
 * - compiles TSX with Solid's universal renderer pointed at rippel/renderer
 */
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { codeFrameColumns } from "@babel/code-frame";
import solid from "vite-plugin-solid";
import { normalizePath, type Plugin, type PluginOption } from "vite";
import { buildFont } from "../node/fonts.js";
import { clientConfig, FONT_URL_PREFIX, styleContext, type ResolvedConfig } from "../node/load-config.js";
import { validateSource } from "../node/validator.js";
import { compileStyleSheet } from "../style/css.js";

const CLIENT_ID = "/@rippel/client";
const RESOLVED_CLIENT_ID = "\0rippel:client";
const STYLE_PREFIX = "\0rippel-style:";
// Suffix keeps Vite's own CSS pipeline from claiming the module.
const STYLE_SUFFIX = ".rippel.js";

const SHELL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rippel</title>
  </head>
  <body>
    <script type="module" src="${CLIENT_ID}"></script>
  </body>
</html>
`;

function isUserFile(file: string, root: string): boolean {
  const rel = relative(root, file);
  return !rel.startsWith("..") && !rel.includes("node_modules");
}

function urlFor(root: string, file: string): string {
  return "/" + normalizePath(relative(root, file));
}

export function rippel(config: ResolvedConfig): PluginOption[] {
  const root = config.root;
  const cacheDir = join(root, "node_modules", ".rippel", "fonts");
  const ctx = styleContext(config);

  const core: Plugin = {
    name: "rippel",
    enforce: "pre",

    config() {
      return {
        appType: "custom",
        resolve: { dedupe: ["solid-js"] },
        optimizeDeps: {
          // Rippel's runtime must share one solid-js instance with user code.
          exclude: ["rippel"],
          include: ["solid-js", "solid-js/universal"],
        },
      };
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "/").split("?")[0];
        try {
          if (url === "/" || url === "/index.html") {
            const html = await server.transformIndexHtml(url, SHELL_HTML, req.originalUrl);
            res.setHeader("Content-Type", "text/html");
            res.end(html);
            return;
          }
          if (url.startsWith(FONT_URL_PREFIX)) {
            const [family, file] = url.slice(FONT_URL_PREFIX.length).split("/");
            const size = Number(file?.replace(/\.bin$/, ""));
            const font = config.fonts.find((f) => f.family === family);
            if (!font || !font.sizes.includes(size)) {
              res.statusCode = 404;
              res.end(`No font ${family} ${size}px in rippel.config.ts`);
              return;
            }
            const data = await buildFont(font, size, cacheDir);
            res.setHeader("Content-Type", "application/octet-stream");
            res.end(data);
            return;
          }
        } catch (err) {
          res.statusCode = 500;
          res.end(err instanceof Error ? err.message : String(err));
          return;
        }
        next();
      });
    },

    resolveId(source, importer) {
      if (source === CLIENT_ID) return RESOLVED_CLIENT_ID;
      if (importer && source.endsWith(".css") && !importer.startsWith("\0")) {
        const file = normalizePath(resolve(dirname(importer), source));
        if (isUserFile(file, root)) return STYLE_PREFIX + file + STYLE_SUFFIX;
      }
      return undefined;
    },

    async load(id) {
      if (id === RESOLVED_CLIENT_ID) {
        const loadContract = config.contract
          ? `() => import(${JSON.stringify(urlFor(root, config.contract))})`
          : "undefined";
        const loadMock = config.mock
          ? `() => import(${JSON.stringify(urlFor(root, config.mock))})`
          : "undefined";
        return [
          `import { startDevShell } from "rippel/dev-shell";`,
          `startDevShell({`,
          `  config: ${JSON.stringify(clientConfig(config))},`,
          `  loadApp: () => import(${JSON.stringify(urlFor(root, config.entry))}),`,
          `  loadContract: ${loadContract},`,
          `  loadMock: ${loadMock},`,
          `});`,
        ].join("\n");
      }
      if (id.startsWith(STYLE_PREFIX)) {
        const file = id.slice(STYLE_PREFIX.length, -STYLE_SUFFIX.length);
        this.addWatchFile(file);
        const sheet = compileStyleSheet(await readFile(file, "utf8"), file, ctx);
        return [
          `import { registerStyleSheet } from "rippel/runtime/styles";`,
          `registerStyleSheet(${JSON.stringify(file)}, ${JSON.stringify(sheet.rules)});`,
          `if (import.meta.hot) import.meta.hot.accept();`,
        ].join("\n");
      }
      return undefined;
    },

    transform(code, id) {
      const file = id.split("?")[0];
      if (!/\.[cm]?[jt]sx?$/.test(file) || id.startsWith("\0") || !isUserFile(file, root)) return undefined;
      if (config.mock && file === normalizePath(config.mock)) return undefined;
      const issues = validateSource(code, file);
      if (!issues.length) return undefined;
      const first = issues[0];
      const err = new Error(
        issues.length > 1 ? `${first.message} (and ${issues.length - 1} more; run \`rippel check\`)` : first.message,
      ) as Error & { loc?: unknown; frame?: string };
      err.loc = { file, line: first.line, column: first.column };
      err.frame = codeFrameColumns(code, { start: { line: first.line, column: first.column } });
      throw err;
    },

    handleHotUpdate({ file, server }) {
      if (!file.endsWith(".css")) return undefined;
      const mod = server.moduleGraph.getModuleById(STYLE_PREFIX + normalizePath(file) + STYLE_SUFFIX);
      if (!mod) return undefined;
      server.moduleGraph.invalidateModule(mod);
      return [mod];
    },
  };

  return [
    core,
    solid({
      solid: { generate: "universal", moduleName: "rippel/renderer" },
      dev: true,
      hot: true,
    }),
  ];
}
