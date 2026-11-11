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

/** A converted image, from importing a .png file. */
export interface ImageAsset {
  readonly kind: "image";
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  /** Name of an LVGL color format constant. */
  readonly format: string;
  /** The pixels, base64 encoded. */
  readonly data: string;
}

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
    view: CommonProps & {
      children?: Element;
      /** Lets the user drag to scroll content that overflows. */
      scroll?: boolean;
    };
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
    /** A circular dial. Style the track with `arc-color` and `arc-width`, and the fill with `::indicator`. */
    arc: CommonProps & {
      min?: number;
      max?: number;
      value?: number;
      /** Shows the arc as a gauge: no knob, ignores touch. */
      readonly?: boolean;
      /** Can hold other elements, centered with flex. */
      children?: Element;
      onInput?: (value: number) => void;
      onChange?: (value: number) => void;
    };
    /** An on/off switch. Style it with `:checked`, `::indicator` and `::knob`. */
    switch: CommonProps & {
      /** Fires when the user flips the switch. */
      onChange?: (checked: boolean) => void;
    };
    /** A checkbox. Its text children are the label. Style the box with `::indicator`. */
    checkbox: CommonProps & {
      children?: Element;
      /** Fires when the user toggles the box. */
      onChange?: (checked: boolean) => void;
    };
    /** A dropdown. Style its open list with `::items` and `::selected`. */
    dropdown: Omit<CommonProps, "checked"> & {
      options: string[];
      /** Index of the chosen option. */
      selected?: number;
      /** Fires with the index the user picked. */
      onChange?: (index: number) => void;
    };
    /** A picture from an imported .png file. Sized to the image unless you set a width and height. */
    image: CommonProps & {
      src: ImageAsset;
      /** How the image fills the element when their sizes differ. Defaults to "none", which centers it unscaled. */
      fit?: "none" | "contain" | "cover" | "fill";
    };
    /** A progress bar. Style the fill with `::indicator`. */
    bar: CommonProps & {
      min?: number;
      max?: number;
      value?: number;
    };
  }
}
