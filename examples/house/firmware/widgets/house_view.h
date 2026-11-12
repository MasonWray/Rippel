/* What the firmware can ask the house view, beyond the props the UI sets. */
#ifndef HOUSE_VIEW_H
#define HOUSE_VIEW_H

#include "lvgl.h"

/* Where drawing time goes: clearing, slab, floor, walls, lines on the floor, device dots, edges, stair */
#define HOUSE_VIEW_PHASES 8

typedef struct {
    /* Frames drawn in the last second */
    float fps;
    /* Average time per frame spent working out where everything lands on screen, and drawing it, in ms. Doesn't
     * include LVGL copying the pixels out or sending them to the display. */
    float project_ms;
    float draw_ms;
    /* Everything the view does in a frame, adding its room names and the frame rate readout */
    float callback_ms;
    /* Frames drawn since the view was made */
    uint32_t frames;
    float phase_ms[HOUSE_VIEW_PHASES];
    /* Heap the view holds, in bytes */
    uint32_t memory;
} house_view_stats_t;

void house_view_get_stats(lv_obj_t * obj, house_view_stats_t * out);

#endif
