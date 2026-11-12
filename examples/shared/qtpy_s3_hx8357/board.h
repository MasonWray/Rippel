/* Wiring for an Adafruit QT Py ESP32-S3 and the Adafruit 3.5" 480x320 TFT breakout (SPI mode). */
#ifndef BOARD_H
#define BOARD_H

#include "driver/gpio.h"
#include "hal/adc_types.h"

#define BOARD_LCD_WIDTH  480
#define BOARD_LCD_HEIGHT 320

/* Start here. If the picture is clean, it can usually go higher. A project can set its own. */
#ifndef BOARD_LCD_SPI_HZ
#define BOARD_LCD_SPI_HZ (20 * 1000 * 1000)
#endif

#define BOARD_PIN_SCK  GPIO_NUM_36 /* SCK */
#define BOARD_PIN_MOSI GPIO_NUM_35 /* MO */
#define BOARD_PIN_CS   GPIO_NUM_18 /* A0 */
#define BOARD_PIN_DC   GPIO_NUM_17 /* A1 */
#define BOARD_PIN_RST  GPIO_NUM_5  /* TX */

/* 4-wire resistive touch. X+ and Y+ need ADC pins. */
#define BOARD_PIN_XP GPIO_NUM_9 /* A2 */
#define BOARD_PIN_YP GPIO_NUM_8 /* A3 */
#define BOARD_PIN_XM GPIO_NUM_7 /* SDA */
#define BOARD_PIN_YM GPIO_NUM_6 /* SCL */
#define BOARD_ADC_XP ADC_CHANNEL_8
#define BOARD_ADC_YP ADC_CHANNEL_7

/* Raw ADC readings at the panel's edges, measured by pressing its corners.
 * MIN is the left or top edge, so MIN > MAX means that axis runs backwards. */
#define BOARD_TOUCH_X_MIN 3920
#define BOARD_TOUCH_X_MAX 445
#define BOARD_TOUCH_Y_MIN 565
#define BOARD_TOUCH_Y_MAX 3645

#endif /* BOARD_H */
