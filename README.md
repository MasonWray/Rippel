# Rippel

Build embedded display UIs for microcontrollers with TSX and CSS. You write the UI like a SolidJS app, preview it in the browser on the real LVGL renderer, and (from milestone 2) build it into C that runs on the device.

See [docs/design.md](docs/design.md) for the design and roadmap.

**Status:** milestone 1 (the browser dev runtime) works. C code generation hasn't started.

## Try the example

The example is a thermostat UI for a 320×240 display.

```bash
git clone --recursive https://github.com/MasonWray/Rippel.git
cd Rippel
npm install
npm run dev
```

`npm run dev` builds the `rippel` package and starts the example at http://localhost:5173. The page shows the simulated display, a panel for setting firmware signals and watching action calls, and LVGL's heap usage.

If you cloned without `--recursive`, run `git submodule update --init` first. The example's custom font comes from the LVGL submodule.

## See the demo

`examples/espresso` is a full espresso machine UI for an 800×480 display. A scripted mock plays the firmware, so the whole thing runs on its own in the browser.

```bash
npm run demo
```

Wait for the boiler to heat up, pick a recipe and press **Start shot**. Things to try:

- Switch recipes. One signal recolors the UI and updates the settings, the yield and the boiler target.
- Watch a shot: live dials and a pressure trace drawn over the recipe's target, updating one bar at a time.
- In History, sort by **Top rated** and change a rating. The rows reorder as you tap.
- In the signals panel, drag `waterPct` below 15 to see the machine refuse to brew.

The demo runs in the browser simulator. C code generation for the device comes in later milestones.

## What a Rippel project looks like

```
rippel.config.ts          display, MCU, fonts
src/App.tsx               root component
src/styles.css            styles (a subset of CSS that maps onto LVGL)
src/firmware.contract.ts  signals the firmware pushes, actions the UI calls
src/firmware.mock.ts      optional: a script that plays the firmware in the simulator
```

```tsx
import { createSignal } from "rippel";
import { temperature, setpoint } from "./firmware.contract";
import "./styles.css";

export default function App() {
  const [target, setTarget] = createSignal(21);
  return (
    <view class="screen">
      <label class="temperature">{temperature()}°</label>
      <slider min={10} max={30} value={target()} onInput={setTarget} />
      <button onClick={() => setpoint({ celsius: target() })}>Apply</button>
    </view>
  );
}
```

Commands, run from a project folder:

- `rippel dev` starts the browser dev runtime with hot reload.
- `rippel check` reports code and styles the device build won't be able to compile.

## Repository layout

```
packages/rippel/          the npm package
  src/                    TypeScript: renderer, CSS translator, contract, dev shell, CLI
  native/bridge/          C bridge between Rippel and LVGL (shared with future codegen)
  native/sim/             browser simulator platform and its lv_conf.h
  native/lvgl/            LVGL 9.6 (git submodule)
  wasm/                   prebuilt simulator (LVGL + bridge compiled to WASM)
examples/thermostat/      small example project
examples/espresso/        full demo project
docs/design.md            design doc
```

## Working on Rippel

```bash
npm run build      # compile the package
npm test           # unit tests
```

The simulator WASM in `packages/rippel/wasm/` is prebuilt and committed, so you only need Emscripten if you change the C code or update LVGL:

```bash
npm run setup:emsdk   # installs Emscripten 7.0.0 into .toolchain/ (about 1 GB, one time)
npm run build:wasm    # incremental; add -- --clean after updating LVGL
```
