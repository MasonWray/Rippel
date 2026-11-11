import { createEffect, Match, Switch } from "rippel";
import { Nav } from "./components/Nav";
import { phase } from "./firmware.contract";
import { History } from "./screens/History";
import { Home } from "./screens/Home";
import { LiveShot } from "./screens/LiveShot";
import { Summary } from "./screens/Summary";
import { PHASE, recordSample, saveFinishedShot, tab } from "./state";
import "./accents.css";
import "./styles.css";

export default function App() {
  createEffect(recordSample);

  return (
    <view class="app">
      <Nav history={true} />
      <view class="content">
        <Switch>
          <Match when={phase() === PHASE.done}>
            <Summary onSave={saveFinishedShot} />
          </Match>
          <Match when={phase() !== PHASE.idle}>
            <LiveShot />
          </Match>
          <Match when={tab() === "history"}>
            <History />
          </Match>
          <Match when={tab() === "brew"}>
            <Home />
          </Match>
        </Switch>
      </view>
    </view>
  );
}
