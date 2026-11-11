import { For } from "rippel";
import { Gauge } from "../components/Gauge";
import { ProfileChart } from "../components/ProfileChart";
import { elapsedDs, flowMlS, phase, pressureBar, stopShot, weightG } from "../firmware.contract";
import { icons } from "../icons";
import { accent, PHASE, recipe, targetYieldG } from "../state";

const STEPS = [
  { phase: PHASE.preinfuse, label: "Pre-infuse" },
  { phase: PHASE.ramp, label: "Ramp" },
  { phase: PHASE.extract, label: "Extract" },
];

export function LiveShot() {
  return (
    <view class="screen">
      <view class="row-between">
        <view class="steps">
          <For each={STEPS}>
            {(step) => (
              <label class={`step step-${accent()}`} checked={phase() >= step.phase}>
                {step.label}
              </label>
            )}
          </For>
        </view>
        <view class="title-row">
          <image class={`tint-${accent()}`} src={recipe().icon} />
          <label class={`recipe-title text-${accent()}`}>{recipe().name}</label>
        </view>
      </view>

      <view class="live-mid">
        <Gauge size="lg" accent={accent()} min={0} max={120} value={Math.round(pressureBar() * 10)}>
          <label class="readout-md">{pressureBar().toFixed(1)}</label>
          <label class="muted">bar</label>
        </Gauge>

        <view class="live-center">
          <label class="readout-lg">{(elapsedDs() / 10).toFixed(1)}</label>
          <view class="weight-row">
            <label class="readout-sm">{weightG().toFixed(1)}</label>
            <label class="stat-unit">of {targetYieldG()} g</label>
          </view>
          <bar class={`weight-bar bar-${accent()}`} min={0} max={targetYieldG() * 10} value={Math.round(weightG() * 10)} />
        </view>

        <view class="live-side">
          <Gauge size="md" accent={accent()} min={0} max={40} value={Math.round(flowMlS() * 10)}>
            <label class="readout-sm">{flowMlS().toFixed(1)}</label>
            <label class="muted">ml/s</label>
          </Gauge>
          <button class="stop" onClick={() => stopShot({})}>
            {icons.stop}  Stop
          </button>
        </view>
      </view>

      <ProfileChart />
    </view>
  );
}
