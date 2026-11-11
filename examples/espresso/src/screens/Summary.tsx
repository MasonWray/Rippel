import { createSignal } from "rippel";
import { ProfileChart } from "../components/ProfileChart";
import { Rating } from "../components/Rating";
import { Stat } from "../components/Stat";
import { elapsedDs, weightG } from "../firmware.contract";
import { icons } from "../icons";
import { accent, discardFinishedShot, doseTenths, peakPressure, recipe, saveFinishedShot } from "../state";

export function Summary() {
  const [rating, setRating] = createSignal(0);
  const ratio = () => (weightG() / (doseTenths() / 10)).toFixed(1);

  return (
    <view class="screen">
      <view class="row-between">
        <label class="title">Shot complete</label>
        <view class="title-row">
          <image class={`tint-${accent()}`} src={recipe().icon} />
          <label class={`recipe-title text-${accent()}`}>{recipe().name}</label>
        </view>
      </view>

      <view class="stats">
        <Stat name="Time" value={(elapsedDs() / 10).toFixed(1)} unit="s" />
        <Stat name="Yield" value={weightG().toFixed(1)} unit="g" />
        <Stat name="Ratio" value={`1:${ratio()}`} />
        <Stat name="Peak" value={peakPressure().toFixed(1)} unit="bar" />
      </view>

      <ProfileChart />

      <view class="row-between">
        <view class="rate">
          <label class="muted">How was it?</label>
          <Rating large value={rating()} onRate={setRating} />
        </view>
        <view class="actions">
          <button class="secondary" onClick={discardFinishedShot}>
            {icons.close}  Discard
          </button>
          <button class={`primary fill-${accent()}`} disabled={rating() === 0} onClick={() => saveFinishedShot(rating())}>
            {icons.check}  Save shot
          </button>
        </view>
      </view>
    </view>
  );
}
