import { createSignal, Match, Switch } from "rippel";
import { batteryPct, online, setpoint, temperature } from "./firmware.contract";
import "./styles.css";

export default function App() {
  const [target, setTarget] = createSignal(21);
  const [applied, setApplied] = createSignal(21);

  const apply = () => {
    setpoint({ celsius: target() });
    setApplied(target());
  };

  return (
    <view class="screen">
      <view class="top-bar">
        <label class="room">Living room</label>
        <label class={online() ? "status" : "status offline"}>
          {online() ? "Online" : "Offline"} • {batteryPct()}%
        </label>
      </view>

      <view class="reading">
        <label class="temperature">{temperature()}°</label>
        <Switch>
          <Match when={temperature() < applied()}>
            <label class="mode mode-heat">Heating</label>
          </Match>
          <Match when={temperature() > applied()}>
            <label class="mode mode-cool">Cooling</label>
          </Match>
          <Match when={temperature() === applied()}>
            <label class="mode mode-hold">Holding</label>
          </Match>
        </Switch>
      </view>

      <view class="target-row">
        <label class="target-label">Target {target()}°C</label>
        <button class="apply" disabled={target() === applied()} onClick={apply}>
          Apply
        </button>
      </view>

      <slider class="slider" min={10} max={30} value={target()} onInput={setTarget} />
    </view>
  );
}
