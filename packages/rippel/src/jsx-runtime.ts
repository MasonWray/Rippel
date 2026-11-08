/**
 * JSX types for Rippel. Projects set `"jsxImportSource": "rippel"` with
 * `"jsx": "preserve"`; the Solid compiler does the actual transform.
 *
 * Elements are LVGL widgets, not HTML elements.
 */

declare const rippelNode: unique symbol;

/** An element or text node created by the renderer. Opaque to user code. */
export interface RippelNode {
  readonly [rippelNode]: true;
}

export type InlineStyle = Record<string, string | number | undefined>;

interface CommonProps {
  /** Space-separated CSS class names. */
  class?: string;
  /** Inline styles. Numbers are px, except opacity and flex-grow. */
  style?: InlineStyle;
  /** Names the object so firmware can get its lv_obj_t* (from M2). */
  id?: string;
  hidden?: boolean;
  /** Sets LVGL's disabled state (`:disabled` in CSS). */
  disabled?: boolean;
  /** Sets LVGL's checked state (`:checked` in CSS). */
  checked?: boolean;
  onClick?: () => void;
  onPress?: () => void;
  onRelease?: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

export namespace JSX {
  export type Element =
    | RippelNode
    | string
    | number
    | boolean
    | null
    | undefined
    | Element[]
    | (() => Element);

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes {}

  export interface IntrinsicElements {
    /** A plain container, like a div. No default styling, sized to its content. */
    view: CommonProps & { children?: Element };
    /** Text. Children must be text or expressions. */
    label: CommonProps & { children?: Element };
    /** A pressable button. Text children are shown in a centered label. */
    button: CommonProps & { children?: Element };
    slider: CommonProps & {
      min?: number;
      max?: number;
      value?: number;
      /** Fires continuously while the value changes. */
      onInput?: (value: number) => void;
      /** Fires when the user releases the slider. */
      onChange?: (value: number) => void;
    };
  }
}
