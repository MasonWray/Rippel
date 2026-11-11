# Display and touch drivers for an Adafruit QT Py ESP32-S3 wired to the Adafruit 3.5" TFT.
idf_component_register(
  SRCS "rippel_board.c" "hx8357.c" "touch.c"
  INCLUDE_DIRS "."
  REQUIRES lvgl esp_lcd esp_driver_gpio esp_driver_spi esp_adc
)
