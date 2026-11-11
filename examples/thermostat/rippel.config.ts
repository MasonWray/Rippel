import { defineConfig } from "rippel";
import { adafruit_3_5_tft } from "rippel/displays";
import { esp32s3 } from "rippel/mcu";

export default defineConfig({
  entry: "src/App.tsx",
  contract: "src/firmware.contract.ts",
  display: adafruit_3_5_tft({ rotation: 90 }),
  mcu: esp32s3(),
  output: {
    dir: "firmware/components/ui",
    integration: "esp-idf",
  },
  fonts: {
    // Lato ships with LVGL's examples (SIL Open Font License).
    lato: {
      src: "../../packages/rippel/native/lvgl/examples/libs/freetype/Lato-Regular.ttf",
      sizes: [56],
      range: "0x20-0x7E,0xB0",
    },
  },
});
