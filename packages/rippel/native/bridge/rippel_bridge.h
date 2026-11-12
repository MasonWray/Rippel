/**
 * Rippel bridge: the small set of LVGL operations Rippel's renderers use.
 *
 * The browser dev runtime calls these from JS (through WASM). Generated
 * device code will call the same operations from C. Keeping one interface
 * for both is what keeps the simulator and the device in sync.
 *
 * The bridge only depends on LVGL. Platform code (the simulator, or the
 * firmware) owns the display, input and tick, and receives events through
 * rp_set_event_handler().
 */
#ifndef RIPPEL_BRIDGE_H
#define RIPPEL_BRIDGE_H

#include "lvgl.h"
#include <stdbool.h>
#include <stdint.h>

/* RP_API marks functions that must stay exported when the bridge is called
 * across a boundary, such as from JS in the WASM simulator. */
#ifndef RP_API
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define RP_API EMSCRIPTEN_KEEPALIVE
#else
#define RP_API
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* Widget types. The numbering is part of the bridge interface. */
typedef enum {
    RP_WIDGET_VIEW = 0,
    RP_WIDGET_LABEL = 1,
    RP_WIDGET_BUTTON = 2,
    RP_WIDGET_SLIDER = 3,
    RP_WIDGET_ARC = 4,
    RP_WIDGET_BAR = 5,
    RP_WIDGET_IMAGE = 6,
    RP_WIDGET_SWITCH = 7,
    RP_WIDGET_CHECKBOX = 8,
    RP_WIDGET_DROPDOWN = 9,
} rp_widget_t;

/* Events forwarded to the platform. The numbering is part of the bridge interface. */
typedef enum {
    RP_EVENT_CLICK = 1,
    RP_EVENT_PRESS = 2,
    RP_EVENT_RELEASE = 3,
    RP_EVENT_LONG_PRESS = 4,
    RP_EVENT_VALUE_CHANGED = 5,
    RP_EVENT_FOCUS = 6,
    RP_EVENT_BLUR = 7,
} rp_event_t;

/* Easing curves for style transitions. Exposed by name through rp_const_*. */
typedef enum {
    RP_PATH_LINEAR = 0,
    RP_PATH_EASE_IN = 1,
    RP_PATH_EASE_OUT = 2,
    RP_PATH_EASE_IN_OUT = 3,
    RP_PATH_OVERSHOOT = 4,
    RP_PATH_BOUNCE = 5,
} rp_path_t;

/* `value` carries the widget's current value for widgets that have one: a number for sliders, arcs and
 * dropdowns, and 0 or 1 for switches and checkboxes. It's 0 for everything else. */
typedef void (*rp_event_handler_t)(lv_obj_t * obj, rp_event_t event, int32_t value);

void rp_set_event_handler(rp_event_handler_t handler);

/* Objects */
RP_API lv_obj_t * rp_obj_create(rp_widget_t type, lv_obj_t * parent);
RP_API void rp_obj_delete(lv_obj_t * obj);
/* Moves obj under parent at index (-1 appends). */
RP_API void rp_obj_set_parent(lv_obj_t * obj, lv_obj_t * parent, int32_t index);
RP_API void rp_obj_set_state(lv_obj_t * obj, int32_t state, bool on);
RP_API void rp_obj_set_hidden(lv_obj_t * obj, bool hidden);
RP_API void rp_obj_center(lv_obj_t * obj);
/* A floating object is left out of its parent's layout and placed with x, y and align (position: absolute). */
RP_API void rp_obj_set_floating(lv_obj_t * obj, bool floating);
/* Makes the object clickable and starts forwarding its events to the event handler. */
RP_API void rp_obj_listen(lv_obj_t * obj);
/* Makes the object clickable and calls cb directly for one event. Used by generated code. */
RP_API void rp_obj_on(lv_obj_t * obj, lv_event_cb_t cb, lv_event_code_t code);
/* Lets a view scroll its overflowing content by dragging. */
RP_API void rp_view_set_scroll(lv_obj_t * obj, bool scroll);

/* Widget properties */
RP_API void rp_label_set_text(lv_obj_t * obj, const char * text);
RP_API void rp_slider_set_range(lv_obj_t * obj, int32_t min, int32_t max);
RP_API void rp_slider_set_value(lv_obj_t * obj, int32_t value);
RP_API int32_t rp_slider_get_value(lv_obj_t * obj);
RP_API void rp_arc_set_range(lv_obj_t * obj, int32_t min, int32_t max);
RP_API void rp_arc_set_value(lv_obj_t * obj, int32_t value);
/* A read-only arc is a gauge: no knob, and it ignores touch. */
RP_API void rp_arc_set_readonly(lv_obj_t * obj, bool readonly);
RP_API void rp_bar_set_range(lv_obj_t * obj, int32_t min, int32_t max);
RP_API void rp_bar_set_value(lv_obj_t * obj, int32_t value);
RP_API void rp_checkbox_set_text(lv_obj_t * obj, const char * text);
/* `options` has one option per line. */
RP_API void rp_dropdown_set_options(lv_obj_t * obj, const char * options);
RP_API void rp_dropdown_set_selected(lv_obj_t * obj, int32_t index);
RP_API void rp_image_set_src(lv_obj_t * obj, const void * src);
/* `fit` is an lv_image_align_t: how the image fills the object when their sizes differ. */
RP_API void rp_image_set_fit(lv_obj_t * obj, int32_t fit);
/* Wraps pixel data the caller keeps alive. Used by the simulator, where images load at runtime. */
RP_API const lv_image_dsc_t * rp_image_dsc_create(int32_t width, int32_t height, int32_t format, int32_t stride,
                                                  const uint8_t * data, uint32_t size);

/* Shared styles (CSS classes) */
RP_API lv_style_t * rp_style_create(void);
RP_API void rp_style_destroy(lv_style_t * style);
RP_API void rp_style_set_num(lv_style_t * style, int32_t prop, int32_t value);
RP_API void rp_style_set_color(lv_style_t * style, int32_t prop, uint32_t rgb);
RP_API void rp_style_set_ptr(lv_style_t * style, int32_t prop, const void * ptr);
/* Animates `props` (count entries) over `time` ms when the object's state changes. The props are copied. */
RP_API void rp_style_set_transition(lv_style_t * style, const int32_t * props, int32_t count, uint32_t time,
                                    uint32_t delay, rp_path_t path);
RP_API void rp_obj_add_style(lv_obj_t * obj, lv_style_t * style, uint32_t selector);
RP_API void rp_obj_remove_style(lv_obj_t * obj, lv_style_t * style, uint32_t selector);

/* Local styles (inline `style` props) */
RP_API void rp_obj_set_local_num(lv_obj_t * obj, int32_t prop, int32_t value, uint32_t selector);
RP_API void rp_obj_set_local_color(lv_obj_t * obj, int32_t prop, uint32_t rgb, uint32_t selector);
RP_API void rp_obj_set_local_ptr(lv_obj_t * obj, int32_t prop, const void * ptr, uint32_t selector);
RP_API void rp_obj_remove_local(lv_obj_t * obj, int32_t prop, uint32_t selector);

/* Values */
RP_API int32_t rp_pct(int32_t value);
RP_API int32_t rp_size_content(void);

/* Fonts */
RP_API const lv_font_t * rp_font_builtin(int32_t size);

/* Named LVGL constants (style props, parts, states, layout enums), so
 * callers never hardcode LVGL's numeric values. */
RP_API int32_t rp_const_count(void);
RP_API const char * rp_const_name(int32_t index);
RP_API int32_t rp_const_value(int32_t index);

#ifdef __cplusplus
}
#endif

#endif /* RIPPEL_BRIDGE_H */
