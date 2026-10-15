#!/usr/bin/env python3
"""Build transparent Milgard window overlays for the sales app.

Reads the white exterior studio shots, drops the black background and floor
reflection, and writes data/overlay/<series>_<type>_<color>[_zbar].webp
plus manifest.json. Glass pixels are not recolored. Picture windows, the
V400 single hung, and every Z-bar are marked approximate so a later photo
can replace the file without a code change.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'overlay'
MAX_SIDE = 680
WEBP_QUALITY = 72

SOURCES = {
    ('V250', 'hslider'): 'MGWD_V250-Style_Line_HorizontalSlider',
    ('V250', 'vslider'): 'MGWD_V250-Style_Line_SingleHung',
    ('V300', 'hslider'): 'MGWD_V300Trinsic_HorizontalSlide',
    ('V300', 'vslider'): 'MGWD_V300Trinsic_SingleHung',
    ('V400', 'hslider'): 'MGWD_V400-Tuscany_Horizontal-Slider',
}

# Match the color chips already in data/rates.json. Black is Black / Black
# because these photos are exteriors. Bronze Anodized uses the bronze chip.
COLORS = {
    'white': None,
    'adobe': (200, 162, 122),
    'black': (48, 48, 50),
    'bronze': (91, 70, 54),
}
COLOR_META = [
    {'id': 'white', 'name': 'White / White', 'rateId': 'ww', 'swatch': '#f4f4f1'},
    {'id': 'adobe', 'name': 'Adobe', 'rateId': 'adobe', 'swatch': '#C8A27A'},
    {'id': 'black', 'name': 'Black / Black', 'rateId': 'bb', 'swatch': '#111111'},
    {'id': 'bronze', 'name': 'Bronze Anodized', 'rateId': 'bronze', 'swatch': '#5b4636'},
]
SERIES_META = [
    {'id': 'V250', 'name': 'V250'},
    {'id': 'V300', 'name': 'V300'},
    {'id': 'V400', 'name': 'V400'},
]
TYPE_META = [
    {'id': 'hslider', 'name': 'XO slider'},
    {'id': 'vslider', 'name': 'Single hung'},
    {'id': 'picture', 'name': 'Picture'},
]

PICTURE_NOTE = 'Picture window is the slider frame with the meeting rail removed.'
V400_HUNG_NOTE = 'V400 single hung is the slider photo with the meeting rail turned horizontal.'
ZBAR_NOTE = 'Z-bar is a stepped trim border, not a factory photo.'


def find_source(token):
    roots = [
        ROOT / 'ar-windows' / 'raw',
        Path('/home/ubuntu/.cursor/projects/workspace/uploads'),
        Path('/home/workdir/attachments'),
    ]
    hits = []
    for root in roots:
        if not root.is_dir():
            continue
        hits.extend(p for p in root.iterdir() if token in p.name and p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'})
    if not hits:
        sys.exit(f'missing source photo containing {token}')
    hits.sort(key=lambda p: p.stat().st_size, reverse=True)
    return hits[0]


def cutout(path):
    im = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if im is None:
        sys.exit(f'could not read {path}')
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    # Opening this mask splits a thin meeting rail into two sashes. Keep the
    # frame connected and drop the floor reflection as its own component.
    hi = (gray > 120).astype(np.uint8)
    count, labels = cv2.connectedComponents(hi)
    if count < 2:
        sys.exit(f'no frame found in {path}')
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    core = (labels == int(areas.argmax())).astype(np.uint8)
    near = cv2.dilate(core, np.ones((11, 11), np.uint8))
    soft = (((gray > 72) & (near == 1)) | (core == 1)).astype(np.uint8)
    soft = cv2.morphologyEx(soft, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    ys, xs = np.where(soft > 0)
    y0, y1, x0, x1 = int(ys.min()), int(ys.max()), int(xs.min()), int(xs.max())
    crop = im[y0:y1 + 1, x0:x1 + 1]
    frame = soft[y0:y1 + 1, x0:x1 + 1].copy()
    inv = (1 - frame).astype(np.uint8)
    count, labels = cv2.connectedComponents(inv)
    h, w = frame.shape
    glass = np.zeros_like(frame)
    min_glass = 0.012 * h * w
    for i in range(1, count):
        comp = labels == i
        area = int(comp.sum())
        edge = bool(comp[0].any() or comp[-1].any() or comp[:, 0].any() or comp[:, -1].any())
        if edge:
            continue
        if area >= min_glass:
            glass[comp] = 1
        else:
            frame[comp] = 1
    return crop, frame, glass


def glass_boxes(glass):
    count, labels = cv2.connectedComponents(glass.astype(np.uint8))
    boxes = []
    for i in range(1, count):
        ys, xs = np.where(labels == i)
        if len(xs) < 80:
            continue
        boxes.append((int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), int(len(xs))))
    boxes.sort(key=lambda b: -b[4])
    return boxes


def vertical_rail_span(frame, glass):
    boxes = glass_boxes(glass)
    if len(boxes) < 2:
        return None
    pair = sorted(boxes[:2], key=lambda b: b[0])
    left, right = pair
    if right[0] <= left[2]:
        return None
    x0 = max(0, left[2] - 1)
    x1 = min(frame.shape[1] - 1, right[0] + 1)
    y0 = min(left[1], right[1])
    y1 = max(left[3], right[3])
    return x0, y0, x1, y1


def without_vertical_rail(crop, frame, glass):
    span = vertical_rail_span(frame, glass)
    if span is None:
        sys.exit('could not find the slider meeting rail')
    x0, y0, x1, y1 = span
    x0 = max(0, x0 - 2)
    x1 = min(crop.shape[1] - 1, x1 + 2)
    crop = crop.copy()
    frame = frame.copy()
    glass = glass.copy()
    # Clear the sash pixels. Leaving them would read as a glass reflection.
    crop[y0:y1 + 1, x0:x1 + 1] = 0
    frame[y0:y1 + 1, x0:x1 + 1] = 0
    glass[y0:y1 + 1, x0:x1 + 1] = 1
    return crop, frame, glass, (x0, y0, x1, y1)


def with_horizontal_rail(crop, frame, glass):
    """V400 single hung: turn the slider meeting rail so it crosses the opening."""
    span = vertical_rail_span(frame, glass)
    if span is None:
        sys.exit('could not find the V400 slider meeting rail')
    x0, y0, x1, y1 = span
    rail = crop[y0:y1 + 1, x0:x1 + 1].copy()
    crop, frame, glass, _span = without_vertical_rail(crop, frame, glass)
    boxes = glass_boxes(glass)
    if not boxes:
        sys.exit('opening missing after removing the V400 rail')
    left, top, right, bottom = boxes[0][:4]
    rotated = cv2.rotate(rail, cv2.ROTATE_90_CLOCKWISE)
    width = right - left + 1
    bar = cv2.resize(rotated, (width, rotated.shape[0]), interpolation=cv2.INTER_AREA)
    y_a = max(top, (top + bottom) // 2 - bar.shape[0] // 2)
    y_b = min(bottom + 1, y_a + bar.shape[0])
    bar = bar[:y_b - y_a]
    crop = crop.copy()
    crop[y_a:y_b, left:left + width] = bar
    frame = frame.copy()
    glass = glass.copy()
    frame[y_a:y_b, left:left + width] = 1
    glass[y_a:y_b, left:left + width] = 0
    return crop, frame, glass


def defringe(bgr, frame, glass):
    """Pull black-background mix off the outer silhouette. Interior shading stays."""
    outside = ((frame == 0) & (glass == 0)).astype(np.uint8)
    edge = (cv2.dilate(outside, np.ones((3, 3), np.uint8)) & (frame == 1)).astype(bool)
    if not edge.any():
        return bgr, edge, np.ones(frame.shape, np.float32)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    face = float(np.percentile(gray[frame == 1], 80))
    face = max(face, 1)
    alpha = np.clip(gray / face, 0.2, 1)
    face_bgr = np.percentile(bgr[frame == 1].astype(np.float32), 75, axis=0)
    out = bgr.astype(np.float32)
    out[edge] = face_bgr
    return np.clip(out, 0, 255).astype(np.uint8), edge, alpha


def recolor(bgr, frame, rgb):
    if rgb is None:
        return bgr.copy()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    face = float(np.percentile(gray[frame == 1], 78)) or 1
    shade = np.clip(gray / face, 0, 1.45)
    # Keep the extrusion readable on dark colors without lifting the whole frame to gray.
    shade = np.clip(0.28 + 0.72 * shade, 0, 1.45)
    target = np.array([rgb[2], rgb[1], rgb[0]], np.float32)
    colored = np.clip(shade[..., None] * target, 0, 255).astype(np.uint8)
    out = bgr.copy()
    out[frame == 1] = colored[frame == 1]
    return out


def to_rgba(bgr, frame, glass, edge=None, edge_alpha=None):
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = 0
    rgba[frame == 1, 3] = 255
    if edge is not None:
        rgba[edge, 3] = np.clip(edge_alpha[edge] * 255, 0, 255).astype(np.uint8)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.int16)
    # Studio black inside the opening stays clear. Real reflections stay.
    glass_alpha = np.clip((gray - 48) * 3, 0, 170).astype(np.uint8)
    use = glass == 1
    rgba[use, 3] = glass_alpha[use]
    return rgba


def add_zbar(rgba, rgb):
    h, w = rgba.shape[:2]
    step = max(7, int(round(min(h, w) * 0.034)))
    steps = 3
    pad = step * steps
    canvas = np.zeros((h + pad * 2, w + pad * 2, 4), np.float32)
    if rgb is None:
        opaque = rgba[..., 3] > 200
        if opaque.any():
            base = np.percentile(rgba[opaque][:, :3], 70, axis=0).astype(np.float32)
        else:
            base = np.array([240, 240, 238], np.float32)
    else:
        base = np.array([rgb[2], rgb[1], rgb[0]], np.float32)
    H, W = canvas.shape[:2]
    for i in range(steps):
        # Ring only. A filled rectangle would paint the glass opening.
        inset = i * step
        shade = 0.46 + 0.18 * i
        color = np.clip(base * shade, 0, 255)
        y0, y1 = inset, H - inset
        x0, x1 = inset, W - inset
        canvas[y0:y0 + step, x0:x1, :3] = color
        canvas[y0:y0 + step, x0:x1, 3] = 255
        canvas[y1 - step:y1, x0:x1, :3] = color
        canvas[y1 - step:y1, x0:x1, 3] = 255
        canvas[y0:y1, x0:x0 + step, :3] = color
        canvas[y0:y1, x0:x0 + step, 3] = 255
        canvas[y0:y1, x1 - step:x1, :3] = color
        canvas[y0:y1, x1 - step:x1, 3] = 255
        groove = np.clip(base * (shade * 0.55), 0, 255)
        lip = np.clip(base * min(1.2, shade + 0.28), 0, 255)
        t = max(2, step // 5)
        canvas[y0:y0 + t, x0:x1, :3] = lip
        canvas[y1 - t:y1, x0:x1, :3] = groove
        canvas[y0:y1, x0:x0 + t, :3] = lip
        canvas[y0:y1, x1 - t:x1, :3] = groove
    out = alpha_over(canvas, rgba, pad, pad)
    return np.clip(out, 0, 255).astype(np.uint8)


def alpha_over(dst, src, y, x):
    sh, sw = src.shape[:2]
    roi = dst[y:y + sh, x:x + sw]
    sa = src[..., 3:4].astype(np.float32) / 255
    da = roi[..., 3:4] / 255
    out_a = sa + da * (1 - sa)
    out_rgb = src[..., :3].astype(np.float32) * sa + roi[..., :3] * da * (1 - sa)
    safe = np.maximum(out_a, 1e-4)
    roi[..., :3] = out_rgb / safe
    roi[..., 3] = (out_a * 255).reshape(roi.shape[:2])
    dst[y:y + sh, x:x + sw] = roi
    return dst


def fit(rgba):
    h, w = rgba.shape[:2]
    scale = min(1, MAX_SIDE / max(h, w))
    if scale >= 0.999:
        return rgba
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    return cv2.resize(rgba, (nw, nh), interpolation=cv2.INTER_AREA)


def save_webp(rgba, path):
    rgb = cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)
    Image.fromarray(rgb).save(path, 'WEBP', quality=WEBP_QUALITY, method=6)


def build_variant(crop, frame, glass):
    bgr, edge, edge_alpha = defringe(crop, frame, glass)
    variants = {}
    for color, rgb in COLORS.items():
        painted = recolor(bgr, frame, rgb)
        variants[color] = to_rgba(painted, frame, glass, edge, edge_alpha)
    return variants


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    bases = {}
    for key, token in SOURCES.items():
        path = find_source(token)
        print('source', key, path.name)
        bases[key] = cutout(path)

    derived = {}
    for series in ('V250', 'V300', 'V400'):
        crop, frame, glass = bases[(series, 'hslider')]
        derived[(series, 'picture')] = without_vertical_rail(crop, frame, glass)[:3]
    crop, frame, glass = bases[('V400', 'hslider')]
    derived[('V400', 'vslider')] = with_horizontal_rail(crop, frame, glass)

    assets = []
    total = 0
    order = []
    for series, _name in ((s['id'], s['name']) for s in SERIES_META):
        for kind in ('hslider', 'vslider', 'picture'):
            if (series, kind) in bases:
                crop, frame, glass = bases[(series, kind)]
            else:
                crop, frame, glass = derived[(series, kind)]
            order.append((series, kind, crop, frame, glass))

    for series, kind, crop, frame, glass in order:
        variants = build_variant(crop, frame, glass)
        for color, rgb in COLORS.items():
            rgba = fit(variants[color])
            z = fit(add_zbar(variants[color], rgb))
            for zbar, image in ((False, rgba), (True, z)):
                name = f'{series}_{kind}_{color}' + ('_zbar' if zbar else '') + '.webp'
                path = OUT / name
                save_webp(image, path)
                total += path.stat().st_size
                notes = []
                if kind == 'picture':
                    notes.append(PICTURE_NOTE)
                if series == 'V400' and kind == 'vslider':
                    notes.append(V400_HUNG_NOTE)
                if zbar:
                    notes.append(ZBAR_NOTE)
                assets.append({
                    'series': series,
                    'type': kind,
                    'color': color,
                    'zbar': zbar,
                    'file': f'data/overlay/{name}',
                    'width': int(image.shape[1]),
                    'height': int(image.shape[0]),
                    'approximate': bool(notes),
                    'note': ' '.join(notes),
                })
                print(f'{name:42} {image.shape[1]}x{image.shape[0]} {path.stat().st_size // 1024}KB')

    manifest = {
        'version': 1,
        'note': 'Straight-on exterior overlays. Replace a WebP in place to use a real photo. The app reads this list and does not hard-code file names.',
        'series': SERIES_META,
        'types': TYPE_META,
        'colors': COLOR_META,
        'assets': assets,
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'{len(assets)} files, {total / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
