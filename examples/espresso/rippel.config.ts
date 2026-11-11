import { defineConfig } from "rippel";
import { adafruit_3_5_tft } from "rippel/displays";
import { esp32s3 } from "rippel/mcu";

export default defineConfig({
  entry: "src/App.tsx",
  contract: "src/firmware.contract.ts",
  mock: "src/firmware.mock.ts",
  display: adafruit_3_5_tft({ rotation: 90 }),
  mcu: esp32s3(),
  output: {
    dir: "firmware/components/ui",
    integration: "esp-idf",
    lvglHeapKB: 160,
  },
  fonts: {
    // Only the glyphs the big readouts need, to keep flash use down.
    // Lato ships with LVGL's examples (SIL Open Font License).
    numerals: {
      src: "../../packages/rippel/native/lvgl/examples/libs/freetype/Lato-Regular.ttf",
      sizes: [24, 40, 72],
      range: "0x20,0x2E,0x30-0x39,0x3A,0xB0",
    },
  },
});
