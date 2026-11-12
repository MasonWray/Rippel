import { For, Show, type ItemOf } from "rippel";
import { connectWifi, wifiNetworks, wifiSsid } from "../firmware.contract";
import { icons } from "../icons";
import { beepWhenDone, ecoMode, setUnits, toggleBeep, toggleEco, UNITS, units } from "../state";

const BARS = [1, 2, 3, 4];

function NetworkRow(props: { network: ItemOf<typeof wifiNetworks> }) {
  const { network } = props;
  const strength = () => (network.rssi > -55 ? 4 : network.rssi > -65 ? 3 : network.rssi > -75 ? 2 : 1);
  const connected = () => network.ssid === wifiSsid();

  return (
    <view class="network" checked={connected()} onClick={() => connectWifi({ ssid: network.ssid })}>
      <view class="bars">
        <For each={BARS}>{(bar) => <view class={`wifi-bar wifi-bar-${bar}`} checked={strength() >= bar} />}</For>
      </view>
      <view class="setting-text">
        <label class="recipe-name">{network.ssid}</label>
        <label class="muted">{connected() ? "Connected" : network.secure ? "Secured" : "Open"}</label>
      </view>
    </view>
  );
}

export function Settings() {
  return (
    <view class="settings" scroll>
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

      <label class="heading">{icons.wifi}  Wi-Fi</label>
      <For each={wifiNetworks.sorted((a, b) => b.rssi - a.rssi)}>{(network) => <NetworkRow network={network} />}</For>
      <Show when={wifiNetworks.size() === 0}>
        <label class="muted">Looking for networks...</label>
      </Show>
    </view>
  );
}
