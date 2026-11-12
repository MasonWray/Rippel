import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { resolveConfig } from "../node/load-config.js";
import { buildProject } from "./build.js";
import { CodegenError } from "./compile.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CONTRACT = `
  import { action, bool, f32, i16, list, signal, str, u8, widget } from "rippel/contract";
  export const temperature = signal(i16, { initial: 20 });
  export const level = signal(f32);
  export const online = signal(bool, { initial: true });
  export const name = signal(str(16), { initial: "hi" });
  export const battery = signal(u8);
  export const setpoint = action({ celsius: i16 });
  export const networks = list({ capacity: 4, fields: { ssid: str(16), rssi: i16 } });
  export const Dial = widget({ value: u8, label: str(12), on: bool });
`;

/** Writes a project to a temp folder, builds it and returns its generated files. */
async function build(files: Record<string, string | Buffer>, out = "out") {
  const root = mkdtempSync(join(tmpdir(), "rippel-codegen-"));
  roots.push(root);
  const all: Record<string, string | Buffer> = { "src/firmware.contract.ts": CONTRACT, ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const config = resolveConfig({ display: { width: 320, height: 240 }, output: { dir: out, integration: "esp-idf" } }, root, join(root, "rippel.config.ts"));
  const result = await buildProject(config);
  const read = (name: string) => readFileSync(join(result.outDir, name), "utf8");
  return { result, ui: read("ui.c"), header: read("ui.h"), conf: read("lv_conf.h"), read };
}

const app = (body: string, before = "") => ({
  "src/App.tsx": `
    import { createSignal, createMemo, createEffect, Show, Switch, Match, For } from "rippel";
    import { temperature, level, online, name, battery, setpoint } from "./firmware.contract";
    ${before}
    export default function App() { ${body} }
  `,
});

describe("rippel build", () => {
  it("generates a typed interface from the contract", async () => {
    const { header } = await build(app(`return <view />;`));
    expect(header).toContain("void ui_set_temperature(int16_t value);");
    expect(header).toContain("void ui_set_level(float value);");
    expect(header).toContain("void ui_set_online(bool value);");
    expect(header).toContain("void ui_set_name(const char * value);");
    expect(header).toContain("void (*setpoint)(int16_t celsius);");
  });

  it("formats text and only re-runs bindings that read a signal", async () => {
    const { ui } = await build(app(`return <view><label>Now {temperature()}° at {level().toFixed(1)}</label><label>{name()}</label></view>;`));
    expect(ui).toContain(
      'snprintf(text, sizeof(text), "Now %d\\xc2\\xb0 at %s%u.%01u", (int)sig_temperature, (sig_level < 0) ? "-" : "", (unsigned)(rp_fixed_float(sig_level, 10) / 10u), (unsigned)(rp_fixed_float(sig_level, 10) % 10u));',
    );
    expect(ui).toMatch(/void ui_set_battery\(uint8_t value\)\n\{\n    if\(sig_battery == value\) return;\n    sig_battery = value;\n\}/);
    expect(ui).toContain("lv_strlcpy(sig_name, value, sizeof(sig_name));");
  });

  it("adds no float math to a UI that only uses whole numbers", async () => {
    const { ui } = await build(
      app(
        `return (
          <view>
            <label>{secs().toFixed(1)} {(battery() / 3).toFixed(2)} {battery().toFixed(1)} {temperature().toFixed(0)}</label>
            <label>{Math.round(temperature() / 4)} {Math.floor(temperature() / 4)} {Math.ceil(battery() / 4)} {Math.trunc(temperature() / 4)}</label>
            <bar value={temperature() / 2} />
            <label>{networks.sum((n) => n.rssi)}</label>
            <label>{(networks.size() > 0 ? networks.sum((n) => n.rssi) / networks.size() : 0).toFixed(1)}</label>
          </view>
        );`,
        `import { networks } from "./firmware.contract";
         const secs = () => temperature() / 10;`,
      ),
    );
    // The contract's f32 signal is declared as a float. Nothing else should be.
    const code = ui.replace(/^.*\bsig_level\b.*$/gm, "").replace(/ui_set_level\(float value\)/g, "");
    expect(code).not.toMatch(/\bfloat\b|\bdouble\b|floorf|ceilf|fmodf|%[.\d]*[fg]/);
    expect(ui).toContain("rp_fixed_div(sig_temperature, 10, 10)");
    expect(ui).toContain("rp_div_round(sig_temperature, 4)");
    expect(ui).toContain("rp_div_floor(sig_temperature, 4)");
    expect(ui).toContain("rp_div_ceil(sig_battery, 4)");
    expect(ui).toContain("rp_div_trunc(sig_temperature, 4)");
    expect(ui).toContain("rp_div_round(sig_temperature, 2)");
  });

  it("keeps a local signal an int until something assigns it a fraction", async () => {
    const whole = await build(app(`const [n, setN] = createSignal(1); return <button onClick={() => setN(n() + 1)}>Go</button>;`));
    expect(whole.ui).toContain("static int32_t sig_n = 1;");

    const fraction = await build(app(`const [n, setN] = createSignal(1); return <button onClick={() => setN(n() / 2)}>Go</button>;`));
    expect(fraction.ui).toContain("static float sig_n = 1.0f;");
  });

  it("inlines components with props and children, each with its own state", async () => {
    const { ui } = await build({
      "src/Card.tsx": `
        import { createSignal, type ParentComponent } from "rippel";
        export const Card: ParentComponent<{ title: string }> = (props) => {
          const [open, setOpen] = createSignal(true);
          return <view class="card" onClick={() => setOpen(!open())}><label>{props.title}</label>{props.children}</view>;
        };
      `,
      "src/App.tsx": `
        import { temperature } from "./firmware.contract";
        import { Card } from "./Card";
        export default function App() {
          return <view><Card title="One"><label>{temperature()}</label></Card><Card title="Two" /></view>;
        }
      `,
    });
    expect(ui).toContain('rp_label_set_text(o_label, "One");');
    expect(ui).toContain('rp_label_set_text(o_label_3, "Two");');
    expect(ui).toContain("static bool sig_open = true;");
    expect(ui).toContain("static bool sig_open_2 = true;");
  });

  it("builds every <Show> branch up front and hides the inactive ones", async () => {
    const { ui } = await build(app(`return <view><Show when={online()} fallback={<label>Off</label>}><label>On</label></Show></view>;`));
    expect(ui).toContain("int32_t active = sig_online ? 0 : true ? 1 : -1;");
    expect(ui).toContain("lv_obj_set_hidden(o_label, active != 0);");
    expect(ui).toContain("lv_obj_set_hidden(o_label_2, active != 1);");
  });

  it("compiles event handlers to setters and action calls", async () => {
    const { ui } = await build(
      app(`
        const [t, setT] = createSignal(20);
        const send = () => { setpoint({ celsius: t() }); };
        return <view><slider min={0} max={40} value={t()} onInput={setT} /><button onClick={send}>Send</button></view>;
      `),
    );
    expect(ui).toContain("int32_t value = lv_slider_get_value(lv_event_get_target(e));");
    expect(ui).toContain("set_t(value);");
    expect(ui).toContain("if(actions.setpoint) actions.setpoint((int16_t)sig_t);");
  });

  it("switches between every class list an expression can produce", async () => {
    const { ui } = await build({
      ...app(`return <view class={online() ? "a" : "a b"} />;`, `import "./app.css";`),
      "src/app.css": `.a { opacity: 1 } .b { opacity: 0.5 }`,
    });
    expect(ui).toContain("const int32_t next = sig_online ? 0 : 1;");
    expect(ui).toContain("rp_obj_remove_style(o_view, &st_1_b, LV_PART_MAIN);");
  });

  it("applies only the @media rules that match the configured display", async () => {
    const { ui } = await build({
      ...app(`return <view class="box" />;`, `import "./app.css";`),
      "src/app.css": `@media (max-width: 320px) { .box { width: 10px; } } @media (min-width: 321px) { .box { width: 99px; } }`,
    });
    expect(ui).toContain("LV_STYLE_WIDTH, 10)");
    expect(ui).not.toContain("LV_STYLE_WIDTH, 99)");
  });

  it("floats absolutely positioned elements, from classes or inline styles", async () => {
    const { ui } = await build({
      ...app(`return <view><view class={online() ? "badge" : "plain"} /><view style={{ position: "absolute", left: 3 }} /></view>;`, `import "./app.css";`),
      "src/app.css": `.badge { position: absolute; right: 2px; top: 2px; } .plain { opacity: 1 }`,
    });
    expect(ui).toContain("rp_obj_set_floating(o_view_2, true);");
    expect(ui).toMatch(/case 1:\n\s+rp_obj_add_style\(o_view_2, &st_1_plain, LV_PART_MAIN\);\n\s+rp_obj_set_floating\(o_view_2, false\);/);
    expect(ui).toContain("rp_obj_set_floating(o_view_3, true);");
  });

  it("sets LVGL's refresh period from refreshHz", async () => {
    const { conf } = await build(app(`return <view />;`));
    expect(conf).toContain("#define LV_DEF_REFR_PERIOD 33");
  });

  it("only enables the fonts and widgets the UI uses", async () => {
    const { conf } = await build({
      ...app(`return <view><arc class="big" /></view>;`, `import "./app.css";`),
      "src/app.css": `.big { font-size: 28px; }`,
    });
    expect(conf).toContain("#define LV_USE_ARC 1");
    expect(conf).toContain("#define LV_USE_CHART 0");
    expect(conf).toContain("#define LV_FONT_MONTSERRAT_28 1");
    expect(conf).toContain("#define LV_FONT_MONTSERRAT_48 0");
  });

  it("names objects for the firmware with id", async () => {
    const { ui, header } = await build(app(`return <view id="statusBar" />;`));
    expect(header).toContain("UI_OBJ_STATUS_BAR,");
    expect(ui).toContain("case UI_OBJ_STATUS_BAR: return o_view;");
  });

  it("produces the same output every time", async () => {
    const files = app(`const [n, setN] = createSignal(0); return <button onClick={() => setN(n() + 1)}>{n()}</button>;`);
    const [a, b] = [await build(files), await build(files)];
    expect(a.ui).toBe(b.ui);
    expect(a.conf).toBe(b.conf);
  });

  it("reports what it can't compile yet, with a location", async () => {
    await expect(build(app(`return <view><For each={[temperature()]}>{() => <view />}</For></view>;`))).rejects.toMatchObject({
      name: "CodegenError",
      line: 5,
      message: expect.stringMatching(/<For> needs a constant list, or the items of a list made with createList/),
    });
    await expect(build(app(`const [items] = createSignal([1]); return <label>{items()}</label>;`))).rejects.toBeInstanceOf(CodegenError);
  });

  describe("switch, checkbox and dropdown", () => {
    it("binds a switch and passes a boolean to its handler", async () => {
      const { ui, conf } = await build(app(`const [on, setOn] = createSignal(false); return <switch checked={on()} onChange={setOn} />;`));
      expect(ui).toContain("rp_obj_create(RP_WIDGET_SWITCH, root)");
      expect(ui).toContain("const bool value = lv_obj_has_state(lv_event_get_target(e), LV_STATE_CHECKED);");
      expect(ui).toContain("set_on(value);");
      expect(ui).toContain("LV_EVENT_VALUE_CHANGED");
      expect(conf).toContain("#define LV_USE_SWITCH 1");
    });

    it("uses a checkbox's children as its label", async () => {
      const { ui } = await build(app(`return <checkbox>Beep at {temperature()}</checkbox>;`));
      expect(ui).toMatch(/rp_checkbox_set_text\(o_checkbox, text\);/);
    });

    it("sets dropdown options and passes the chosen index", async () => {
      const { ui, conf } = await build(app(`const [i, setI] = createSignal(1); return <dropdown options={["A", "B"]} selected={i()} onChange={setI} />;`));
      expect(ui).toContain('rp_dropdown_set_options(o_dropdown, "A\\nB");');
      expect(ui).toContain("rp_dropdown_set_selected(o_dropdown, sig_i);");
      expect(ui).toContain("const int32_t value = (int32_t)lv_dropdown_get_selected(lv_event_get_target(e));");
      expect(conf).toContain("#define LV_USE_DROPDOWN 1");
    });

    it("needs dropdown options at build time", async () => {
      await expect(build(app(`return <dropdown options={[name()]} />;`))).rejects.toThrow(/known at build time/);
    });
  });

  describe("<image>", () => {
    const png = (alpha: number) => {
      const image = new PNG({ width: 2, height: 1 });
      image.data.set([255, 0, 0, alpha, 0, 0, 255, alpha]);
      return PNG.sync.write(image);
    };

    it("embeds an imported PNG as a C image", async () => {
      const { ui, conf, read, result } = await build({
        ...app(`return <image src={logo} fit="contain" />;`, `import logo from "./logo.png";`),
        "src/logo.png": png(128),
      });
      expect(ui).toContain("LV_IMAGE_DECLARE(rp_img_logo);");
      expect(ui).toContain("rp_image_set_src(o_image, &rp_img_logo);");
      expect(ui).toContain("rp_image_set_fit(o_image, LV_IMAGE_ALIGN_CONTAIN);");
      expect(conf).toContain("#define LV_USE_IMAGE 1");
      // Two RGB565 pixels, then two alpha bytes.
      expect(read("rp_img_logo.c")).toContain("0x00, 0xf8, 0x1f, 0x00, 0x80, 0x80,");
      expect(read("rp_img_logo.c")).toContain(".cf = LV_COLOR_FORMAT_RGB565A8, .w = 2, .h = 1, .stride = 4");
      expect(result.images[0].bytes).toBe(6);
    });

    it("leaves out the alpha plane for opaque images", async () => {
      const { read } = await build({ ...app(`return <image src={logo} />;`, `import logo from "./logo.png";`), "src/logo.png": png(255) });
      expect(read("rp_img_logo.c")).toContain(".cf = LV_COLOR_FORMAT_RGB565,");
    });

    it("picks an image at runtime from a condition or a table", async () => {
      const { ui } = await build({
        ...app(
          `const [i] = createSignal(0);
           return <view><image src={online() ? a : b} /><image src={ROWS[i()].icon} /></view>;`,
          `import a from "./a.png"; import b from "./b.png"; const ROWS = [{ icon: a }, { icon: b }];`,
        ),
        "src/a.png": png(255),
        "src/b.png": png(128),
      });
      expect(ui).toContain("rp_image_set_src(o_image, (sig_online ? &rp_img_a : &rp_img_b));");
      expect(ui).toContain("static const void * const lut_0[] = { &rp_img_a, &rp_img_b };");
      expect(ui).toContain("rp_image_set_src(o_image_2, lut_0[sig_i]);");
    });

    it("only compiles the images the UI uses", async () => {
      const { result } = await build({ ...app(`return <view />;`, `import logo from "./logo.png";`), "src/logo.png": png(255) });
      expect(result.images).toEqual([]);
    });

    it("rejects other image formats", async () => {
      await expect(build({ ...app(`return <view />;`, `import pic from "./pic.jpg";`), "src/pic.jpg": "x" })).rejects.toThrow(/Only .png/);
    });
  });

  describe("custom widgets", () => {
    const widgetUi = (body: string) => ({
      "src/App.tsx": `
        import { Dial, temperature, online } from "./firmware.contract";
        export default function App() { ${body} }
      `,
    });

    it("declares the C interface the firmware implements", async () => {
      const { read, result } = await build(widgetUi(`return <Dial value={temperature()} label="Room" on={online()} />;`));
      const header = read("ui_widgets.h");
      expect(header).toContain("lv_obj_t * ui_widget_dial_create(lv_obj_t * parent);");
      expect(header).toContain("void ui_widget_dial_set_value(lv_obj_t * obj, uint8_t value);");
      expect(header).toContain("void ui_widget_dial_set_label(lv_obj_t * obj, const char * value);");
      expect(result.files).toContain("ui_widgets.h");
      expect(read("CMakeLists.txt")).not.toContain("# Custom widgets");
    });

    it("creates the widget with its own function and binds its props", async () => {
      const { ui } = await build(widgetUi(`return <view><Dial class="d" value={temperature()} label="Room" on={online()} /></view>;`));
      expect(ui).toContain('#include "ui_widgets.h"');
      expect(ui).toMatch(/o_d = ui_widget_dial_create\(o_view\);/);
      expect(ui).toContain("ui_widget_dial_set_value(o_d, (uint8_t)sig_temperature);");
      expect(ui).toContain('ui_widget_dial_set_label(o_d, "Room");');
      expect(ui).toContain("ui_widget_dial_set_on(o_d, sig_online);");
    });

    it("rejects unknown props and children", async () => {
      await expect(build(widgetUi(`return <Dial size={3} />;`))).rejects.toThrow(/Unknown prop "size" on <Dial>/);
      await expect(build(widgetUi(`return <Dial><view /></Dial>;`))).rejects.toThrow(/can't have children/);
    });
  });

  describe("firmware lists", () => {
    const listUi = (body: string) => ({
      "src/App.tsx": `
        import { For } from "rippel";
        import { networks, setpoint } from "./firmware.contract";
        export default function App() { ${body} }
      `,
    });

    it("gives the firmware add, update, remove and clear", async () => {
      const { header, ui } = await build(listUi(`return <view><For each={networks.sorted((a, b) => b.rssi - a.rssi)}>{(n) => <label>{n.ssid}</label>}</For></view>;`));
      expect(header).toContain("uint32_t ui_networks_add(const char * ssid, int16_t rssi);");
      expect(header).toContain("void ui_networks_update(uint32_t id, const char * ssid, int16_t rssi);");
      expect(header).toContain("void ui_networks_remove(uint32_t id);");
      expect(header).toContain("void ui_networks_clear(void);");
      expect(ui).toContain("static list_networks_item_t list_networks[4] = {");
      expect(ui).toContain("lv_strlcpy(list_networks[0].ssid, value, sizeof(list_networks[0].ssid));");
    });

    it("lets the UI pass an item's fields to an action", async () => {
      const { ui } = await build(listUi(`return <view><For each={networks.items()}>{(n) => <button onClick={() => setpoint({ celsius: n.rssi })}>{n.ssid}</button>}</For></view>;`));
      expect(ui).toContain("actions.setpoint((int16_t)list_networks[0].rssi);");
    });

    it("doesn't let the UI change a firmware list", async () => {
      await expect(build(listUi(`return <button onClick={() => networks.add({ ssid: "x", rssi: 1 })}>Add</button>;`))).rejects.toThrow(/firmware fills/);
    });
  });

  describe("createList", () => {
    const listApp = (body: string) =>
      app(
        body,
        `import { createList } from "rippel"; import { u8, f32, str } from "rippel/contract";
         const items = createList({ capacity: 3, fields: { score: u8, weight: f32, name: str(8) }, initial: [{ score: 1, weight: 1.5, name: "a" }] });`,
      );

    it("reserves fixed storage and starts with the initial items", async () => {
      const { ui } = await build(listApp(`return <view><For each={items.items()}>{(item) => <label>{item.name}</label>}</For></view>;`));
      expect(ui).toContain("static list_items_item_t list_items[3] = {");
      expect(ui).toContain('[0] = { .score = 1, .weight = 1.5f, .name = "a", .id = 1, .used = true },');
      expect(ui).toContain("char name[9];");
    });

    it("builds one row per slot and shows only those in use", async () => {
      const { ui } = await build(listApp(`return <view><For each={items.items()}>{(item) => <label>{item.score}</label>}</For></view>;`));
      expect(ui).toContain("lv_obj_set_hidden(o_label_3, active != 0);");
      expect(ui).toContain("(unsigned)list_items[2].score");
    });

    it("sorts with the compare function and moves rows", async () => {
      const { ui } = await build(listApp(`return <view><For each={items.sorted((a, b) => b.score - a.score)}>{(item) => <label>{item.score}</label>}</For></view>;`));
      expect(ui).toContain("(list_items[ib].score - list_items[ia].score)");
      expect(ui).toContain("lv_obj_move_to_index(view_");
      // Changing any item's score re-sorts.
      expect(ui).toMatch(/static void set_items_2_score\(uint8_t value\)[^}]*bind_\d+_view\(\);/);
    });

    it("compiles add, remove and update in handlers", async () => {
      const { ui } = await build(
        listApp(`return <view>
          <button onClick={() => items.add({ score: 2, weight: level(), name: "b" })}>Add</button>
          <For each={items.items()}>{(item) => <button onClick={() => items.update(item, { score: 9 })} onLongPress={() => items.remove(item)}>{item.score}</button>}</For>
        </view>;`),
      );
      expect(ui).toContain('items_add((uint8_t)2, (float)sig_level, "b");');
      expect(ui).toContain("set_items_0_score((uint8_t)9);");
      expect(ui).toContain("set_items_1_used(false);");
      expect(ui).toContain("/* Full: the oldest item makes room. */");
    });

    it("computes size and sum", async () => {
      const { ui } = await build(listApp(`return <label>{items.size()} {items.sum((i) => i.weight).toFixed(1)}</label>;`));
      expect(ui).toContain("sig_items_size");
      expect(ui).toMatch(/if\(list_items\[i\]\.used\) total \+= list_items\[i\]\.weight;/);
    });

    it("rejects more initial items than the capacity", async () => {
      await expect(
        build(app(`return <For each={l.items()}>{() => <view />}</For>;`, `import { createList } from "rippel"; import { u8 } from "rippel/contract"; const l = createList({ capacity: 1, fields: { a: u8 }, initial: [{ a: 1 }, { a: 2 }] });`)),
      ).rejects.toThrow(/don't fit a capacity/);
    });
  });

  it("expands <For> over constant data", async () => {
    const { ui } = await build(app(`const ROWS = [{ name: "A" }, { name: "B" }]; return <view><For each={ROWS}>{(row, i) => <label>{row.name}{i()}</label>}</For></view>;`));
    expect(ui).toContain('rp_label_set_text(o_label, "A0");');
    expect(ui).toContain('rp_label_set_text(o_label_2, "B1");');
  });

  it("runs helper functions over constants at build time", async () => {
    const { ui } = await build(
      app(
        `return <label>{total(TABLE)}</label>;`,
        `const TABLE = [1, 2, 3];
         function total(list: number[]) { let_free: for (const v of list) { if (v > 2) return v * 10; } return 0; }`.replace("let_free: ", ""),
      ),
    );
    expect(ui).toContain('rp_label_set_text(o_label, "30");');
  });

  it("turns a table read through a signal into a lookup table", async () => {
    const { ui } = await build({
      ...app(
        `const [i, setI] = createSignal(0);
         const row = () => ROWS[i()];
         return <button class={\`card c-\${row().tone}\`} onClick={() => setI(1)}>{row().name} {row().size}</button>;`,
        `import "./app.css"; const ROWS = [{ name: "One", tone: "a", size: 10 }, { name: "Two", tone: "b", size: 20 }];`,
      ),
      "src/app.css": `.c-a { opacity: 1 } .c-b { opacity: 0.5 }`,
    });
    expect(ui).toContain('static const char * const lut_0[] = { "One", "Two" };');
    expect(ui).toContain("static const int32_t lut_1[] = { 10, 20 };");
    expect(ui).toContain("const int32_t next = (sig_i == 0) ? 0 : 1;");
    expect(ui).toMatch(/"%s %d", lut_0\[sig_i\], \(int\)\(?lut_1\[sig_i\]\)?/);
  });

  it("compiles string signals to pointers", async () => {
    const { ui } = await build(app(`const [tab, setTab] = createSignal("a"); return <button checked={tab() === "b"} onClick={() => setTab("b")}>{tab()}</button>;`));
    expect(ui).toContain('static const char * sig_tab = "a";');
    expect(ui).toContain("(strcmp(sig_tab, \"b\") == 0)");
    expect(ui).toContain("sig_tab = value;");
  });

  it("resets a branch's local signals when it reopens", async () => {
    const { ui } = await build(
      app(
        `return <view><Show when={online()}><Inner /></Show></view>;`,
        `function Inner() { const [m, setM] = createSignal(1); return <button onClick={() => setM(m() + 1)}>{m()}</button>; }`,
      ),
    );
    expect(ui).toContain("if(active != shown) {");
    expect(ui).toContain("set_m(1);");
  });

  it("binds inline lengths that change at runtime", async () => {
    const { ui } = await build(app(`return <view style={{ height: Math.round(level() * 8) }} />;`));
    expect(ui).toContain("rp_obj_set_local_num(o_view, LV_STYLE_HEIGHT, (int32_t)floorf((sig_level * 8) + 0.5f), LV_PART_MAIN);");
  });

  it("runs effects when the signals they read change", async () => {
    const { ui } = await build(
      app(`const [seen, setSeen] = createSignal(0); createEffect(() => { setSeen(temperature()); }); return <label>{seen()}</label>;`).valueOf() as Record<string, string>,
    );
    expect(ui).toMatch(/static void bind_\d+_effect\(void\)\n\{\n    set_seen\(sig_temperature\);/);
    expect(ui).toMatch(/void ui_set_temperature\(int16_t value\)[^}]*bind_\d+_effect\(\);/);
  });

  it("expands a setter picked from a constant list at runtime into a switch", async () => {
    const { ui } = await build(
      app(
        `const pair = LIST.map(() => createSignal(0));
         return <button onClick={() => pair[temperature()][1](5)}>{pair[0][0]()}</button>;`,
        `const LIST = [0, 1];`,
      ),
    );
    expect(ui).toContain("switch(sig_temperature) {");
    expect(ui).toContain("case 1:");
  });
});
