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
  /**
   * On the device, build this branch's objects when it opens and delete them
   * when it closes, instead of building them up front and hiding them. Saves
   * LVGL memory for screens that aren't always open, at the cost of building
   * them each time they open. The dev runtime always works this way.
   */
  lazy?: boolean;
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
  /** Makes every branch lazy. See `lazy` on <Show>. */
  lazy?: boolean;
  children: JSX.Element;
}) => JSX.Element;

export const Match = SolidMatch as unknown as <T>(props: {
  when: T | undefined | null | false;
  keyed?: false;
  /** Builds this branch when it opens. See `lazy` on <Show>. */
  lazy?: boolean;
  children: JSX.Element | ((item: Accessor<NonNullable<T>>) => JSX.Element);
}) => JSX.Element;
export { createList, type ListFields, type ListItem, type ListOptions, type ListValues, type RippelList } from "./list.js";
export type { ImageAsset } from "./jsx-runtime.js";
/** The item type of a list, like `ItemOf<typeof networks>`. */
export type ItemOf<L extends { items(): unknown[] }> = ReturnType<L["items"]>[number];
