import { createMemo, For, Show } from "rippel";
import { Rating } from "../components/Rating";
import { Stat } from "../components/Stat";
import { icons } from "../icons";
import { deleteShot, setSortKey, shots, sortedShots, sortKey, SORTS, type Shot } from "../state";

function average(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function ShotRow(props: { shot: Shot }) {
  const { shot } = props;
  return (
    <view class="shot">
      <view class={`shot-stripe fill-${shot.recipe.accent}`} />
      <view class="shot-main">
        <label class="recipe-name">{shot.recipe.name}</label>
        <label class="muted">
          {shot.doseG.toFixed(1)} g in, {shot.yieldG.toFixed(1)} g out
        </label>
      </view>
      <label class="shot-time">{shot.seconds.toFixed(1)} s</label>
      <Rating value={shot.rating()} onRate={shot.setRating} />
      <button class="icon-btn" onClick={() => deleteShot(shot)}>
        {icons.trash}
      </button>
    </view>
  );
}

export function History() {
  // Keyed by shot: changing the order moves the existing rows instead of rebuilding them.
  const sorted = createMemo(sortedShots);

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
        <Stat name="Shots" value={String(shots().length)} />
        <Stat name="Average time" value={average(shots().map((s) => s.seconds)).toFixed(1)} unit="s" />
        <Stat name="Average rating" value={average(shots().map((s) => s.rating())).toFixed(1)} unit="/ 5" />
      </view>

      <view class="list" scroll>
        <For each={sorted()}>{(shot) => <ShotRow shot={shot} />}</For>
        <Show when={shots().length === 0}>
          <label class="muted">No shots yet. Pull one from the brew screen.</label>
        </Show>
      </view>
    </view>
  );
}
