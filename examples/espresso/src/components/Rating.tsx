import { For } from "rippel";

const STEPS = [1, 2, 3, 4, 5];

export function Rating(props: { value: number; onRate: (value: number) => void; large?: boolean }) {
  return (
    <view class="rating">
      <For each={STEPS}>
        {(step) => (
          <view
            class={props.large ? "dot dot-lg" : "dot"}
            checked={props.value >= step}
            onClick={() => props.onRate(step)}
          />
        )}
      </For>
    </view>
  );
}
