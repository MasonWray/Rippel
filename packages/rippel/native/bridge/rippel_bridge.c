#include "rippel_bridge.h"
#include <stddef.h>
#include <string.h>

static rp_event_handler_t event_handler = NULL;

void rp_set_event_handler(rp_event_handler_t handler)
{
    event_handler = handler;
}

/* ---------- Objects ---------- */

/* Defaults for views. Applied as a shared style, not local properties,
 * so class styles added later can override them. */
static lv_style_t view_base;
static bool view_base_ready = false;

lv_obj_t * rp_obj_create(rp_widget_t type, lv_obj_t * parent)
{
    lv_obj_t * obj = NULL;
    switch(type) {
        case RP_WIDGET_VIEW:
            /* A view is a plain container, like a div: no theme styling,
             * sized to its content. */
            if(!view_base_ready) {
                lv_style_init(&view_base);
                lv_style_set_width(&view_base, LV_SIZE_CONTENT);
                lv_style_set_height(&view_base, LV_SIZE_CONTENT);
                view_base_ready = true;
            }
            obj = lv_obj_create(parent);
            lv_obj_remove_style_all(obj);
            lv_obj_add_style(obj, &view_base, LV_PART_MAIN);
            /* Touches pass through a view to whatever is behind it, unless
             * it has a handler (rp_obj_listen) or scrolls (rp_view_set_scroll). */
            lv_obj_set_clickable(obj, false);
            lv_obj_set_scrollable(obj, false);
            break;
        case RP_WIDGET_LABEL:
            obj = lv_label_create(parent);
            lv_label_set_text(obj, "");
            break;
#if LV_USE_BUTTON
        case RP_WIDGET_BUTTON:
            obj = lv_button_create(parent);
            break;
#endif
#if LV_USE_SLIDER
        case RP_WIDGET_SLIDER:
            obj = lv_slider_create(parent);
            break;
#endif
#if LV_USE_ARC
        case RP_WIDGET_ARC:
            obj = lv_arc_create(parent);
            break;
#endif
#if LV_USE_BAR
        case RP_WIDGET_BAR:
            obj = lv_bar_create(parent);
            break;
#endif
#if LV_USE_IMAGE
        case RP_WIDGET_IMAGE:
            obj = lv_image_create(parent);
            break;
#endif
#if LV_USE_SWITCH
        case RP_WIDGET_SWITCH:
            obj = lv_switch_create(parent);
            break;
#endif
#if LV_USE_CHECKBOX
        case RP_WIDGET_CHECKBOX:
            obj = lv_checkbox_create(parent);
            lv_checkbox_set_text(obj, "");
            break;
#endif
#if LV_USE_DROPDOWN
        case RP_WIDGET_DROPDOWN:
            obj = lv_dropdown_create(parent);
            break;
#endif
        default:
            break;
    }
    return obj;
}

void rp_obj_delete(lv_obj_t * obj)
{
    lv_obj_delete(obj);
}

void rp_obj_set_parent(lv_obj_t * obj, lv_obj_t * parent, int32_t index)
{
    if(lv_obj_get_parent(obj) != parent) lv_obj_set_parent(obj, parent);
    if(index >= 0) lv_obj_move_to_index(obj, index);
    else lv_obj_move_to_index(obj, (int32_t)lv_obj_get_child_count(parent) - 1);
}

void rp_obj_set_state(lv_obj_t * obj, int32_t state, bool on)
{
    lv_obj_set_state(obj, (lv_state_t)state, on);
}

void rp_obj_set_hidden(lv_obj_t * obj, bool hidden)
{
    lv_obj_set_hidden(obj, hidden);
}

void rp_obj_center(lv_obj_t * obj)
{
    lv_obj_center(obj);
}

static void forward_event(lv_event_t * e)
{
    if(event_handler == NULL) return;
    lv_obj_t * obj = lv_event_get_current_target(e);
    /* Only report events that happened on this object, not ones bubbling up from children. */
    if(lv_event_get_target(e) != obj) return;

    rp_event_t ev;
    switch(lv_event_get_code(e)) {
        case LV_EVENT_CLICKED: ev = RP_EVENT_CLICK; break;
        case LV_EVENT_PRESSED: ev = RP_EVENT_PRESS; break;
        case LV_EVENT_RELEASED: ev = RP_EVENT_RELEASE; break;
        case LV_EVENT_LONG_PRESSED: ev = RP_EVENT_LONG_PRESS; break;
        case LV_EVENT_VALUE_CHANGED: ev = RP_EVENT_VALUE_CHANGED; break;
        case LV_EVENT_FOCUSED: ev = RP_EVENT_FOCUS; break;
        case LV_EVENT_DEFOCUSED: ev = RP_EVENT_BLUR; break;
        default: return;
    }

    int32_t value = 0;
#if LV_USE_SLIDER
    if(lv_obj_check_type(obj, &lv_slider_class)) value = lv_slider_get_value(obj);
#endif
#if LV_USE_ARC
    if(lv_obj_check_type(obj, &lv_arc_class)) value = lv_arc_get_value(obj);
#endif
#if LV_USE_SWITCH
    if(lv_obj_check_type(obj, &lv_switch_class)) value = lv_obj_has_state(obj, LV_STATE_CHECKED);
#endif
#if LV_USE_CHECKBOX
    if(lv_obj_check_type(obj, &lv_checkbox_class)) value = lv_obj_has_state(obj, LV_STATE_CHECKED);
#endif
#if LV_USE_DROPDOWN
    if(lv_obj_check_type(obj, &lv_dropdown_class)) value = (int32_t)lv_dropdown_get_selected(obj);
#endif
    event_handler(obj, ev, value);
}

void rp_obj_listen(lv_obj_t * obj)
{
    lv_obj_set_clickable(obj, true);
    lv_obj_add_event_cb(obj, forward_event, LV_EVENT_ALL, NULL);
}

void rp_obj_on(lv_obj_t * obj, lv_event_cb_t cb, lv_event_code_t code)
{
    lv_obj_set_clickable(obj, true);
    lv_obj_add_event_cb(obj, cb, code, NULL);
}

void rp_view_set_scroll(lv_obj_t * obj, bool scroll)
{
    lv_obj_set_scrollable(obj, scroll);
    if(scroll) lv_obj_set_clickable(obj, true);
}

/* ---------- Widget properties ---------- */

void rp_label_set_text(lv_obj_t * obj, const char * text)
{
    /* LVGL reallocates, re-lays out and redraws a label even if its text is the same. */
    const char * current = lv_label_get_text(obj);
    if(current != NULL && strcmp(current, text) == 0) return;
    lv_label_set_text(obj, text);
}

#if LV_USE_SLIDER
void rp_slider_set_range(lv_obj_t * obj, int32_t min, int32_t max)
{
    lv_slider_set_range(obj, min, max);
}

void rp_slider_set_value(lv_obj_t * obj, int32_t value)
{
    lv_slider_set_value(obj, value, LV_ANIM_OFF);
}

int32_t rp_slider_get_value(lv_obj_t * obj)
{
    return lv_slider_get_value(obj);
}
#endif

#if LV_USE_ARC
void rp_arc_set_range(lv_obj_t * obj, int32_t min, int32_t max)
{
    lv_arc_set_range(obj, min, max);
}

void rp_arc_set_value(lv_obj_t * obj, int32_t value)
{
    lv_arc_set_value(obj, value);
}

void rp_arc_set_readonly(lv_obj_t * obj, bool readonly)
{
    if(readonly) {
        lv_obj_set_clickable(obj, false);
        lv_obj_set_style_opa(obj, LV_OPA_TRANSP, LV_PART_KNOB);
    }
    else {
        lv_obj_set_clickable(obj, true);
        lv_obj_remove_local_style_prop(obj, LV_STYLE_OPA, LV_PART_KNOB);
    }
}
#endif

#if LV_USE_BAR
void rp_bar_set_range(lv_obj_t * obj, int32_t min, int32_t max)
{
    lv_bar_set_range(obj, min, max);
}

void rp_bar_set_value(lv_obj_t * obj, int32_t value)
{
    lv_bar_set_value(obj, value, LV_ANIM_OFF);
}
#endif

#if LV_USE_CHECKBOX
void rp_checkbox_set_text(lv_obj_t * obj, const char * text)
{
    if(strcmp(lv_checkbox_get_text(obj), text) == 0) return;
    lv_checkbox_set_text(obj, text);
}
#endif

#if LV_USE_DROPDOWN
void rp_dropdown_set_options(lv_obj_t * obj, const char * options)
{
    lv_dropdown_set_options(obj, options);
}

void rp_dropdown_set_selected(lv_obj_t * obj, int32_t index)
{
    lv_dropdown_set_selected(obj, (uint32_t)index);
}
#endif

#if LV_USE_IMAGE
void rp_image_set_src(lv_obj_t * obj, const void * src)
{
    lv_image_set_src(obj, src);
}

void rp_image_set_fit(lv_obj_t * obj, int32_t fit)
{
    lv_image_set_inner_align(obj, (lv_image_align_t)fit);
}
#endif

const lv_image_dsc_t * rp_image_dsc_create(int32_t width, int32_t height, int32_t format, int32_t stride,
                                           const uint8_t * data, uint32_t size)
{
    lv_image_dsc_t * dsc = lv_malloc_zeroed(sizeof(lv_image_dsc_t));
    dsc->header.magic = LV_IMAGE_HEADER_MAGIC;
    dsc->header.cf = (uint32_t)format;
    dsc->header.w = (uint32_t)width;
    dsc->header.h = (uint32_t)height;
    dsc->header.stride = (uint32_t)stride;
    dsc->data_size = size;
    dsc->data = data;
    return dsc;
}

/* ---------- Styles ---------- */

/* A transition descriptor and its zero-terminated property list, in one allocation. */
typedef struct {
    lv_style_transition_dsc_t dsc;
    lv_style_prop_t props[];
} rp_transition_t;

lv_style_t * rp_style_create(void)
{
    lv_style_t * style = lv_malloc(sizeof(lv_style_t));
    lv_style_init(style);
    return style;
}

void rp_style_destroy(lv_style_t * style)
{
    lv_style_value_t transition;
    if(lv_style_get_prop(style, LV_STYLE_TRANSITION, &transition) == LV_STYLE_RES_FOUND) {
        lv_free((void *)transition.ptr);
    }
    lv_style_reset(style);
    lv_free(style);
}

void rp_style_set_num(lv_style_t * style, int32_t prop, int32_t value)
{
    lv_style_value_t v = { .num = value };
    lv_style_set_prop(style, (lv_style_prop_t)prop, v);
}

void rp_style_set_color(lv_style_t * style, int32_t prop, uint32_t rgb)
{
    lv_style_value_t v = { .color = lv_color_hex(rgb) };
    lv_style_set_prop(style, (lv_style_prop_t)prop, v);
}

void rp_style_set_ptr(lv_style_t * style, int32_t prop, const void * ptr)
{
    lv_style_value_t v = { .ptr = ptr };
    lv_style_set_prop(style, (lv_style_prop_t)prop, v);
}

void rp_style_set_transition(lv_style_t * style, const int32_t * props, int32_t count, uint32_t time,
                             uint32_t delay, rp_path_t path)
{
    lv_anim_path_cb_t cb;
    switch(path) {
        case RP_PATH_EASE_IN: cb = lv_anim_path_ease_in; break;
        case RP_PATH_EASE_OUT: cb = lv_anim_path_ease_out; break;
        case RP_PATH_EASE_IN_OUT: cb = lv_anim_path_ease_in_out; break;
        case RP_PATH_OVERSHOOT: cb = lv_anim_path_overshoot; break;
        case RP_PATH_BOUNCE: cb = lv_anim_path_bounce; break;
        default: cb = lv_anim_path_linear; break;
    }

    rp_transition_t * t = lv_malloc(sizeof(rp_transition_t) + sizeof(lv_style_prop_t) * ((size_t)count + 1));
    for(int32_t i = 0; i < count; i++) t->props[i] = (lv_style_prop_t)props[i];
    t->props[count] = LV_STYLE_PROP_INV;
    lv_style_transition_dsc_init(&t->dsc, t->props, cb, time, delay, NULL);
    lv_style_set_transition(style, &t->dsc);
}

/* A dropdown's open list is a separate object, so ::items and ::selected are sent there. */
static void route_list_styles(lv_obj_t ** obj, uint32_t * selector)
{
#if LV_USE_DROPDOWN
    if(!lv_obj_check_type(*obj, &lv_dropdown_class)) return;
    lv_part_t part = lv_obj_style_get_selector_part(*selector);
    if(part != LV_PART_ITEMS && part != LV_PART_SELECTED) return;
    *obj = lv_dropdown_get_list(*obj);
    if(part == LV_PART_ITEMS) *selector = lv_obj_style_get_selector_state(*selector);
#else
    LV_UNUSED(obj);
    LV_UNUSED(selector);
#endif
}

void rp_obj_add_style(lv_obj_t * obj, lv_style_t * style, uint32_t selector)
{
    route_list_styles(&obj, &selector);
    lv_obj_add_style(obj, style, selector);
}

void rp_obj_remove_style(lv_obj_t * obj, lv_style_t * style, uint32_t selector)
{
    route_list_styles(&obj, &selector);
    lv_obj_remove_style(obj, style, selector);
}

void rp_obj_set_local_num(lv_obj_t * obj, int32_t prop, int32_t value, uint32_t selector)
{
    lv_style_value_t v = { .num = value };
    lv_obj_set_local_style_prop(obj, (lv_style_prop_t)prop, v, selector);
}

void rp_obj_set_local_color(lv_obj_t * obj, int32_t prop, uint32_t rgb, uint32_t selector)
{
    lv_style_value_t v = { .color = lv_color_hex(rgb) };
    lv_obj_set_local_style_prop(obj, (lv_style_prop_t)prop, v, selector);
}

void rp_obj_set_local_ptr(lv_obj_t * obj, int32_t prop, const void * ptr, uint32_t selector)
{
    lv_style_value_t v = { .ptr = ptr };
    lv_obj_set_local_style_prop(obj, (lv_style_prop_t)prop, v, selector);
}

void rp_obj_remove_local(lv_obj_t * obj, int32_t prop, uint32_t selector)
{
    lv_obj_remove_local_style_prop(obj, (lv_style_prop_t)prop, selector);
}

/* ---------- Values ---------- */

int32_t rp_pct(int32_t value)
{
    return lv_pct(value);
}

int32_t rp_size_content(void)
{
    return LV_SIZE_CONTENT;
}

/* ---------- Fonts ---------- */

const lv_font_t * rp_font_builtin(int32_t size)
{
    switch(size) {
#if LV_FONT_MONTSERRAT_10
        case 10: return &lv_font_montserrat_10;
#endif
#if LV_FONT_MONTSERRAT_12
        case 12: return &lv_font_montserrat_12;
#endif
#if LV_FONT_MONTSERRAT_14
        case 14: return &lv_font_montserrat_14;
#endif
#if LV_FONT_MONTSERRAT_16
        case 16: return &lv_font_montserrat_16;
#endif
#if LV_FONT_MONTSERRAT_18
        case 18: return &lv_font_montserrat_18;
#endif
#if LV_FONT_MONTSERRAT_20
        case 20: return &lv_font_montserrat_20;
#endif
#if LV_FONT_MONTSERRAT_22
        case 22: return &lv_font_montserrat_22;
#endif
#if LV_FONT_MONTSERRAT_24
        case 24: return &lv_font_montserrat_24;
#endif
#if LV_FONT_MONTSERRAT_26
        case 26: return &lv_font_montserrat_26;
#endif
#if LV_FONT_MONTSERRAT_28
        case 28: return &lv_font_montserrat_28;
#endif
#if LV_FONT_MONTSERRAT_30
        case 30: return &lv_font_montserrat_30;
#endif
#if LV_FONT_MONTSERRAT_32
        case 32: return &lv_font_montserrat_32;
#endif
#if LV_FONT_MONTSERRAT_36
        case 36: return &lv_font_montserrat_36;
#endif
#if LV_FONT_MONTSERRAT_40
        case 40: return &lv_font_montserrat_40;
#endif
#if LV_FONT_MONTSERRAT_48
        case 48: return &lv_font_montserrat_48;
#endif
        default: return NULL;
    }
}

/* ---------- Constants ---------- */

typedef struct {
    const char * name;
    int32_t value;
} rp_const_t;

#define C(x) { #x, (int32_t)(x) }

static const rp_const_t constants[] = {
    /* Style properties */
    C(LV_STYLE_WIDTH), C(LV_STYLE_MIN_WIDTH), C(LV_STYLE_MAX_WIDTH),
    C(LV_STYLE_HEIGHT), C(LV_STYLE_MIN_HEIGHT), C(LV_STYLE_MAX_HEIGHT),
    C(LV_STYLE_X), C(LV_STYLE_Y), C(LV_STYLE_ALIGN),
    C(LV_STYLE_RADIUS),
    C(LV_STYLE_PAD_TOP), C(LV_STYLE_PAD_BOTTOM), C(LV_STYLE_PAD_LEFT), C(LV_STYLE_PAD_RIGHT),
    C(LV_STYLE_PAD_ROW), C(LV_STYLE_PAD_COLUMN),
    C(LV_STYLE_MARGIN_TOP), C(LV_STYLE_MARGIN_BOTTOM), C(LV_STYLE_MARGIN_LEFT), C(LV_STYLE_MARGIN_RIGHT),
    C(LV_STYLE_BG_COLOR), C(LV_STYLE_BG_OPA),
    C(LV_STYLE_BORDER_COLOR), C(LV_STYLE_BORDER_OPA), C(LV_STYLE_BORDER_WIDTH), C(LV_STYLE_BORDER_SIDE),
    C(LV_STYLE_OUTLINE_COLOR), C(LV_STYLE_OUTLINE_OPA), C(LV_STYLE_OUTLINE_WIDTH), C(LV_STYLE_OUTLINE_PAD),
    C(LV_STYLE_SHADOW_COLOR), C(LV_STYLE_SHADOW_OPA), C(LV_STYLE_SHADOW_WIDTH),
    C(LV_STYLE_SHADOW_OFFSET_X), C(LV_STYLE_SHADOW_OFFSET_Y), C(LV_STYLE_SHADOW_SPREAD),
    C(LV_STYLE_TEXT_COLOR), C(LV_STYLE_TEXT_OPA), C(LV_STYLE_TEXT_FONT),
    C(LV_STYLE_TEXT_ALIGN), C(LV_STYLE_TEXT_LETTER_SPACE), C(LV_STYLE_TEXT_LINE_SPACE), C(LV_STYLE_TEXT_DECOR),
    C(LV_STYLE_ARC_COLOR), C(LV_STYLE_ARC_OPA), C(LV_STYLE_ARC_WIDTH), C(LV_STYLE_ARC_ROUNDED),
    C(LV_STYLE_OPA), C(LV_STYLE_RECOLOR_OPA),
    C(LV_STYLE_IMAGE_RECOLOR), C(LV_STYLE_IMAGE_RECOLOR_OPA),
    C(LV_STYLE_TRANSLATE_X), C(LV_STYLE_TRANSLATE_Y),
    C(LV_STYLE_LAYOUT),
    C(LV_STYLE_FLEX_FLOW), C(LV_STYLE_FLEX_MAIN_PLACE), C(LV_STYLE_FLEX_CROSS_PLACE),
    C(LV_STYLE_FLEX_TRACK_PLACE), C(LV_STYLE_FLEX_GROW),

    /* Parts */
    C(LV_PART_MAIN), C(LV_PART_SCROLLBAR), C(LV_PART_INDICATOR), C(LV_PART_KNOB),
    C(LV_PART_SELECTED), C(LV_PART_ITEMS), C(LV_PART_CURSOR),

    /* States */
    C(LV_STATE_DEFAULT), C(LV_STATE_CHECKED), C(LV_STATE_FOCUSED), C(LV_STATE_FOCUS_KEY),
    C(LV_STATE_EDITED), C(LV_STATE_HOVERED), C(LV_STATE_PRESSED), C(LV_STATE_SCROLLED),
    C(LV_STATE_DISABLED),

    /* Layouts */
    C(LV_LAYOUT_NONE), C(LV_LAYOUT_FLEX),
    C(LV_FLEX_FLOW_ROW), C(LV_FLEX_FLOW_COLUMN), C(LV_FLEX_FLOW_ROW_WRAP), C(LV_FLEX_FLOW_ROW_REVERSE),
    C(LV_FLEX_FLOW_ROW_WRAP_REVERSE), C(LV_FLEX_FLOW_COLUMN_WRAP), C(LV_FLEX_FLOW_COLUMN_REVERSE),
    C(LV_FLEX_FLOW_COLUMN_WRAP_REVERSE),
    C(LV_FLEX_ALIGN_START), C(LV_FLEX_ALIGN_END), C(LV_FLEX_ALIGN_CENTER),
    C(LV_FLEX_ALIGN_SPACE_EVENLY), C(LV_FLEX_ALIGN_SPACE_AROUND), C(LV_FLEX_ALIGN_SPACE_BETWEEN),

    /* Text */
    C(LV_TEXT_ALIGN_AUTO), C(LV_TEXT_ALIGN_LEFT), C(LV_TEXT_ALIGN_CENTER), C(LV_TEXT_ALIGN_RIGHT),
    C(LV_TEXT_DECOR_NONE), C(LV_TEXT_DECOR_UNDERLINE), C(LV_TEXT_DECOR_STRIKETHROUGH),

    /* Sizes */
    C(LV_RADIUS_CIRCLE),

    /* Borders */
    C(LV_BORDER_SIDE_NONE), C(LV_BORDER_SIDE_BOTTOM), C(LV_BORDER_SIDE_TOP),
    C(LV_BORDER_SIDE_LEFT), C(LV_BORDER_SIDE_RIGHT), C(LV_BORDER_SIDE_FULL),

    /* Images */
    C(LV_COLOR_FORMAT_RGB565), C(LV_COLOR_FORMAT_RGB565A8), C(LV_COLOR_FORMAT_ARGB8888),
#if LV_USE_IMAGE
    C(LV_IMAGE_ALIGN_CENTER), C(LV_IMAGE_ALIGN_CONTAIN), C(LV_IMAGE_ALIGN_COVER), C(LV_IMAGE_ALIGN_STRETCH),
#endif

    /* Easing */
    C(RP_PATH_LINEAR), C(RP_PATH_EASE_IN), C(RP_PATH_EASE_OUT), C(RP_PATH_EASE_IN_OUT),
    C(RP_PATH_OVERSHOOT), C(RP_PATH_BOUNCE),
};

#undef C

int32_t rp_const_count(void)
{
    return (int32_t)(sizeof(constants) / sizeof(constants[0]));
}

const char * rp_const_name(int32_t index)
{
    return constants[index].name;
}

int32_t rp_const_value(int32_t index)
{
    return constants[index].value;
}
