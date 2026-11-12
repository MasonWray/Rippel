/**
 * The `rippel dev` page: the simulated display, the firmware mock panel and
 * LVGL memory stats. Plain DOM; only the device canvas is LVGL.
 */
import type { ClientConfig } from "../config.js";
import type { Component } from "../index.js";
import { attachLvgl, registerFont } from "../runtime/host.js";
import { createComponent, createRoot, render } from "../runtime/renderer.js";
import { startSimulator } from "../runtime/simulator.js";
import { setStyleContext } from "../runtime/styles.js";
import { startMock, type Mock } from "../mock.js";
import { h } from "./dom.js";
import { createPanel } from "./panel.js";
import { SHELL_CSS } from "./shell-css.js";

export interface DevShellOptions {
  config: ClientConfig;
  loadApp: () => Promise<{ default?: Component }>;
  loadContract?: () => Promise<Record<string, unknown>>;
  loadMock?: () => Promise<{ default?: Mock }>;
}

const ZOOM_KEY = "rippel.zoom";

function readZoom(): number | undefined {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v >= 1 && v <= 4 ? v : undefined;
  } catch {
    return undefined;
  }
}

function saveZoom(zoom: number) {
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    // Storage can be unavailable (private windows). Zoom just won't persist.
  }
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export async function startDevShell({ config, loadApp, loadContract, loadMock }: DevShellOptions): Promise<void> {
  const { display } = config;
  document.head.append(h("style", {}, SHELL_CSS));
  document.title = `${display.name} · Rippel`;

  const canvas = h("canvas", { class: "rp-canvas", "aria-label": `${display.name} display` });
  const errorBox = h("pre", { class: "rp-error", hidden: true });
  const memUsed = h("span", {}, "–");
  const memPeak = h("span", {}, "–");

  const zoomButtons = [1, 2, 3, 4].map((z) => h("button", { type: "button", class: "rp-zoom", "data-zoom": z }, `${z}×`));
  const setZoom = (zoom: number) => {
    canvas.style.width = `${display.width * zoom}px`;
    canvas.style.height = `${display.height * zoom}px`;
    for (const b of zoomButtons) b.classList.toggle("rp-active", Number(b.dataset.zoom) === zoom);
    saveZoom(zoom);
  };
  for (const b of zoomButtons) b.addEventListener("click", () => setZoom(Number(b.dataset.zoom)));

  const showError = (err: unknown) => {
    const message = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
    errorBox.textContent = message;
    errorBox.hidden = false;
    console.error(err);
  };
  window.addEventListener("error", (e) => showError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => showError(e.reason));

  const specs = [
    `${display.width}×${display.height}`,
    display.colorFormat,
    `${display.dpi} dpi`,
    config.mcu?.name,
  ].filter(Boolean).join(" · ");

  const stage = h("main", { class: "rp-stage" },
    h("div", { class: "rp-device" }, canvas),
    errorBox,
  );
  const panelSlot = h("div", { class: "rp-panel-slot" });

  document.body.replaceChildren(
    h("div", { class: "rp-shell" },
      h("header", { class: "rp-header" },
        h("div", { class: "rp-title" },
          h("strong", {}, display.name),
          h("span", { class: "rp-specs" }, specs),
        ),
        h("div", { class: "rp-header-right" },
          h("span", { class: "rp-mem", title: "LVGL heap in use / peak" }, "LVGL heap ", memUsed, " / peak ", memPeak),
          h("div", { class: "rp-zooms", role: "group", "aria-label": "Zoom" }, ...zoomButtons),
        ),
      ),
      stage,
      panelSlot,
    ),
  );

  const fitZoom = Math.max(1, Math.min(4, Math.floor(Math.min(
    (stage.clientWidth - 48) / display.width,
    (stage.clientHeight - 48) / display.height,
  ))));
  setZoom(readZoom() ?? fitZoom);

  try {
    const sim = await startSimulator(canvas, display);
    attachLvgl(sim.lv);
    // Debug handle for the browser console.
    (window as unknown as { __rippel: unknown }).__rippel = { lv: sim.lv };
    setStyleContext({
      fonts: config.fontCatalog,
      defaultFont: config.defaultFont,
      rem: config.rem,
      display: { width: display.width, height: display.height },
    });
    sim.lv.setRefreshPeriod(Math.round(1000 / config.refreshHz));

    await Promise.all(config.fonts.map(async (font) => {
      const res = await fetch(font.url);
      if (!res.ok) throw new Error(`Couldn't load font ${font.family} ${font.size}px: ${res.status} ${await res.text()}`);
      registerFont(font.family, font.size, sim.lv.loadFont(new Uint8Array(await res.arrayBuffer())));
    }));

    const contract = loadContract ? await loadContract() : undefined;
    panelSlot.replaceWith(createPanel(contract));

    const updateMem = () => {
      memUsed.textContent = kb(sim.lv.memUsed());
      memPeak.textContent = kb(sim.lv.memMaxUsed());
    };
    updateMem();
    setInterval(updateMem, 500);

    const app = await loadApp();
    if (typeof app.default !== "function") {
      throw new Error("The entry module must default-export the root component.");
    }
    const App = app.default;
    render(() => createComponent(App as never, {}), createRoot());

    if (loadMock) {
      const mock = (await loadMock()).default;
      if (typeof mock !== "function") throw new Error("The firmware mock must default-export defineMock(...).");
      startMock(mock);
    }
  } catch (err) {
    showError(err);
  }
}
