import { action, bool, i16, signal, u8 } from "rippel/contract";

/** Room temperature in whole °C, pushed by the firmware. */
export const temperature = signal(i16, { initial: 22 });

/** Battery charge in percent. */
export const batteryPct = signal(u8, { initial: 87 });

/** Whether the thermostat is connected to the hub. */
export const online = signal(bool, { initial: true });

/** Asks the firmware to hold the room at this temperature. */
export const setpoint = action({ celsius: i16 });
