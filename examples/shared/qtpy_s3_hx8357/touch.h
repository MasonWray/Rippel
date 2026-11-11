#ifndef TOUCH_H
#define TOUCH_H

#include "lvgl.h"

/* Sets up the 4-wire resistive touch panel as an LVGL pointer on `disp`. */
void touch_create_indev(lv_display_t * disp);

#endif /* TOUCH_H */
