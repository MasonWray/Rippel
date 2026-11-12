/**
 * Firmware mock panel: a control for every contract signal and a log of
 * every action call, so the UI can be exercised without hardware.
 */
import { createEffect, createRoot } from "solid-js";
import { coerce, contractMeta, onActionCall, type ActionCall, type ListMeta, type SignalMeta } from "../contract.js";
import type { ValueType } from "../contract.js";
import { h } from "./dom.js";

function signalControl(meta: SignalMeta): HTMLElement {
  const { type } = meta;
  const id = `signal-${meta.name}`;
  let current = meta.initial;
  const set = (value: unknown) => meta.set(coerce(type, value));
  /** Keeps a control in step with the signal, unless the user is editing it. */
  const follow = (update: (value: typeof current) => void, control: HTMLElement) => {
    meta.listeners.add((value) => {
      current = value;
      if (document.activeElement !== control) update(value);
    });
  };

  if (type.kind === "bool") {
    const input = h("input", { type: "checkbox", id, "aria-label": meta.name, checked: Boolean(current) });
    input.addEventListener("change", () => set(input.checked));
    follow((value) => (input.checked = Boolean(value)), input);
    return input;
  }

  if (type.kind === "string") {
    const input = h("input", { type: "text", id, "aria-label": meta.name, value: String(current), maxLength: type.maxLength });
    input.addEventListener("input", () => set(input.value));
    follow((value) => (input.value = String(value)), input);
    return input;
  }

  // f32 values have rounding noise, so show two decimals at most.
  const show = (value: typeof current) => String(Math.round(Number(value) * 100) / 100);

  // Numbers: a number box, plus a slider when the type's range is small enough to scrub.
  const isInt = type.kind === "int";
  const input = h("input", {
    type: "number",
    id,
    "aria-label": meta.name,
    value: show(current),
    step: isInt ? 1 : 0.1,
    min: isInt ? type.min : undefined,
    max: isInt ? type.max : undefined,
  });
  const wrap = h("div", { class: "rp-number" }, input);
  let range: HTMLInputElement | undefined;
  if (isInt && type.max - type.min <= 1000) {
    range = h("input", { type: "range", "aria-label": `${meta.name} slider`, min: type.min, max: type.max, step: 1, value: String(current) });
    range.addEventListener("input", () => set(range!.value));
    follow((value) => (range!.value = String(value)), range);
    wrap.prepend(range);
  }
  input.addEventListener("input", () => {
    if (input.value === "" || input.value === "-") return;
    set(input.value);
  });
  input.addEventListener("blur", () => (input.value = show(current)));
  follow((value) => (input.value = show(value)), input);
  return wrap;
}

function fieldInput(name: string, type: ValueType): { el: HTMLInputElement; read: () => unknown } {
  if (type.kind === "bool") {
    const el = h("input", { type: "checkbox", "aria-label": name });
    return { el, read: () => el.checked };
  }
  if (type.kind === "string") {
    const el = h("input", { type: "text", "aria-label": name, placeholder: name, maxLength: type.maxLength });
    return { el, read: () => el.value };
  }
  const el = h("input", { type: "number", "aria-label": name, placeholder: name, value: "0" });
  return { el, read: () => el.value };
}

/** A firmware list: its items, with controls to add, remove and clear them as the firmware would. */
function listSection(meta: ListMeta): HTMLElement {
  const fields = Object.entries(meta.fields);
  const count = h("span", { class: "rp-type" });
  const rows = h("ol", { class: "rp-log" });
  const clear = h("button", { class: "rp-link", type: "button" }, "Clear");
  clear.addEventListener("click", () => meta.firmware.clear());

  createRoot(() =>
    createEffect(() => {
      const items = meta.list.items();
      count.textContent = `${items.length} of ${meta.capacity}`;
      rows.replaceChildren(
        ...items.map((item) => {
          const values = item as unknown as Record<string, unknown>;
          const text = fields.map(([field]) => `${field}: ${JSON.stringify(values[field])}`).join(", ");
          const remove = h("button", { class: "rp-link", type: "button" }, "Remove");
          remove.addEventListener("click", () => meta.firmware.remove(item.id));
          return h("li", {}, h("code", {}, `#${item.id} ${text}`), remove);
        }),
      );
    }),
  );

  const inputs = fields.map(([field, type]) => ({ field, type, ...fieldInput(field, type) }));
  const add = h("button", { class: "rp-link", type: "button" }, "Add");
  add.addEventListener("click", () => {
    const values: Record<string, unknown> = {};
    for (const input of inputs) values[input.field] = coerce(input.type, input.read());
    meta.firmware.add(values as never);
  });

  return h(
    "div",
    { class: "rp-list" },
    h("div", { class: "rp-section-head" }, h("span", { class: "rp-signal-name" }, meta.name ?? "list"), count, clear),
    rows,
    h("div", { class: "rp-list-add" }, ...inputs.map((i) => i.el), add),
  );
}

function formatCall(call: ActionCall): string {
  const args = Object.entries(call.args)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  return `${call.name}(${args ? `{ ${args} }` : ""})`;
}

export function createPanel(contract: Record<string, unknown> | undefined): HTMLElement {
  const signals = h("div", { class: "rp-signals" });
  const lists: HTMLElement[] = [];
  const actions: string[] = [];

  for (const [name, value] of Object.entries(contract ?? {})) {
    const meta = contractMeta(value);
    if (!meta) continue;
    meta.name = name;
    if (meta.kind === "widget") {
      continue;
    } else if (meta.kind === "list") {
      lists.push(listSection(meta));
    } else if (meta.kind === "signal") {
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
    lists.length ? h("section", {}, h("h2", {}, "Firmware lists"), ...lists) : undefined,
    h("section", {},
      h("div", { class: "rp-section-head" }, h("h2", {}, "Action calls"), clear),
      actions.length ? h("p", { class: "rp-declared" }, actions.join("\n")) : undefined,
      empty,
      log,
    ),
  );
}
