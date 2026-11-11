import { Show } from "rippel";
import { waterPct, phase } from "../firmware.contract";
import { icons } from "../icons";
import { PHASE, setTab, tab, waterLow } from "../state";

export function Nav(props: { history: boolean }) {
  const busy = () => phase() !== PHASE.idle;

  return (
    <view class="nav">
      <button class="nav-btn" checked={tab() === "brew"} disabled={busy()} onClick={() => setTab("brew")}>
        {icons.home}
      </button>
      <Show when={props.history}>
        <button class="nav-btn" checked={tab() === "history"} disabled={busy()} onClick={() => setTab("history")}>
          {icons.list}
        </button>
      </Show>
      <view class="nav-spacer" />
      <bar class={waterLow() ? "water water-low" : "water"} min={0} max={100} value={waterPct()} />
      <label class={waterLow() ? "water-icon text-warn" : "water-icon"}>{icons.water}</label>
    </view>
  );
}
