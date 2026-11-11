import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../node/load-config.js";
import { buildProject } from "./build.js";
import { CodegenError } from "./compile.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CONTRACT = `
  import { action, bool, f32, i16, signal, str, u8 } from "rippel/contract";
  export const temperature = signal(i16, { initial: 20 });
  export const level = signal(f32);
  export const online = signal(bool, { initial: true });
  export const name = signal(str(16), { initial: "hi" });
  export const battery = signal(u8);
  export const setpoint = action({ celsius: i16 });
`;

/** Writes a project to a temp folder, builds it and returns its generated files. */
async function build(files: Record<string, string>, out = "out") {
  const root = mkdtempSync(join(tmpdir(), "rippel-codegen-"));
  roots.push(root);
  const all: Record<string, string> = { "src/firmware.contract.ts": CONTRACT, ...files };
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
    expect(ui).toMatch(/snprintf\(text, sizeof\(text\), "Now %d\\xc2\\xb0 at %\.1f", \(int\)sig_temperature, \(double\)sig_level\);/);
    expect(ui).toMatch(/void ui_set_battery\(uint8_t value\)\n\{\n    if\(sig_battery == value\) return;\n    sig_battery = value;\n\}/);
    expect(ui).toContain("lv_strlcpy(sig_name, value, sizeof(sig_name));");
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
    expect(ui).toContain("lv_obj_remove_style(o_view, &st_1_b, LV_PART_MAIN);");
  });

  it("applies only the @media rules that match the configured display", async () => {
    const { ui } = await build({
      ...app(`return <view class="box" />;`, `import "./app.css";`),
      "src/app.css": `@media (max-width: 320px) { .box { width: 10px; } } @media (min-width: 321px) { .box { width: 99px; } }`,
    });
    expect(ui).toContain("LV_STYLE_WIDTH, 10)");
    expect(ui).not.toContain("LV_STYLE_WIDTH, 99)");
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
      message: expect.stringMatching(/<For> over a list that changes at runtime.*M3/),
    });
    await expect(build(app(`const [items] = createSignal([1]); return <label>{items()}</label>;`))).rejects.toBeInstanceOf(CodegenError);
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
