export function Stat(props: { name: string; value: string; unit?: string }) {
  return (
    <view class="stat">
      <label class="muted">{props.name}</label>
      <view class="stat-row">
        <label class="stat-value">{props.value}</label>
        <label class="stat-unit">{props.unit ?? ""}</label>
      </view>
    </view>
  );
}
