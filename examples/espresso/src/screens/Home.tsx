import { For, Show } from "rippel";
import { Gauge } from "../components/Gauge";
import { Param } from "../components/Param";
import { RecipeCard } from "../components/RecipeCard";
import { boilerC, setBoilerTarget } from "../firmware.contract";
import { icons } from "../icons";
import { RECIPES } from "../recipes";
import {
  accent,
  beginShot,
  boilerReady,
  canBrew,
  doseTenths,
  ratioTenths,
  recipe,
  setDoseTenths,
  setRatioTenths,
  setTempC,
  targetYieldG,
  tempC,
  waterLow,
} from "../state";

export function Home() {
  const status = () => {
    if (waterLow()) return "Refill the water tank";
    return boilerReady() ? "Ready to brew" : `Heating to ${tempC()}°`;
  };

  return (
    <view class="home">
      <view class="col-side">
        <label class="heading">Recipes</label>
        <For each={RECIPES}>{(r) => <RecipeCard recipe={r} />}</For>
      </view>

      <view class="col-center">
        <label class={`recipe-title text-${accent()}`}>{recipe().name}</label>
        <Gauge size="lg" accent={accent()} min={60} max={100} value={Math.round(boilerC())}>
          <label class="readout-md">{Math.round(boilerC())}°</label>
          <label class="muted">Boiler</label>
        </Gauge>
        <view class="status-row">
          <Show when={waterLow()}>
            <label class="text-warn">{icons.warning}</label>
          </Show>
          <label class={`status ${canBrew() ? `text-${accent()}` : "status-wait"}`}>{status()}</label>
        </view>
        <button class={`start fill-${accent()}`} disabled={!canBrew()} onClick={beginShot}>
          {icons.play}  Start shot
        </button>
      </view>

      <view class="col-side">
        <label class="heading">Adjust</label>
        <Param
          name="Dose"
          display={`${(doseTenths() / 10).toFixed(1)} g`}
          accent={accent()}
          min={120}
          max={220}
          value={doseTenths()}
          onInput={setDoseTenths}
        />
        <Param
          name="Ratio"
          display={`1:${(ratioTenths() / 10).toFixed(1)}`}
          accent={accent()}
          min={15}
          max={40}
          value={ratioTenths()}
          onInput={setRatioTenths}
        />
        <Param
          name="Temperature"
          display={`${tempC()}°`}
          accent={accent()}
          min={88}
          max={98}
          value={tempC()}
          onInput={setTempC}
          onChange={(celsius) => setBoilerTarget({ celsius })}
        />
        <view class="yield">
          <label class="muted">Yield in the cup</label>
          <view class="stat-row">
            <label class={`readout-md text-${accent()}`}>{targetYieldG()}</label>
            <label class="stat-unit">g in {recipe().durationS} s</label>
          </view>
        </view>
      </view>
    </view>
  );
}
