#!/usr/bin/env python3
"""Cut installed-window photos into overlay WebPs and append them to the manifest.

The Milgard studio set is left as it is. This adds:
  Andersen 100 picture (real black, recolors)
  V300 XO block frame (real black, recolors)
  V300 single-hung block frame (real black, recolors)
  Andersen 100 XO nail fin (real black, recolors)

It also writes the two gallery installs Nick asked to show: the V300
single hung and the Andersen nail-fin slider with the phone chrome removed.
"""
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'overlay'
GALLERY = ROOT / 'assets' / 'gallery'
MAX_SIDE = 680
WEBP_QUALITY = 72

PIC = Path('/home/ubuntu/.cursor/projects/workspace/uploads/0d73eb9bea6916f51b5e6de7316c7a7b11eefb49c08353ae6117b8ed859dcd7a_18f4.png')
ATT = Path('/cursor/stores/bot/grok-bot/agents/5f240e8d-09af-4252-accf-8403d7e62a76/attachments')
XO = ATT / '01M50SN4JW3KRVWHXHXQ8E6MKT.jpg'
SH = ATT / '01M50SN4JW22W1KCCV20R1DC4R.jpg'
AX = ATT / '01M50SN4JW1N5V1ZEGTZVY80RZ.png'

ANDERSEN_COLORS = {
    'white': (244, 244, 241),
    'sandtone': (203, 187, 160),
    'terratone': (138, 106, 79),
    'dkbronze': (74, 59, 47),
    'black': None,
}
MILGARD_COLORS = {
    'white': (244, 244, 241),
    'adobe': (200, 162, 122),
    'bronze': (91, 70, 54),
    'black': None,
}
NEW_COLORS = [
    {'id': 'sandtone', 'name': 'Sandtone', 'rateId': 'sandtone', 'swatch': '#CBBBA0'},
    {'id': 'terratone', 'name': 'Terratone', 'rateId': 'terratone', 'swatch': '#8A6A4F'},
    {'id': 'dkbronze', 'name': 'Dark Bronze / Dark Bronze', 'rateId': 'dkbronze_dkbronze', 'swatch': '#3d2e24'},
]
RECOLOR_NOTES = {
    'picture': 'Recolored from the installed black Andersen 100 picture window.',
    'v300-block-h': 'Recolored from the installed black V300 block-frame slider.',
    'v300-block-v': 'Recolored from the installed black V300 block-frame single hung.',
    'nailfin': 'Recolored from the installed black Andersen 100 nail-fin slider.',
}


def read_bgr(path):
    im = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if im is None:
        raise SystemExit(f'could not read {path}')
    return im


def extreme_corners(mask):
    cnts, _ = cv2.findContours((mask > 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnt = max(cnts, key=cv2.contourArea)
    pts = cnt.reshape(-1, 2).astype(np.float32)
    s = pts[:, 0] + pts[:, 1]
    d = pts[:, 0] - pts[:, 1]
    return np.array([
        pts[int(np.argmin(s))],
        pts[int(np.argmax(d))],
        pts[int(np.argmax(s))],
        pts[int(np.argmin(d))],
    ], np.float32)


def warp(im, quad, size):
    dst = np.array([[0, 0], [size[0] - 1, 0], [size[0] - 1, size[1] - 1], [0, size[1] - 1]], np.float32)
    M = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    return cv2.warpPerspective(im, M, size, flags=cv2.INTER_LINEAR)


def side_lengths(quad):
    def dist(a, b):
        return float(np.hypot(*(a - b)))
    top, bot = dist(quad[0], quad[1]), dist(quad[3], quad[2])
    left, right = dist(quad[0], quad[3]), dist(quad[1], quad[2])
    return top, bot, left, right


def output_size(quad, max_side, force=None):
    top, bot, left, right = side_lengths(quad)
    aw = (top + bot) / 2
    ah = (left + right) / 2
    if force:
        aw, ah = force
    scale = max_side / max(aw, ah)
    return max(40, int(round(aw * scale))), max(40, int(round(ah * scale)))


def recolor(bgr, frame, rgb):
    if rgb is None:
        return bgr.copy()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    face = float(np.percentile(gray[frame == 1], 60)) or 1.0
    shade = np.clip(gray / face, 0.42, 1.35)
    target = np.array([rgb[2], rgb[1], rgb[0]], np.float32)
    colored = np.clip(shade[..., None] * target, 0, 255).astype(np.uint8)
    out = bgr.copy()
    out[frame == 1] = colored[frame == 1]
    return out


def restore_lifted_black(bgr, frame):
    """The block-frame slider JPEG lifted real black to a flat brown. Put it back."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    face = float(np.median(gray[frame == 1])) or 1.0
    if face < 90:
        return bgr.copy()
    scale = 34.0 / face
    out = bgr.copy()
    out[frame == 1] = np.clip(out[frame == 1].astype(np.float32) * scale, 0, 255).astype(np.uint8)
    er = cv2.erode(frame, np.ones((3, 3), np.uint8), iterations=1)
    lip = (frame == 1) & (er == 0)
    out[lip] = np.clip(out[lip].astype(np.int16) + 36, 0, 255).astype(np.uint8)
    return out


def to_rgba(bgr, frame):
    rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = 0
    rgba[frame == 1, 3] = 255
    return rgba


def fit(rgba):
    h, w = rgba.shape[:2]
    scale = min(1.0, MAX_SIDE / max(h, w))
    if scale >= 0.999:
        return rgba
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    return cv2.resize(rgba, (nw, nh), interpolation=cv2.INTER_AREA)


def save_webp(rgba, path):
    Image.fromarray(cv2.cvtColor(rgba, cv2.COLOR_BGRA2RGBA)).save(path, 'WEBP', quality=WEBP_QUALITY, method=6)


def largest_dark(gray, thresh, close):
    dark = (gray < thresh).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((close, close), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, 8)
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == i).astype(np.uint8)


def picture_cutout():
    im = read_bgr(PIC)
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    mask = largest_dark(gray, 75, 9) * 255
    quad = extreme_corners(mask)
    w, h = output_size(quad, 720, force=(24, 36))
    warped = warp(im, quad, (w, h))
    g = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    def bead(row):
        # Skip a bright sliver of wall, stay in the dark frame, stop at the
        # inner bead. Top and bottom run into the blinds, so only the sides
        # are measured.
        limit = int(len(row) * 0.32)
        x = 0
        while x < limit and row[x] > 85:
            x += 1
        start = x
        while x < limit:
            if row[x] > 100 and x > start + 8:
                return x
            x += 1
        return None

    hits = []
    for y in range(int(h * 0.42), int(h * 0.68), 2):
        for row in (g[y], g[y, ::-1]):
            edge = bead(row)
            if edge:
                hits.append(edge)
    inset = int(np.median(hits)) if hits else int(w * 0.15)
    inset = int(np.clip(inset, int(w * 0.08), int(w * 0.22)))
    frame = np.zeros((h, w), np.uint8)
    frame[:inset, :] = 1
    frame[-inset:, :] = 1
    frame[:, :inset] = 1
    frame[:, -inset:] = 1
    print('picture quad', quad.round(0).tolist(), 'inset', inset, f'{w}x{h}')
    return warped, frame


def sh_cutout():
    im = read_bgr(SH)
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    mask = largest_dark(gray, 95, 5)
    quad = extreme_corners(mask * 255)
    w, h = output_size(quad, 680)
    warped = warp(im, quad, (w, h))
    wmask = warp(mask * 255, quad, (w, h))
    frame = (wmask > 127).astype(np.uint8)
    frame = cv2.morphologyEx(frame, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    print('sh quad', quad.round(0).tolist(), f'{w}x{h}', 'frame', round(float(frame.mean()), 3))
    return warped, frame


def ax_cutout():
    im = read_bgr(AX)
    # Drop the phone status bar and the button row before any use.
    crop = im[71:944]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    dark = (gray < 96).astype(np.uint8)
    dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(dark, 8)
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = (labels == i).astype(np.uint8)
    # The meeting rail is lighter than the outer frame and can miss the
    # threshold. Add vertical bands that are dark through the middle.
    h0, w0 = gray.shape
    col_dark = (gray[int(h0 * 0.25):int(h0 * 0.75)] < 96).mean(0)
    rail = (col_dark > 0.45).astype(np.uint8)
    rail_cols = np.where(rail > 0)[0]
    if len(rail_cols):
        # Keep bands that sit inside the frame, not the outer stile twice.
        x0, x1 = int(rail_cols.min()), int(rail_cols.max())
        inner = (rail_cols > x0 + 30) & (rail_cols < x1 - 30)
        for x in rail_cols[inner]:
            mask[:, x] = np.where(gray[:, x] < 110, 1, mask[:, x])
    quad = extreme_corners(mask * 255)
    w, h = output_size(quad, 680)
    warped = warp(crop, quad, (w, h))
    wmask = warp(mask * 255, quad, (w, h))
    frame = (wmask > 127).astype(np.uint8)
    frame = cv2.morphologyEx(frame, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    print('ax quad', quad.round(0).tolist(), f'{w}x{h}', 'frame', round(float(frame.mean()), 3))
    return warped, frame, crop


def xo_cutout():
    """The slider JPEG crushed the black frame and the glass to one flat color.

    The white trim around the opening is still there, so the outer frame
    follows that trim. The sash line was flattened, so the meeting rail
    is placed across the middle of that opening.
    """
    im = read_bgr(XO)
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    white = gray > 190
    col = white.mean(0)
    rowf = white.mean(1)

    def runs(idx, gap):
        groups = []
        start = prev = int(idx[0])
        for i in idx[1:]:
            i = int(i)
            if i > prev + gap:
                groups.append((start, prev))
                start = i
            prev = i
        groups.append((start, prev))
        return groups

    xr = runs(np.where(col > 0.08)[0], 6)
    yr = runs(np.where(rowf > 0.05)[0], 6)
    print('xo white x', xr, 'y', yr)
    # First two vertical trims bound the left unit. First and last horizontal
    # trims are the head and sill; a short line across the wall sits between them.
    left_trim, right_trim = xr[0], xr[1]
    top_trim, bot_trim = yr[0], yr[-1]
    x0, x1 = left_trim[1] + 1, right_trim[0] - 1
    y0, y1 = top_trim[1] + 1, bot_trim[0] - 1
    quad = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float32)
    w, h = output_size(quad, 640)
    warped = warp(im, quad, (w, h))
    thick = max(16, int(round(min(w, h) * 0.11)))
    rail = max(12, int(round(min(w, h) * 0.07)))
    frame = np.zeros((h, w), np.uint8)
    frame[:thick, :] = 1
    frame[-thick:, :] = 1
    frame[:, :thick] = 1
    frame[:, -thick:] = 1
    # This opening is the tall single hung. The JPEG flattened the sash
    # line, so the meeting rail sits at the middle of the measured frame.
    cy = h // 2
    frame[cy - rail // 2:cy + rail // 2 + 1, :] = 1
    print('hung opening', x0, y0, x1, y1, f'{w}x{h}', 'thick', thick, 'rail', rail)
    return warped, frame


def variants(bgr, frame, colors, restore_black=False):
    out = {}
    base = bgr
    for color, rgb in colors.items():
        if color == 'black' and restore_black:
            painted = restore_lifted_black(base, frame)
        else:
            painted = recolor(base, frame, rgb)
        out[color] = to_rgba(painted, frame)
    return out


def magenta(bgr, frame):
    mag = np.full_like(bgr, (180, 0, 180))
    mag[frame == 1] = bgr[frame == 1]
    return mag


def write_assets(manifest, bgr, frame, colors, series, kind, frame_id, note_key, restore_black=False):
    made = variants(bgr, frame, colors, restore_black=restore_black)
    rows = []
    for color, rgb in colors.items():
        rgba = fit(made[color])
        suffix = f'_{frame_id}' if frame_id else ''
        name = f'{series}_{kind}_{color}{suffix}.webp'
        path = OUT / name
        save_webp(rgba, path)
        real = color == 'black'
        rows.append({
            'series': series,
            'type': kind,
            'color': color,
            'frame': frame_id,
            'zbar': False,
            'file': f'data/overlay/{name}',
            'width': int(rgba.shape[1]),
            'height': int(rgba.shape[0]),
            'approximate': not real,
            'note': '' if real else RECOLOR_NOTES[note_key],
        })
        print(f'{name:48} {rgba.shape[1]}x{rgba.shape[0]} {path.stat().st_size // 1024}KB')
    manifest['assets'].extend(rows)


def save_gallery(im, name):
    h, w = im.shape[:2]
    scale = min(1.0, 1600 / max(h, w))
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    rgb = cv2.cvtColor(cv2.resize(im, (nw, nh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    Image.fromarray(rgb).save(GALLERY / name, 'JPEG', quality=82, optimize=True)
    return nw, nh


def upsert_slide(gallery, slide, after_src):
    slides = [s for s in gallery['slides'] if s['src'] != slide['src']]
    idx = next(i for i, s in enumerate(slides) if s['src'] == after_src)
    slides.insert(idx + 1, slide)
    gallery['slides'] = slides


def main():
    pic_bgr, pic_frame = picture_cutout()
    sh_bgr, sh_frame = sh_cutout()
    ax_bgr, ax_frame, ax_scene = ax_cutout()
    xo_bgr, xo_frame = xo_cutout()

    cv2.imwrite('/tmp/preview-picture.jpg', magenta(pic_bgr, pic_frame))
    cv2.imwrite('/tmp/preview-sh.jpg', magenta(sh_bgr, sh_frame))
    cv2.imwrite('/tmp/preview-ax.jpg', magenta(ax_bgr, ax_frame))
    black_xo = restore_lifted_black(xo_bgr, xo_frame)
    cv2.imwrite('/tmp/preview-xo.jpg', magenta(black_xo, xo_frame))

    manifest = json.loads((OUT / 'manifest.json').read_text())
    fresh = []
    for row in manifest['assets']:
        name = Path(row['file']).name
        if name.startswith('andersen100_') or name.endswith('_block.webp') or '_nailfin' in name:
            continue
        fresh.append(row)
    manifest['assets'] = fresh
    if not any(s['id'] == 'andersen100' for s in manifest['series']):
        manifest['series'].append({'id': 'andersen100', 'name': 'Andersen 100'})
    have = {c['id'] for c in manifest['colors']}
    for color in NEW_COLORS:
        if color['id'] not in have:
            manifest['colors'].append(color)
    manifest['frames'] = [
        {'id': '', 'name': 'Product photo'},
        {'id': 'block', 'name': 'Block frame'},
        {'id': 'nailfin', 'name': 'Nail fin'},
    ]
    write_assets(manifest, pic_bgr, pic_frame, ANDERSEN_COLORS, 'andersen100', 'picture', '', 'picture')
    # The stucco photo with the real vertical rail is the XO block slider.
    # The taller crushed opening is the single hung.
    write_assets(manifest, sh_bgr, sh_frame, MILGARD_COLORS, 'V300', 'hslider', 'block', 'v300-block-h')
    write_assets(manifest, xo_bgr, xo_frame, MILGARD_COLORS, 'V300', 'vslider', 'block', 'v300-block-v', restore_black=True)
    write_assets(manifest, ax_bgr, ax_frame, ANDERSEN_COLORS, 'andersen100', 'hslider', 'nailfin', 'nailfin')
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('assets', len(manifest['assets']))

    sh_scene = read_bgr(XO)
    sw, shh = save_gallery(sh_scene, 'milgard-v300-06.jpg')
    aw, ah = save_gallery(ax_scene, 'andersen-100-07.jpg')
    gallery = json.loads((GALLERY / 'gallery.json').read_text())
    upsert_slide(gallery, {
        'src': 'milgard-v300-06.jpg',
        'caption': 'Milgard V300 black single-hung windows, block frame, exterior view on stucco',
        'brand': 'Milgard',
        'series': 'V300',
        'category': 'window - single hung',
        'installType': 'block frame',
        'source': 'nick',
        'group': 'milgard-v300',
        'w': sw,
        'h': shh,
        'lowRes': False,
    }, 'milgard-v300-05.jpg')
    upsert_slide(gallery, {
        'src': 'andersen-100-07.jpg',
        'caption': 'Andersen 100 Series black XO slider, nailing fin, new construction on sheathing',
        'brand': 'Andersen',
        'series': '100 Series',
        'category': 'window - slider',
        'installType': 'nailing fin (new construction)',
        'source': 'nick',
        'group': 'andersen-100',
        'w': aw,
        'h': ah,
        'lowRes': False,
    }, 'andersen-100-06.jpg')
    (GALLERY / 'gallery.json').write_text(json.dumps(gallery, indent=2) + '\n')
    print('gallery', len(gallery['slides']), 'sh', sw, shh, 'ax', aw, ah)


if __name__ == '__main__':
    main()
