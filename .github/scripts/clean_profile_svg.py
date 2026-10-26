"""Strip the radar chart, language pie and stats footer from the
github-profile-3d-contrib SVGs, keeping only the 3D contribution calendar,
drop the solid background so it blends into GitHub's light/dark theme,
and crop the canvas tightly around the bars."""
import math
import re
import sys
from pathlib import Path

PADDING = 20
TAG_RE = re.compile(r"<(/?)(\w+)[^>]*?(/?)>")
BAR_RE = re.compile(r'<g transform="translate\(([-\d.]+) ([-\d.]+)\)">(.*?)</g>', re.S)
SIDE_RECT_RE = re.compile(r'<rect[^>]*transform="skewY\(30\)[^>]*>')
HEIGHT_RE = re.compile(r'\sheight="([\d.]+)"')
SCALE_Y_RE = re.compile(r'scale\([\d.]+ ([\d.]+)\)')


def top_level_elements(text):
    """Yield (tag, start, end) for direct children of the root <svg>."""
    body = text.find(">") + 1
    depth = 0
    start = tag = None
    for m in TAG_RE.finditer(text, body):
        closing, name, self_closing = m.groups()
        if closing:
            depth -= 1
            if depth == 0:
                yield tag, start, m.end()
            if depth < 0:
                return
        else:
            if depth == 0:
                start, tag = m.start(), name
                if self_closing:
                    yield tag, start, m.end()
                    continue
            if not self_closing:
                depth += 1


def calendar_bbox(group):
    """Bounding box of the isometric bars, from their final (post-animation) geometry."""
    sx = math.tan(math.radians(40.89))
    sy = math.tan(math.radians(30))
    xs, ys = [], []
    for m in BAR_RE.finditer(group):
        tx, ty, inner = float(m.group(1)), float(m.group(2)), m.group(3)
        side = SIDE_RECT_RE.search(inner)
        h = 0.0
        if side:
            tag = side.group(0)
            h = float(HEIGHT_RE.search(tag).group(1)) * float(SCALE_Y_RE.search(tag).group(1))
        # Top face: skewY(-30) skewX(40.89) scale(1 1.15) of an 18x18 square.
        for px, py in ((0, 0), (18, 0), (0, 18), (18, 18)):
            py *= 1.15
            px += py * sx
            py -= px * sy
            xs.append(tx + px)
            ys.append(ty + py)
        # Side faces reach x + 36 and drop by h below the front corner at y + 10.39.
        xs.append(tx + 36)
        ys.append(ty + 10.39 + h)
    return min(xs), min(ys), max(xs), max(ys)


def clean(path):
    text = path.read_text()
    elements = list(top_level_elements(text))
    groups = [e for e in elements if e[0] == "g"]
    if not groups:
        raise SystemExit(f"{path}: no calendar group found")
    calendar = groups[0]
    for _, start, end in sorted(groups[1:], key=lambda e: -e[1]):
        text = text[:start] + text[end:]

    x0, y0, x1, y1 = calendar_bbox(text[calendar[1]:calendar[2]])
    x0, y0 = math.floor(x0 - PADDING), math.floor(y0 - PADDING)
    w, h = math.ceil(x1 + PADDING) - x0, math.ceil(y1 + PADDING) - y0
    text = re.sub(
        r'<svg ([^>]*?)width="[^"]*" height="[^"]*" viewBox="[^"]*"',
        rf'<svg \1width="{w}" height="{h}" viewBox="{x0} {y0} {w} {h}"',
        text,
        count=1,
    )
    text = re.sub(r'<rect x="0" y="0" width="1280" height="850"[^>]*></rect>', "", text, count=1)
    path.write_text(text)
    print(f"{path}: viewBox {x0} {y0} {w} {h}")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        clean(Path(arg))
