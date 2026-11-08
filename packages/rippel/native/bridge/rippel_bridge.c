#include "rippel_bridge.h"
#include <stddef.h>

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
            break;
        case RP_WIDGET_LABEL:
            obj = lv_label_create(parent);
            lv_label_set_text(obj, "");
            break;
        case RP_WIDGET_BUTTON:
            obj = lv_button_create(parent);
            break;
        case RP_WIDGET_SLIDER:
            obj = lv_slider_create(parent);
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
    if(lv_obj_check_type(obj, &lv_slider_class)) value = lv_slider_get_value(obj);
    event_handler(obj, ev, value);
}

void rp_obj_listen(lv_obj_t * obj)
{
    lv_obj_add_event_cb(obj, forward_event, LV_EVENT_ALL, NULL);
}

/* ---------- Widget properties ---------- */

void rp_label_set_text(lv_obj_t * obj, const char * text)
{
    lv_label_set_text(obj, text);
}

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

/* ---------- Styles ---------- */

lv_style_t * rp_style_create(void)
{
    lv_style_t * style = lv_malloc(sizeof(lv_style_t));
    lv_style_init(style);
    return style;
}

void rp_style_destroy(lv_style_t * style)
{
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

void rp_obj_add_style(lv_obj_t * obj, lv_style_t * style, uint32_t selector)
{
    lv_obj_add_style(obj, style, selector);
}

void rp_obj_remove_style(lv_obj_t * obj, lv_style_t * style, uint32_t selector)
{
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
    C(LV_STYLE_OPA),
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
