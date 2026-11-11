/**
 * Rippel's authoring API. Shaped like Solid's, but owned by Rippel so the
 * device-side implementation can differ.
 */
import {
  For as SolidFor,
  Index as SolidIndex,
  Match as SolidMatch,
  Show as SolidShow,
  Switch as SolidSwitch,
  type Accessor,
} from "solid-js";
import type { JSX } from "./jsx-runtime.js";

export {
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
  type Setter,
  type Signal,
} from "solid-js";

export type { JSX } from "./jsx-runtime.js";
export { defineConfig, type RippelConfig, type FontConfig } from "./config.js";

export type Component<P = {}> = (props: P) => JSX.Element;
export type ParentComponent<P = {}> = Component<P & { children?: JSX.Element }>;

/** Renders its children when `when` is truthy, otherwise `fallback`. */
export const Show = SolidShow as unknown as <T>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  fallback?: JSX.Element;
  children: JSX.Element | ((item: Accessor<NonNullable<T>>) => JSX.Element);
}) => JSX.Element;

/** Renders one item per array entry, keyed by reference. */
export const For = SolidFor as unknown as <T>(props: {
  each: readonly T[] | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: T, index: Accessor<number>) => JSX.Element;
}) => JSX.Element;

/** Renders one item per array index. */
export const Index = SolidIndex as unknown as <T>(props: {
  each: readonly T[] | undefined | null | false;
  fallback?: JSX.Element;
  children: (item: Accessor<T>, index: number) => JSX.Element;
}) => JSX.Element;

/** Renders the first matching <Match>. */
export const Switch = SolidSwitch as unknown as (props: {
  fallback?: JSX.Element;
  children: JSX.Element;
}) => JSX.Element;

export const Match = SolidMatch as unknown as <T>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  children: JSX.Element | ((item: Accessor<NonNullable<T>>) => JSX.Element);
}) => JSX.Element;
export { createList, type ListFields, type ListItem, type ListOptions, type ListValues, type RippelList } from "./list.js";
