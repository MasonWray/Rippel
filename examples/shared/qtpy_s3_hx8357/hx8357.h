#ifndef HX8357_H
#define HX8357_H

#include "lvgl.h"

/* Sets up SPI and the panel, and returns an LVGL display that draws to it. */
lv_display_t * hx8357_create_display(void);

#endif /* HX8357_H */
