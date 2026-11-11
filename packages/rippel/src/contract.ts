/**
 * Firmware contract: the typed interface between the UI and the firmware.
 *
 * - `signal(type)` declares a value the firmware pushes to the UI. UI code
 *   reads it like a Solid signal; only the firmware (or the dev mock panel)
 *   can set it.
 * - `action(params)` declares a call the UI makes into the firmware.
 *
 * Codegen turns the contract into a C header (setters and action callbacks).
 * In the dev runtime, the mock panel sets signals and logs actions.
 */
import { createSignal } from "solid-js";
import { createList, type ListFields, type ListItem, type ListValues, type RippelList } from "./list.js";

export type IntName = "i8" | "u8" | "i16" | "u16" | "i32" | "u32";

export type ValueType =
  | { readonly kind: "int"; readonly name: IntName; readonly min: number; readonly max: number }
  | { readonly kind: "float"; readonly name: "f32" }
  | { readonly kind: "bool"; readonly name: "bool" }
  | { readonly kind: "string"; readonly name: "str"; readonly maxLength: number };

export type ValueOf<T extends ValueType> = T extends { kind: "int" | "float" }
  ? number
  : T extends { kind: "bool" }
    ? boolean
    : string;

const int = <N extends IntName>(name: N, min: number, max: number) =>
  ({ kind: "int", name, min, max }) as const;

export const i8 = int("i8", -128, 127);
export const u8 = int("u8", 0, 255);
export const i16 = int("i16", -32768, 32767);
export const u16 = int("u16", 0, 65535);
export const i32 = int("i32", -2147483648, 2147483647);
export const u32 = int("u32", 0, 4294967295);
export const f32 = { kind: "float", name: "f32" } as const;
export const bool = { kind: "bool", name: "bool" } as const;
/** A string of at most `maxLength` bytes (UTF-8). The firmware allocates the buffer. */
export const str = (maxLength: number) => ({ kind: "string", name: "str", maxLength }) as const;

const META = Symbol.for("rippel.contract");

export interface SignalMeta<T extends ValueType = ValueType> {
  kind: "signal";
  type: T;
  initial: ValueOf<T>;
  /** Set by the dev shell from the export name. */
  name?: string;
  /** Sets the value, as the firmware would. Not available to UI code. */
  set(value: ValueOf<T>): void;
  /** Dev shell: called after every set, whoever made it. */
  readonly listeners: Set<(value: ValueOf<T>) => void>;
}

export interface ActionMeta<P extends Record<string, ValueType> = Record<string, ValueType>> {
  kind: "action";
  params: P;
  name?: string;
}

export type FirmwareSignal<T extends ValueType> = (() => ValueOf<T>) & { readonly [META]: SignalMeta<T> };
export type FirmwareAction<P extends Record<string, ValueType>> = ((
  args: { [K in keyof P]: ValueOf<P[K]> },
) => void) & { readonly [META]: ActionMeta<P> };

function defaultValue(type: ValueType): ValueOf<ValueType> {
  switch (type.kind) {
    case "int": return Math.max(type.min, Math.min(type.max, 0));
    case "float": return 0;
    case "bool": return false;
    case "string": return "";
  }
}

/** Coerces a value to what the firmware type can actually hold. */
export function coerce<T extends ValueType>(type: T, value: unknown): ValueOf<T> {
  switch (type.kind) {
    case "int": {
      const n = Math.trunc(Number(value));
      return Math.max(type.min, Math.min(type.max, Number.isNaN(n) ? 0 : n)) as ValueOf<T>;
    }
    case "float":
      return Math.fround(Number(value) || 0) as ValueOf<T>;
    case "bool":
      return Boolean(value) as ValueOf<T>;
    case "string": {
      // Truncate to maxLength UTF-8 bytes without splitting a character.
      let s = String(value ?? "");
      while (new TextEncoder().encode(s).length > type.maxLength) s = s.slice(0, -1);
      return s as ValueOf<T>;
    }
  }
}

export function signal<T extends ValueType>(type: T, options: { initial?: ValueOf<T> } = {}): FirmwareSignal<T> {
  const initial = coerce(type, options.initial ?? defaultValue(type));
  const [get, set] = createSignal<ValueOf<T>>(initial, { equals: false });
  const read = () => get();
  const meta: SignalMeta<T> = {
    kind: "signal",
    type,
    initial,
    set(value) {
      const next = coerce(type, value);
      set(() => next);
      for (const listener of meta.listeners) listener(next);
    },
    listeners: new Set(),
  };
  return Object.assign(read, { [META]: meta });
}

export interface ActionCall {
  name: string;
  args: Record<string, unknown>;
  time: number;
  /** Which action was called. */
  meta: ActionMeta;
}

const actionListeners = new Set<(call: ActionCall) => void>();

export function action<P extends Record<string, ValueType>>(params: P): FirmwareAction<P> {
  const meta: ActionMeta<P> = { kind: "action", params };
  const call = (args: { [K in keyof P]: ValueOf<P[K]> }) => {
    const coerced: Record<string, unknown> = {};
    for (const [key, type] of Object.entries(params)) coerced[key] = coerce(type, args[key]);
    const record = { name: meta.name ?? "(unnamed action)", args: coerced, time: Date.now(), meta: meta as ActionMeta };
    for (const listener of actionListeners) listener(record);
  };
  return Object.assign(call, { [META]: meta });
}

/** Dev shell: reads contract metadata from a value, if it is a signal or action. */
/** What the firmware can do to one of its lists. Items are identified by the id `add` returns. */
export interface FirmwareListHandle<F extends ListFields> {
  add(values: ListValues<F>): number;
  update(id: number, changes: Partial<ListValues<F>>): void;
  remove(id: number): void;
  clear(): void;
}

export interface ListMeta<F extends ListFields = ListFields> {
  kind: "list";
  capacity: number;
  fields: F;
  name?: string;
  /** The list as the UI sees it. */
  list: RippelList<F>;
  /** The firmware's side, used by the mock and the dev panel. */
  firmware: FirmwareListHandle<F>;
}

/** A list the firmware fills. The UI can read it but not change it. */
export type FirmwareList<F extends ListFields> = Pick<RippelList<F>, "capacity" | "size" | "items" | "sorted" | "sum"> & {
  readonly [META]: ListMeta<F>;
};

/**
 * Declares a list the firmware fills, like Wi-Fi scan results. It has a fixed
 * capacity and field types, so the device reserves its storage at build time.
 * The firmware gets ui_<name>_add, _update, _remove and _clear functions.
 */
export function list<F extends ListFields>(options: { capacity: number; fields: F }): FirmwareList<F> {
  const inner = createList({ capacity: options.capacity, fields: options.fields });
  const find = (id: number) => inner.items().find((item) => item.id === id);
  const firmware: FirmwareListHandle<F> = {
    add: (values) => inner.add(values),
    update(id, changes) {
      const item = find(id);
      if (item) inner.update(item, changes);
    },
    remove(id) {
      const item = find(id);
      if (item) inner.remove(item);
    },
    clear() {
      for (const item of inner.items()) inner.remove(item);
    },
  };
  const meta: ListMeta<F> = { kind: "list", capacity: options.capacity, fields: options.fields, list: inner, firmware };
  return {
    capacity: inner.capacity,
    size: inner.size,
    items: inner.items,
    sorted: inner.sorted,
    sum: inner.sum,
    [META]: meta,
  };
}

export type { ListItem };

/** Dev shell: reads contract metadata from a value, if it is a signal, action or list. */
export function contractMeta(value: unknown): SignalMeta | ActionMeta | ListMeta | undefined {
  if ((typeof value === "function" || (typeof value === "object" && value !== null)) && META in value) {
    return (value as { [META]: SignalMeta | ActionMeta | ListMeta })[META];
  }
  return undefined;
}

/** Dev shell: subscribes to action calls. Returns an unsubscribe function. */
export function onActionCall(listener: (call: ActionCall) => void): () => void {
  actionListeners.add(listener);
  return () => actionListeners.delete(listener);
}
