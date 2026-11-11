#include "rippel_board.h"
#include "hx8357.h"
#include "touch.h"

lv_display_t * board_create_display(void)
{
    return hx8357_create_display();
}

void board_create_input(lv_display_t * disp)
{
    touch_create_indev(disp);
}
