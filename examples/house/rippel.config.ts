import { defineConfig } from "rippel";
import { adafruit_3_5_tft } from "rippel/displays";
import { esp32s3 } from "rippel/mcu";

export default defineConfig({
  entry: "src/App.tsx",
  contract: "src/firmware.contract.ts",
  display: adafruit_3_5_tft({ rotation: 90 }),
  mcu: esp32s3(),
  // As fast as the panel allows, so the frame rate shows what the house view costs
  refreshHz: 60,
  output: {
    dir: "firmware/components/ui",
    integration: "esp-idf",
  },
  // The house view, and the house it draws, exported from ArkViz.
  widgets: { sources: ["firmware/widgets/house_view.c", "firmware/widgets/house_scene.c"] },
});
