import { createSignal } from "rippel";
import { benchmark, HouseView } from "./firmware.contract";
import "./styles.css";

export default function App() {
  const [exploded, setExploded] = createSignal(true);
  const [spinning, setSpinning] = createSignal(false);
  const [lights, setLights] = createSignal(true);

  return (
    <view class="screen">
      <HouseView
        id="house"
        class="house"
        explode={exploded()}
        spin={spinning() || benchmark() ? 30 : 0}
        lights={lights()}
        stats={benchmark()}
      />
      <view class="tools">
        <button class={exploded() ? "tool on" : "tool"} onClick={() => setExploded(!exploded())}>
          {exploded() ? "Stack" : "Explode"}
        </button>
        <button class={spinning() ? "tool on" : "tool"} onClick={() => setSpinning(!spinning())}>
          Spin
        </button>
        <button class={lights() ? "tool on" : "tool"} onClick={() => setLights(!lights())}>
          Lights
        </button>
      </view>
    </view>
  );
}
