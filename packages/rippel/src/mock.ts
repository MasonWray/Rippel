/**
 * Firmware mocks: a dev-only script that plays the firmware in the simulator,
 * pushing signals and answering actions. It runs in the browser and is never
 * compiled for the device, so it can use any JavaScript.
 *
 * Put it in `src/firmware.mock.ts` and default-export `defineMock(...)`.
 */
import { batch } from "solid-js";
import {
  contractMeta,
  onActionCall,
  type ActionMeta,
  type FirmwareAction,
  type FirmwareList,
  type FirmwareListHandle,
  type FirmwareSignal,
  type ListMeta,
  type SignalMeta,
  type ValueOf,
  type ValueType,
} from "./contract.js";
import type { ListFields } from "./list.js";

export interface MockContext {
  /** Pushes a signal value, as the firmware's generated setter would. */
  set<T extends ValueType>(signal: FirmwareSignal<T>, value: ValueOf<T>): void;
  /** Runs `handler` whenever the UI calls this action. */
  on<P extends Record<string, ValueType>>(
    action: FirmwareAction<P>,
    handler: (args: { [K in keyof P]: ValueOf<P[K]> }) => void,
  ): void;
  /** Runs `tick` every `ms` milliseconds, passing the time since the last run. */
  every(ms: number, tick: (elapsedMs: number) => void): void;
  /** The firmware's side of a list: add, update, remove and clear, as the generated C functions do. */
  list<F extends ListFields>(list: FirmwareList<F>): FirmwareListHandle<F>;
}

export type Mock = (context: MockContext) => void;

/** Identity helper that gives the mock type checking. */
export function defineMock(mock: Mock): Mock {
  return mock;
}

/** Dev shell: starts a mock. Updates in one tick or handler reach the UI together. */
export function startMock(mock: Mock): void {
  mock({
    set(signal, value) {
      (contractMeta(signal) as SignalMeta).set(value as never);
    },
    on(action, handler) {
      const meta = contractMeta(action) as ActionMeta;
      onActionCall((call) => {
        if (call.meta === meta) batch(() => handler(call.args as never));
      });
    },
    list(list) {
      const meta = contractMeta(list) as ListMeta<never>;
      return meta.firmware as never;
    },
    every(ms, tick) {
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        const elapsed = now - last;
        last = now;
        batch(() => tick(elapsed));
      }, ms);
    },
  });
}
