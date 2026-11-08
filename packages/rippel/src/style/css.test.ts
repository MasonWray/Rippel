import { describe, expect, it } from "vitest";
import { CssError, compileStyleSheet } from "./css.js";
import type { StyleContext } from "./ir.js";

const ctx: StyleContext = { fonts: { montserrat: [14] }, defaultFont: { family: "montserrat", size: 14 }, rem: 16 };
const compile = (css: string) => compileStyleSheet(css, "/app/styles.css", ctx);

describe("compileStyleSheet", () => {
  it("maps states and parts to LVGL selectors", () => {
    const { rules } = compile(`
      .button { opacity: 1 }
      .button:active, .button:focus-visible { opacity: 0.5 }
      .slider::knob:active { opacity: 0 }
    `);
    expect(rules.map((r) => [r.className, r.selector])).toEqual([
      ["button", { part: "LV_PART_MAIN", states: [] }],
      ["button", { part: "LV_PART_MAIN", states: ["LV_STATE_PRESSED"] }],
      ["button", { part: "LV_PART_MAIN", states: ["LV_STATE_FOCUS_KEY"] }],
      ["slider", { part: "LV_PART_KNOB", states: ["LV_STATE_PRESSED"] }],
    ]);
  });

  it("reports the location of a bad declaration", () => {
    try {
      compile(".card {\n  width: 10px;\n  radius: 8px;\n}");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CssError);
      expect((err as CssError).loc).toEqual({ file: "/app/styles.css", line: 3, column: 3 });
    }
  });

  it("rejects unsupported selectors and at-rules", () => {
    expect(() => compile("div { opacity: 1 }")).toThrow(/Unsupported selector/);
    expect(() => compile(".a .b { opacity: 1 }")).toThrow(/Unsupported selector/);
    expect(() => compile(".a:hover::knob::items { opacity: 1 }")).toThrow(/Only one part/);
    expect(() => compile(".a:visited { opacity: 1 }")).toThrow(/Unknown state/);
    expect(() => compile("@media (min-width: 10px) { .a { opacity: 1 } }")).toThrow(/At-rules/);
  });
});
