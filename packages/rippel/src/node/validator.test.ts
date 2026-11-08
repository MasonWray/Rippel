import { describe, expect, it } from "vitest";
import { validateSource } from "./validator.js";

const messages = (code: string) => validateSource(code, "App.tsx").map((i) => i.message);

describe("validateSource", () => {
  it("accepts ordinary component code", () => {
    const code = `
      import { createSignal, Show, type Accessor } from "rippel";
      import { temperature } from "./firmware.contract";
      import "./styles.css";
      type Props = { label: string; items: Map<string, number> };
      export default function App(props: Props) {
        const [n, setN] = createSignal(0);
        const doubled = () => n() * 2;
        const label = (v: number) => \`\${v.toFixed(1)}°\`;
        return <view><label>{label(temperature())}</label><button onClick={() => setN(n() + 1)}>+</button></view>;
      }
    `;
    expect(messages(code)).toEqual([]);
  });

  it("flags code the device build can't compile", () => {
    const code = `
      import { format } from "date-fns";
      class Store {}
      async function load() { await fetch("/x"); }
      function* gen() {}
      try { throw 1 } catch {}
      const re = /a+/;
      const d = new Date();
      setTimeout(() => {}, 10);
      delete obj.x;
      import("./lazy");
    `;
    expect(messages(code)).toEqual([
      expect.stringMatching(/Can't import "date-fns"/),
      expect.stringMatching(/Classes/),
      expect.stringMatching(/Async functions/),
      expect.stringMatching(/"fetch" isn't available/),
      expect.stringMatching(/Generators/),
      expect.stringMatching(/Exceptions/),
      expect.stringMatching(/Exceptions/),
      expect.stringMatching(/Regular expressions/),
      expect.stringMatching(/`new` isn't supported/),
      expect.stringMatching(/"setTimeout" isn't available/),
      expect.stringMatching(/`delete`/),
      expect.stringMatching(/Dynamic import/),
    ]);
  });

  it("allows type-only imports and local names that shadow globals", () => {
    const code = `
      import type { Foo } from "some-lib";
      const Date = (n: number) => n;
      export const x = Date(1);
    `;
    expect(messages(code)).toEqual([]);
  });

  it("reports line and column", () => {
    expect(validateSource("const a = 1;\nconst r = /x/;", "a.ts")[0]).toMatchObject({ line: 2, column: 11 });
  });
});
