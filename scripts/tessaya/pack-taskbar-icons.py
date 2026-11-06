"""Taskbar icons for each palette and theme, from the logo kit, as .ico files of 16 to 256 px.

  python scripts/tessaya/pack-taskbar-icons.py <kit> apps/desktop/resources/tessaya

Light: the kit's own app icon for the palette (app-icons/<palette>/tessaya-app.ico): the paper mark on a dye tile.
Dark: the same tile shape in the palette's ink, with the kit's reversed mark (colour/<palette>/tessaya-mark-on-ink.svg:
paper strips, the dye strips in the light dye), placed where the kit's icon places its mark. The mark's paths are
straight-edged polygons, so they are drawn here at 8x and scaled down; no SVG renderer is needed.
"""
import os
import re
import shutil
import sys

from PIL import Image, ImageDraw

kit, out = sys.argv[1], sys.argv[2]
INK = {"woad": "#0F1B1E", "damson": "#151019", "madder": "#1C1517"}
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
# The kit's 256 px icon draws the 256-unit mark at 0.901 scale from (12.15, 12.15).
SCALE, OFFSET, SS = 0.901, 12.15, 8

os.makedirs(out, exist_ok=True)
for palette, ink in INK.items():
    shutil.copyfile(f"{kit}/app-icons/{palette}/tessaya-app.ico", f"{out}/taskbar-{palette}-light.ico")
    tile_alpha = Image.open(f"{kit}/app-icons/{palette}/tessaya-app-256.png").convert("RGBA").getchannel("A")
    big = Image.new("RGBA", (256 * SS, 256 * SS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(big)
    svg = open(f"{kit}/colour/{palette}/tessaya-mark-on-ink.svg").read()
    for fill, d in re.findall(r'<path fill="(#[0-9A-Fa-f]{6})" d="([^"]+)"', svg):
        for shape in re.findall(r"M[^Z]+Z", d):
            nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", shape)]
            points = [((nums[i] * SCALE + OFFSET) * SS, (nums[i + 1] * SCALE + OFFSET) * SS) for i in range(0, len(nums), 2)]
            draw.polygon(points, fill=fill)
    mark = big.resize((256, 256), Image.LANCZOS)
    tile = Image.new("RGBA", (256, 256), ink)
    tile.putalpha(tile_alpha)
    tile.alpha_composite(mark)
    tile.save(f"{out}/taskbar-{palette}-dark.ico", sizes=[(s, s) for s in SIZES])
