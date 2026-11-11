/**
 * createList: a list of records that changes at runtime, with a fixed capacity.
 *
 * The capacity is what makes this work on a microcontroller. The device build
 * reserves storage and builds one row of UI per slot up front, so memory use
 * is known at compile time and never grows.
 *
 * Field types use the same names as the firmware contract. Items are plain to
 * read (`item.rating`) and reactive: anything that reads a field updates when
 * the field changes through `update`.
 */
import { batch, createSignal } from "solid-js";
import { coerce, type ValueOf, type ValueType } from "./contract.js";

export type ListFields = Record<string, ValueType>;
export type ListValues<F extends ListFields> = { [K in keyof F]: ValueOf<F[K]> };

/** An item in a list. `id` is assigned when it's added and increases with each add. */
export type ListItem<F extends ListFields> = Readonly<ListValues<F>> & { readonly id: number };

export interface RippelList<F extends ListFields> {
  readonly capacity: number;
  /** How many items the list holds. */
  size(): number;
  /** The items, oldest first. */
  items(): ListItem<F>[];
  /** The items in the order `compare` gives, like Array.prototype.sort. */
  sorted(compare: (a: ListItem<F>, b: ListItem<F>) => number): ListItem<F>[];
  /** Adds up `value` over every item. */
  sum(value: (item: ListItem<F>) => number): number;
  /** Adds an item. When the list is full, the oldest item is dropped to make room. */
  add(values: ListValues<F>): void;
  remove(item: ListItem<F>): void;
  update(item: ListItem<F>, changes: Partial<ListValues<F>>): void;
}

export interface ListOptions<F extends ListFields> {
  capacity: number;
  fields: F;
  initial?: ListValues<F>[];
}

export function createList<F extends ListFields>(options: ListOptions<F>): RippelList<F> {
  const { capacity, fields } = options;
  const [items, setItems] = createSignal<ListItem<F>[]>([]);
  const setters = new WeakMap<object, Record<string, (value: unknown) => void>>();
  let nextId = 1;

  const makeItem = (values: ListValues<F>): ListItem<F> => {
    const item: Record<string, unknown> = {};
    Object.defineProperty(item, "id", { value: nextId++, enumerable: true });
    const itemSetters: Record<string, (value: unknown) => void> = {};
    for (const [name, type] of Object.entries(fields)) {
      const [get, set] = createSignal<unknown>(coerce(type, values[name]));
      Object.defineProperty(item, name, { get, enumerable: true });
      itemSetters[name] = (value) => set(() => coerce(type, value));
    }
    setters.set(item, itemSetters);
    return item as ListItem<F>;
  };

  const initial = options.initial ?? [];
  if (initial.length > capacity) throw new Error(`createList: ${initial.length} initial items don't fit a capacity of ${capacity}`);
  setItems(initial.map(makeItem));

  return {
    capacity,
    size: () => items().length,
    items: () => items(),
    sorted: (compare) => [...items()].sort(compare),
    sum: (value) => items().reduce((total, item) => total + value(item), 0),
    add(values) {
      const kept = items().length >= capacity ? items().slice(1) : items();
      setItems([...kept, makeItem(values)]);
    },
    remove(item) {
      setItems(items().filter((i) => i !== item));
    },
    update(item, changes) {
      const itemSetters = setters.get(item);
      if (!itemSetters) return;
      batch(() => {
        for (const [name, value] of Object.entries(changes)) itemSetters[name]?.(value);
      });
    },
  };
}
