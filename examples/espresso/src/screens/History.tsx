import { For, Show } from "rippel";
import { Rating } from "../components/Rating";
import { Stat } from "../components/Stat";
import { icons } from "../icons";
import { RECIPES } from "../recipes";
import { setSortKey, shots, sortedShots, sortKey, SORTS, type Shot } from "../state";

function ShotRow(props: { shot: Shot }) {
  const { shot } = props;
  const recipe = () => RECIPES[shot.recipe];

  return (
    <view class="shot">
      <view class={`shot-stripe fill-${recipe().accent}`} />
      <view class="shot-main">
        <label class="recipe-name">{recipe().name}</label>
        <label class="muted">
          {shot.doseG.toFixed(1)} g in, {shot.yieldG.toFixed(1)} g out
        </label>
      </view>
      <label class="shot-time">{shot.seconds.toFixed(1)} s</label>
      <Rating value={shot.rating} onRate={(rating) => shots.update(shot, { rating })} />
      <button class="icon-btn" onClick={() => shots.remove(shot)}>
        {icons.trash}
      </button>
    </view>
  );
}

export function History() {
  const average = (total: number) => (shots.size() > 0 ? total / shots.size() : 0);

  return (
    <view class="screen">
      <view class="row-between">
        <label class="title">History</label>
        <view class="chips">
          <For each={SORTS}>
            {(sort) => (
              <button class="chip" checked={sortKey() === sort.key} onClick={() => setSortKey(sort.key)}>
                {sort.label}
              </button>
            )}
          </For>
        </view>
      </view>

      <view class="stats">
        <Stat name="Shots" value={String(shots.size())} />
        <Stat name="Average time" value={average(shots.sum((s) => s.seconds)).toFixed(1)} unit="s" />
        <Stat name="Average rating" value={average(shots.sum((s) => s.rating)).toFixed(1)} unit="/ 5" />
      </view>

      <view class="list" scroll>
        <For each={sortedShots()}>{(shot) => <ShotRow shot={shot} />}</For>
        <Show when={shots.size() === 0}>
          <label class="muted">No shots yet. Pull one from the brew screen.</label>
        </Show>
      </view>
    </view>
  );
}
