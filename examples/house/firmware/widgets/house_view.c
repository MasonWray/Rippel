/*
 * <HouseView>: ArkViz's house view, drawn on the device.
 *
 * The house is an exploded axonometric: each floor cut like a plan, its walls standing to the cut, its floor showing
 * pools of light where lights are on. Drag to turn it. It draws what ArkViz's three.js view draws, but the scene is
 * narrow enough to need no 3D engine: an orthographic camera, flat colors, and solids that are polygons stood up.
 *
 * LVGL draws the screen in bands. For each band this widget projects nothing new (that happens once a frame), then
 * fills a band-sized buffer with its own scanline rasterizer and hands it to LVGL as an image. Each floor gets a fresh
 * depth buffer: floors stack, and the camera is always above the horizon, so a higher floor is always in front of a
 * lower one. Room names are LVGL labels on top.
 *
 * It uses float math, so it wants a chip with an FPU (the ESP32-S3 has one).
 */
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include "ui_widgets.h"
#include "house_scene.h"
#include "house_view.h"

#if defined(ESP_PLATFORM)
/* The ui component only requires LVGL, so time with the CPU's cycle counter, which every ESP-IDF build has. It
 * wraps every few seconds, so this keeps a running total. */
#include "esp_cpu.h"
#include "esp_rom_sys.h"
static int64_t now_us(void)
{
    static uint32_t last;
    static int64_t total;
    uint32_t now = esp_cpu_get_cycle_count();
    total += (uint32_t)(now - last);
    last = now;
    return total / esp_rom_get_cpu_ticks_per_us();
}
#elif defined(__EMSCRIPTEN__)
#include <emscripten.h>
static int64_t now_us(void) { return (int64_t)(emscripten_get_now() * 1000.0); }
#else
static int64_t now_us(void) { return (int64_t)lv_tick_get() * 1000; }
#endif

#define PI_F         3.14159265f
#define PHI_MIN      0.3f      /* How far the camera can tilt from straight down, as OrbitControls allows */
#define PHI_MAX      1.32f
#define PHI_START    0.911f    /* Where ArkViz's camera starts */
#define THETA_START  (-0.618f)
#define DRAG_RATE    (2 * PI_F * 0.55f) /* Radians for a drag the view's height, as OrbitControls turns */
#define DAMPING      0.08f     /* Of the turn's speed lost each 60th of a second once let go */
#define FLOOR_LIFT   20        /* mm the floor sits above its slab */
#define LINE_LIFT    25        /* and the lines drawn on it */
#define DOT_LIGHT    91        /* Radius of a device's dot on the floor, mm */
#define DOT_DEVICE   66
#define DOT_SIDES    12
#define LIGHT_ON_S   0.6f
#define LIGHT_OFF_S  0.4f
#define TICK_MS      16
#define MARGIN       8         /* px kept clear around the house */
#define Z_STEPS      65000.0f  /* Depth buffer steps, shared out between the floors */
#define LINE_BIAS_MM 25.0f     /* How far a line wins by, so lines on a face show */
#define MAX_FLOORS   8
#define MAX_GLOWS    8         /* Lit lights one room can show */

typedef struct {
    float x, y, z;
} vtx_t;

typedef struct {
    float x, y, inv_r2, opa;
} glow_t;

typedef struct {
    const char * text;
    /* In the widget's own coordinates */
    lv_area_t at;
} label_t;

typedef struct {
    /* Camera, in radians: tilt from straight down, and turn */
    float phi, theta;
    float v_phi, v_theta;
    bool dragging;
    float explode, explode_to;
    float spin;
    bool lights, stats;
    /* How lit each light looks, 0-1, so pools fade in and out */
    float * shown;

    /* The projection, worked out once a frame */
    bool stale;
    int32_t w, h;
    float s, ox, oy, ct, st, cp, sp, spacing;
    /* Each prism's points projected at its bottom, then at its top */
    vtx_t * verts;
    uint32_t * prism_first;
    int16_t * prism_ymin;
    int16_t * prism_ymax;
    float zmin[MAX_FLOORS];
    float zscale[MAX_FLOORS];
    /* The frame rate readout, set once a frame */
    char stats_text[48];
    lv_area_t stats_at;
    /* Each floor's surface points, projected */
    vtx_t * surf;
    uint32_t surf_first[MAX_FLOORS + 1];
    /* The rows each line on a floor reaches, so a band only projects the lines that cross it */
    int16_t * seg_y;
    uint32_t seg_first[MAX_FLOORS];
    /* Room names that fit this frame */
    label_t * labels;
    uint32_t label_count;

    /* The band being drawn */
    lv_draw_buf_t strip;
    uint16_t * pixels;
    uint16_t * zbuf;
    int32_t cap_w, cap_h;
    uint32_t memory;

    lv_timer_t * timer;
    /* LVGL's tick, so animation runs the same in the simulator and on the device */
    uint32_t last_tick, last_drag;
    /* Stats */
    uint32_t frames;
    uint32_t window_frames;
    int64_t window_start;
    int64_t window_project_us, window_draw_us, window_callback_us;
    int64_t window_phase_us[HOUSE_VIEW_PHASES];
    int64_t mark;
    house_view_stats_t out;
} view_t;

typedef struct {
    /* The band's first row, at the widget's left edge, `stride` pixels a row */
    uint16_t * px;
    int32_t stride;
    /* Depth, `w` a row */
    uint16_t * zb;
    int32_t w;
    /* The band's rows and columns in the widget's own coordinates, inclusive */
    int32_t y0, y1, x0, x1;
    /* Depth steps from the floor's nearest point, and where its slice of the buffer starts */
    float zmin, zscale, zbase, zspan;
    int32_t bias;
} band_t;

/* Colors */

static uint16_t rgb565(uint32_t argb)
{
    return (uint16_t)(((argb >> 8) & 0xf800) | ((argb >> 5) & 0x07e0) | ((argb >> 3) & 0x001f));
}

static uint16_t blend(uint16_t fg, uint16_t bg, uint32_t opa)
{
    if(opa >= 255) return fg;
    uint32_t a = (opa + 4) >> 3;
    uint32_t f = (fg | ((uint32_t)fg << 16)) & 0x07e0f81f;
    uint32_t b = (bg | ((uint32_t)bg << 16)) & 0x07e0f81f;
    uint32_t r = ((f * a + b * (32 - a)) >> 5) & 0x07e0f81f;
    return (uint16_t)(r | (r >> 16));
}

static uint16_t color(int token)
{
    return rgb565(house_scene.colors[token]);
}

/* How strong a pool of light is at a fraction of its radius, by the square of that fraction: full to 0.45, then
 * fading to nothing at the edge, as ArkViz's gradient does. */
static uint8_t glow_lut[64];

static void glow_lut_init(void)
{
    for(int i = 0; i < 64; i++) {
        float r = sqrtf((i + 0.5f) / 64.0f);
        float a = r <= 0.45f ? 1.0f : (1.0f - r) / 0.55f;
        glow_lut[i] = (uint8_t)(a * 255.0f + 0.5f);
    }
}

/* Rounds up, without a libm call */
static inline int32_t iceil(float x)
{
    int32_t i = (int32_t)x;
    return i + (x > (float)i);
}

/* A circle of DOT_SIDES points, for device dots */
static float dot_cos[DOT_SIDES], dot_sin[DOT_SIDES];

static void dot_init(void)
{
    for(int i = 0; i < DOT_SIDES; i++) {
        dot_cos[i] = cosf(i * 2 * PI_F / DOT_SIDES);
        dot_sin[i] = sinf(i * 2 * PI_F / DOT_SIDES);
    }
}

/* Projection */

static vtx_t project(const view_t * v, float x, float y, float h)
{
    float along = v->st * x + v->ct * y;
    float u = v->ct * x - v->st * y;
    float up = -v->cp * along + v->sp * h;
    vtx_t r = { v->ox + v->s * u, v->oy - v->s * up, v->sp * along + v->cp * h };
    return r;
}

static void prism_heights(const view_t * v, const hs_prism_t * p, float rise, float * bottom, float * top)
{
    const hs_scene_t * sc = &house_scene;
    switch(p->kind) {
        case HS_SLAB: *bottom = (float)-sc->slab; *top = 0; break;
        case HS_SILL: *bottom = 0; *top = (float)sc->sill; break;
        case HS_STEP: *top = (p->step + 1) * rise; *bottom = *top - sc->step; break;
        default: *bottom = 0; *top = (float)sc->cut; break;
    }
    (void)v;
}

static void project_all(view_t * v)
{
    const hs_scene_t * sc = &house_scene;
    v->ct = cosf(v->theta);
    v->st = sinf(v->theta);
    v->cp = cosf(v->phi);
    v->sp = sinf(v->phi);
    v->spacing = sc->level + sc->gap * v->explode;

    /* Fit the house pulled apart, whichever way it's turned, so it doesn't zoom as it opens */
    float across = sc->span * 1.41421356f;
    float levels = (float)(sc->floor_count - 1);
    float tall = (levels * (sc->level + sc->gap) + sc->cut) * v->sp + across * v->cp;
    v->s = fminf((v->h - 2 * MARGIN) / tall, (v->w - 2 * MARGIN) / across);
    float middle = (levels * v->spacing + sc->cut - sc->slab) / 2;
    v->ox = v->w / 2.0f;
    v->oy = v->h / 2.0f + v->s * v->sp * middle;

    uint32_t prism = 0;
    for(uint32_t i = 0; i < sc->floor_count; i++) {
        const hs_floor_t * f = &sc->floors[i];
        float base = i * v->spacing;
        float rise = f->steps ? v->spacing / f->steps : 0;
        float zmin = INFINITY, zmax = -INFINITY;
        for(uint32_t n = 0; n < f->prism_count; n++, prism++) {
            const hs_prism_t * p = &f->prisms[n];
            uint32_t count = p->ring_ends[p->ring_count - 1];
            float bottom, top;
            prism_heights(v, p, rise, &bottom, &top);
            vtx_t * out = &v->verts[v->prism_first[prism]];
            float ymin = INFINITY, ymax = -INFINITY;
            for(uint32_t k = 0; k < count; k++) {
                out[k] = project(v, p->pts[k].x, p->pts[k].y, base + bottom);
                out[count + k] = project(v, p->pts[k].x, p->pts[k].y, base + top);
                for(int e = 0; e < 2; e++) {
                    const vtx_t * q = &out[e * count + k];
                    ymin = fminf(ymin, q->y);
                    ymax = fmaxf(ymax, q->y);
                    zmin = fminf(zmin, q->z);
                    zmax = fmaxf(zmax, q->z);
                }
            }
            v->prism_ymin[prism] = (int16_t)fmaxf(-30000, floorf(ymin) - 1);
            v->prism_ymax[prism] = (int16_t)fminf(30000, ceilf(ymax) + 1);
        }
        float floor_h = base + FLOOR_LIFT;
        vtx_t * sp = &v->surf[v->surf_first[i]];
        uint32_t points = v->surf_first[i + 1] - v->surf_first[i];
        for(uint32_t k = 0; k < points; k++) sp[k] = project(v, f->surface_pts[k].x, f->surface_pts[k].y, floor_h);

        float line_h = base + LINE_LIFT;
        int16_t * sy = &v->seg_y[v->seg_first[i] * 2];
        const hs_pt_t * lists[3] = { f->furniture, f->fine, f->leaf };
        const uint16_t counts[3] = { f->furniture_count, f->fine_count, f->leaf_count };
        for(int l = 0; l < 3; l++) {
            for(uint32_t k = 0; k < counts[l]; k++, sy += 2) {
                float y0 = project(v, lists[l][2 * k].x, lists[l][2 * k].y, line_h).y;
                float y1 = project(v, lists[l][2 * k + 1].x, lists[l][2 * k + 1].y, line_h).y;
                sy[0] = (int16_t)fmaxf(-30000, floorf(fminf(y0, y1)) - 1);
                sy[1] = (int16_t)fminf(30000, ceilf(fmaxf(y0, y1)) + 1);
            }
        }

        /* A little room either side, for lines lifted off the floor */
        float pad = (zmax - zmin) * 0.02f + 1;
        v->zmin[i] = zmin - pad;
        v->zscale[i] = (Z_STEPS / sc->floor_count - 2) / (zmax - zmin + 2 * pad);
    }
}

/* Rasterizing */

static int32_t clampi(int32_t v, int32_t lo, int32_t hi)
{
    return v < lo ? lo : v > hi ? hi : v;
}

/*
 * Depth in buffer steps, with 8 bits of fraction for stepping along a row. Floors stack, and a higher floor is always
 * in front, so each gets a slice of the buffer above the one below and the buffer is cleared once a band.
 */
#define DEPTH_SHIFT 8

static int32_t depth_q(const band_t * b, float z)
{
    float q = (z - b->zmin) * b->zscale;
    if(q < 0) q = 0;
    if(q > b->zspan) q = b->zspan;
    return (int32_t)((q + b->zbase) * (1 << DEPTH_SHIFT));
}

typedef struct {
    const view_t * view;
    const glow_t * glows;
    int count;
    /* Height of the floor, for working back from a pixel to where it is on the plan */
    float h;
    float inv_s, inv_cp;
    uint16_t glow_color;
} shade_t;

/* Fills a triangle, depth tested, with a flat color, or with a room's pools of light when `shade` is given */
static void fill_tri(const band_t * b, vtx_t p0, vtx_t p1, vtx_t p2, uint16_t col, uint32_t opa, const shade_t * shade)
{
    vtx_t t;
    if(p1.y < p0.y) { t = p0; p0 = p1; p1 = t; }
    if(p2.y < p0.y) { t = p0; p0 = p2; p2 = t; }
    if(p2.y < p1.y) { t = p1; p1 = p2; p2 = t; }
    int32_t ys = clampi(iceil(p0.y - 0.5f), b->y0, b->y1 + 1);
    int32_t ye = clampi(iceil(p2.y - 0.5f) - 1, b->y0 - 1, b->y1);
    if(ys > ye) return;

    float e1x = p1.x - p0.x, e1y = p1.y - p0.y, e1z = p1.z - p0.z;
    float e2x = p2.x - p0.x, e2y = p2.y - p0.y, e2z = p2.z - p0.z;
    float nz = e1x * e2y - e1y * e2x;
    if(fabsf(nz) < 1e-6f) return;
    float dzdx = -(e1y * e2z - e1z * e2y) / nz;
    float dzdy = -(e1z * e2x - e1x * e2z) / nz;
    int32_t dq = (int32_t)(dzdx * b->zscale * (1 << DEPTH_SHIFT));
    /* x along each edge per row. A flat edge is never sampled, so its slope doesn't matter. */
    float s02 = e2x / e2y;
    float s01 = e1y > 0 ? e1x / e1y : 0;
    float s12 = p2.y > p1.y ? (p2.x - p1.x) / (p2.y - p1.y) : 0;

    for(int32_t y = ys; y <= ye; y++) {
        float yc = y + 0.5f;
        float xa = p0.x + s02 * (yc - p0.y);
        float xb = yc < p1.y ? p0.x + s01 * (yc - p0.y) : p1.x + s12 * (yc - p1.y);
        float xl = fminf(xa, xb), xr = fmaxf(xa, xb);
        int32_t xs = clampi(iceil(xl - 0.5f), b->x0, b->x1 + 1);
        int32_t xe = clampi(iceil(xr - 0.5f) - 1, b->x0 - 1, b->x1);
        if(xs > xe) continue;
        int32_t q = depth_q(b, p0.z + dzdx * (xs + 0.5f - p0.x) + dzdy * (yc - p0.y));
        uint16_t * px = b->px + (y - b->y0) * b->stride;
        uint16_t * zb = b->zb + (y - b->y0) * b->w;

        if(!shade) {
            for(int32_t x = xs; x <= xe; x++, q += dq) {
                uint16_t z = (uint16_t)(q >> DEPTH_SHIFT);
                if(z <= zb[x]) continue;
                zb[x] = z;
                px[x] = blend(col, px[x], opa);
            }
            continue;
        }

        /* Where the pixel is on the plan, stepping along the row */
        const view_t * v = shade->view;
        float u = (xs + 0.5f - v->ox) * shade->inv_s;
        float up = (v->oy - yc) * shade->inv_s;
        float along = (v->sp * shade->h - up) * shade->inv_cp;
        float gx = v->ct * u + v->st * along;
        float gy = -v->st * u + v->ct * along;
        float dgx = v->ct * shade->inv_s, dgy = -v->st * shade->inv_s;
        for(int32_t x = xs; x <= xe; x++, q += dq, gx += dgx, gy += dgy) {
            uint16_t z = (uint16_t)(q >> DEPTH_SHIFT);
            if(z <= zb[x]) continue;
            zb[x] = z;
            uint16_t c = col;
            for(int g = 0; g < shade->count; g++) {
                const glow_t * l = &shade->glows[g];
                float dx = gx - l->x, dy = gy - l->y;
                float f = (dx * dx + dy * dy) * l->inv_r2;
                if(f >= 1.0f) continue;
                c = blend(shade->glow_color, c, (uint32_t)(glow_lut[(int)(f * 64.0f)] * l->opa));
            }
            px[x] = blend(c, px[x], opa);
        }
    }
}

/* A one-pixel line, depth tested but not written, so lines never hide what's drawn after them */
static void draw_seg(const band_t * b, vtx_t p, vtx_t q, uint16_t col, uint32_t opa)
{
    /* Clip to the band's rows. Columns are checked pixel by pixel. */
    float dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
    float t0 = 0, t1 = 1;
    float top = (float)b->y0, bottom = b->y1 + 0.999f;
    if(dy == 0) {
        if(p.y < top || p.y > bottom) return;
    } else {
        float inv = 1.0f / dy;
        float ta = (top - p.y) * inv, tb = (bottom - p.y) * inv;
        if(ta > tb) {
            float t = ta;
            ta = tb;
            tb = t;
        }
        if(ta > t0) t0 = ta;
        if(tb < t1) t1 = tb;
        if(t0 > t1) return;
    }
    float x0 = p.x + dx * t0, y0 = p.y + dy * t0, z0 = p.z + dz * t0;
    float x1 = p.x + dx * t1, y1 = p.y + dy * t1, z1 = p.z + dz * t1;
    int32_t steps = iceil(fmaxf(fabsf(x1 - x0), fabsf(y1 - y0)));
    if(steps < 1) steps = 1;
    float inv = 1.0f / steps;
    float sx = (x1 - x0) * inv, sy = (y1 - y0) * inv, sz = (z1 - z0) * inv;
    for(int32_t i = 0; i <= steps; i++, x0 += sx, y0 += sy, z0 += sz) {
        int32_t x = (int32_t)x0, y = (int32_t)y0;
        if(x < b->x0 || x > b->x1 || y < b->y0 || y > b->y1) continue;
        if((depth_q(b, z0) >> DEPTH_SHIFT) + b->bias <= b->zb[(y - b->y0) * b->w + x]) continue;
        uint16_t * px = &b->px[(y - b->y0) * b->stride + x];
        *px = blend(col, *px, opa);
    }
}

/* A prism's faces, and then its edges: the top's outline, and the sides' edges where a side faces the camera */
static void draw_prism(const view_t * v, const band_t * b, const hs_prism_t * p, const vtx_t * pv,
                       uint16_t top, uint16_t side, uint32_t opa, bool faces, bool tops, uint16_t edge, uint32_t edge_opa)
{
    uint32_t count = p->ring_ends[p->ring_count - 1];
    const vtx_t * lo = pv;
    const vtx_t * hi = pv + count;
    uint32_t first = 0;
    for(uint32_t r = 0; r < p->ring_count; r++) {
        uint32_t end = p->ring_ends[r];
        for(uint32_t k = first; k < end; k++) {
            uint32_t j = k + 1 < end ? k + 1 : first;
            /* The outward face of edge k→j is on its left in the plan's axes */
            float ex = (float)(p->pts[j].x - p->pts[k].x), ey = (float)(p->pts[j].y - p->pts[k].y);
            bool facing = ey * v->st - ex * v->ct > 0;
            uint32_t i = k > first ? k - 1 : end - 1;
            float px = (float)(p->pts[k].x - p->pts[i].x), py = (float)(p->pts[k].y - p->pts[i].y);
            bool prev_facing = py * v->st - px * v->ct > 0;
            if(faces) {
                if(facing) {
                    fill_tri(b, lo[k], lo[j], hi[j], side, opa, NULL);
                    fill_tri(b, lo[k], hi[j], hi[k], side, opa, NULL);
                }
            } else {
                draw_seg(b, hi[k], hi[j], edge, edge_opa);
                if(facing) draw_seg(b, lo[k], lo[j], edge, edge_opa);
                if(facing || prev_facing) draw_seg(b, lo[k], hi[k], edge, edge_opa);
            }
        }
        first = end;
    }
    if(faces && tops) {
        for(uint32_t t = 0; t < p->tri_count; t++) {
            const uint16_t * tri = &p->tris[t * 3];
            fill_tri(b, hi[tri[0]], hi[tri[1]], hi[tri[2]], top, opa, NULL);
        }
    }
}

static void draw_lines(const view_t * v, const band_t * b, const hs_pt_t * pts, uint32_t count, const int16_t * rows,
                       float h, uint16_t col, uint32_t opa)
{
    for(uint32_t i = 0; i < count; i++) {
        if(rows[2 * i + 1] < b->y0 || rows[2 * i] > b->y1) continue;
        vtx_t p = project(v, pts[2 * i].x, pts[2 * i].y, h);
        vtx_t q = project(v, pts[2 * i + 1].x, pts[2 * i + 1].y, h);
        draw_seg(b, p, q, col, opa);
    }
}

/* Adds the time since the last mark to a phase */
static void phase(view_t * v, int k)
{
    int64_t now = now_us();
    v->window_phase_us[k] += now - v->mark;
    v->mark = now;
}

static void draw_floor(view_t * v, const band_t * b, uint32_t i, uint32_t prism0, uint32_t device0)
{
    const hs_scene_t * sc = &house_scene;
    const hs_floor_t * f = &sc->floors[i];
    float base = i * v->spacing;
    const hs_prism_t * prisms = f->prisms;
    uint32_t n_prisms = f->prism_count;
#define IN_BAND(n) (v->prism_ymax[prism0 + (n)] >= b->y0 && v->prism_ymin[prism0 + (n)] <= b->y1)
#define VERTS(n) (&v->verts[v->prism_first[prism0 + (n)]])

    uint16_t sunk = color(HS_SURFACE_SUNK), surface = color(HS_SURFACE), poche = color(HS_POCHE);
    uint16_t strong = color(HS_LINE_STRONG), ink = color(HS_INK);

    /* The slab under the floor: just its sides, as the floor always covers its top */
    for(uint32_t n = 0; n < n_prisms; n++) {
        if(prisms[n].kind == HS_SLAB && IN_BAND(n)) draw_prism(v, b, &prisms[n], VERTS(n), sunk, sunk, 255, true, false, 0, 0);
    }

    phase(v, 1);

    /* The floor, room by room with its pools of light */
    float floor_h = base + FLOOR_LIFT;
    uint32_t glow_alpha = house_scene.colors[HS_LAMP_GLOW] >> 24;
    glow_t glows[MAX_GLOWS];
    int last_room = -1;
    shade_t shade = { v, glows, 0, floor_h, 1.0f / v->s, 1.0f / v->cp, color(HS_LAMP_GLOW) };
    uint16_t floor_col = color(HS_FLOOR);
    const vtx_t * sp = &v->surf[v->surf_first[i]];
    for(uint32_t t = 0; t < f->surface_tri_count; t++) {
        const uint16_t * tri = &f->surface_tris[t * 3];
        vtx_t a = sp[tri[0]], c = sp[tri[1]], d = sp[tri[2]];
        if(fmaxf(a.y, fmaxf(c.y, d.y)) < b->y0 || fminf(a.y, fminf(c.y, d.y)) > b->y1 + 1) continue;
        int room = f->surface_room[t];
        if(room != last_room) {
            last_room = room;
            shade.count = 0;
            for(uint32_t k = 0; k < f->device_count && shade.count < MAX_GLOWS; k++) {
                const hs_device_t * dev = &f->devices[k];
                float amount = v->shown[device0 + k];
                if(!dev->light || dev->room != room || amount <= 0) continue;
                amount = 1 - (1 - amount) * (1 - amount);
                float r = dev->glow_radius * amount;
                glow_t * l = &glows[shade.count++];
                l->x = dev->at.x;
                l->y = dev->at.y;
                l->inv_r2 = 1.0f / (r * r);
                l->opa = glow_alpha / 255.0f * dev->glow_opa / 255.0f * amount;
            }
        }
        fill_tri(b, a, c, d, floor_col, 255, shade.count ? &shade : NULL);
    }

    phase(v, 2);

    /* Walls */
    for(uint32_t n = 0; n < n_prisms; n++) {
        uint8_t k = prisms[n].kind;
        if((k == HS_WALL || k == HS_SILL) && IN_BAND(n)) draw_prism(v, b, &prisms[n], VERTS(n), poche, surface, 255, true, true, 0, 0);
    }

    phase(v, 3);

    /* What's drawn on the floor */
    float line_h = base + LINE_LIFT;
    const int16_t * rows = &v->seg_y[v->seg_first[i] * 2];
    draw_lines(v, b, f->furniture, f->furniture_count, rows, line_h, strong, 140);
    rows += f->furniture_count * 2;
    draw_lines(v, b, f->fine, f->fine_count, rows, line_h, strong, 255);
    rows += f->fine_count * 2;
    draw_lines(v, b, f->leaf, f->leaf_count, rows, line_h, poche, 255);

    phase(v, 4);

    /* Devices on the floor: a lit light is a filled dot, anything else a ring */
    for(uint32_t k = 0; k < f->device_count; k++) {
        const hs_device_t * dev = &f->devices[k];
        if(dev->wall || dev->whole_room) continue;
        bool lit = dev->light && v->shown[device0 + k] > 0.5f;
        float r = dev->light ? DOT_LIGHT : DOT_DEVICE;
        vtx_t mid = project(v, dev->at.x, dev->at.y, line_h);
        float reach = r * v->s + 2;
        if(mid.y + reach < b->y0 || mid.y - reach > b->y1 + 1) continue;
        vtx_t ring[DOT_SIDES];
        for(int s = 0; s < DOT_SIDES; s++) ring[s] = project(v, dev->at.x + r * dot_cos[s], dev->at.y + r * dot_sin[s], line_h);
        if(lit) {
            for(int s = 1; s + 1 < DOT_SIDES; s++) fill_tri(b, ring[0], ring[s], ring[s + 1], color(HS_LAMP), 255, NULL);
        }
        uint16_t edge = lit ? color(HS_LAMP_INK) : color(HS_INK_MUTED);
        for(int s = 0; s < DOT_SIDES; s++) draw_seg(b, ring[s], ring[(s + 1) % DOT_SIDES], edge, 255);
    }

    phase(v, 5);

    /* Edges, after every face, so a face never covers an edge in front of it */
    for(uint32_t n = 0; n < n_prisms; n++) {
        if(!IN_BAND(n)) continue;
        uint8_t k = prisms[n].kind;
        if(k == HS_SLAB) draw_prism(v, b, &prisms[n], VERTS(n), 0, 0, 0, false, false, strong, 204);
        else if(k != HS_STEP) draw_prism(v, b, &prisms[n], VERTS(n), 0, 0, 0, false, false, ink, 255);
    }

    phase(v, 6);

    /* The stair up, see-through, last */
    for(uint32_t n = 0; n < n_prisms; n++) {
        if(prisms[n].kind != HS_STEP || !IN_BAND(n)) continue;
        draw_prism(v, b, &prisms[n], VERTS(n), surface, surface, 140, true, true, 0, 0);
        draw_prism(v, b, &prisms[n], VERTS(n), 0, 0, 0, false, false, strong, 204);
    }
    phase(v, 7);
#undef IN_BAND
#undef VERTS
}

static bool ensure_strip(view_t * v, int32_t w, int32_t rows)
{
    if(v->pixels && w <= v->cap_w && rows <= v->cap_h) return true;
    if(v->pixels) {
        free(v->pixels);
        free(v->zbuf);
    }
    int32_t cap_w = w > v->cap_w ? w : v->cap_w;
    int32_t cap_h = rows > v->cap_h ? rows : v->cap_h;
    uint32_t size = (uint32_t)cap_w * cap_h * sizeof(uint16_t);
    v->pixels = malloc(size);
    v->zbuf = malloc(size);
    if(!v->pixels || !v->zbuf) {
        free(v->pixels);
        free(v->zbuf);
        v->pixels = v->zbuf = NULL;
        v->cap_w = v->cap_h = 0;
        return false;
    }
    v->cap_w = cap_w;
    v->cap_h = cap_h;
    lv_draw_buf_init(&v->strip, (uint32_t)cap_w, (uint32_t)cap_h, LV_COLOR_FORMAT_RGB565, (uint32_t)cap_w * 2, v->pixels, size);
    return true;
}

static bool intersect(lv_area_t * out, const lv_area_t * a, const lv_area_t * b)
{
    out->x1 = LV_MAX(a->x1, b->x1);
    out->y1 = LV_MAX(a->y1, b->y1);
    out->x2 = LV_MIN(a->x2, b->x2);
    out->y2 = LV_MIN(a->y2, b->y2);
    return out->x1 <= out->x2 && out->y1 <= out->y2;
}

/* Text in a box measured beforehand, given in the widget's own coordinates, if it reaches the band */
static void draw_text(lv_layer_t * layer, const lv_font_t * font, const char * text, lv_color_t col, lv_opa_t opa,
                      const lv_area_t * box, const lv_area_t * area, const lv_area_t * clip)
{
    lv_area_t a = { area->x1 + box->x1, area->y1 + box->y1, area->x1 + box->x2, area->y1 + box->y2 };
    lv_area_t hit;
    if(!intersect(&hit, &a, clip)) return;
    lv_draw_label_dsc_t d;
    lv_draw_label_dsc_init(&d);
    d.font = font;
    d.color = col;
    d.opa = opa;
    d.text = text;
    d.text_static = 1;
    lv_draw_label(layer, &d, &a);
}

static bool inside_tri(float x, float y, const vtx_t * a, const vtx_t * b, const vtx_t * c)
{
    float d1 = (x - b->x) * (a->y - b->y) - (a->x - b->x) * (y - b->y);
    float d2 = (x - c->x) * (b->y - c->y) - (b->x - c->x) * (y - c->y);
    float d3 = (x - a->x) * (c->y - a->y) - (c->x - a->x) * (y - a->y);
    bool neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
}

/* Whether a floor above `floor` covers this point on screen */
static bool covered(const view_t * v, uint32_t floor, float x, float y)
{
    const hs_scene_t * sc = &house_scene;
    uint32_t prism = 0;
    for(uint32_t i = 0; i < sc->floor_count; i++) {
        const hs_floor_t * f = &sc->floors[i];
        for(uint32_t n = 0; n < f->prism_count; n++, prism++) {
            const hs_prism_t * p = &f->prisms[n];
            if(i <= floor || p->kind != HS_SLAB) continue;
            const vtx_t * hi = &v->verts[v->prism_first[prism] + p->ring_ends[p->ring_count - 1]];
            for(uint32_t t = 0; t < p->tri_count; t++) {
                const uint16_t * tri = &p->tris[t * 3];
                if(inside_tri(x, y, &hi[tri[0]], &hi[tri[1]], &hi[tri[2]])) return true;
            }
        }
    }
    return false;
}

/*
 * Picks the room names to show this frame: the top floor's first, and none that a floor above covers or that would
 * run into a name already placed. Stacked, only the top floor's show.
 */
static void place_labels(view_t * v, const lv_font_t * font)
{
    const hs_scene_t * sc = &house_scene;
    v->label_count = 0;
    uint32_t lowest = v->explode > 0.5f ? 0 : sc->floor_count - 1;
    for(int32_t i = sc->floor_count - 1; i >= (int32_t)lowest; i--) {
        const hs_floor_t * f = &sc->floors[i];
        for(uint32_t r = 0; r < f->room_count; r++) {
            if(f->rooms[r].compact) continue;
            vtx_t p = project(v, f->rooms[r].tag.x, f->rooms[r].tag.y, i * v->spacing + FLOOR_LIFT);
            if(covered(v, (uint32_t)i, p.x, p.y)) continue;
            lv_point_t size;
            lv_text_get_size(&size, f->rooms[r].name, font, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
            int32_t x = (int32_t)p.x - size.x / 2, y = (int32_t)p.y - size.y / 2;
            lv_area_t a = { x, y, x + size.x - 1, y + size.y - 1 };
            if(a.x1 < 0 || a.y1 < 0 || a.x2 >= v->w || a.y2 >= v->h) continue;
            lv_area_t pad = { a.x1 - 3, a.y1 - 1, a.x2 + 3, a.y2 + 1 }, hit;
            bool clear = true;
            for(uint32_t k = 0; k < v->label_count && clear; k++) clear = !intersect(&hit, &pad, &v->labels[k].at);
            if(!clear) continue;
            v->labels[v->label_count].text = f->rooms[r].name;
            v->labels[v->label_count].at = a;
            v->label_count++;
        }
    }
}

static void draw_cb(lv_event_t * e)
{
    lv_obj_t * obj = lv_event_get_target_obj(e);
    lv_layer_t * layer = lv_event_get_layer(e);
    view_t * v = lv_event_get_user_data(e);
    const hs_scene_t * sc = &house_scene;

    lv_area_t area, clip;
    lv_obj_get_coords(obj, &area);
    if(!intersect(&clip, &area, &layer->_clip_area)) return;
    int32_t w = lv_area_get_width(&area), h = lv_area_get_height(&area);
    if(w < 8 || h < 8) return;

    int64_t t0 = now_us();
    if(v->stale || v->w != w || v->h != h) {
        v->w = w;
        v->h = h;
        project_all(v);
        const lv_font_t * font = lv_obj_get_style_text_font(obj, LV_PART_MAIN);
        place_labels(v, font);
        if(v->stats) {
            lv_snprintf(v->stats_text, sizeof(v->stats_text), "%d fps  %d.%d ms", (int)(v->out.fps + 0.5f),
                        (int)v->out.draw_ms, (int)(v->out.draw_ms * 10) % 10);
            lv_point_t size;
            lv_text_get_size(&size, v->stats_text, font, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
            lv_area_t at = { 6, 4, 6 + size.x - 1, 4 + size.y - 1 };
            v->stats_at = at;
        }
        v->stale = false;
        v->frames++;
        v->window_frames++;
        v->window_project_us += now_us() - t0;
    }
    int64_t t1 = now_us();

    band_t b;
    b.w = w;
    b.y0 = clip.y1 - area.y1;
    b.y1 = clip.y2 - area.y1;
    int32_t rows = b.y1 - b.y0 + 1;
    if(!ensure_strip(v, w, rows)) return;
    b.zb = v->zbuf;

    /*
     * When the band lies inside the view, the view told LVGL it covers it, so LVGL drew nothing under it and the view
     * is the first thing in the band. It draws straight into LVGL's buffer. Otherwise it draws into its own buffer and
     * hands that to LVGL as an image, over whatever is behind.
     */
    lv_draw_buf_t * dest = layer->draw_buf;
    bool direct = dest && dest->header.cf == LV_COLOR_FORMAT_RGB565 && clip.x1 == layer->_clip_area.x1 &&
                  clip.x2 == layer->_clip_area.x2 && clip.y1 == layer->_clip_area.y1 && clip.y2 == layer->_clip_area.y2;
    if(direct) {
        b.stride = (int32_t)(dest->header.stride / 2);
        b.px = (uint16_t *)(dest->data + (clip.y1 - layer->buf_area.y1) * (int32_t)dest->header.stride) +
               (area.x1 - layer->buf_area.x1);
        b.x0 = clip.x1 - area.x1;
        b.x1 = clip.x2 - area.x1;
    } else {
        b.stride = w;
        b.px = v->pixels;
        b.x0 = 0;
        b.x1 = w - 1;
    }

    v->mark = t1;
    uint16_t ground = color(HS_GROUND);
    for(int32_t y = 0; y < rows; y++) {
        uint16_t * row = b.px + y * b.stride;
        for(int32_t x = b.x0; x <= b.x1; x++) row[x] = ground;
    }

    memset(b.zb, 0, (size_t)w * rows * sizeof(uint16_t));
    phase(v, 0);
    uint32_t prism0 = 0, device0 = 0;
    float slice = Z_STEPS / sc->floor_count;
    for(uint32_t i = 0; i < sc->floor_count; i++) {
        b.zmin = v->zmin[i];
        b.zscale = v->zscale[i];
        b.zbase = 1 + i * slice;
        b.zspan = slice - 2;
        b.bias = (int32_t)(LINE_BIAS_MM * b.zscale) + 1;
        draw_floor(v, &b, i, prism0, device0);
        prism0 += sc->floors[i].prism_count;
        device0 += sc->floors[i].device_count;
    }
    v->window_draw_us += now_us() - t1;

    /* The band's pixels, then the names over them. LVGL's image caches are off, so it reads the buffer afresh. */
    if(!direct) {
        lv_draw_image_dsc_t img;
        lv_draw_image_dsc_init(&img);
        img.src = &v->strip;
        lv_area_t at = { area.x1, area.y1 + b.y0, area.x1 + v->cap_w - 1, area.y1 + b.y0 + v->cap_h - 1 };
        lv_draw_image(layer, &img, &at);
    }

    const lv_font_t * font = lv_obj_get_style_text_font(obj, LV_PART_MAIN);
    lv_color_t ink = lv_color_hex(sc->colors[HS_INK] & 0xffffff);
    for(uint32_t k = 0; k < v->label_count; k++) {
        const lv_area_t * a = &v->labels[k].at;
        draw_text(layer, font, v->labels[k].text, ink, LV_OPA_COVER, a, &area, &clip);
    }

    if(v->stats) {
        draw_text(layer, font, v->stats_text, lv_color_hex(sc->colors[HS_INK_MUTED] & 0xffffff), LV_OPA_COVER,
                  &v->stats_at, &area, &clip);
    }
    v->window_callback_us += now_us() - t0;
}

/*
 * The view paints every pixel it covers, so LVGL can skip whatever is under it. LVGL starts the check at "covers",
 * and its base object would turn that down for a widget with no background, so this answers before it does.
 */
static void cover_cb(lv_event_t * e)
{
    lv_event_stop_processing(e);
}

/* Animation and input */

static void tick_cb(lv_timer_t * t)
{
    lv_obj_t * obj = lv_timer_get_user_data(t);
    view_t * v = lv_obj_get_user_data(obj);
    const hs_scene_t * sc = &house_scene;
    int64_t now = now_us();
    float dt = lv_tick_elaps(v->last_tick) / 1000.0f;
    v->last_tick = lv_tick_get();
    if(dt > 0.05f) dt = 0.05f;
    bool moving = false;

    if(v->spin != 0 && !v->dragging) {
        v->theta += v->spin * dt;
        moving = true;
    }
    if(!v->dragging && (fabsf(v->v_theta) > 1e-4f || fabsf(v->v_phi) > 1e-4f)) {
        float keep = powf(1 - DAMPING, dt * 60);
        v->theta += v->v_theta * dt;
        v->phi = fminf(PHI_MAX, fmaxf(PHI_MIN, v->phi + v->v_phi * dt));
        v->v_theta *= keep;
        v->v_phi *= keep;
        moving = true;
    }
    if(fabsf(v->explode - v->explode_to) > 0.002f) {
        v->explode += (v->explode_to - v->explode) * (1 - powf(0.0025f, dt));
        moving = true;
    } else v->explode = v->explode_to;

    uint32_t d = 0;
    for(uint32_t i = 0; i < sc->floor_count; i++) {
        const hs_floor_t * f = &sc->floors[i];
        for(uint32_t k = 0; k < f->device_count; k++, d++) {
            if(!f->devices[k].light) continue;
            float to = v->lights && f->devices[k].on ? 1.0f : 0.0f;
            float from = v->shown[d];
            if(from == to) continue;
            v->shown[d] = to > from ? fminf(1, from + dt / LIGHT_ON_S) : fmaxf(0, from - dt / LIGHT_OFF_S);
            moving = true;
        }
    }

    /* Stats, a second at a time */
    if(now - v->window_start >= 1000000) {
        float secs = (now - v->window_start) / 1e6f;
        uint32_t n = v->window_frames ? v->window_frames : 1;
        v->out.fps = v->window_frames / secs;
        v->out.project_ms = v->window_project_us / 1000.0f / n;
        v->out.draw_ms = v->window_draw_us / 1000.0f / n;
        v->out.callback_ms = v->window_callback_us / 1000.0f / n;
        v->window_callback_us = 0;
        for(int k = 0; k < HOUSE_VIEW_PHASES; k++) {
            v->out.phase_ms[k] = v->window_phase_us[k] / 1000.0f / n;
            v->window_phase_us[k] = 0;
        }
        v->out.frames = v->frames;
        v->window_start = now;
        v->window_frames = 0;
        v->window_project_us = v->window_draw_us = 0;
        if(v->stats) moving = true;
    }

    if(moving) {
        v->stale = true;
        lv_obj_invalidate(obj);
    }
}

static void input_cb(lv_event_t * e)
{
    lv_obj_t * obj = lv_event_get_target_obj(e);
    view_t * v = lv_event_get_user_data(e);
    lv_event_code_t code = lv_event_get_code(e);
    if(code == LV_EVENT_PRESSED) {
        v->dragging = true;
        v->v_theta = v->v_phi = 0;
        v->last_drag = lv_tick_get();
    } else if(code == LV_EVENT_PRESSING) {
        lv_point_t d;
        lv_indev_get_vect(lv_indev_active(), &d);
        if(!d.x && !d.y) return;
        float k = DRAG_RATE / (v->h > 0 ? v->h : 320);
        float dtheta = -d.x * k, dphi = -d.y * k;
        v->theta += dtheta;
        v->phi = fminf(PHI_MAX, fmaxf(PHI_MIN, v->phi + dphi));
        /* Carried on when let go, at the rate it was turning */
        float dt = lv_tick_elaps(v->last_drag) / 1000.0f;
        v->last_drag = lv_tick_get();
        if(dt > 0.001f && dt < 0.2f) {
            v->v_theta = dtheta / dt;
            v->v_phi = dphi / dt;
        }
        v->stale = true;
        lv_obj_invalidate(obj);
    } else if(code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) {
        v->dragging = false;
    }
}

static void delete_cb(lv_event_t * e)
{
    view_t * v = lv_event_get_user_data(e);
    lv_timer_delete(v->timer);
    free(v->pixels);
    free(v->zbuf);
    free(v->verts);
    free(v->prism_first);
    free(v->prism_ymin);
    free(v->prism_ymax);
    free(v->shown);
    free(v->labels);
    free(v->surf);
    free(v->seg_y);
    free(v);
}

lv_obj_t * ui_widget_house_view_create(lv_obj_t * parent)
{
    const hs_scene_t * sc = &house_scene;
    LV_ASSERT(sc->floor_count <= MAX_FLOORS);
    glow_lut_init();
    dot_init();

    lv_obj_t * obj = lv_obj_create(parent);
    lv_obj_remove_style_all(obj);
    lv_obj_set_clickable(obj, true);
    lv_obj_set_scrollable(obj, false);
    lv_obj_set_scroll_chain(obj, false);
    lv_obj_set_gesture_bubble(obj, false);

    view_t * v = calloc(1, sizeof(view_t));
    LV_ASSERT_MALLOC(v);
    v->phi = PHI_START;
    v->theta = THETA_START;
    v->lights = true;
    v->stale = true;

    uint32_t prisms = 0, verts = 0, devices = 0, rooms = 0, surf = 0, segs = 0;
    for(uint32_t i = 0; i < sc->floor_count; i++) {
        const hs_floor_t * f = &sc->floors[i];
        prisms += f->prism_count;
        devices += f->device_count;
        rooms += f->room_count;
        /* Room for every surface point the triangles use */
        v->surf_first[i] = surf;
        uint32_t points = 0;
        for(uint32_t t = 0; t < f->surface_tri_count * 3u; t++) {
            if(f->surface_tris[t] + 1u > points) points = f->surface_tris[t] + 1u;
        }
        surf += points;
        v->seg_first[i] = segs;
        segs += f->furniture_count + f->fine_count + f->leaf_count;
        for(uint32_t n = 0; n < sc->floors[i].prism_count; n++) {
            const hs_prism_t * p = &sc->floors[i].prisms[n];
            verts += 2 * p->ring_ends[p->ring_count - 1];
        }
    }
    v->verts = malloc(verts * sizeof(vtx_t));
    v->prism_first = malloc(prisms * sizeof(uint32_t));
    v->prism_ymin = malloc(prisms * sizeof(int16_t));
    v->prism_ymax = malloc(prisms * sizeof(int16_t));
    v->shown = calloc(devices ? devices : 1, sizeof(float));
    v->surf_first[sc->floor_count] = surf;
    v->labels = malloc((rooms ? rooms : 1) * sizeof(label_t));
    v->surf = malloc((surf ? surf : 1) * sizeof(vtx_t));
    v->seg_y = malloc((segs ? segs : 1) * 2 * sizeof(int16_t));
    LV_ASSERT_MALLOC(v->verts && v->prism_first && v->prism_ymin && v->prism_ymax && v->shown && v->labels && v->surf &&
                     v->seg_y);
    v->memory = sizeof(view_t) + verts * sizeof(vtx_t) + prisms * (sizeof(uint32_t) + 2 * sizeof(int16_t)) +
                devices * sizeof(float) + rooms * sizeof(label_t) + surf * sizeof(vtx_t) + segs * 2 * sizeof(int16_t);

    uint32_t at = 0, g = 0, d = 0;
    for(uint32_t i = 0; i < sc->floor_count; i++) {
        const hs_floor_t * f = &sc->floors[i];
        for(uint32_t n = 0; n < f->prism_count; n++, g++) {
            v->prism_first[g] = at;
            at += 2 * f->prisms[n].ring_ends[f->prisms[n].ring_count - 1];
        }
        for(uint32_t k = 0; k < f->device_count; k++, d++) v->shown[d] = f->devices[k].light && f->devices[k].on ? 1.0f : 0.0f;
    }

    lv_obj_add_event_cb(obj, draw_cb, LV_EVENT_DRAW_MAIN, v);
    lv_obj_add_event_cb(obj, cover_cb, LV_EVENT_COVER_CHECK | LV_EVENT_PREPROCESS, v);
    lv_obj_add_event_cb(obj, input_cb, LV_EVENT_PRESSED, v);
    lv_obj_add_event_cb(obj, input_cb, LV_EVENT_PRESSING, v);
    lv_obj_add_event_cb(obj, input_cb, LV_EVENT_RELEASED, v);
    lv_obj_add_event_cb(obj, input_cb, LV_EVENT_PRESS_LOST, v);
    lv_obj_add_event_cb(obj, delete_cb, LV_EVENT_DELETE, v);
    lv_obj_set_user_data(obj, v);
    v->last_tick = lv_tick_get();
    v->window_start = now_us();
    v->timer = lv_timer_create(tick_cb, TICK_MS, obj);
    return obj;
}

void ui_widget_house_view_set_explode(lv_obj_t * obj, bool value)
{
    view_t * v = lv_obj_get_user_data(obj);
    v->explode_to = value ? 1.0f : 0.0f;
}

void ui_widget_house_view_set_spin(lv_obj_t * obj, int16_t value)
{
    view_t * v = lv_obj_get_user_data(obj);
    v->spin = value * PI_F / 180.0f;
}

void ui_widget_house_view_set_lights(lv_obj_t * obj, bool value)
{
    view_t * v = lv_obj_get_user_data(obj);
    v->lights = value;
}

void ui_widget_house_view_set_stats(lv_obj_t * obj, bool value)
{
    view_t * v = lv_obj_get_user_data(obj);
    if(v->stats == value) return;
    v->stats = value;
    lv_obj_invalidate(obj);
}

void house_view_get_stats(lv_obj_t * obj, house_view_stats_t * out)
{
    view_t * v = lv_obj_get_user_data(obj);
    *out = v->out;
    out->memory = v->memory + (uint32_t)v->cap_w * v->cap_h * 4;
}
