import { createEffect, Match, Switch } from "rippel";
import { Nav } from "./components/Nav";
import { phase } from "./firmware.contract";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { LiveShot } from "./screens/LiveShot";
import { Settings } from "./screens/Settings";
import { Summary } from "./screens/Summary";
import { PHASE, recordSample, tab } from "./state";
import "./accents.css";
import "./styles.css";

export default function App() {
  createEffect(recordSample);

  return (
    <view class="app">
      <Nav />
      <view class="content">
        {/* Only the open screen's objects exist on the device. The others are built when they open. */}
        <Switch lazy>
          <Match when={phase() === PHASE.done}>
            <Summary />
          </Match>
          <Match when={phase() !== PHASE.idle}>
            <LiveShot />
          </Match>
          <Match when={tab() === "history"}>
            <History />
          </Match>
          <Match when={tab() === "settings"}>
            <Settings />
          </Match>
          <Match when={tab() === "brew"}>
            <Home />
          </Match>
        </Switch>
      </view>
    </view>
  );
}
