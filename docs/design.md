# Rippel design

Status: draft. M1 (browser dev runtime) and M2 (C codegen) are done. Last updated 2026-11-11.

Rippel is a toolchain for building embedded display UIs with web tooling. You write the UI in TSX and CSS, preview it in the browser on the real renderer, and build it into C code that runs on a microcontroller using [LVGL](https://lvgl.io).

## Decisions so far

| # | Decision | Why |
|---|---|---|
| 1 | **Targets are microcontrollers only.** | Linux boards already have reasonable options for this (Qt, Slint, a browser). MCUs don't. |
| 2 | **The audience is embedded developers** who want nicer UI authoring. | They already own the firmware and its logic. What they lack is a good way to build the screens. |
| 3 | **Only the UI layer is compiled to C.** App logic stays in firmware, behind a generated, typed interface. | Compiling arbitrary JS to C means writing a JS compiler. Views, styles, bindings and simple expressions can be compiled reliably. |
| 4 | **Generated code is never edited by hand.** | Hand edits get lost on regeneration and quietly break things. Every customization needs a supported route (config, contract, escape hatches). |
| 5 | **The render target is LVGL 9.** | It supports a huge range of displays, input devices and MCUs. Rippel's value is the toolchain, not the pixels. |
| 6 | **The authoring API is modeled on SolidJS.** | Solid's fine-grained reactivity matches LVGL's retained object tree: create objects once, then update one property when its signal changes. No virtual DOM to emulate. |
| 7 | **The preview runs real LVGL compiled to WASM.** | The browser preview and the device share one renderer, so what you see is what ships. |
| 8 | **Rippel is an npm package with a CLI and a root `rippel.config.ts`.** | It's the familiar Vite / Drizzle / Prisma pattern. Vite is used internally for the dev server. |
| 9 | **Display, board and MCU are configuration from day one.** | Changing hardware should mean editing the config file, not reworking the project. |
| 10 | **Shipping the compiler as one self-contained binary is a goal, not a requirement.** | Firmware CI shouldn't need Node if we can avoid it. We'll drop or defer this if it costs too much. |
| 11 | **Custom C widgets show as placeholders in the simulator at first.** | Showing them for real means compiling the user's C into the WASM build, which needs Emscripten on the user's machine. That's deferred. |

## Architecture

```
 src/**/*.tsx   src/**/*.css   src/firmware.contract.ts   rippel.config.ts
        └──────────────┬──────────────┴───────────────────────────┘
                       ▼
                    Front-end (shared)
   Babel parser · subset validator · CSS → LVGL styles
   contract parser · font pipeline (lv_font_conv) · image pipeline
                       │
           ┌───────────┴────────────┐
           ▼                        ▼
      Dev runtime                C codegen
  Solid universal renderer   ui.c / ui.h, lv_conf.h,
     → bridge (JS)           fonts, images, build glue
     → LVGL in WASM                 │
           │                        ▼
     browser canvas         firmware build → device
```

The **bridge** is the main design seam. It's a small set of operations: create a widget, set a prop, set a style, attach an event, delete. The dev runtime calls these operations from JS through WASM, and generated C calls the equivalent C functions directly. Keeping one interface with two callers is what keeps the preview and the device in sync.

## Authoring model

### Elements

Elements use LVGL widget names, not HTML names, so nobody expects arbitrary HTML to work. They are typed intrinsic elements, so the editor autocompletes them and rejects anything unknown.

Touches pass through a plain `view` to whatever is behind it, unless it has an event handler or the `scroll` prop. A `view` doesn't scroll unless it has `scroll`.

Elements so far: `view`, `label`, `button`, `slider`, `arc`, `bar`, `image`, `switch`, `checkbox`, `dropdown`. Later: `textarea`, `chart`, `tabview`, and so on.

### Reactivity

`createSignal`, `createMemo`, `createEffect` (limited), `<Show>`, `<For>`, `<Switch>/<Match>`. These are Rippel's own APIs, shaped like Solid's. The dev runtime is built on `solid-js` for now, but users import from `rippel`, which leaves room to change the runtime later (Solid 2.0, or our own).

### Styling

A CSS subset that maps directly onto LVGL styles:

- Class selectors only. No descendant or sibling selectors.
- Pseudo-classes map to LVGL states: `:active` → pressed, `:focus` → focused, `:focus-visible` → focus-key, `:hover`, `:checked`, `:disabled`.
- Pseudo-elements map to LVGL parts: `::indicator`, `::knob`, `::scrollbar`, `::selected`, `::items`, `::cursor`. For example `.slider::knob:active`.
- `display: flex` maps to LVGL's flex layout. Grid comes later.
- Units: `px`, `%` and `rem` (resolved at compile time). `em` is rejected, since there is no font-size cascade to resolve it against.
- Colors always set their matching opacity property too, so `background` works on unstyled views.
- `transition` maps to LVGL style transitions. They run when a state changes (`:active`, `:checked`, `:disabled`), not when a class changes. LVGL has one duration, delay and easing per transition, and needs the properties listed, so `all` is an error.
- A `:disabled` rule turns off the grey tint LVGL's theme adds, so the colors you write are the colors you get.
- `align-items` also places the flex track, so a single line aligns against the whole container as it does in CSS.
- `@media` queries are settled at compile time against the configured display, since it can't change at runtime. They support `width`, `height`, their `min-` and `max-` forms, and `orientation`, joined with `and` or commas. Only the matching rules reach the device. A block that doesn't match the current display isn't checked until you build for a display it matches.
- Fonts are chosen by `font-family` and `font-size` together and must exist in the font catalog: built-in Montserrat sizes plus fonts from `rippel.config.ts`.
- Anything unsupported is a build error with a clear message, never silently ignored.

The same translator applies styles in the dev runtime and will emit style data in codegen. The supported properties are listed in `packages/rippel/src/style/translate.ts`.

### Subset validator

The validator flags code the C backend can't compile. It runs in dev from day one, so the dev runtime can't drift into accepting code that production would reject.

Version 1 (M1) checks syntax and imports: no classes, async, generators, exceptions, regular expressions, `new`, `delete`, dynamic `import()`, browser globals, or imports outside `rippel`, `rippel/contract` and the project's own files. It runs as a Vite transform (errors show in the dev overlay) and as `rippel check`. A TypeScript language-service plugin, for errors while typing, comes later.

## Firmware contract

The contract is the single source of truth for how the UI and firmware talk. It's written in TypeScript so its types flow straight into the TSX.

```ts
// src/firmware.contract.ts
import { signal, action, i16, u8 } from "rippel/contract";

export const temperature = signal(i16, { initial: 20 });
export const batteryPct  = signal(u8);
export const setpoint    = action({ celsius: i16 });
```

From that, Rippel generates a stable header. A sketch of the shape:

```c
/* GENERATED BY RIPPEL. DO NOT EDIT. */
void ui_init(lv_display_t *disp);
void ui_set_temperature(int16_t value);
void ui_set_battery_pct(uint8_t value);

typedef struct {
    void (*setpoint)(int16_t celsius);
} ui_actions_t;
void ui_set_actions(const ui_actions_t *actions);
```

Firmware calls the setters and implements the actions in its own files. Generated files never contain user code.

In dev, the contract also drives a **firmware mock panel**: a control for every signal and a log of every action call.

A project can also add `src/firmware.mock.ts`, a script that plays the firmware in the simulator using `defineMock` from `rippel/mock`. It pushes signals and answers actions on a timer. It only runs in the browser and is never compiled for the device, so the subset validator skips it and it can use any JavaScript.

## Project shape and configuration

```
my-device/
  firmware/                 ESP-IDF / Zephyr / CMake project (user-owned)
  ui/
    package.json
    rippel.config.ts
    src/
      App.tsx
      styles.css
      firmware.contract.ts
```

```ts
// rippel.config.ts
import { defineConfig } from "rippel";
import { esp32s3 } from "rippel/mcu";
import { adafruit_2_8_tft } from "rippel/displays";

export default defineConfig({
  entry: "src/App.tsx",
  contract: "src/firmware.contract.ts",
  display: adafruit_2_8_tft({ rotation: 90 }),   // or { width, height, colorFormat, dpi }
  mcu: esp32s3({ psramKB: 8192 }),
  output: {
    dir: "../firmware/components/ui",
    integration: "esp-idf",                      // "cmake" | "zephyr" | "platformio" | ...
  },
});
```

CLI:

- `rippel dev` starts the Vite-powered browser preview: device canvas, firmware mock panel, hot reload.
- `rippel build` validates the project and emits C into `output.dir`. Like `prisma generate`, it's codegen, not a Vite bundle.
- `rippel check` runs the validator only, for CI.

The firmware build can also call `rippel build` itself (a CMake step or ESP-IDF component hook), so the generated code is never stale and never committed.

### What the hardware settings control

- **Display:** resolution, color format, DPI, rotation. Used by both the simulator and codegen.
- **MCU:**
  - number defaults (whether floats are cheap depends on the FPU)
  - memory budget and settings in the generated `lv_conf.h`
  - GPU draw backend (DMA2D on STM32, PPA on ESP32-P4, VGLite on NXP)
  - flash placement attributes for fonts and images
  - build integration defaults
- **Targets:** `targets` in `rippel.config.ts` lists other hardware the same UI runs on. `--target <name>` on any command selects one, and `@media` queries see its display. The thermostat builds for the ESP32-S3 with a 480×320 display and the ESP32-C6 with a 170×320 portrait display, from one UI.
- Display and MCU presets are plain data and functions. Anyone can write their own, and a custom display is just `{ width, height, ... }`.

Rippel generates `lv_conf.h` with only the widgets the UI actually uses enabled, which saves flash.

Display and touch **drivers** belong to the firmware for now. Rippel takes an `lv_display_t*` in `ui_init`. Optional driver glue for known boards could come later as presets.

### The WASM simulator ships prebuilt

LVGL is compiled to WASM once and shipped inside the npm package, with every supported widget enabled. Resolution and color format are set when it starts. Users never need Emscripten.

## Generated code rules

1. Output lives in `output.dir` and carries a "do not edit" banner. We recommend not committing it.
2. The public API (`ui.h`) stays small and versioned: init, setters, action callbacks, named object handles.
3. Output is deterministic: the same input gives byte-identical files.
4. Generated code must not depend on anything outside LVGL and the C standard library.

## Escape hatches

Without escape hatches, people end up editing generated code. Rippel needs:

- **Custom widgets:** a C function in user-owned code, declared in the contract and used as `<custom:Gauge value={x()} />`. The simulator shows a labeled placeholder (decision 11).
- **Named object handles:** `<view id="statusBar">` generates `ui_obj(UI_OBJ_STATUS_BAR)`, returning the `lv_obj_t*` for the rare case firmware needs raw LVGL access.

## Milestones

### M1: browser dev runtime

1. Build LVGL 9 to WASM. Flush into a canvas, forward pointer input, set resolution and color format at startup.
2. Write the bridge C shim (create, set prop, set style, event, delete) and its JS bindings.
3. Write the Solid universal renderer on top of the bridge.
4. Build the shared front-end pieces: CSS → LVGL style translator, font pipeline, first version of the subset validator.
5. Build the contract parser and the firmware mock panel.
6. Set up `rippel.config.ts` loading and `rippel dev` (Vite, hot reload).
7. Support the v0 elements (`view`, `label`, `button`, `slider`) and flex layout.

**Done when:** a sample thermostat UI runs in the browser at the reference display's resolution, reacts to mock firmware signals, logs actions, and hot-reloads on edits.

**Status: done.** `examples/thermostat` runs at 320×240 RGB565 with all of the above. Notes from building it:

- **Stack:** LVGL 9.6.0 (git submodule), Emscripten 7.0.0, Vite 8, Solid 1.9 universal renderer. The WASM build is about 970 KB. It's prebuilt and committed so contributors don't need Emscripten.
- **Bridge:** `native/bridge/rippel_bridge.{h,c}` is platform-independent. The simulator platform (`native/sim/sim.c`) owns the display, input and tick. LVGL constants are looked up by name through the bridge, so JS never hardcodes LVGL's numeric values.
- **Input:** each pointer change is processed by LVGL immediately (`lv_indev_read`), not on the next frame. Otherwise fast clicks get lost when `requestAnimationFrame` is throttled (background tabs, hidden panes).
- **Text:** text children become the text of a `<label>`, or of an implicit centered label inside a `<button>`. Text anywhere else is an error.
- **Slider events** follow the web: `onInput` fires while dragging, `onChange` on release.
- **The contract is read at runtime in M1.** The dev shell imports the contract module and reads each signal's and action's metadata. The static contract parser that C header generation needs moves to M2.
- **Hot reload:** CSS updates styles in place. TSX updates go through Solid's hot reload, which re-runs the edited component, so its local signals reset. Firmware signal values survive.
- **Dev tooling:** `rippel check` already caught a real CSS mistake (`radius` instead of `border-radius`) while building the example.

### M2: C codegen vertical slice

1. Hand-write the C we want generated for the M1 sample.
2. Build codegen that produces equivalent C: static tree, styles, signal bindings, actions, the contract header, and `lv_conf.h`.
3. Support `<Show>` and `<Switch>`, since the sample uses `<Switch>`.
4. Compile the generated C to WASM and pixel-diff it against the dev runtime, so codegen can be tested on every change without a board.
5. Add ESP-IDF and plain CMake integration.
6. Run the sample on the reference board.

**Done when:** the same sample runs on the reference board, built by `rippel build`, with no hand edits.

**Status: done.** `rippel build` generates the thermostat, `npm run conformance` passes, and the result runs on an Adafruit QT Py ESP32-S3 with the Adafruit 3.5" 480×320 display, including touch, with no edits to generated code. How it works:

- **Components are inlined** at each use. Nothing is evaluated at compile time, and there is no JS on the device.
- **Each reactive JSX expression becomes one generated bind function.** A signal's setter compares the new value and calls the binds that read it. `lv_subject_t` isn't used: it only holds a few value types, and derived values need generated functions anyway.
- **`<Show>` and `<Switch>` build all their branches up front** and hide the inactive ones. Memory use is predictable, but a branch keeps its objects while hidden. Components with local signals inside a branch are rejected for now, because the dev runtime resets those signals when a branch reopens.
- **Number types are inferred.** Contract signals use their declared types. A local number signal is `int32_t` unless something assigns it a fraction, then it's `float`. `/` always produces a float. An MCU with no FPU gets a build warning instead of different behavior.
- **`lv_conf.h` is generated** with only the widgets and Montserrat sizes the UI uses. `ui_init` sets the DPI after the display is created, in the same order as the simulator, so LVGL's theme scales the same way.
- **The output folder includes the bridge**, so generated code and the simulator share `rippel_bridge.c`.
- Anything outside the subset is a build error with a file and line.

Notes from bringing it up on the board:

- **Stack:** LVGL's software renderer needs more than ESP-IDF's default 3.5 KB main task stack. The thermostat peaked at about 4.7 KB. The example uses 16 KB. Projects that call `lv_timer_handler` from `app_main` need the same change.
- **Touch calibration** belongs to the firmware. The raw edge values are measured per panel and live in `board.h`.

### M3 and later

**In progress.** The target is the espresso demo on the reference board. It now builds and runs there in full, using these additions:

- **Compile-time evaluation.** Anything that doesn't depend on a signal is computed during the build, including constant tables, `.map` and your own helper functions. `<For>` over a constant list expands into one copy per item.
- **Tables read through a signal.** A value like `RECIPES[recipeIndex()].name` is evaluated once per row and becomes a C lookup table. Class names work the same way.
- **`createEffect`** becomes a bind function that re-runs when any signal it read changes.
- **Inline lengths** like `height` can change at runtime.
- **Local string signals** hold pointers to string literals.
- **Branch state:** local signals inside a `<Show>` or `<Switch>` branch reset when it reopens, as they do in the dev runtime.
- **`createList`** holds records that change at runtime. It takes a fixed `capacity` and field types from the contract, like `{ rating: u8, name: str(16) }`, so storage is reserved at build time and strings have a known size. The device builds one row per slot up front, shows the slots in use, and moves rows when the order changes. Adding to a full list drops the oldest item.
- **Images** come from importing a `.png` and passing it to `<image src>`. They're converted to the display's pixel format at build time and stored in flash, as RGB565, or RGB565A8 when they have transparency. `src` can change at runtime between images known at build time. `image-recolor` tints an image, and `fit` scales it, which costs CPU on every redraw.
- `output.lvglHeapKB` sets LVGL's memory. Every branch is built up front, so a UI with several screens needs more than one screen's worth.

Still to come:


- Lists pushed from firmware through the contract
- More widgets, images, animations, multiple screens and navigation
- Single-binary compiler (decision 10)
- More integrations (Zephyr, PlatformIO), more MCU and display presets
- Real custom widgets in the simulator

## Open questions

1. **Numeric types (settled for now).** Inferred, as described under M2. Wider integer types for locals may be needed later.
2. **Signals in C (settled).** Generated setters and bind functions. See M2.
3. **`<Show>` default.** M2 hides prebuilt objects, which keeps memory predictable. Creating and destroying them could become an option for screens that are rarely open.
4. **Firmware-provided lists.** `createList` settles storage for lists owned by the UI. A firmware-side list needs a way to declare and push it through the contract.
5. **LVGL version.** Pin one version per Rippel release? Allow user-supplied `lv_conf.h` overrides?
6. **Reference hardware (settled).** An Adafruit QT Py ESP32-S3 and the Adafruit 3.5" 480×320 TFT.
7. **Package name.** `rippel` is unclaimed on npm as of 2026-11-07. Reserve it, and decide whether to use one package or a scope (`@rippel/*`).
8. **Glyph coverage.** A character missing from the font renders as a box (the built-in Montserrat has no `·`, for example). The validator could check string literals against each font's ranges.
9. **Prebuilt WASM in git.** Committing `wasm/` keeps contributor setup simple but adds about 1 MB per rebuild to history. Alternatives: build it in CI and publish it only in the npm package, or use Git LFS.
