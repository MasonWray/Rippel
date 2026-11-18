/*
 * A house as the house view draws it: each floor's surfaces, slab, walls and stair as plain polygons, in whole mm in
 * the plan's axes (x right, y down), centered on the house. house_scene.c holds one, made by scripts/scene-to-c.mjs
 * from a scene ArkViz exports.
 */
#ifndef HOUSE_SCENE_H
#define HOUSE_SCENE_H

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    int16_t x;
    int16_t y;
} hs_pt_t;

enum { HS_SLAB, HS_WALL, HS_SILL, HS_STEP };

/*
 * A solid stood up from a polygon. Its rings are its outline, wound to positive area, then its holes, wound the other
 * way, so every edge's outward face is on its left in the plan's axes. `tris` triangulates its top.
 */
typedef struct {
    const hs_pt_t * pts;
    /* Where each ring ends in `pts` */
    const uint16_t * ring_ends;
    const uint16_t * tris;
    uint16_t tri_count;
    uint8_t ring_count;
    uint8_t kind;
    /* For a step, which one it is from the bottom */
    uint8_t step;
} hs_prism_t;

typedef struct {
    const char * name;
    hs_pt_t tag;
    bool compact;
} hs_room_t;

typedef struct {
    hs_pt_t at;
    /* Index into the floor's rooms, or -1 */
    int8_t room;
    uint8_t light : 1;
    uint8_t on : 1;
    uint8_t wall : 1;
    uint8_t whole_room : 1;
    /* 0-100 */
    uint8_t level;
    /* A light's pool, in mm, and its strength, 0-255 */
    uint16_t glow_radius;
    uint8_t glow_opa;
} hs_device_t;

typedef struct {
    const char * name;
    const char * sheet;
    const hs_room_t * rooms;
    uint16_t room_count;
    /* The floor itself, rooms less the stair wells, triangulated. `surface_room` gives each triangle's room. */
    const hs_pt_t * surface_pts;
    const uint16_t * surface_tris;
    const uint8_t * surface_room;
    uint16_t surface_tri_count;
    const hs_prism_t * prisms;
    uint16_t prism_count;
    /* Steps in the stair up, which sets how far each rises as the floors pull apart */
    uint16_t steps;
    /* Lines on the floor, as pairs of points */
    const hs_pt_t * furniture;
    uint16_t furniture_count;
    const hs_pt_t * fine;
    uint16_t fine_count;
    const hs_pt_t * leaf;
    uint16_t leaf_count;
    const hs_device_t * devices;
    uint16_t device_count;
} hs_floor_t;

enum {
    HS_GROUND, HS_SURFACE, HS_SURFACE_SUNK, HS_LINE_STRONG, HS_INK, HS_INK_MUTED, HS_POCHE, HS_FLOOR, HS_LAMP,
    HS_LAMP_GLOW, HS_LAMP_INK, HS_COLOR_COUNT
};

typedef struct {
    const hs_floor_t * floors;
    uint8_t floor_count;
    /* The larger of the house's width and depth */
    int32_t span;
    /* Floor to floor, extra separation when exploded, wall cut, window sill, slab and stair tread, all in mm */
    int32_t level, gap, cut, sill, slab, step;
    /* 0xAARRGGBB */
    uint32_t colors[HS_COLOR_COUNT];
} hs_scene_t;

extern const hs_scene_t house_scene;

#endif
