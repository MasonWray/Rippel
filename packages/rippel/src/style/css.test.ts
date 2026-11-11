import { describe, expect, it } from "vitest";
import { CssError, compileStyleSheet } from "./css.js";
import type { StyleContext } from "./ir.js";

const ctx: StyleContext = {
  fonts: { montserrat: [14] },
  defaultFont: { family: "montserrat", size: 14 },
  rem: 16,
  display: { width: 480, height: 320 },
};
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

  describe("@media", () => {
    const classes = (css: string) => compile(css).rules.map((r) => r.className);

    it("keeps only the blocks that match the display", () => {
      expect(classes("@media (min-width: 400px) { .wide { opacity: 1 } } @media (max-width: 400px) { .narrow { opacity: 1 } }")).toEqual(["wide"]);
    });

    it("supports height, exact sizes, orientation, rem and screen", () => {
      expect(classes("@media (height: 320px) { .a { opacity: 1 } }")).toEqual(["a"]);
      expect(classes("@media (min-height: 500px) { .a { opacity: 1 } }")).toEqual([]);
      expect(classes("@media (orientation: landscape) { .a { opacity: 1 } }")).toEqual(["a"]);
      expect(classes("@media (orientation: portrait) { .a { opacity: 1 } }")).toEqual([]);
      expect(classes("@media (min-width: 30rem) { .a { opacity: 1 } }")).toEqual(["a"]);
      expect(classes("@media screen and (max-width: 480px) { .a { opacity: 1 } }")).toEqual(["a"]);
    });

    it("treats and as all and commas as any", () => {
      expect(classes("@media (min-width: 100px) and (max-width: 200px) { .a { opacity: 1 } }")).toEqual([]);
      expect(classes("@media (max-width: 100px), (min-width: 400px) { .a { opacity: 1 } }")).toEqual(["a"]);
    });

    it("keeps source order, so a later block overrides an earlier rule", () => {
      expect(classes(".a { opacity: 1 } @media (min-width: 100px) { .b { opacity: 1 } } .c { opacity: 1 }")).toEqual(["a", "b", "c"]);
    });

    it("rejects queries it can't evaluate, with a location", () => {
      expect(() => compile("@media (min-color: 8) { .a { opacity: 1 } }")).toThrow(/Unsupported media feature/);
      expect(() => compile("@media print { .a { opacity: 1 } }")).toThrow(/Unsupported media query/);
      expect(() => compile("@media (min-width: 10vw) { .a { opacity: 1 } }")).toThrow(/px or rem/);
      expect(() => compile("\n@media (hover) { .a { opacity: 1 } }")).toThrow(/:2:1/);
    });

    it("still validates the rules in a block that matches", () => {
      expect(() => compile("@media (min-width: 100px) { .a { radius: 1px } }")).toThrow(/Unsupported CSS property/);
    });
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
    expect(() => compile("@font-face { font-family: x }")).toThrow(/At-rules/);
  });
});
