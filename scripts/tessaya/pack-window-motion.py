"""The wake sting for the windows (splash, sidebar, About), once per palette and ground: the logo kit's transparent
animation at 128 px, recoloured from the kit's Damson film to each palette's own two colours.

  python scripts/tessaya/pack-window-motion.py <films> apps/desktop/resources/tessaya

<films> holds sting-alpha-dark.apng and sting-alpha-light.apng with 108 frames each: the kit's
motion/colour/sting-alpha-<ground>/index.html drawn with draw(t) at t = i * 2 / 107. Played at 30 fps the
2 s film runs 3.6 s and comes to rest at about 3 s; every frame is a real one, so it never steps.

Each pixel is placed on the line between the film's two colours and moved to the same place on the line between
the palette's two (the kit's colour/<palette>/tessaya-mark-on-ink.svg and -on-paper.svg): the motion is identical,
only the colours change. Writes sting-<palette>-<ground>.webp.
"""
import io
import os
import sys

from PIL import Image, ImageSequence

folder, out = sys.argv[1], sys.argv[2]
SIZE = 128
FRAMES = 108
FPS = 30

# The kit's film is drawn in Damson: on dark, paper strips and the light dye; on light, ink strips and the deep dye.
SOURCE = {"dark": ("#F3EFEB", "#BC96CE"), "light": ("#151019", "#4A205E")}
# (strips, dye) per palette and ground, from the kit's colour/<palette>/tessaya-mark-on-{ink,paper}.svg.
PALETTES = {
    "woad": {"dark": ("#EEEDE4", "#5FB3B3"), "light": ("#0F1B1E", "#14505A")},
    "damson": {"dark": ("#F3EFEB", "#BC96CE"), "light": ("#151019", "#4A205E")},
    "madder": {"dark": ("#F4EEE3", "#D8505C"), "light": ("#1C1517", "#8E1F2F")},
}


def rgb(h):
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def recolour(image, old_base, old_dye, new_base, new_dye):
    ob, od, nb, nd = map(rgb, (old_base, old_dye, new_base, new_dye))
    axis = [d - b for d, b in zip(od, ob)]
    length = sum(a * a for a in axis)
    pixels = []
    for r, g, b, a in image.getdata():
        t = max(0.0, min(1.0, sum((c - p) * x for c, p, x in zip((r, g, b), ob, axis)) / length))
        pixels.append(tuple(round(p + t * (n - p)) for p, n in zip(nb, nd)) + (a,))
    result = Image.new("RGBA", image.size)
    result.putdata(pixels)
    return result


os.makedirs(out, exist_ok=True)
for ground, (old_base, old_dye) in SOURCE.items():
    image = Image.open(f"{folder}/sting-alpha-{ground}.apng")
    frames = [f.convert("RGBA").resize((SIZE, SIZE), Image.LANCZOS) for f in ImageSequence.Iterator(image)]
    step = len(frames) / FRAMES
    picked = [frames[min(len(frames) - 1, int(i * step))] for i in range(FRAMES)]
    for palette, grounds in PALETTES.items():
        new_base, new_dye = grounds[ground]
        film = [recolour(f, old_base, old_dye, new_base, new_dye) for f in picked]
        buf = io.BytesIO()
        film[0].save(buf, "WEBP", save_all=True, append_images=film[1:], duration=int(1000 / FPS), loop=1,
                     lossless=True, quality=100, method=6, exact=True)
        with open(f"{out}/sting-{palette}-{ground}.webp", "wb") as f:
            f.write(buf.getvalue())
