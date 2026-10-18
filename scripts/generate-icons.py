"""Generate the extension's small-size artwork. Requires Pillow (development only)."""

from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def draw_icon(size):
    scale = 8
    edge = size * scale
    unit = edge / 128
    image = Image.new("RGBA", (edge, edge))
    mask = Image.new("L", (edge, edge))
    ImageDraw.Draw(mask).rounded_rectangle(
        (4 * unit, 4 * unit, 124 * unit, 124 * unit), radius=29 * unit, fill=255
    )
    # Restrained green gives the white mark contrast on both browser themes.
    gradient = Image.new("RGBA", (edge, edge))
    pixels = gradient.load()
    for y in range(edge):
        for x in range(edge):
            t = (x + y) / (2 * edge)
            pixels[x, y] = (round(30 - 17 * t), round(79 - 39 * t), round(69 - 32 * t), 255)
    image.paste(gradient, (0, 0), mask)
    pen = ImageDraw.Draw(image)

    def rect(box, radius, fill):
        pen.rounded_rectangle(tuple(v * unit for v in box), radius=radius * unit, fill=fill)

    # A long paper silhouette remains recognizable at 16px.
    rect((44, 24, 86, 105), 8, "#102E29")
    rect((41, 21, 83, 102), 8, "#F4FAF7")
    for y, right in ((39, 71), (52, 71), (65, 65)):
        rect((52, y, right, y + 5), 2.5, "#317462")
    rect((52, 84, 71, 89), 2.5, "#317462")

    # Two opposing capture corners avoid noisy detail at toolbar size.
    for points in (((29, 44), (29, 27), (35, 27)), ((93, 79), (93, 96), (87, 96))):
        coords = [(round(x * unit), round(y * unit)) for x, y in points]
        pen.line(coords, fill="#8FE1BD", width=round(6 * unit), joint="curve")
        for x, y in (coords[0], coords[-1]):
            r = 3 * unit
            pen.ellipse((x - r, y - r, x + r, y + r), fill="#8FE1BD")
    return image.resize((size, size), Image.Resampling.LANCZOS)


for size in (16, 32, 48, 128):
    draw_icon(size).save(OUT / f"icon-{size}.png", optimize=True)
    print(f"icons/icon-{size}.png")
