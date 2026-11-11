/**
 * Ambient types for Rippel projects. Add "rippel/client" to `types` in tsconfig.json.
 */

/** CSS files are compiled to LVGL styles. Importing one registers its classes. */
declare module "*.css";

/** PNG files are converted to LVGL's pixel formats. Pass the import to <image src>. */
declare module "*.png" {
  const image: import("rippel").ImageAsset;
  export default image;
}
