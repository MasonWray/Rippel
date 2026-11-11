/* The board interface every example firmware is written against. Each board component implements it. */
#ifndef RIPPEL_BOARD_H
#define RIPPEL_BOARD_H

#include "lvgl.h"

/* Adafruit QT Py ESP32-S3 with the Adafruit 3.5" 480x320 TFT, which has resistive touch. */
#define BOARD_HAS_TOUCH 1

/* Sets up the display and returns an LVGL display that draws to it. */
lv_display_t * board_create_display(void);

/* Sets up touch or other input for `disp`, if the board has any. */
void board_create_input(lv_display_t * disp);

#endif /* RIPPEL_BOARD_H */
