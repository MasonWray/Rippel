idf_component_register(
  SRCS "main.c" "hx8357.c" "touch.c"
  INCLUDE_DIRS "."
  REQUIRES ui lvgl esp_lcd esp_driver_gpio esp_driver_spi esp_adc esp_timer
)
