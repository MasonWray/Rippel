/**
 * Browser simulator platform: owns the LVGL display, pointer input and tick,
 * converts frames to RGBA for a <canvas>, and forwards bridge events to JS.
 */
#include <emscripten.h>
#include <stdlib.h>
#include "rippel_bridge.h"

/* Color formats the simulator emulates. The numbering is part of the JS interface. */
enum {
    SIM_CF_RGB565 = 0,
    SIM_CF_RGB888 = 1,
    SIM_CF_XRGB8888 = 2,
};

static lv_display_t * display;
static uint8_t * draw_buf;
static uint32_t draw_stride;
static uint32_t draw_bpp;
static uint32_t * rgba;
static int32_t width;
static int32_t height;
static lv_obj_t * detached_root;

/* Dirty region since the last rp_sim_take_dirty(): [has_dirty, x1, y1, x2, y2]. */
static int32_t dirty[5];

/* Latest pointer state. Each change is read by LVGL immediately (see
 * rp_sim_pointer), so input doesn't depend on the frame rate. */
static lv_indev_t * pointer;
static int32_t pointer_x;
static int32_t pointer_y;
static bool pointer_down;

EM_JS(void, js_dispatch_event, (lv_obj_t * obj, int event, int32_t value), {
    if (Module.onRippelEvent) Module.onRippelEvent(obj, event, value);
});

static void on_bridge_event(lv_obj_t * obj, rp_event_t event, int32_t value)
{
    js_dispatch_event(obj, (int)event, value);
}

static inline uint32_t expand5(uint32_t v) { return (v * 527 + 23) >> 6; }
static inline uint32_t expand6(uint32_t v) { return (v * 259 + 33) >> 6; }

static void flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    LV_UNUSED(px_map);
    for(int32_t y = area->y1; y <= area->y2; y++) {
        const uint8_t * src = draw_buf + (uint32_t)y * draw_stride + (uint32_t)area->x1 * draw_bpp;
        uint32_t * dst = rgba + y * width + area->x1;
        for(int32_t x = area->x1; x <= area->x2; x++) {
            uint32_t r, g, b;
            if(draw_bpp == 2) {
                uint16_t p = (uint16_t)(src[0] | (src[1] << 8));
                r = expand5((p >> 11) & 0x1F);
                g = expand6((p >> 5) & 0x3F);
                b = expand5(p & 0x1F);
            }
            else {
                /* RGB888 and XRGB8888 are stored as B, G, R(, X). */
                b = src[0];
                g = src[1];
                r = src[2];
            }
            *dst++ = 0xFF000000u | (b << 16) | (g << 8) | r;
            src += draw_bpp;
        }
    }

    if(!dirty[0]) {
        dirty[0] = 1;
        dirty[1] = area->x1;
        dirty[2] = area->y1;
        dirty[3] = area->x2;
        dirty[4] = area->y2;
    }
    else {
        if(area->x1 < dirty[1]) dirty[1] = area->x1;
        if(area->y1 < dirty[2]) dirty[2] = area->y1;
        if(area->x2 > dirty[3]) dirty[3] = area->x2;
        if(area->y2 > dirty[4]) dirty[4] = area->y2;
    }

    lv_display_flush_ready(disp);
}

static void pointer_read_cb(lv_indev_t * indev, lv_indev_data_t * data)
{
    LV_UNUSED(indev);
    data->point.x = pointer_x;
    data->point.y = pointer_y;
    data->state = pointer_down ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

/* Starts LVGL with the given resolution, color format and DPI. Returns 0 on success. */
EMSCRIPTEN_KEEPALIVE int rp_sim_init(int32_t w, int32_t h, int32_t color_format, int32_t dpi)
{
    lv_color_format_t cf;
    switch(color_format) {
        case SIM_CF_RGB565: cf = LV_COLOR_FORMAT_RGB565; draw_bpp = 2; break;
        case SIM_CF_RGB888: cf = LV_COLOR_FORMAT_RGB888; draw_bpp = 3; break;
        case SIM_CF_XRGB8888: cf = LV_COLOR_FORMAT_XRGB8888; draw_bpp = 4; break;
        default: return 1;
    }

    width = w;
    height = h;
    lv_init();

    display = lv_display_create(w, h);
    lv_display_set_color_format(display, cf);
    lv_display_set_dpi(display, dpi);

    draw_stride = lv_draw_buf_width_to_stride((uint32_t)w, cf);
    uint32_t buf_size = draw_stride * (uint32_t)h;
    draw_buf = aligned_alloc(64, (buf_size + 63) & ~63u);
    rgba = calloc((size_t)w * (size_t)h, 4);
    if(draw_buf == NULL || rgba == NULL) return 2;

    lv_display_set_buffers(display, draw_buf, NULL, buf_size, LV_DISPLAY_RENDER_MODE_DIRECT);
    lv_display_set_flush_cb(display, flush_cb);

    pointer = lv_indev_create();
    lv_indev_set_type(pointer, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(pointer, pointer_read_cb);

    /* Objects that are created but not yet inserted, or removed and awaiting
     * deletion, live under this screen. It is never loaded, so it never draws. */
    detached_root = lv_obj_create(NULL);

    rp_set_event_handler(on_bridge_event);
    return 0;
}

/* Advances LVGL's clock and runs its timers (layout, animation, input, rendering). */
EMSCRIPTEN_KEEPALIVE void rp_sim_tick(uint32_t elapsed_ms)
{
    lv_tick_inc(elapsed_ms);
    lv_timer_handler();
}

/* Updates the pointer and has LVGL process it right away, so a press and
 * release that arrive between two frames (a fast click) are both seen. */
EMSCRIPTEN_KEEPALIVE void rp_sim_pointer(int32_t x, int32_t y, int32_t down)
{
    pointer_x = x;
    pointer_y = y;
    pointer_down = down != 0;
    if(pointer) lv_indev_read(pointer);
}

/* How often LVGL redraws, in milliseconds. Matches LV_DEF_REFR_PERIOD in a device build. */
EMSCRIPTEN_KEEPALIVE void rp_sim_set_refresh_period(uint32_t ms)
{
    lv_timer_t * timer = lv_display_get_refr_timer(display);
    if(timer) lv_timer_set_period(timer, ms);
}

EMSCRIPTEN_KEEPALIVE lv_obj_t * rp_sim_screen(void)
{
    return lv_screen_active();
}

EMSCRIPTEN_KEEPALIVE lv_obj_t * rp_sim_detached_root(void)
{
    return detached_root;
}

EMSCRIPTEN_KEEPALIVE uint32_t * rp_sim_rgba(void)
{
    return rgba;
}

/* Returns a pointer to [has_dirty, x1, y1, x2, y2]. The caller clears has_dirty after reading. */
EMSCRIPTEN_KEEPALIVE int32_t * rp_sim_dirty(void)
{
    return dirty;
}

EMSCRIPTEN_KEEPALIVE uint32_t rp_sim_mem_used(void)
{
    lv_mem_monitor_t mon;
    lv_mem_monitor(&mon);
    return (uint32_t)(mon.total_size - mon.free_size);
}

EMSCRIPTEN_KEEPALIVE uint32_t rp_sim_mem_max_used(void)
{
    lv_mem_monitor_t mon;
    lv_mem_monitor(&mon);
    return (uint32_t)mon.max_used;
}

/* Loads a font produced by `lv_font_conv --format bin`. The buffer must stay alive. */
EMSCRIPTEN_KEEPALIVE lv_font_t * rp_sim_font_load(void * buffer, uint32_t size)
{
    return lv_binfont_create_from_buffer(buffer, size);
}
