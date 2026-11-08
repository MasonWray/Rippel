/**
 * Firmware mock panel: a control for every contract signal and a log of
 * every action call, so the UI can be exercised without hardware.
 */
import { coerce, contractMeta, onActionCall, type ActionCall, type SignalMeta } from "../contract.js";
import { h } from "./dom.js";

function signalControl(meta: SignalMeta): HTMLElement {
  const { type } = meta;
  const id = `signal-${meta.name}`;
  let current = meta.initial;
  const set = (value: unknown) => {
    current = coerce(type, value);
    meta.set(current);
  };

  if (type.kind === "bool") {
    const input = h("input", { type: "checkbox", id, "aria-label": meta.name, checked: Boolean(current) });
    input.addEventListener("change", () => set(input.checked));
    return input;
  }

  if (type.kind === "string") {
    const input = h("input", { type: "text", id, "aria-label": meta.name, value: String(current), maxLength: type.maxLength });
    input.addEventListener("input", () => set(input.value));
    return input;
  }

  // Numbers: a number box, plus a slider when the type's range is small enough to scrub.
  const isInt = type.kind === "int";
  const input = h("input", {
    type: "number",
    id,
    "aria-label": meta.name,
    value: String(current),
    step: isInt ? 1 : 0.1,
    min: isInt ? type.min : undefined,
    max: isInt ? type.max : undefined,
  });
  const wrap = h("div", { class: "rp-number" }, input);
  let range: HTMLInputElement | undefined;
  if (isInt && type.max - type.min <= 1000) {
    range = h("input", { type: "range", "aria-label": `${meta.name} slider`, min: type.min, max: type.max, step: 1, value: String(current) });
    range.addEventListener("input", () => {
      set(range!.value);
      input.value = String(current);
    });
    wrap.prepend(range);
  }
  input.addEventListener("input", () => {
    if (input.value === "" || input.value === "-") return;
    set(input.value);
    if (range) range.value = String(current);
  });
  input.addEventListener("blur", () => (input.value = String(current)));
  return wrap;
}

function formatCall(call: ActionCall): string {
  const args = Object.entries(call.args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return `${call.name}(${args ? `{ ${args} }` : ""})`;
}

export function createPanel(contract: Record<string, unknown> | undefined): HTMLElement {
  const signals = h("div", { class: "rp-signals" });
  const actions: string[] = [];

  for (const [name, value] of Object.entries(contract ?? {})) {
    const meta = contractMeta(value);
    if (!meta) continue;
    meta.name = name;
    if (meta.kind === "signal") {
      signals.append(
        h(
          "label",
          { class: "rp-signal", for: `signal-${name}` },
          h("span", { class: "rp-signal-name" }, name),
          h("span", { class: "rp-type" }, meta.type.kind === "string" ? `str(${meta.type.maxLength})` : meta.type.name),
        ),
        signalControl(meta),
      );
    } else {
      const params = Object.entries(meta.params)
        .map(([k, t]) => `${k}: ${t.name}`)
        .join(", ");
      actions.push(`${name}(${params ? `{ ${params} }` : ""})`);
    }
  }

  const log = h("ol", { class: "rp-log" });
  const empty = h("p", { class: "rp-empty" }, "No calls yet.");
  onActionCall((call) => {
    empty.remove();
    const time = new Date(call.time).toLocaleTimeString([], { hour12: false });
    log.prepend(h("li", {}, h("time", {}, time), h("code", {}, formatCall(call))));
    while (log.children.length > 200) log.lastChild?.remove();
  });
  const clear = h("button", { class: "rp-link", type: "button" }, "Clear");
  clear.addEventListener("click", () => {
    log.replaceChildren();
    log.before(empty);
  });

  const hasContract = contract !== undefined;
  return h(
    "aside",
    { class: "rp-panel" },
    h("section", {}, h("h2", {}, "Firmware signals"),
      hasContract && signals.children.length
        ? signals
        : h("p", { class: "rp-empty" }, hasContract ? "The contract declares no signals." : "No firmware contract found."),
    ),
    h("section", {},
      h("div", { class: "rp-section-head" }, h("h2", {}, "Action calls"), clear),
      actions.length ? h("p", { class: "rp-declared" }, actions.join("\n")) : undefined,
      empty,
      log,
    ),
  );
}
