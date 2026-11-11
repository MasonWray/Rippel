import { For } from "rippel";
import { pressureAt, RECIPES, type Recipe } from "../recipes";
import { recipeIndex, selectRecipe } from "../state";

const SPARK = Array.from({ length: 13 }, (_, i) => i / 13);

export function RecipeCard(props: { recipe: Recipe }) {
  const index = RECIPES.indexOf(props.recipe);
  const { recipe } = props;

  return (
    <view class={`recipe edge-${recipe.accent}`} checked={recipeIndex() === index} onClick={() => selectRecipe(index)}>
      <view class="recipe-head">
        <image class={`card-icon tint-${recipe.accent}`} src={recipe.icon} fit="contain" />
        <label class="recipe-name">{recipe.name}</label>
      </view>
      <view class="spark-row">
        <For each={SPARK}>
          {(t) => (
            <view
              class={`spark fill-${recipe.accent}`}
              style={{ height: Math.max(2, Math.round(pressureAt(recipe, t * recipe.durationS) * 2)) }}
            />
          )}
        </For>
      </view>
    </view>
  );
}
