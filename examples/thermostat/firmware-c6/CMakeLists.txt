cmake_minimum_required(VERSION 3.16)

# The same thermostat firmware as ../firmware, built for the ESP32-C6 and the 1.9" LCD.
# Only the board component and this project's settings differ.
set(EXTRA_COMPONENT_DIRS
  "${CMAKE_CURRENT_LIST_DIR}/../../../packages/rippel/native/lvgl"
  "${CMAKE_CURRENT_LIST_DIR}/../../shared/c6_st7789"
)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(thermostat_c6)
