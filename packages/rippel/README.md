# Rippel

Build embedded display UIs for microcontrollers with TSX and CSS. You write the UI like a SolidJS app, preview it in the browser on the real LVGL renderer, and generate C that runs on the device.

The browser preview and the device both draw with LVGL 9.6, so what you see in the simulator is what the display shows.

## Install

```bash
npm install rippel
```

Rippel needs Node.js 20.19 or later. To run the generated C on hardware you also need ESP-IDF 5.5 and LVGL 9.6.

## Set up a project

```
rippel.config.ts          display, MCU, fonts, where the C goes
tsconfig.json
src/App.tsx               root component
src/styles.css            styles (a subset of CSS that maps onto LVGL)
src/firmware.contract.ts  signals the firmware pushes, actions the UI calls
src/firmware.mock.ts      optional: a script that plays the firmware in the simulator
```

`rippel.config.ts`:

```ts
import { defineConfig } from "rippel";
import { adafruit_3_5_tft } from "rippel/displays";
import { esp32s3 } from "rippel/mcu";

export default defineConfig({
  entry: "src/App.tsx",
  contract: "src/firmware.contract.ts",
  display: adafruit_3_5_tft({ rotation: 90 }),
  mcu: esp32s3(),
  output: { dir: "firmware/components/ui", integration: "esp-idf" },
});
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "jsxImportSource": "rippel",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["rippel/client"]
  },
  "include": ["src", "rippel.config.ts"]
}
```

`src/firmware.contract.ts` declares what passes between the UI and your firmware:

```ts
import { action, i16, signal } from "rippel/contract";

/** Room temperature in whole °C, pushed by the firmware. */
export const temperature = signal(i16, { initial: 22 });

/** Asks the firmware to hold the room at this temperature. */
export const setpoint = action({ celsius: i16 });
```

`src/App.tsx`:

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

## Commands

Run these from the project folder, with `npx` or from your `package.json` scripts.

- `rippel dev` starts the browser dev runtime with hot reload. The page shows the simulated display, a panel for setting firmware signals and watching action calls, and LVGL's heap usage.
- `rippel check` reports code and styles the device build won't be able to compile.
- `rippel build` generates the C code for the device into `output.dir`.

`rippel --help` lists the options, including `--target` for building the same UI for other hardware listed under `targets` in the config.

## Run it on a device

`rippel build` writes an ESP-IDF component: `ui.c`, `ui.h`, `lv_conf.h`, the Rippel bridge and a `CMakeLists.txt`. Put `output.dir` under your firmware's `components/` folder, and add LVGL 9.6 as a component named `lvgl`. From the firmware folder:

```bash
git clone --branch v9.6.0 --depth 1 https://github.com/lvgl/lvgl.git components/lvgl
```

The UI component tells LVGL to compile against its own `lv_conf.h`, so the settings match the UI. Everything else in your firmware is ordinary code you own: the display and touch drivers, the code that pushes signals (`ui_set_temperature(...)`), and the functions that implement each action.

## Custom C widgets

You can draw parts of the UI with your own LVGL C code. On the device they compile into the UI component. In the browser, the simulator only runs them when it's built from a clone of the Rippel repo with Emscripten installed. Otherwise `rippel dev` shows a labelled placeholder in their place.

## More

The [Rippel repository](https://github.com/MasonWray/Rippel) has two full example projects with firmware for real boards, and a [design doc](https://github.com/MasonWray/Rippel/blob/main/docs/design.md) covering what the compiler supports.

## Licence

MIT. The C that `rippel build` generates from your UI is yours. The copied bridge files (`rippel_bridge.c` and `.h`) are MIT and carry their own notice. The prebuilt simulator includes LVGL, also MIT. See `THIRD_PARTY_NOTICES.md`.
