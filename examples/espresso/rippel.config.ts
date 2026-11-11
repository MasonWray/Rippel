import { defineConfig } from "rippel";
import { dpiFromDiagonal } from "rippel/displays";
import { esp32s3 } from "rippel/mcu";

export default defineConfig({
  entry: "src/App.tsx",
  contract: "src/firmware.contract.ts",
  mock: "src/firmware.mock.ts",
  // A custom display is just an object.
  display: {
    name: '5" RGB panel',
    width: 800,
    height: 480,
    colorFormat: "RGB565",
    dpi: dpiFromDiagonal(800, 480, 5),
  },
  mcu: esp32s3({ psramKB: 8192 }),
  fonts: {
    // Only the glyphs the big readouts need, to keep flash use down.
    // Lato ships with LVGL's examples (SIL Open Font License).
    numerals: {
      src: "../../packages/rippel/native/lvgl/examples/libs/freetype/Lato-Regular.ttf",
      sizes: [34, 56, 104],
      range: "0x20,0x2E,0x30-0x39,0x3A,0xB0",
    },
  },
});
