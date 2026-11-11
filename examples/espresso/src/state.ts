/** State shared across screens. One signal per fact; everything else is derived. */
import { batch, createList, createSignal, type ListItem } from "rippel";
import { f32, u8 } from "rippel/contract";
import { ackShot, boilerC, elapsedDs, phase, pressureBar, setBoilerTarget, startShot, waterPct, weightG } from "./firmware.contract";
import { RECIPES } from "./recipes";

export const PHASE = { idle: 0, preinfuse: 1, ramp: 2, extract: 3, done: 4 };

export const [tab, setTab] = createSignal<"brew" | "history">("brew");

// Recipe and its adjustable settings

export const [recipeIndex, setRecipeIndex] = createSignal(0);
export const recipe = () => RECIPES[recipeIndex()];
export const accent = () => recipe().accent;

export const [doseTenths, setDoseTenths] = createSignal(RECIPES[0].doseTenths);
export const [ratioTenths, setRatioTenths] = createSignal(RECIPES[0].ratioTenths);
export const [tempC, setTempC] = createSignal(RECIPES[0].tempC);

export const targetYieldG = () => Math.round((doseTenths() * ratioTenths()) / 100);

export function selectRecipe(index: number) {
  const next = RECIPES[index];
  batch(() => {
    setRecipeIndex(index);
    setDoseTenths(next.doseTenths);
    setRatioTenths(next.ratioTenths);
    setTempC(next.tempC);
  });
  setBoilerTarget({ celsius: next.tempC });
}

// Machine readiness

export const boilerReady = () => Math.abs(boilerC() - tempC()) <= 1;
export const waterLow = () => waterPct() < 15;
export const canBrew = () => boilerReady() && !waterLow();

// Live pressure trace: one signal per chart column, so each sample redraws one bar

export const COLUMNS = Array.from({ length: 40 }, (_, i) => i);
const columns = COLUMNS.map(() => createSignal(0));
export const sample = (col: number) => columns[col][0]();
export const [peakPressure, setPeakPressure] = createSignal(0);

/** The column the current moment of the shot falls in. */
function currentColumn() {
  const fraction = elapsedDs() / (recipe().durationS * 10);
  return Math.min(COLUMNS.length - 1, Math.floor(fraction * COLUMNS.length));
}

/** Copies the live pressure into the chart. Run inside an effect. */
export function recordSample() {
  if (phase() === PHASE.idle || phase() === PHASE.done) return;
  columns[currentColumn()][1](pressureBar());
  setPeakPressure(Math.max(peakPressure(), pressureBar()));
}

export function beginShot() {
  batch(() => {
    for (const [, set] of columns) set(0);
    setPeakPressure(0);
  });
  startShot({ recipe: recipeIndex(), yieldG: targetYieldG() });
}

// Shot history. The capacity is fixed, so the device reserves room for it up front.

const SHOT_FIELDS = { recipe: u8, doseG: f32, yieldG: f32, seconds: f32, rating: u8 };

export type Shot = ListItem<typeof SHOT_FIELDS>;

export const shots = createList({
  capacity: 12,
  fields: SHOT_FIELDS,
  initial: [
    { recipe: 0, doseG: 18.5, yieldG: 37, seconds: 29.1, rating: 3 },
    { recipe: 2, doseG: 17, yieldG: 37.4, seconds: 25.9, rating: 2 },
    { recipe: 0, doseG: 18, yieldG: 36, seconds: 27.8, rating: 4 },
    { recipe: 1, doseG: 18, yieldG: 45, seconds: 32.4, rating: 5 },
    { recipe: 3, doseG: 15, yieldG: 45, seconds: 18.2, rating: 3 },
  ],
});

export const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "best", label: "Top rated" },
  { key: "fastest", label: "Fastest" },
];

export const [sortKey, setSortKey] = createSignal("newest");

export const sortedShots = () =>
  shots.sorted((a, b) => {
    if (sortKey() === "best" && a.rating !== b.rating) return b.rating - a.rating;
    if (sortKey() === "fastest") return a.seconds - b.seconds;
    return b.id - a.id;
  });

/** Files the finished shot and returns the machine to idle. */
export function saveFinishedShot(rating: number) {
  shots.add({ recipe: recipeIndex(), doseG: doseTenths() / 10, yieldG: weightG(), seconds: elapsedDs() / 10, rating });
  batch(() => {
    setSortKey("newest");
    setTab("history");
  });
  ackShot({});
}

export function discardFinishedShot() {
  ackShot({});
}
