# Rippel guide for coding agents

Read this before you write or change UI code in a Rippel project. It's written for AI coding agents, and it's useful to people too.

Rippel looks like SolidJS, but it isn't Solid for the web. Your TSX and CSS are compiled to C and run on a microcontroller with LVGL. Most of what you know about Solid still holds: signals, components, `<Show>`, `<For>`. What changes is everything that would need a JavaScript engine on the device. This guide lists those changes.

## How to check your work

Run both of these from the project folder before you call a change done:

```bash
npx tsc --noEmit        # types: unknown elements, wrong props, wrong contract argument types
npx rippel build        # the real test: runs `rippel check`, then compiles the UI to C
```

Each tool catches something different:

- **`rippel check`** catches banned syntax (classes, `async`, `try`, regex, `new`), banned imports and globals, and CSS errors. It's fast, but it **doesn't** run the compiler, so passing it doesn't mean the code will build.
- **`rippel build`** runs `check`, then compiles to C. Most of the rules in this guide are enforced only here. It writes to `output.dir` in `rippel.config.ts`. To compile without touching that folder, pass `--out` with a scratch folder.
- **`rippel dev`** runs the UI in the browser on the real LVGL renderer. The browser preview runs your TSX with real Solid, so **code that works in the preview can still fail `rippel build`**. Never treat a working preview as proof that the code compiles.

Error messages give a file, line and column, and usually say what to do instead. Trust them over your Solid instincts. If a message says something "isn't supported by `rippel build` yet", rewrite the code in a supported way; don't work around the check.

## Project layout

```
rippel.config.ts          display, MCU, fonts, output folder, build targets
tsconfig.json             "jsx": "preserve", "jsxImportSource": "rippel", "types": ["rippel/client"]
src/App.tsx               root component: `export default function App()`
src/styles.css            styles, imported from TSX: `import "./styles.css"`
src/firmware.contract.ts  signals the firmware pushes, actions the UI calls
src/firmware.mock.ts      optional: plays the firmware in the simulator
```

Generated C goes to `output.dir`. Never edit it by hand. It's overwritten on every build.

## Imports

UI code can import only from `rippel`, `rippel/contract` and your own files (relative paths). It can't use npm packages, `solid-js` or Node modules. Type-only imports (`import type`) are fine.

- `rippel`: `createSignal`, `createMemo`, `createEffect`, `batch`, `Show`, `For`, `Index`, `Switch`, `Match`, `createList`, and the types `Component`, `ParentComponent`, `Accessor`, `Setter`, `Signal`, `JSX`, `ImageAsset`, `ItemOf`, `ListItem`. `defineConfig` is for `rippel.config.ts` only.
- `rippel` also exports `onMount`, `onCleanup`, `untrack` and `on`, so the preview runs them, but **`rippel build` rejects all four**. Don't use them. Use `createEffect` or a handler instead.
- `rippel/contract`: `signal`, `action`, `list`, `widget`, and the value types `i8`, `u8`, `i16`, `u16`, `i32`, `u32`, `f32`, `bool`, `str(n)`.
- `rippel/displays` and `rippel/mcu`: hardware presets for `rippel.config.ts`. Displays: `adafruit_2_8_tft`, `adafruit_3_5_tft`, `waveshare_1_9_lcd`, `esp32_s3_box_3`, or a plain `{ width, height, colorFormat, dpi }`. MCUs: `esp32`, `esp32s3`, `esp32c6`, `esp32p4`, `rp2040`, `rp2350`, `stm32f429`, `stm32h747`.
- `rippel/mock`: `defineMock`, for `src/firmware.mock.ts` only.
- `.css` files are imported for their side effect. A `.png` file is a default import that gives an `ImageAsset`.

## Elements

Elements are LVGL widgets, not HTML. There's no `div`, `span`, `p`, `img` or `input`.

| Element | Use it for | Props beyond the common ones | Events |
|---|---|---|---|
| `view` | container, like `div` | `scroll` | common only |
| `label` | text | | common only |
| `button` | pressable; text children become a centered label | | common only |
| `slider` | horizontal value picker | `min`, `max`, `value` | `onInput(value)` while dragging, `onChange(value)` on release |
| `arc` | circular dial or gauge; can hold children | `min`, `max`, `value`, `readonly` | `onInput(value)`, `onChange(value)` |
| `bar` | progress bar | `min`, `max`, `value` | common only |
| `switch` | on/off toggle | | `onChange(checked)` |
| `checkbox` | check box; text children are its label | | `onChange(checked)` |
| `dropdown` | pick one of several strings | `options` (constant `string[]`), `selected` (index) | `onChange(index)` |
| `image` | picture from an imported `.png` | `src`, `fit` (`none`, `contain`, `cover`, `fill`) | common only |

Common props on every element: `class`, `style`, `id`, `hidden`, `disabled`, `checked`, and the events `onClick`, `onPress`, `onRelease`, `onLongPress`, `onFocus`, `onBlur`. Any other `on…` prop is an error, such as `onInput` on a `view`.

- **Text goes in a `label`**, or as the text of a `button` or `checkbox`. Text directly inside a `view` is an error.
- `checked` and `disabled` set LVGL states, which you style with `:checked` and `:disabled`. Setting `checked` on a `view` is the usual way to show a selected state, like the active tab or a filled rating dot.
- A plain `view` passes touches through to whatever is behind it, unless it has an event handler or `scroll`. It doesn't scroll unless it has `scroll`.
- `hidden` can't go on the top element of a `<Show>` or `<Match>` branch. Wrap the element, or use the branch's condition.
- `id="name"` lets firmware get the object's `lv_obj_t*`. Its value must be a string literal.
- Fragments (`<>…</>`) are fine.

## Components and reactivity

Components are plain functions. On the device they're inlined at every use. Nothing in your TSX runs on the device; the compiler turns it into C that builds the screen once and updates single properties when signals change. That's why the rules below are stricter than Solid's.

**Signals hold numbers, booleans or strings.** `createSignal([...])` and `createSignal({...})` don't build. For a collection that changes at runtime, use `createList`. For a fixed set of values, keep one signal per value, or index a constant array with a number signal.

```tsx
const [mode, setMode] = createSignal(0);    // ok
const [name, setName] = createSignal("");   // ok
const [items, setItems] = createSignal([]); // no: use createList
```

- `createSignal` needs an initial value, and that value can't read another signal.
- **Setters take a value, never a function.** Write `setCount(count() + 1)`, not `setCount(c => c + 1)`.
- Derived values are plain functions: `const doubled = () => count() * 2`. `createMemo(() => …)` works the same way.
- Inside a component or function, every variable must be `const`. Module-level `let` and `var` don't build either. Mutable state goes in a signal.
- `createEffect(fn)` works at the top of a component. `fn` follows the handler rules below, and re-runs when any signal it reads changes.
- Destructuring props builds, but it breaks reactivity in the preview, as in Solid. Read `props.x`.
- Props can carry values, setters and callbacks: `<Param value={level()} onInput={setLevel} />`.
- **State shared across screens goes at module level**, usually in a `src/state.ts` file. `export const [tab, setTab] = createSignal(0);` works there, along with derived functions, helpers that set signals or call actions, and `createList`. Signals created inside a component belong to that component. In a `lazy` branch, they restart from their initial value each time the branch opens.
- A `label` can mix text and expressions: `<label>Target {target()}°C</label>`. On the device, a run of spaces in JSX text becomes one space. To keep more, write them as a string: `{hour}:00{"  "}{temp}°`.

### Expressions (anything shown or bound in JSX)

Allowed:

- number, string and boolean literals; template literals; string `+`
- arithmetic: `+ - * / %`. `/` always gives a float, so use `Math.round` or `Math.floor` to get a whole number back.
- comparisons. Strings compare with `===` and `!==`.
- `cond ? a : b`, with both sides the same kind of value (string, number or boolean)
- `!x`. **`&&` and `||` only on booleans.** `count() && …` is an error; write `count() > 0 && …`.
- `n.toFixed(d)` with a literal `d` from 0 to 6, `n.toString()`, `String(n)`
- `Math.round`, `floor`, `ceil`, `trunc`, `abs`, and `Math.min` and `Math.max` with exactly two arguments, plus `Math.PI`
- calling your own functions, reading props, and indexing a constant array with a signal: `NAMES[mode()]`

Not allowed in reactive expressions:

- `??` and optional chaining
- string methods and properties: `.length`, `.toUpperCase()`, `.slice()`, `.includes()`, `.padStart()`, `.split()`
- array methods on runtime data: `.map`, `.filter`, `.length`
- `parseInt`, `parseFloat`, `JSON`, `Date`, `Map`, `Set`, `Promise`, `setTimeout`, `fetch`, `console`, `window`, `document`
- `untrack`

A function that returns a value can have `const` declarations and early returns written as `if (…) return x;`, and must end with a `return`. Other statements, and `if` with an `else`, don't build there:

```tsx
const status = () => {
  if (waterLow()) return "Refill water";
  if (!ready()) return "Heating";
  return "Ready";
};
```

### Constant data is evaluated at build time

Module-level `const` data that doesn't read signals is worked out by the compiler, so it can use more JavaScript: array and object literals, `.map`, `.filter`, `.indexOf`, `.includes`, `Array.from({ length: n }, fn)`, `Math.*`, `Number()` and `String()`. Keep tables, labels, recipes and options here, and pick from them with a number signal.

```tsx
const MODES = [
  { label: "Heat", color: "orange" },
  { label: "Cool", color: "blue" },
];
const [mode, setMode] = createSignal(0);
// <label class={`mode mode-${MODES[mode()].color}`}>{MODES[mode()].label}</label>
```

### Event handlers

Handlers do things; they don't compute values. A handler body can contain only:

- setter calls, action calls, and calls to your own functions (which follow the same rules)
- `batch(() => { … })`
- `if` / `else`, `cond && doThing()`, `cond ? doA() : doB()`
- `const` locals that hold numbers or booleans. **String locals don't build**, so put the expression inline: `setName(a() === "x" ? "y" : "z")`.
- `for (const x of CONSTANT_ARRAY)`, which is unrolled at build time. Loops over runtime data don't build.
- a bare `return;`, but not inside a helper function the handler calls

`switch`, `while`, `let`, `try` and returning a value don't build in handlers.

Event props take a function: `onClick={save}` or `onClick={() => save(3)}`. Value events pass the new value: `<slider onInput={setLevel} />`.

## Control flow

- `<Show when={…} fallback={…}>`: `when` can be a boolean, a number or a string (an empty string is false). The children must be elements. The function child form `{(v) => …}` doesn't build.
- `<Switch>` with `<Match when={…}>` children only, with an optional `fallback`.
- By default, the device builds every branch at startup and hides the inactive ones. Add `lazy` (to `<Show>`, `<Match>` or `<Switch>`) to build a branch's objects when it opens and delete them when it closes. This saves LVGL memory for whole screens. `lazy` must be written literally (`lazy` or `lazy={true}`).
- Write `{cond ? <a /> : <b />}` or `{cond && <a />}` with a boolean `cond`.
- **`<For each={…}>` takes a constant array** (unrolled at build time) **or a `createList` / contract `list`** (`list.items()`, `list.sorted(compare)`). It can't take `.map()` in JSX, or a constant array filtered by a signal. To show a filtered subset, keep the full constant list and set `hidden` or `checked` on each row from the signal.
- Over a constant array, `<For>` passes `(item, index)` as in Solid, where `index` is an accessor: `index()`. `<Index>` also works over constant arrays and passes `(item, index)`, where `item` is an accessor and `index` is a number.
- For a runtime list, each row must be a single element, and the index argument isn't available.
- **The device build ignores `fallback` on `<For>`**, without an error. For an empty state, add `<Show when={list.size() === 0}>` next to the `<For>`.

## Lists that change at runtime

```tsx
import { createList, type ListItem } from "rippel";
import { f32, u8 } from "rippel/contract";

const FIELDS = { rating: u8, seconds: f32 };
export type Shot = ListItem<typeof FIELDS>;
export const shots = createList({ capacity: 12, fields: FIELDS, initial: [] });

shots.add({ rating: 3, seconds: 27.5 }); // in a handler. When the list is full, the oldest item is dropped.
shots.update(shot, { rating: 4 });
shots.remove(shot);
// reading: shots.size(), shots.items(), shots.sorted((a, b) => b.rating - a.rating), shots.sum((s) => s.seconds)
```

The capacity is fixed because the device reserves memory for every slot up front. Item fields use contract types and are read as plain properties (`shot.rating`). `item.id` increases with each add.

## The firmware contract

`src/firmware.contract.ts` is the only way the UI talks to the firmware. App logic stays in firmware: no networking, timers, storage or sensors in UI code.

```ts
import { action, bool, f32, i16, list, signal, str, u8, widget } from "rippel/contract";

/** Pushed by the firmware. The UI reads it like a signal: temperature(). */
export const temperature = signal(i16, { initial: 22 });
export const ssid = signal(str(32));            // a string of at most 32 UTF-8 bytes

/** Called by the UI with an object of named arguments. */
export const setpoint = action({ celsius: i16 });
export const stop = action({});                 // call it as stop({})

/** A list the firmware fills. The UI can only read it. */
export const networks = list({ capacity: 8, fields: { ssid: str(32), rssi: i16, secure: bool } });

/** A widget drawn in C by your firmware. */
export const Dial = widget({ value: u16 });
```

- The contract file exports only `signal`, `action`, `list` and `widget` values. UI code imports them by name.
- UI code can't set a contract signal. To change one, call an action and let the firmware push the new value.
- Values are coerced to their type: a `u8` clamps to 0–255, and a `str(n)` is truncated.
- From this file, the build generates `ui_set_<name>(value)` for each signal, a `ui_actions_t` struct with one callback per action, `ui_<list>_add/_update/_remove/_clear` for each list, and `ui_widget_<name>_create` plus one setter per prop for each widget (declared in `ui_widgets.h`). Names are converted to snake_case.

## Styles

CSS is a subset that maps onto LVGL styles. Anything unsupported is an error, never ignored.

**Selectors**: one class, optionally followed by one part and any number of states, like `.card`, `.btn:active`, `.slider::knob`, `.slider::knob:active`, `.toggle:checked::indicator`. There are no element, id, descendant, child or sibling selectors, no `*`, and no `:not()`.

- States: `:active` (pressed), `:focus`, `:focus-visible`, `:hover`, `:checked`, `:disabled`.
- Parts: `::indicator` (the fill of a slider, bar, arc or switch, and the box of a checkbox), `::knob`, `::scrollbar`, `::selected` and `::items` (a dropdown's list), `::cursor`.

**Class names must be known at build time.** `class="a b"`, `` class={`a ${x() > 1 ? "on" : "off"}`} `` and `` class={`fill-${RECIPES[i()].accent}`} `` all work, because the compiler can list every possible result. `class={"t-" + mode()}` doesn't, because it can't. For a state like selected or pressed, prefer `checked={…}` with a `:checked` rule.

**Properties**:

- size: `width`, `height`, `min-width`, `max-width`, `min-height`, `max-height`
- spacing: `padding`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `margin`, `margin-top`, `margin-right`, `margin-bottom`, `margin-left`, `gap`, `row-gap`, `column-gap`
- color: `background`, `background-color`, `color`, `opacity`, `image-recolor`
- borders: `border`, `border-width`, `border-color`, `border-style`, `border-radius`, `outline`, `outline-width`, `outline-color`, `outline-offset`, `box-shadow`
- arcs: `arc-color`, `arc-width` (the track; style the fill with `::indicator`)
- text: `font`, `font-family`, `font-size`, `text-align`, `text-decoration`, `letter-spacing`
- layout: `display` (`flex`), `flex-direction`, `flex-wrap`, `flex-flow`, `justify-content`, `align-items`, `align-content`, `flex-grow`, `flex` (a single number only)
- position: `position` (`absolute` or `static`), `left`, `right`, `top`, `bottom`, `translate`
- animation: `transition`

**Units**: `px`, `%`, `rem`, `vw`, `vh`, `vmin` and `vmax`. `em` is an error. Viewport units and `rem` become pixels at build time, using the configured display.

Things that work differently from the web:

- Layout is either flex or nothing. A `view` without `display: flex` places its children at the top-left, on top of each other. There's no grid, no block flow and no inline flow.
- `align-self` is an error. Wrap the element in a view with its own `align-items`, or use `position: absolute`.
- `position: absolute` places an element from one horizontal edge (`left` or `right`) and one vertical edge (`top` or `bottom`) of its parent's content area. Setting both `left` and `right` is an error; use `width`. `relative` isn't supported; use `translate` to nudge an element.
- **Fonts are a fixed catalog.** `font-family` and `font-size` together must name a font that exists. Built in is `montserrat` at 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40 and 48 px; the default is 14 px. Add other fonts or sizes under `fonts` in `rippel.config.ts` (a TTF path, `sizes`, and an optional glyph `range`). There's no `font-weight`; use a different font. Built-in Montserrat has printable ASCII, `°`, `•` and LVGL's symbols (Font Awesome code points like `""`). Any other character, like `é` or `→`, needs a custom font whose `range` includes it. A custom font has only the glyphs in its `range`.
- `transition` runs when a state changes (`:active`, `:checked`, `:disabled`), not when a class changes. It needs the properties listed; `all` is an error. Allowed properties: `background`, `background-color`, `color`, `opacity`, `width`, `height`, `translate`, `border-color`, `border-width`, `outline-color`, `outline-width`, `box-shadow`, `arc-color`.
- No CSS variables (`--x`, `var()`), and no `!important`.
- `@media` with `width`, `height`, their `min-` and `max-` forms, and `orientation` is settled at build time against the configured display.
- Colors: hex, `rgb()`/`rgba()` and named colors.
- Inline `style={{ … }}` must be an object literal. Its values can change at runtime only for lengths, like `width` and `height`. For a color that changes, switch classes or use `checked`.

## The firmware mock

`src/firmware.mock.ts` plays the firmware in the simulator. It runs only in the browser and is never compiled, so it can use any JavaScript, and `rippel check` skips it. Rippel finds it at that path automatically; set `mock` in `rippel.config.ts` only to use a different path.

```ts
import { defineMock } from "rippel/mock";
import * as fw from "./firmware.contract";

export default defineMock(({ set, on, every, list }) => {
  on(fw.setpoint, ({ celsius }) => set(fw.temperature, celsius));
  every(1000, () => set(fw.temperature, fw.temperature() + 1));
  list(fw.networks).add({ ssid: "Kitchen", rssi: -48, secure: true });
});
```

Don't move logic from UI code into the mock to get around a build error. On the device, the mock doesn't exist.

## Running it on a device

`rippel build` writes an ESP-IDF component (`ui.c`, `ui.h`, `lv_conf.h`, the bridge, and `CMakeLists.txt`) into `output.dir`, which should be under the firmware's `components/` folder. The firmware also needs LVGL 9.6 as a component named `lvgl`:

```bash
git clone --branch v9.6.0 --depth 1 https://github.com/lvgl/lvgl.git components/lvgl
```

The firmware owns the display and touch drivers and the main loop:

```c
lv_init();
/* create the display and input device */
static const ui_actions_t actions = { .setpoint = on_setpoint };
ui_set_actions(&actions);
ui_init(disp);
for (;;) {
    ui_set_temperature(read_sensor());   /* push signals whenever values change */
    vTaskDelay(pdMS_TO_TICKS(lv_timer_handler()));
}
```

Use `--target <name>` with `dev` or `build` to build the same UI for other hardware listed under `targets` in `rippel.config.ts`.

## Common mistakes

| You wrote | Write instead |
|---|---|
| `<div>`, `<span>`, `<p>` | `<view>`, `<label>` |
| text directly inside `<view>` | wrap it in `<label>` |
| `import { createSignal } from "solid-js"` | `from "rippel"` |
| `setCount(c => c + 1)` | `setCount(count() + 1)` |
| `createSignal<Item[]>([])` | `createList({ capacity, fields })` |
| `{items().map(i => <Row … />)}` | `<For each={list.items()}>{(i) => <Row … />}</For>` |
| `{count() && <Badge />}` | `{count() > 0 && <Badge />}` |
| `<For each={…} fallback={<Empty />}>` | `<For each={…}>` plus `<Show when={list.size() === 0}><Empty /></Show>` |
| `` `${h}`.padStart(2, "0") `` | `` `${h < 10 ? "0" : ""}${h}` `` |
| `name().length`, `.toUpperCase()` | precompute in firmware and push a signal, or use a constant table |
| `value ?? fallback` | `cond ? value : fallback` |
| `class={"tab-" + id()}` | `` class={`tab ${id() === 1 ? "tab-a" : "tab-b"}`} ``, or `checked` and `:checked` |
| `let x = …` in a component | `const`, or a signal |
| `const s = flag() ? "a" : "b"` in a handler | inline the expression into the call |
| `switch` in a handler | `if` / `else if` |
| `onMount(...)` | the signal's initial value, or `createEffect` |
| `setTimeout`, `fetch`, `Date.now()` | firmware does it and pushes a contract signal |
| `.parent .child { … }` | one class per rule: `.child { … }` |
| `font-weight: bold` | add a bold TTF under `fonts` in the config |
| `font-size: 15px` | a size in the font catalog |
| `align-self: center` | wrap it in a view with `align-items: center` |
| `transition: all 200ms` | `transition: background-color 200ms` |
| `action(21)` | `action({ celsius: 21 })` |
| `Math.max(a, b, c)` | `Math.max(a, Math.max(b, c))` |
