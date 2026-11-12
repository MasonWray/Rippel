cmake_minimum_required(VERSION 3.16)

# LVGL comes from the Rippel repo, so it's always the version the simulator runs.
set(EXTRA_COMPONENT_DIRS
  "${CMAKE_CURRENT_LIST_DIR}/../../../packages/rippel/native/lvgl"
  "${CMAKE_CURRENT_LIST_DIR}/../../shared/qtpy_s3_hx8357"
)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# The house view redraws the whole view every frame, so it sends the display twice the shared board's default.
idf_build_set_property(COMPILE_DEFINITIONS "BOARD_LCD_SPI_HZ=40000000" APPEND)

project(house)
