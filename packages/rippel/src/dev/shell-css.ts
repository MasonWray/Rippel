/** Styles for the dev shell page (not the device UI). */
export const SHELL_CSS = /* css */ `
:root {
  color-scheme: light dark;
  --rp-bg: #f4f5f7;
  --rp-surface: #ffffff;
  --rp-border: #dcdfe4;
  --rp-text: #1d2128;
  --rp-muted: #69707d;
  --rp-accent: #2f6fde;
  --rp-device: #1b1d21;
  --rp-error-bg: #fdecec;
  --rp-error-text: #9b1c1c;
  --rp-mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --rp-bg: #15171a;
    --rp-surface: #1d2024;
    --rp-border: #2e3238;
    --rp-text: #e4e6ea;
    --rp-muted: #8b919c;
    --rp-accent: #6b9cf0;
    --rp-device: #000000;
    --rp-error-bg: #3a1a1a;
    --rp-error-text: #f3b4b4;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--rp-bg);
  color: var(--rp-text);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.rp-shell {
  display: grid;
  grid-template-columns: 1fr 300px;
  grid-template-rows: auto 1fr;
  height: 100vh;
}
.rp-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: var(--rp-surface);
  border-bottom: 1px solid var(--rp-border);
}
.rp-title { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.rp-title strong { white-space: nowrap; }
.rp-specs, .rp-mem { color: var(--rp-muted); font-family: var(--rp-mono); font-size: 12px; white-space: nowrap; }
.rp-header-right { display: flex; align-items: center; gap: 16px; }
.rp-zooms { display: flex; border: 1px solid var(--rp-border); border-radius: 6px; overflow: hidden; }
.rp-zoom {
  border: 0;
  background: transparent;
  color: var(--rp-muted);
  font: inherit;
  padding: 3px 9px;
  cursor: pointer;
}
.rp-zoom + .rp-zoom { border-left: 1px solid var(--rp-border); }
.rp-zoom.rp-active { background: var(--rp-accent); color: #fff; }
.rp-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 24px;
}
.rp-device {
  padding: 14px;
  background: var(--rp-device);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
  line-height: 0;
}
.rp-canvas {
  image-rendering: pixelated;
  touch-action: none;
  cursor: pointer;
  background: #000;
}
.rp-error {
  position: absolute;
  inset: auto 16px 16px 16px;
  max-height: 45%;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  background: var(--rp-error-bg);
  color: var(--rp-error-text);
  border-radius: 8px;
  font: 12px/1.5 var(--rp-mono);
  white-space: pre-wrap;
}
.rp-panel, .rp-panel-slot {
  background: var(--rp-surface);
  border-left: 1px solid var(--rp-border);
  overflow: auto;
}
.rp-panel section { padding: 14px 16px; border-bottom: 1px solid var(--rp-border); }
.rp-panel h2 {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--rp-muted);
}
.rp-section-head { display: flex; align-items: baseline; justify-content: space-between; }
.rp-signals { display: grid; grid-template-columns: auto 1fr; gap: 8px 10px; align-items: center; }
.rp-signal { display: flex; flex-direction: column; }
.rp-signal-name { font-family: var(--rp-mono); }
.rp-type { color: var(--rp-muted); font-family: var(--rp-mono); font-size: 11px; }
.rp-number { display: flex; gap: 8px; align-items: center; min-width: 0; }
.rp-number input[type="range"] { flex: 1; min-width: 0; }
.rp-panel input[type="number"], .rp-panel input[type="text"] {
  width: 76px;
  padding: 3px 6px;
  border: 1px solid var(--rp-border);
  border-radius: 5px;
  background: var(--rp-bg);
  color: inherit;
  font: 12px var(--rp-mono);
}
.rp-panel input[type="text"] { width: 100%; }
.rp-declared { margin: 0 0 10px; color: var(--rp-muted); font: 11px/1.6 var(--rp-mono); white-space: pre-wrap; }
.rp-empty { margin: 0; color: var(--rp-muted); }
.rp-log { list-style: none; margin: 0; padding: 0; font: 12px/1.5 var(--rp-mono); }
.rp-log li { display: flex; gap: 8px; padding: 3px 0; border-top: 1px solid var(--rp-border); }
.rp-log li:first-child { border-top: 0; }
.rp-log time { color: var(--rp-muted); }
.rp-log code { overflow-wrap: anywhere; }
.rp-list + .rp-list { margin-top: 12px; }
.rp-list .rp-section-head { gap: 8px; justify-content: flex-start; }
.rp-list .rp-link { margin-left: auto; }
.rp-list li .rp-link { margin-left: auto; flex: none; }
.rp-list-add { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.rp-list-add input[type="text"], .rp-list-add input[type="number"] { width: 90px; }
.rp-link { border: 0; background: none; color: var(--rp-accent); font: inherit; cursor: pointer; padding: 0; }
@media (max-width: 760px) {
  .rp-shell { grid-template-columns: 1fr; grid-template-rows: auto auto auto; height: auto; }
  .rp-panel, .rp-panel-slot { border-left: 0; border-top: 1px solid var(--rp-border); }
  .rp-header { flex-wrap: wrap; }
}
`;
