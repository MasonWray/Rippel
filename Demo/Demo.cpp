#include "raylib.h"

int main(void)
{
	const int screenWidth = 320;
	const int screenHeight = 240;

	InitWindow(screenWidth, screenHeight, "Adafruit TFT LCD");

	SetTargetFPS(60);

	while (!WindowShouldClose())
	{
		// Update
		//----------------------------------------------------------------------------------
		// TODO: Update your variables here
		//----------------------------------------------------------------------------------

		BeginDrawing();
		ClearBackground(BLACK);
		EndDrawing();
	}

	CloseWindow();

	return 0;
}