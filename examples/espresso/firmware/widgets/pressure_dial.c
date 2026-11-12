/*
 * <PressureDial>: a pressure gauge drawn by hand with LVGL's draw API.
 *
 * It implements the widget declared in src/firmware.contract.ts. The UI that
 * Rippel generates calls these functions, on the device and in the simulator.
 * `rippel build` compiles this file into the generated ui component, because
 * it's listed under widgets.sources in rippel.config.ts. Size it with CSS like
 * any element.
 *
 * Integer math only, so it's just as quick on chips without an FPU.
 */
#include "ui_widgets.h"

/* The dial sweeps 270 degrees clockwise from the lower left. LVGL measures
 * angles clockwise from 3 o'clock. */
#define DIAL_START  135
#define DIAL_SWEEP  270
/* Full scale is 12 bar, in tenths. */
#define DIAL_MAX    120
/* Where a shot should extract, highlighted on the track. */
#define SWEET_LOW   80
#define SWEET_HIGH  100

#define TRACK_WIDTH 10

typedef struct {
    uint16_t value;
    lv_color_t color;
} dial_t;

static int32_t angle_of(uint32_t tenths)
{
    if(tenths > DIAL_MAX) tenths = DIAL_MAX;
    return DIAL_START + (int32_t)(tenths * DIAL_SWEEP / DIAL_MAX);
}

static lv_point_precise_t polar(const lv_point_t * center, int32_t radius, int32_t angle)
{
    int16_t a = (int16_t)(angle % 360);
    lv_point_precise_t p;
    p.x = center->x + ((radius * lv_trigo_cos(a)) >> LV_TRIGO_SHIFT);
    p.y = center->y + ((radius * lv_trigo_sin(a)) >> LV_TRIGO_SHIFT);
    return p;
}

static void draw_arc(lv_layer_t * layer, const lv_point_t * center, int32_t radius, int32_t width,
                     int32_t start, int32_t end, lv_color_t color, lv_opa_t opa, bool rounded)
{
    if(start == end) return;
    lv_draw_arc_dsc_t arc;
    lv_draw_arc_dsc_init(&arc);
    arc.center = *center;
    arc.radius = (uint16_t)radius;
    arc.width = width;
    arc.start_angle = start;
    arc.end_angle = end;
    arc.color = color;
    arc.opa = opa;
    arc.rounded = rounded;
    lv_draw_arc(layer, &arc);
}

static void draw_line(lv_layer_t * layer, lv_point_precise_t from, lv_point_precise_t to, int32_t width, lv_color_t color)
{
    lv_draw_line_dsc_t line;
    lv_draw_line_dsc_init(&line);
    line.p1 = from;
    line.p2 = to;
    line.width = width;
    line.color = color;
    line.round_start = 1;
    line.round_end = 1;
    lv_draw_line(layer, &line);
}

static void draw_cb(lv_event_t * e)
{
    lv_obj_t * obj = lv_event_get_target_obj(e);
    lv_layer_t * layer = lv_event_get_layer(e);
    const dial_t * dial = lv_event_get_user_data(e);

    lv_area_t area;
    lv_obj_get_content_coords(obj, &area);
    int32_t size = LV_MIN(lv_area_get_width(&area), lv_area_get_height(&area));
    int32_t radius = size / 2;
    if(radius < TRACK_WIDTH * 2) return;
    lv_point_t center = { area.x1 + lv_area_get_width(&area) / 2, area.y1 + lv_area_get_height(&area) / 2 };

    /* Track, with the extraction range tinted. */
    draw_arc(layer, &center, radius, TRACK_WIDTH, DIAL_START, DIAL_START + DIAL_SWEEP, lv_color_hex(0x262a32), LV_OPA_COVER, true);
    draw_arc(layer, &center, radius, TRACK_WIDTH, angle_of(SWEET_LOW), angle_of(SWEET_HIGH), dial->color, LV_OPA_30, false);

    /* Fill up to the current pressure. */
    draw_arc(layer, &center, radius, TRACK_WIDTH, DIAL_START, angle_of(dial->value), dial->color, LV_OPA_COVER, true);

    /* A tick every bar, longer every 3 bar. */
    int32_t tick_outer = radius - TRACK_WIDTH - 4;
    for(uint32_t bar = 0; bar <= DIAL_MAX / 10; bar++) {
        bool major = bar % 3 == 0;
        int32_t angle = angle_of(bar * 10);
        draw_line(layer, polar(&center, tick_outer, angle), polar(&center, tick_outer - (major ? 9 : 5), angle),
                  major ? 2 : 1, lv_color_hex(major ? 0x8b909a : 0x4a4f59));
    }

    /* Needle and hub. */
    int32_t angle = angle_of(dial->value);
    draw_line(layer, polar(&center, 14, angle + 180), polar(&center, tick_outer - 6, angle), 3, lv_color_hex(0xeceef2));
    draw_arc(layer, &center, 7, 7, 0, 360, dial->color, LV_OPA_COVER, false);
    draw_arc(layer, &center, 3, 3, 0, 360, lv_color_hex(0x15171c), LV_OPA_COVER, false);
}

static void delete_cb(lv_event_t * e)
{
    lv_free(lv_event_get_user_data(e));
}

lv_obj_t * ui_widget_pressure_dial_create(lv_obj_t * parent)
{
    lv_obj_t * obj = lv_obj_create(parent);
    lv_obj_remove_style_all(obj);
    lv_obj_set_clickable(obj, false);
    lv_obj_set_scrollable(obj, false);

    dial_t * dial = lv_malloc_zeroed(sizeof(dial_t));
    LV_ASSERT_MALLOC(dial);
    dial->color = lv_color_hex(0xf5a524);
    lv_obj_add_event_cb(obj, draw_cb, LV_EVENT_DRAW_MAIN, dial);
    lv_obj_add_event_cb(obj, delete_cb, LV_EVENT_DELETE, dial);
    lv_obj_set_user_data(obj, dial);
    return obj;
}

void ui_widget_pressure_dial_set_value(lv_obj_t * obj, uint16_t value)
{
    dial_t * dial = lv_obj_get_user_data(obj);
    if(dial->value == value) return;
    dial->value = value;
    lv_obj_invalidate(obj);
}

void ui_widget_pressure_dial_set_color(lv_obj_t * obj, uint32_t value)
{
    dial_t * dial = lv_obj_get_user_data(obj);
    lv_color_t color = lv_color_hex(value);
    if(lv_color_eq(dial->color, color)) return;
    dial->color = color;
    lv_obj_invalidate(obj);
}
