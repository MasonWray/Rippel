/**
 * Plays the espresso machine's firmware in the simulator: heats the boiler,
 * runs the pump along the recipe's pressure profile and fills the cup.
 * Runs only in the browser. On the device, the real firmware does this.
 */
import { defineMock } from "rippel/mock";
import * as fw from "./firmware.contract";
import { RECIPES, pressureAt, segmentAt, type Recipe } from "./recipes";

const PHASE_DONE = 4;

const WIFI_NETWORKS = [
  { ssid: "Kitchen", rssi: -48, secure: true },
  { ssid: "Cafe Guest", rssi: -61, secure: false },
  { ssid: "Upstairs", rssi: -67, secure: true },
  { ssid: "Printer-2F4A", rssi: -72, secure: false },
  { ssid: "Neighbor-5G", rssi: -79, secure: true },
];

interface RunningShot {
  recipe: Recipe;
  yieldG: number;
  seconds: number;
}

export default defineMock(({ set, on, every, list }) => {
  let boiler = fw.boilerC();
  let boilerTarget = RECIPES[0].tempC;
  let shot: RunningShot | undefined;
  let pressure = 0;
  let weight = 0;
  let flow = 0;

  const jitter = (size: number) => (Math.random() - 0.5) * 2 * size;

  const finish = () => {
    if (!shot) return;
    shot = undefined;
    set(fw.phase, PHASE_DONE);
    set(fw.flowMlS, 0);
    set(fw.waterPct, Math.max(0, fw.waterPct() - 4));
  };

  on(fw.setBoilerTarget, ({ celsius }) => {
    boilerTarget = celsius;
  });

  on(fw.startShot, ({ recipe, yieldG }) => {
    shot = { recipe: RECIPES[recipe], yieldG, seconds: 0 };
    pressure = 0;
    weight = 0;
    flow = 0;
    set(fw.weightG, 0);
    set(fw.elapsedDs, 0);
  });

  on(fw.stopShot, finish);
  on(fw.ackShot, () => set(fw.phase, 0));

  // Wi-Fi: the first scan finds networks after a moment, then their signal strength drifts
  // and one network comes and goes.
  const wifi = list(fw.wifiNetworks);
  const networks = WIFI_NETWORKS.map((n) => ({ ...n, id: 0 }));
  let scans = 0;
  on(fw.connectWifi, ({ ssid }) => set(fw.wifiSsid, ssid));
  every(2000, () => {
    scans++;
    for (const network of networks) {
      const flaky = network.ssid === "Neighbor-5G";
      const visible = !flaky || Math.floor(scans / 5) % 2 === 0;
      if (!visible) {
        if (network.id) wifi.remove(network.id);
        network.id = 0;
        continue;
      }
      network.rssi = Math.max(-90, Math.min(-35, network.rssi + Math.round((Math.random() - 0.5) * 6)));
      if (network.id) wifi.update(network.id, network);
      else network.id = wifi.add(network);
    }
  });

  every(40, (ms) => {
    const dt = ms / 1000;

    // The brew water pulls the boiler down a little during a shot.
    const hold = shot ? boilerTarget - 0.6 : boilerTarget;
    boiler += (hold - boiler) * Math.min(1, dt * 0.45) + jitter(0.03);
    set(fw.boilerC, boiler);

    if (!shot) {
      pressure *= Math.max(0, 1 - dt * 5);
      set(fw.pressureBar, pressure);
      return;
    }

    shot.seconds += dt;
    const { recipe, yieldG, seconds } = shot;
    const progress = Math.min(1, seconds / recipe.durationS);

    pressure += (pressureAt(recipe, seconds) - pressure) * Math.min(1, dt * 7) + jitter(0.04);

    // Nothing reaches the cup until the puck has soaked through.
    const dripping = Math.max(0, (progress - 0.18) / 0.82);
    const nextWeight = yieldG * Math.pow(dripping, 1.12);
    const nextFlow = dt > 0 ? (nextWeight - weight) / dt : 0;
    flow += (nextFlow - flow) * Math.min(1, dt * 5) + jitter(0.03);
    weight = nextWeight;

    set(fw.phase, segmentAt(recipe, seconds).phase);
    set(fw.elapsedDs, Math.round(seconds * 10));
    set(fw.pressureBar, Math.max(0, pressure));
    set(fw.flowMlS, Math.max(0, flow));
    set(fw.weightG, weight);

    if (progress >= 1) finish();
  });
});
