import { For } from "rippel";
import { pressureAt } from "../recipes";
import { accent, COLUMNS, recipe, sample } from "../state";

const PX_PER_BAR = 10;

/** The recipe's target pressure in grey, with the live shot drawn over it. */
export function ProfileChart() {
  const target = (col: number) => {
    const seconds = ((col + 0.5) / COLUMNS.length) * recipe().durationS;
    return Math.round(pressureAt(recipe(), seconds) * PX_PER_BAR);
  };

  return (
    <view class="chart">
      <For each={COLUMNS}>
        {(col) => (
          <>
            <view class="chart-target" style={{ height: target(col) }} />
            <view class={`chart-live fill-${accent()}`} style={{ height: Math.round(sample(col) * PX_PER_BAR) }} />
          </>
        )}
      </For>
    </view>
  );
}
