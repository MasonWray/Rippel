import { waterPct, phase } from "../firmware.contract";
import logo from "../assets/logo.png";
import { icons } from "../icons";
import { PHASE, setTab, shots, tab, waterLow } from "../state";

export function Nav() {
  const busy = () => phase() !== PHASE.idle;

  return (
    <view class="nav">
      <image src={logo} />
      <button class="nav-btn" checked={tab() === "brew"} disabled={busy()} onClick={() => setTab("brew")}>
        {icons.home}
      </button>
      <button class="nav-btn" checked={tab() === "history"} disabled={busy()} onClick={() => setTab("history")}>
        {icons.list}
        <view class="badge" hidden={shots.size() === 0}>
          <label class="badge-text">{shots.size()}</label>
        </view>
      </button>
      <button class="nav-btn" checked={tab() === "settings"} disabled={busy()} onClick={() => setTab("settings")}>
        {icons.settings}
      </button>
      <view class="nav-spacer" />
      <bar class={waterLow() ? "water water-low" : "water"} min={0} max={100} value={waterPct()} />
      <label class={waterLow() ? "water-icon text-warn" : "water-icon"}>{icons.water}</label>
    </view>
  );
}
