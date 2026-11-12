import type { ImageAsset } from "rippel";
import bloomIcon from "./assets/bloom.png";
import classicIcon from "./assets/classic.png";
import leverIcon from "./assets/lever.png";
import turboIcon from "./assets/turbo.png";

export type Accent = "amber" | "teal" | "rose" | "violet";

/** One stretch of a pressure profile. Pressure moves from `from` to `to` bar until `until` seconds. */
export interface Segment {
  until: number;
  from: number;
  to: number;
  /** The machine phase this stretch belongs to (see `phase` in the contract). */
  phase: number;
}

export interface Recipe {
  name: string;
  icon: ImageAsset;
  accent: Accent;
  /** The accent as 0xRRGGBB, for widgets drawn in C. */
  accentHex: number;
  doseTenths: number;
  ratioTenths: number;
  tempC: number;
  durationS: number;
  segments: Segment[];
}

export const RECIPES: Recipe[] = [
  {
    name: "Classic",
    icon: classicIcon,
    accent: "amber",
    accentHex: 0xf5a524,
    doseTenths: 180,
    ratioTenths: 20,
    tempC: 93,
    durationS: 28,
    segments: [
      { until: 6, from: 1, to: 3, phase: 1 },
      { until: 9, from: 3, to: 9, phase: 2 },
      { until: 28, from: 9, to: 9, phase: 3 },
    ],
  },
  {
    name: "Bloom",
    icon: bloomIcon,
    accent: "teal",
    accentHex: 0x2dd4bf,
    doseTenths: 180,
    ratioTenths: 25,
    tempC: 92,
    durationS: 32,
    segments: [
      { until: 4, from: 0, to: 4, phase: 1 },
      { until: 13, from: 4, to: 2, phase: 1 },
      { until: 16, from: 2, to: 9, phase: 2 },
      { until: 32, from: 9, to: 6, phase: 3 },
    ],
  },
  {
    name: "Lever",
    icon: leverIcon,
    accent: "rose",
    accentHex: 0xfb7185,
    doseTenths: 170,
    ratioTenths: 22,
    tempC: 94,
    durationS: 26,
    segments: [
      { until: 5, from: 2, to: 4, phase: 1 },
      { until: 7, from: 4, to: 10, phase: 2 },
      { until: 26, from: 10, to: 4, phase: 3 },
    ],
  },
  {
    name: "Turbo",
    icon: turboIcon,
    accent: "violet",
    accentHex: 0xa78bfa,
    doseTenths: 150,
    ratioTenths: 30,
    tempC: 90,
    durationS: 18,
    segments: [
      { until: 2, from: 2, to: 3, phase: 1 },
      { until: 4, from: 3, to: 6, phase: 2 },
      { until: 18, from: 6, to: 6, phase: 3 },
    ],
  },
];

export function segmentAt(recipe: Recipe, seconds: number): Segment {
  for (const segment of recipe.segments) {
    if (seconds < segment.until) return segment;
  }
  return recipe.segments[recipe.segments.length - 1];
}

/** The pressure the recipe asks for at this moment of the shot. */
export function pressureAt(recipe: Recipe, seconds: number): number {
  const segment = segmentAt(recipe, seconds);
  const index = recipe.segments.indexOf(segment);
  const start = index === 0 ? 0 : recipe.segments[index - 1].until;
  const t = Math.min(1, (seconds - start) / (segment.until - start));
  return segment.from + (segment.to - segment.from) * t;
}
