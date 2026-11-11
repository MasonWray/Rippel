/*
 * 4-wire resistive touch: the panel is two resistive sheets. Driving one sheet
 * end to end makes a voltage divider, and the other sheet reads the position.
 */
#include "touch.h"
#include "board.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_rom_sys.h"

#define SAMPLES 8

static adc_oneshot_unit_handle_t adc;

static void pin_float(gpio_num_t pin)
{
    gpio_set_direction(pin, GPIO_MODE_INPUT);
    gpio_set_pull_mode(pin, GPIO_FLOATING);
}

static void pin_drive(gpio_num_t pin, int level)
{
    gpio_set_pull_mode(pin, GPIO_FLOATING);
    gpio_set_direction(pin, GPIO_MODE_OUTPUT);
    gpio_set_level(pin, level);
}

static int read_adc(adc_channel_t channel)
{
    adc_oneshot_chan_cfg_t config = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12 };
    adc_oneshot_config_channel(adc, channel, &config);
    esp_rom_delay_us(20);
    int sum = 0;
    for(int i = 0; i < SAMPLES; i++) {
        int raw = 0;
        adc_oneshot_read(adc, channel, &raw);
        sum += raw;
    }
    return sum / SAMPLES;
}

/* With X- pulled low and Y+ pulled up, Y+ only reads low if the sheets are touching. */
static bool is_pressed(void)
{
    pin_float(BOARD_PIN_XP);
    pin_float(BOARD_PIN_YM);
    pin_drive(BOARD_PIN_XM, 0);
    gpio_set_direction(BOARD_PIN_YP, GPIO_MODE_INPUT);
    gpio_set_pull_mode(BOARD_PIN_YP, GPIO_PULLUP_ONLY);
    esp_rom_delay_us(100);
    return gpio_get_level(BOARD_PIN_YP) == 0;
}

static int scale(int raw, int min, int max, int size)
{
    int v = (raw - min) * (size - 1) / (max - min);
    return v < 0 ? 0 : v >= size ? size - 1 : v;
}

static void read_cb(lv_indev_t * indev, lv_indev_data_t * data)
{
    LV_UNUSED(indev);
    if(!is_pressed()) {
        data->state = LV_INDEV_STATE_RELEASED;
        return;
    }

    /* The panel is mounted in landscape, so its X sheet runs along the screen's Y axis. */
    pin_float(BOARD_PIN_YM);
    pin_float(BOARD_PIN_YP);
    pin_drive(BOARD_PIN_XP, 1);
    pin_drive(BOARD_PIN_XM, 0);
    int raw_y = read_adc(BOARD_ADC_YP);

    /* And its Y sheet along the screen's X axis. */
    pin_float(BOARD_PIN_XM);
    pin_float(BOARD_PIN_XP);
    pin_drive(BOARD_PIN_YP, 1);
    pin_drive(BOARD_PIN_YM, 0);
    int raw_x = read_adc(BOARD_ADC_XP);

    /* A finger lifting mid-read gives a junk position, so check again. */
    if(!is_pressed()) {
        data->state = LV_INDEV_STATE_RELEASED;
        return;
    }

    data->point.x = scale(raw_x, BOARD_TOUCH_X_MIN, BOARD_TOUCH_X_MAX, BOARD_LCD_WIDTH);
    data->point.y = scale(raw_y, BOARD_TOUCH_Y_MIN, BOARD_TOUCH_Y_MAX, BOARD_LCD_HEIGHT);
    data->state = LV_INDEV_STATE_PRESSED;
}

void touch_create_indev(lv_display_t * disp)
{
    adc_oneshot_unit_init_cfg_t unit = { .unit_id = ADC_UNIT_1 };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit, &adc));

    gpio_num_t pins[] = { BOARD_PIN_XP, BOARD_PIN_XM, BOARD_PIN_YP, BOARD_PIN_YM };
    for(size_t i = 0; i < sizeof(pins) / sizeof(pins[0]); i++) gpio_reset_pin(pins[i]);

    lv_indev_t * indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_display(indev, disp);
    lv_indev_set_read_cb(indev, read_cb);
}
