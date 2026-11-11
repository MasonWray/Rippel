/** State shared across screens. One signal per fact; everything else is derived. */
import { batch, createSignal } from "rippel";
import { ackShot, boilerC, elapsedDs, phase, pressureBar, setBoilerTarget, startShot, waterPct, weightG } from "./firmware.contract";
import { RECIPES, type Recipe } from "./recipes";

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

// Shot history

export interface Shot {
  id: number;
  recipe: Recipe;
  doseG: number;
  yieldG: number;
  seconds: number;
  rating: () => number;
  setRating: (value: number) => void;
}

let nextShotId = 1;

function makeShot(recipe: Recipe, doseG: number, yieldG: number, seconds: number, initialRating: number): Shot {
  const [rating, setRating] = createSignal(initialRating);
  return { id: nextShotId++, recipe, doseG, yieldG, seconds, rating, setRating };
}

export const [shots, setShots] = createSignal<Shot[]>([
  makeShot(RECIPES[3], 15, 45, 18.2, 3),
  makeShot(RECIPES[1], 18, 45, 32.4, 5),
  makeShot(RECIPES[0], 18, 36, 27.8, 4),
  makeShot(RECIPES[2], 17, 37.4, 25.9, 2),
  makeShot(RECIPES[0], 18.5, 37, 29.1, 3),
]);

export const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "best", label: "Top rated" },
  { key: "fastest", label: "Fastest" },
];

export const [sortKey, setSortKey] = createSignal("newest");

export function sortedShots(): Shot[] {
  const list = [...shots()];
  if (sortKey() === "best") return list.sort((a, b) => b.rating() - a.rating() || b.id - a.id);
  if (sortKey() === "fastest") return list.sort((a, b) => a.seconds - b.seconds);
  return list.sort((a, b) => b.id - a.id);
}

export function deleteShot(shot: Shot) {
  setShots(shots().filter((s) => s !== shot));
}

/** Files the finished shot and returns the machine to idle. */
export function saveFinishedShot(rating: number) {
  const shot = makeShot(recipe(), doseTenths() / 10, weightG(), elapsedDs() / 10, rating);
  batch(() => {
    setShots([...shots(), shot]);
    setSortKey("newest");
    setTab("history");
  });
  ackShot({});
}

export function discardFinishedShot() {
  ackShot({});
}
