import { action, f32, signal, u16, u8 } from "rippel/contract";

/** Boiler temperature in °C. */
export const boilerC = signal(f32, { initial: 62 });

/** Water tank level in percent. */
export const waterPct = signal(u8, { initial: 78 });

/** Where the shot is: 0 idle, 1 pre-infusion, 2 ramp, 3 extraction, 4 finished. */
export const phase = signal(u8);

/** Shot time in tenths of a second. */
export const elapsedDs = signal(u16);

/** Group head pressure in bar. */
export const pressureBar = signal(f32);

/** Flow out of the group head in ml/s. */
export const flowMlS = signal(f32);

/** Weight in the cup in grams, from the scale in the drip tray. */
export const weightG = signal(f32);

/** Asks the firmware to hold the boiler at this temperature. */
export const setBoilerTarget = action({ celsius: u8 });

/** Starts a shot on a pressure profile, stopping at the target weight. */
export const startShot = action({ recipe: u8, yieldG: u16 });

/** Stops the running shot early. */
export const stopShot = action({});

/** Tells the firmware the user has seen the finished shot. Returns the phase to idle. */
export const ackShot = action({});
