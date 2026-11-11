/* The board interface every example firmware is written against. Each board component implements it. */
#ifndef RIPPEL_BOARD_H
#define RIPPEL_BOARD_H

#include "lvgl.h"

/* Waveshare ESP32-C6-DEV-KIT-N8 with the Waveshare 1.9" 170x320 LCD. The display has no touch. */
#define BOARD_HAS_TOUCH 0

/* Sets up the display and returns an LVGL display that draws to it. */
lv_display_t * board_create_display(void);

/* Sets up touch or other input for `disp`, if the board has any. */
void board_create_input(lv_display_t * disp);

#endif /* RIPPEL_BOARD_H */
