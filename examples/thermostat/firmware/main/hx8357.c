/* Driver for the HX8357D panel over SPI, using ESP-IDF's panel IO and DMA. */
#include "hx8357.h"
#include "board.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#define CMD_SLPOUT 0x11
#define CMD_DISPON 0x29
#define CMD_CASET  0x2A
#define CMD_PASET  0x2B
#define CMD_RAMWR  0x2C
#define CMD_MADCTL 0x36
#define CMD_COLMOD 0x3A

#define MADCTL_MY 0x80
#define MADCTL_MV 0x20

/* 32 lines at a time. LVGL redraws dirty areas in strips of this size. */
#define DRAW_BUF_LINES 32

static const char * TAG = "hx8357";
static esp_lcd_panel_io_handle_t io;

typedef struct {
    uint8_t cmd;
    uint8_t len;
    uint8_t data[34];
} init_cmd_t;

static const init_cmd_t init_cmds[] = {
    { 0xB9, 3, { 0xFF, 0x83, 0x57 } },             /* enable extended commands */
    { 0xB3, 4, { 0x80, 0x00, 0x06, 0x06 } },       /* RGB interface */
    { 0xB6, 1, { 0x25 } },                         /* VCOM */
    { 0xB0, 1, { 0x68 } },                         /* oscillator */
    { 0xCC, 1, { 0x05 } },                         /* panel */
    { 0xB1, 6, { 0x00, 0x15, 0x1C, 0x1C, 0x83, 0xAA } }, /* power */
    { 0xC0, 6, { 0x50, 0x50, 0x01, 0x3C, 0x1E, 0x08 } }, /* source circuit */
    { 0xB4, 7, { 0x02, 0x40, 0x00, 0x2A, 0x2A, 0x0D, 0x78 } }, /* display cycle */
    { 0xE0, 34, { 0x02, 0x0A, 0x11, 0x1D, 0x23, 0x35, 0x41, 0x4B, 0x4B, 0x42, 0x3A, 0x27,
                  0x1B, 0x08, 0x09, 0x03, 0x02, 0x0A, 0x11, 0x1D, 0x23, 0x35, 0x41, 0x4B,
                  0x4B, 0x42, 0x3A, 0x27, 0x1B, 0x08, 0x09, 0x03, 0x00, 0x01 } }, /* gamma */
    { CMD_COLMOD, 1, { 0x55 } },                   /* 16 bits per pixel */
    { CMD_MADCTL, 1, { MADCTL_MV | MADCTL_MY } },  /* landscape */
};

static bool on_flush_done(esp_lcd_panel_io_handle_t handle, esp_lcd_panel_io_event_data_t * event, void * user)
{
    LV_UNUSED(handle);
    LV_UNUSED(event);
    lv_display_flush_ready((lv_display_t *)user);
    return false;
}

static void flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    LV_UNUSED(disp);
    /* The panel wants big-endian RGB565. */
    lv_draw_sw_rgb565_swap(px_map, lv_area_get_size(area));

    uint8_t column[4] = { area->x1 >> 8, area->x1 & 0xFF, area->x2 >> 8, area->x2 & 0xFF };
    uint8_t page[4] = { area->y1 >> 8, area->y1 & 0xFF, area->y2 >> 8, area->y2 & 0xFF };
    esp_lcd_panel_io_tx_param(io, CMD_CASET, column, sizeof(column));
    esp_lcd_panel_io_tx_param(io, CMD_PASET, page, sizeof(page));
    esp_lcd_panel_io_tx_color(io, CMD_RAMWR, px_map, lv_area_get_size(area) * 2);
}

static void panel_reset(void)
{
    gpio_config_t rst = { .pin_bit_mask = 1ULL << BOARD_PIN_RST, .mode = GPIO_MODE_OUTPUT };
    ESP_ERROR_CHECK(gpio_config(&rst));
    gpio_set_level(BOARD_PIN_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(20));
    gpio_set_level(BOARD_PIN_RST, 1);
    vTaskDelay(pdMS_TO_TICKS(150));
}

lv_display_t * hx8357_create_display(void)
{
    size_t buf_size = BOARD_LCD_WIDTH * DRAW_BUF_LINES * sizeof(uint16_t);

    spi_bus_config_t bus = {
        .sclk_io_num = BOARD_PIN_SCK,
        .mosi_io_num = BOARD_PIN_MOSI,
        .miso_io_num = GPIO_NUM_NC,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = (int)buf_size,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));

    panel_reset();

    lv_display_t * disp = lv_display_create(BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT);

    esp_lcd_panel_io_spi_config_t io_config = {
        .dc_gpio_num = BOARD_PIN_DC,
        .cs_gpio_num = BOARD_PIN_CS,
        .pclk_hz = BOARD_LCD_SPI_HZ,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
        .spi_mode = 0,
        .trans_queue_depth = 10,
        .on_color_trans_done = on_flush_done,
        .user_ctx = disp,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI2_HOST, &io_config, &io));

    for(size_t i = 0; i < sizeof(init_cmds) / sizeof(init_cmds[0]); i++) {
        ESP_ERROR_CHECK(esp_lcd_panel_io_tx_param(io, init_cmds[i].cmd, init_cmds[i].data, init_cmds[i].len));
    }
    ESP_ERROR_CHECK(esp_lcd_panel_io_tx_param(io, CMD_SLPOUT, NULL, 0));
    vTaskDelay(pdMS_TO_TICKS(150));
    ESP_ERROR_CHECK(esp_lcd_panel_io_tx_param(io, CMD_DISPON, NULL, 0));
    vTaskDelay(pdMS_TO_TICKS(50));

    void * buf = heap_caps_malloc(buf_size, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    ESP_RETURN_ON_FALSE(buf, NULL, TAG, "No DMA memory for the draw buffer");
    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(disp, buf, NULL, buf_size, LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, flush_cb);
    return disp;
}
