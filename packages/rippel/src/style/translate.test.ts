import { describe, expect, it } from "vitest";
import { parseColor } from "./colors.js";
import type { StyleContext } from "./ir.js";
import { StyleError, translateDeclarations } from "./translate.js";

const ctx: StyleContext = {
  fonts: { montserrat: [12, 14, 16, 24], lato: [56] },
  defaultFont: { family: "montserrat", size: 14 },
  rem: 16,
};

const t = (decls: Record<string, string>) =>
  translateDeclarations(Object.entries(decls).map(([prop, value]) => ({ prop, value })), ctx);

describe("translateDeclarations", () => {
  it("translates lengths, percentages and content sizes", () => {
    expect(t({ width: "100%", height: "auto", "min-width": "2rem" })).toEqual([
      { prop: "LV_STYLE_WIDTH", value: { t: "pct", v: 100 } },
      { prop: "LV_STYLE_HEIGHT", value: { t: "content" } },
      { prop: "LV_STYLE_MIN_WIDTH", value: { t: "num", v: 32 } },
    ]);
  });

  it("expands padding shorthands", () => {
    const out = t({ padding: "4px 8px" });
    expect(out.map((d) => [d.prop, d.value])).toEqual([
      ["LV_STYLE_PAD_TOP", { t: "num", v: 4 }],
      ["LV_STYLE_PAD_RIGHT", { t: "num", v: 8 }],
      ["LV_STYLE_PAD_BOTTOM", { t: "num", v: 4 }],
      ["LV_STYLE_PAD_LEFT", { t: "num", v: 8 }],
    ]);
  });

  it("always emits opacity with colors so backgrounds show on unstyled views", () => {
    expect(t({ background: "#10141b" })).toEqual([
      { prop: "LV_STYLE_BG_COLOR", value: { t: "color", v: 0x10141b } },
      { prop: "LV_STYLE_BG_OPA", value: { t: "num", v: 255 } },
    ]);
    expect(t({ color: "rgb(255 0 0 / 50%)" })[1]).toEqual({ prop: "LV_STYLE_TEXT_OPA", value: { t: "num", v: 128 } });
  });

  it("combines flex-direction and flex-wrap into one flex flow", () => {
    expect(t({ display: "flex", "flex-direction": "column", "flex-wrap": "wrap" })).toEqual([
      { prop: "LV_STYLE_LAYOUT", value: { t: "const", v: "LV_LAYOUT_FLEX" } },
      { prop: "LV_STYLE_FLEX_FLOW", value: { t: "const", v: "LV_FLEX_FLOW_COLUMN_WRAP" } },
    ]);
  });

  it("resolves fonts from family and size, filling in defaults", () => {
    expect(t({ "font-size": "24px" })).toEqual([
      { prop: "LV_STYLE_TEXT_FONT", value: { t: "font", family: "montserrat", size: 24 } },
    ]);
    expect(t({ font: "56px lato" })).toEqual([
      { prop: "LV_STYLE_TEXT_FONT", value: { t: "font", family: "lato", size: 56 } },
    ]);
  });

  it("rejects fonts that aren't available", () => {
    expect(() => t({ "font-size": "13px" })).toThrow(/isn't available at 13px/);
    expect(() => t({ "font-family": "comic-sans" })).toThrow(/Unknown font family/);
  });

  it("maps a 50% radius to LV_RADIUS_CIRCLE", () => {
    expect(t({ "border-radius": "50%" })).toEqual([
      { prop: "LV_STYLE_RADIUS", value: { t: "const", v: "LV_RADIUS_CIRCLE" } },
    ]);
  });

  it("parses a single box shadow", () => {
    const out = t({ "box-shadow": "0 2px 6px rgba(0,0,0,0.5)" });
    expect(Object.fromEntries(out.map((d) => [d.prop, d.value]))).toMatchObject({
      LV_STYLE_SHADOW_OFFSET_X: { t: "num", v: 0 },
      LV_STYLE_SHADOW_OFFSET_Y: { t: "num", v: 2 },
      LV_STYLE_SHADOW_WIDTH: { t: "num", v: 6 },
      LV_STYLE_SHADOW_OPA: { t: "num", v: 128 },
    });
  });

  it("errors on anything that doesn't map to LVGL, naming the declaration", () => {
    const cases: Record<string, string>[] = [
      { radius: "8px" },
      { width: "10em" },
      { width: "10" },
      { display: "grid" },
      { display: "none" },
      { "align-items": "stretch" },
      { "border-style": "dashed" },
      { color: "var(--x)" },
      { color: "red !important" },
    ];
    for (const decls of cases) {
      expect(() => t(decls), JSON.stringify(decls)).toThrow(StyleError);
    }
    try {
      t({ width: "10px", radius: "8px" });
    } catch (err) {
      expect((err as StyleError).declIndex).toBe(1);
      expect((err as StyleError).message).toMatch(/^radius: /);
    }
  });
});

describe("parseColor", () => {
  it("parses hex, rgb, named and transparent colors", () => {
    expect(parseColor("#fff")).toEqual({ rgb: 0xffffff, alpha: 1 });
    expect(parseColor("#11223380")?.alpha).toBeCloseTo(0.5, 2);
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ rgb: 0x010203, alpha: 1 });
    expect(parseColor("rgba(1, 2, 3, 0.25)")).toEqual({ rgb: 0x010203, alpha: 0.25 });
    expect(parseColor("rebeccapurple")).toEqual({ rgb: 0x663399, alpha: 1 });
    expect(parseColor("transparent")).toEqual({ rgb: 0, alpha: 0 });
    expect(parseColor("hsl(0 0% 0%)")).toBeUndefined();
  });
});

describe("transition", () => {
  const translate = (value: string) =>
    translateDeclarations([{ prop: "transition", value }], {
      fonts: { montserrat: [14] },
      defaultFont: { family: "montserrat", size: 14 },
      rem: 16,
    });

  it("maps properties, duration and easing", () => {
    expect(translate("color 200ms ease-out, opacity 200ms ease-out")).toEqual([
      {
        prop: "LV_STYLE_TRANSITION",
        value: {
          t: "transition",
          props: ["LV_STYLE_TEXT_COLOR", "LV_STYLE_TEXT_OPA", "LV_STYLE_OPA"],
          timeMs: 200,
          delayMs: 0,
          path: "RP_PATH_EASE_OUT",
        },
      },
    ]);
  });

  it("reads seconds and a delay", () => {
    expect(translate("opacity 0.5s linear 100ms")[0].value).toMatchObject({ timeMs: 500, delayMs: 100, path: "RP_PATH_LINEAR" });
  });

  it("rejects what LVGL can't do", () => {
    expect(() => translate("all 200ms")).toThrow(/List them/);
    expect(() => translate("margin 200ms")).toThrow(/Can't animate/);
    expect(() => translate("color 200ms, opacity 300ms")).toThrow(/one duration/);
    expect(() => translate("color 200ms cubic-bezier(0,0,1,1)")).toThrow(/Unsupported easing/);
  });
});
