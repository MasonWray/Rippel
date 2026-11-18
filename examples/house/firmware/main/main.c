/*
 * Firmware for the house view example. It starts the UI, and with BENCHMARK set it spins the house, shows the frame
 * rate on screen and logs what each frame costs: working out where everything lands, drawing it, and the whole
 * refresh, which adds LVGL copying the pixels and sending them to the display over SPI.
 */
#include <stdint.h>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "house_view.h"
#include "rippel_board.h"
#include "ui.h"

#define BENCHMARK 1
#define LOG_PERIOD_MS 2000

static const char * TAG = "house";

static int64_t refresh_start;
static int64_t refresh_us;
static uint32_t refreshes;
/* Time LVGL spends waiting for the display to take the last band */
static int64_t wait_start;
static int64_t wait_us;
/* Time inside the board's flush, which waits for the band before to finish sending */
static int64_t flush_start;
static int64_t flush_us;

static uint32_t tick_ms(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000);
}

static void refresh_cb(lv_event_t * e)
{
    int64_t now = esp_timer_get_time();
    switch(lv_event_get_code(e)) {
        case LV_EVENT_REFR_START: refresh_start = now; break;
        case LV_EVENT_REFR_READY:
            refresh_us += now - refresh_start;
            refreshes++;
            break;
        case LV_EVENT_FLUSH_WAIT_START: wait_start = now; break;
        case LV_EVENT_FLUSH_WAIT_FINISH: wait_us += now - wait_start; break;
        case LV_EVENT_FLUSH_START: flush_start = now; break;
        case LV_EVENT_FLUSH_FINISH: flush_us += now - flush_start; break;
        default: break;
    }
}

static void log_stats(void)
{
    house_view_stats_t s;
    house_view_get_stats(ui_obj(UI_OBJ_HOUSE), &s);
    lv_mem_monitor_t mem;
    lv_mem_monitor(&mem);
    ESP_LOGI(TAG, "%.1f fps | project %.2f ms, draw %.2f ms, view in all %.1f ms, whole refresh %.1f ms, waiting for the display %.1f + %.1f ms | view %u KB, LVGL %u KB, free %u KB",
             s.fps, s.project_ms, s.draw_ms, s.callback_ms, refreshes ? refresh_us / 1000.0f / refreshes : 0.0f,
             refreshes ? wait_us / 1000.0f / refreshes : 0.0f, refreshes ? flush_us / 1000.0f / refreshes : 0.0f,
             (unsigned)(s.memory / 1024), (unsigned)((mem.total_size - mem.free_size) / 1024),
             (unsigned)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024));
    ESP_LOGI(TAG, "  clear %.1f, slab %.1f, floor %.1f, walls %.1f, lines %.1f, dots %.1f, edges %.1f, stair %.1f ms",
             s.phase_ms[0], s.phase_ms[1], s.phase_ms[2], s.phase_ms[3], s.phase_ms[4], s.phase_ms[5], s.phase_ms[6],
             s.phase_ms[7]);
    refresh_us = 0;
    wait_us = 0;
    flush_us = 0;
    refreshes = 0;
}

void app_main(void)
{
    lv_init();
    lv_tick_set_cb(tick_ms);

    lv_display_t * disp = board_create_display();
    board_create_input(disp);
    lv_display_add_event_cb(disp, refresh_cb, LV_EVENT_REFR_START, NULL);
    lv_display_add_event_cb(disp, refresh_cb, LV_EVENT_REFR_READY, NULL);
    lv_display_add_event_cb(disp, refresh_cb, LV_EVENT_FLUSH_WAIT_START, NULL);
    lv_display_add_event_cb(disp, refresh_cb, LV_EVENT_FLUSH_WAIT_FINISH, NULL);
    lv_display_add_event_cb(disp, refresh_cb, LV_EVENT_FLUSH_START, NULL);
    lv_display_add_event_cb(disp, refresh_cb, LV_EVENT_FLUSH_FINISH, NULL);

    ui_init(disp);
    ui_set_benchmark(BENCHMARK);

    uint32_t last_log = tick_ms();
    while(true) {
        uint32_t wait = lv_timer_handler();
        if(BENCHMARK && lv_tick_elaps(last_log) >= LOG_PERIOD_MS) {
            last_log = tick_ms();
            log_stats();
        }
        vTaskDelay(pdMS_TO_TICKS(LV_CLAMP(1, wait, 10)));
    }
}
