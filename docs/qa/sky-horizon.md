# The sky's horizon: the game against the editor

Measured through the game driver (`tools/driver`, slot 1) on 2026-11-06, in the in-game editor with its panels hidden.

## Result

The game has no fog. Its sky is a sphere that stays put at any height, and the water and stadium sit in front of it. From above, past the edge of the 2 km water sheet, the camera sees the sphere's flat horizon colour.

That colour is not what the engine's curves give through the viewport's tone mapping. At noon the curves give `(0.92, 1, 1)`, which the viewport shows as near white at any exposure. The game shows blue-grey. A single tint on the curves doesn't fit either: the best one leaves noon lilac. So `domain/sky.ts` holds the colours as measured (`SHOWN_HORIZON_CURVE`), and the sky light's capture keeps using the curves.

## Method

Write the time into the probe map's `timeOfDay`, reopen it by way of `open Map_MainMenu` and `openmap probe_driver`, then point the camera at x -7800, y -21000, z 250000, pitch -60, yaw 70, fov 90. The corners of that frame are sky alone. The sample is the same to within one step of 255 across the frame.

| Time  | Sun height | Curves' horizon     | On screen                 |
| ----- | ---------- | ------------------- | ------------------------- |
| 5:00  | −0.11      | 1, 0.497, 0.168     | 209, 133, 72 (`#d18548`)  |
| 6:00  | 0          | 1, 0.6, 0.2         | 208, 136, 75 (`#d0884b`)  |
| 7:18  | 0.22       | 1, 0.626, 0.345     | 204, 159, 139 (`#cc9f8b`) |
| 9:00  | 0.5        | 0.92, 1, 1          | 171, 188, 206 (`#abbcce`) |
| 12:00 | 1          | 0.92, 1, 1          | 171, 188, 206 (`#abbcce`) |
| 22:00 | night      | 0.012, 0.014, 0.031 | 23, 27, 49 (`#171b31`)    |

These include the game's auto exposure, in a view that is mostly sky. A view with more of the stadium in it can shift them.

## What the editor does with it

The editor doesn't draw the stadium, so the sky ends at the horizon and the sea carries on to meet it, from any height. Past the sheet the sky dome paints the sea itself (`editor/sky.ts`), in the colour the sheet shows over the clear colour, so the sheet's edge doesn't show.
