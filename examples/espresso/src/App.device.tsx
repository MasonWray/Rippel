/**
 * The app as it builds for the device today: everything except History, which
 * needs lists that change at runtime. Once `rippel build` supports those, this
 * file goes away and the device builds App.tsx.
 */
import { createEffect, Match, Switch } from "rippel";
import { Nav } from "./components/Nav";
import { phase } from "./firmware.contract";
import { Home } from "./screens/Home";
import { LiveShot } from "./screens/LiveShot";
import { Summary } from "./screens/Summary";
import { discardFinishedShot, PHASE, recordSample } from "./state";
import "./accents.css";
import "./styles.css";

export default function App() {
  createEffect(recordSample);

  return (
    <view class="app">
      <Nav history={false} />
      <view class="content">
        <Switch>
          <Match when={phase() === PHASE.done}>
            <Summary onSave={discardFinishedShot} />
          </Match>
          <Match when={phase() !== PHASE.idle}>
            <LiveShot />
          </Match>
          <Match when={phase() === PHASE.idle}>
            <Home />
          </Match>
        </Switch>
      </view>
    </view>
  );
}
