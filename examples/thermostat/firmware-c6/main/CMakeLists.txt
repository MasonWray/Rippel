# Shares main.c with the ESP32-S3 project. The board component supplies the display.
idf_component_register(
  SRCS "../../firmware/main/main.c"
  REQUIRES ui lvgl c6_st7789 esp_timer
)
