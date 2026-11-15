/**
 * Keeps docs/agent-guide.md in step with the code. When you add an element,
 * CSS property, state, part, export or preset, this fails until the guide
 * mentions it, so agents learn about it too.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WIDGETS } from "./codegen/compile.js";
import { BUILTIN_MONTSERRAT_SIZES } from "./config.js";
import * as contract from "./contract.js";
import * as displays from "./displays.js";
import * as rippel from "./index.js";
import * as mcu from "./mcu.js";
import * as mock from "./mock.js";
import { PARTS, STATES } from "./style/css.js";
import { SUPPORTED_PROPERTIES, TRANSITION_PROPS } from "./style/translate.js";

const guide = readFileSync(new URL("../docs/agent-guide.md", import.meta.url), "utf8");

/** Names the guide must show in backticks, like `createSignal`. */
function missing(names: Iterable<string>, format = (name: string) => name): string[] {
  return [...names].filter((name) => !guide.includes("`" + format(name) + "`"));
}

/** Exports that only the dev shell or the mock runtime use, not user code. */
const INTERNAL = new Set(["contractMeta", "onActionCall", "coerce", "startMock", "dpiFromDiagonal"]);
const runtimeExports = (module: object) => Object.keys(module).filter((name) => !INTERNAL.has(name));

describe("agent guide", () => {
  it("lists every element", () => {
    expect(missing(Object.keys(WIDGETS))).toEqual([]);
  });

  it("lists every CSS property", () => {
    expect(missing(SUPPORTED_PROPERTIES)).toEqual([]);
  });

  it("lists every property that can transition", () => {
    const section = guide.slice(guide.indexOf("`transition` runs when"));
    expect(Object.keys(TRANSITION_PROPS).filter((p) => !section.includes("`" + p + "`"))).toEqual([]);
  });

  it("lists every state and part", () => {
    expect(missing(Object.keys(STATES), (s) => `:${s}`)).toEqual([]);
    expect(missing(Object.keys(PARTS), (p) => `::${p}`)).toEqual([]);
  });

  it("covers every export of rippel, rippel/contract and rippel/mock", () => {
    expect(missing(runtimeExports(rippel))).toEqual([]);
    expect(missing(runtimeExports(contract).map((name) => (name === "str" ? "str(n)" : name)))).toEqual([]);
    expect(missing(runtimeExports(mock))).toEqual([]);
  });

  it("names every display and MCU preset", () => {
    expect(missing(runtimeExports(displays))).toEqual([]);
    expect(missing(runtimeExports(mcu))).toEqual([]);
  });

  it("lists the built-in Montserrat sizes", () => {
    const sizes = BUILTIN_MONTSERRAT_SIZES.slice(0, -1).join(", ") + " and " + BUILTIN_MONTSERRAT_SIZES.at(-1);
    expect(guide).toContain(sizes);
  });
});
