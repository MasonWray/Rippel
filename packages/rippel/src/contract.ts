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
    set: (value) => set(() => coerce(type, value)),
  };
  return Object.assign(read, { [META]: meta });
}

export interface ActionCall {
  name: string;
  args: Record<string, unknown>;
  time: number;
}

const actionListeners = new Set<(call: ActionCall) => void>();

export function action<P extends Record<string, ValueType>>(params: P): FirmwareAction<P> {
  const meta: ActionMeta<P> = { kind: "action", params };
  const call = (args: { [K in keyof P]: ValueOf<P[K]> }) => {
    const coerced: Record<string, unknown> = {};
    for (const [key, type] of Object.entries(params)) coerced[key] = coerce(type, args[key]);
    const record = { name: meta.name ?? "(unnamed action)", args: coerced, time: Date.now() };
    for (const listener of actionListeners) listener(record);
  };
  return Object.assign(call, { [META]: meta });
}

/** Dev shell: reads contract metadata from a value, if it is a signal or action. */
export function contractMeta(value: unknown): SignalMeta | ActionMeta | undefined {
  if (typeof value === "function" && META in value) return (value as { [META]: SignalMeta | ActionMeta })[META];
  return undefined;
}

/** Dev shell: subscribes to action calls. Returns an unsubscribe function. */
export function onActionCall(listener: (call: ActionCall) => void): () => void {
  actionListeners.add(listener);
  return () => actionListeners.delete(listener);
}
