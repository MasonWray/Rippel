/**
 * LVGL configuration for the Rippel browser simulator (WASM).
 *
 * This build is a superset: every widget and every supported color format is
 * enabled, and resolution, color format and DPI are set at startup. It is not
 * the configuration used on devices. Device builds get an lv_conf.h generated
 * from rippel.config.ts.
 */
#ifndef LV_CONF_H
#define LV_CONF_H

/* Default color format. Each display's actual format is set at runtime. */
#define LV_COLOR_FORMAT_DEFAULT LV_COLOR_FORMAT_RGB565

/* Use LVGL's own allocator so the simulator can report LVGL heap usage. */
#define LV_USE_STDLIB_MALLOC  LV_STDLIB_BUILTIN
#define LV_USE_STDLIB_STRING  LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF LV_STDLIB_CLIB
#define LV_MEM_SIZE (4 * 1024 * 1024)

#define LV_USE_OS LV_OS_NONE

/* Color formats the simulator can emulate. */
#define LV_DRAW_SW_SUPPORT_RGB565   1
#define LV_DRAW_SW_SUPPORT_RGB888   1
#define LV_DRAW_SW_SUPPORT_XRGB8888 1
#define LV_DRAW_SW_SUPPORT_ARGB8888 1

/* Send LVGL warnings to the browser console. */
#define LV_USE_LOG    1
#define LV_LOG_LEVEL  LV_LOG_LEVEL_WARN
#define LV_LOG_PRINTF 1

/* Fonts converted by lv_font_conv are loaded from memory at runtime. */
#define LV_USE_FS_MEMFS    1
#define LV_FS_MEMFS_LETTER 'M'

/* Built-in Montserrat sizes available as `font-family: montserrat`. */
#define LV_FONT_MONTSERRAT_10 1
#define LV_FONT_MONTSERRAT_12 1
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_MONTSERRAT_18 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_22 1
#define LV_FONT_MONTSERRAT_24 1
#define LV_FONT_MONTSERRAT_26 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_MONTSERRAT_30 1
#define LV_FONT_MONTSERRAT_32 1
#define LV_FONT_MONTSERRAT_36 1
#define LV_FONT_MONTSERRAT_40 1
#define LV_FONT_MONTSERRAT_48 1
#define LV_FONT_DEFAULT &lv_font_montserrat_14

#define LV_USE_THEME_DEFAULT 1

#endif /* LV_CONF_H */
