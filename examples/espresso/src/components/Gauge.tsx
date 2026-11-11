import type { ParentComponent } from "rippel";

/** A dial with whatever you put in its center. */
export const Gauge: ParentComponent<{
  size: "lg" | "md";
  accent: string;
  min: number;
  max: number;
  value: number;
}> = (props) => (
  <arc class={`gauge gauge-${props.size} arc-${props.accent}`} readonly min={props.min} max={props.max} value={props.value}>
    {props.children}
  </arc>
);
