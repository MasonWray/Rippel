import { bool, i16, signal, widget } from "rippel/contract";

/**
 * ArkViz's house view, drawn in C in firmware/widgets/house_view.c. Drag it to turn the house.
 * `explode` pulls the floors apart, `spin` turns it by itself in degrees a second, `lights` shows the lights that are
 * on, and `stats` shows the frame rate and the time spent drawing each frame.
 */
export const HouseView = widget({ explode: bool, spin: i16, lights: bool, stats: bool });

/** Spins the house and shows the frame rate, to measure the house view without touching the screen. */
export const benchmark = signal(bool);
