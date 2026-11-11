/** A labeled setting with a slider. */
export function Param(props: {
  name: string;
  display: string;
  accent: string;
  min: number;
  max: number;
  value: number;
  onInput: (value: number) => void;
  onChange?: (value: number) => void;
}) {
  return (
    <view class="param">
      <view class="param-head">
        <label class="muted">{props.name}</label>
        <label class="param-value">{props.display}</label>
      </view>
      <slider
        class={`param-slider slider-${props.accent}`}
        min={props.min}
        max={props.max}
        value={props.value}
        onInput={props.onInput}
        onChange={props.onChange}
      />
    </view>
  );
}
