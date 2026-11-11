import { beepWhenDone, ecoMode, setUnits, toggleBeep, toggleEco, UNITS, units } from "../state";

export function Settings() {
  return (
    <view class="settings">
      <label class="title">Settings</label>

      <view class="setting">
        <view class="setting-text">
          <label class="recipe-name">Eco mode</label>
          <label class="muted">Let the boiler cool between shots</label>
        </view>
        <switch class="toggle" checked={ecoMode()} onChange={toggleEco} />
      </view>

      <view class="setting">
        <checkbox class="check" checked={beepWhenDone()} onChange={toggleBeep}>
          Beep when a shot finishes
        </checkbox>
      </view>

      <view class="setting">
        <label class="recipe-name">Temperature units</label>
        <dropdown class="select" options={UNITS} selected={units()} onChange={setUnits} />
      </view>
    </view>
  );
}
