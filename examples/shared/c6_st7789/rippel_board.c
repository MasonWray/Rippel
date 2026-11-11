/*
 * Waveshare ESP32-C6-DEV-KIT-N8 and the Waveshare 1.9" LCD module, using
 * ESP-IDF's built-in ST7789 driver. All six signals are on one header.
 *
 *   LCD   C6
 *   VCC   3V3
 *   GND   GND
 *   CLK   GPIO18
 *   DIN   GPIO19
 *   CS    GPIO20
 *   DC    GPIO21
 *   RST   GPIO22
 *   BL    GPIO23
 */
#include "rippel_board.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"

#define LCD_WIDTH  170
#define LCD_HEIGHT 320
#define LCD_SPI_HZ (40 * 1000 * 1000)

#define PIN_SCK  GPIO_NUM_18
#define PIN_MOSI GPIO_NUM_19
#define PIN_CS   GPIO_NUM_20
#define PIN_DC   GPIO_NUM_21
#define PIN_RST  GPIO_NUM_22
#define PIN_BL   GPIO_NUM_23

/* The ST7789 controller has 240 columns of memory, and this 170-pixel panel sits in the middle of them. */
#define LCD_X_GAP 35

#define DRAW_BUF_LINES 40

static const char * TAG = "board";
static esp_lcd_panel_handle_t panel;

static bool on_flush_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t * event, void * user)
{
    LV_UNUSED(io);
    LV_UNUSED(event);
    lv_display_flush_ready((lv_display_t *)user);
    return false;
}

static void flush_cb(lv_display_t * disp, const lv_area_t * area, uint8_t * px_map)
{
    LV_UNUSED(disp);
    /* The panel wants big-endian RGB565. */
    lv_draw_sw_rgb565_swap(px_map, lv_area_get_size(area));
    esp_lcd_panel_draw_bitmap(panel, area->x1, area->y1, area->x2 + 1, area->y2 + 1, px_map);
}

lv_display_t * board_create_display(void)
{
    size_t buf_size = LCD_WIDTH * DRAW_BUF_LINES * sizeof(uint16_t);

    spi_bus_config_t bus = {
        .sclk_io_num = PIN_SCK,
        .mosi_io_num = PIN_MOSI,
        .miso_io_num = GPIO_NUM_NC,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = (int)buf_size,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));

    lv_display_t * disp = lv_display_create(LCD_WIDTH, LCD_HEIGHT);

    esp_lcd_panel_io_handle_t io;
    esp_lcd_panel_io_spi_config_t io_config = {
        .dc_gpio_num = PIN_DC,
        .cs_gpio_num = PIN_CS,
        .pclk_hz = LCD_SPI_HZ,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
        .spi_mode = 0,
        .trans_queue_depth = 10,
        .on_color_trans_done = on_flush_done,
        .user_ctx = disp,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI2_HOST, &io_config, &io));

    esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = PIN_RST,
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(io, &panel_config, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    /* IPS panels like this one show inverted colors unless the controller inverts them back. */
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, true));
    ESP_ERROR_CHECK(esp_lcd_panel_set_gap(panel, LCD_X_GAP, 0));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));

    gpio_config_t backlight = { .pin_bit_mask = 1ULL << PIN_BL, .mode = GPIO_MODE_OUTPUT };
    ESP_ERROR_CHECK(gpio_config(&backlight));
    gpio_set_level(PIN_BL, 1);

    void * buf = heap_caps_malloc(buf_size, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    ESP_RETURN_ON_FALSE(buf, NULL, TAG, "No DMA memory for the draw buffer");
    lv_display_set_color_format(disp, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(disp, buf, NULL, buf_size, LV_DISPLAY_RENDER_MODE_PARTIAL);
    lv_display_set_flush_cb(disp, flush_cb);
    return disp;
}

void board_create_input(lv_display_t * disp)
{
    LV_UNUSED(disp);
}
