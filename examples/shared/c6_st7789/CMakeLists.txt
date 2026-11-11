# Display driver for a Waveshare ESP32-C6-DEV-KIT-N8 wired to the Waveshare 1.9" LCD module (ST7789V2).
idf_component_register(
  SRCS "rippel_board.c"
  INCLUDE_DIRS "."
  REQUIRES lvgl esp_lcd esp_driver_gpio esp_driver_spi
)
