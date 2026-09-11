#!/usr/bin/env python3
"""
The standing regression check. Run it after any change to the engine.

With blur, dark, light, thick and crease at 0 the sheet must be INVISIBLE: it
samples the artwork at the same screen point the base does, so every pixel on it
has to equal the pixel underneath. Only its overhang margin may differ.

    pip install playwright numpy pillow && playwright install chromium
    python regression.py                      # first artwork found in assets/
    python regression.py my-design.jpg
    python regression.py --out frames/        # keep what it compared

ONE ARTWORK, DELIBERATELY. The script takes a single image and loads it as
every design, and there is no flag to give it two. Past 90 degrees the sheet
legitimately carries the NEXT design, so with two different artworks about a
quarter of the frame differs for an entirely correct reason and the check tells
you nothing. This cost a cycle once; it cannot be run wrong now.

Three differences are expected and accounted for, everything else fails:

  * the overhang margin (its colour comes from the engine, not from a guess
    here - see RENDER.probe) and the ~2px of anti-aliasing around it;
  * anything outside the artwork rectangle: the contact shadow grows and
    deepens with the angle, so the stage around the artwork is meant to move;
  * BORDER px of the artwork's own outer edge, where the base blends its edge
    texel into the texture padding and the sheet does not - trap #1's floor,
    invisible on a light stage and about a pixel wide on a dark one;
  * a residue of a few units out of 255, where the sheet's explicit-LOD lookup
    and the base's plain texture() land on different mips. The worst tolerated
    difference is printed every run: a registration bug moves the artwork by
    whole pixels and lights up thousands of them at once, so it cannot hide
    under this slack, but watch the number for drift.
"""

import argparse, base64, io, pathlib, sys

import numpy as np
from PIL import Image

from render import CHROME_ARGS, apply_set

ENGINE = pathlib.Path(__file__).with_name("page-flip.html")
ASSETS = pathlib.Path(__file__).with_name("assets")

FLAT = dict(blur="0", dark="0", light="0", thick="0", crease="0")
TOLERANCE = 2      # a differing pixel is one off by more than this
LOD_SLACK = 12     # mip choice between the two sampling paths, out of 255
WEDGE_AA = 2       # px of anti-aliasing around the overhang margin
BORDER = 16        # px of the artwork's outer edge, where the two paths differ


def backdrop(w=960, h=600):
    """A gradient stage image, built here so the check needs no extra asset."""
    y, x = np.mgrid[0:h, 0:w]
    u, v = x / w, y / h
    img = (np.array([0.13, 0.14, 0.18])[None, None, :] * (1 - v[..., None])
           + np.array([0.35, 0.30, 0.26])[None, None, :] * v[..., None])
    img += np.exp(-(((u - .34) / .42) ** 2 + ((v - .28) / .34) ** 2))[..., None] * \
        np.array([0.30, 0.26, 0.20])
    buf = io.BytesIO()
    Image.fromarray((np.clip(img, 0, 1) * 255).astype("uint8")).save(buf, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


STAGES = [
    ("light",  lambda: {"bgmode": "solid", "bgcol": "#f6f6f3"}),
    ("mid",    lambda: {"bgmode": "solid", "bgcol": "#7d7f7a"}),
    ("dark",   lambda: {"bgmode": "solid", "bgcol": "#101014"}),
    ("image",  lambda: {"bgimage": backdrop()}),
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("artwork", nargs="?", help="one image, loaded as every design")
    p.add_argument("--engine", default=str(ENGINE))
    p.add_argument("--size", default="1600x1000")
    p.add_argument("--progress", type=float, default=0.6, help="the mid-flip frame")
    p.add_argument("--out", help="directory to write the compared frames to")
    return p.parse_args()


def pick_artwork(given):
    if given:
        p = pathlib.Path(given)
        if not p.exists():
            sys.exit(f"artwork not found: {p}")
        return p
    found = sorted(f for f in ASSETS.glob("*")
                   if f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"))
    if not found:
        sys.exit(f"no artwork in {ASSETS} - pass one: python regression.py DESIGN.png")
    return found[0]


def classify(flat, mid, probe, w, h):
    """-> (row of percentages, count of pixels nothing explains)."""
    diff = np.abs(flat - mid).max(axis=2)
    bad = diff > TOLERANCE

    # the margin colour is whatever the engine put there this frame
    floor = np.round(np.array(probe["floor"]) * 255)
    margin = np.abs(mid - floor).max(axis=2) <= 6
    near = np.zeros_like(margin)
    for dy in range(-WEDGE_AA, WEDGE_AA + 1):
        for dx in range(-WEDGE_AA, WEDGE_AA + 1):
            near |= np.roll(np.roll(margin, dy, 0), dx, 1)

    # the artwork rectangle, straight off the engine's own fit and aspect
    hx = probe["fit"]
    hy = probe["aspect"] * probe["fit"] * w / h
    x0, x1 = round((0.5 - hx / 2) * w), round((0.5 + hx / 2) * w)
    y0, y1 = round((0.5 - hy / 2) * h), round((0.5 + hy / 2) * h)
    inside = np.zeros(bad.shape, bool)
    inside[y0 + BORDER:y1 - BORDER, x0 + BORDER:x1 - BORDER] = True
    band = np.zeros(bad.shape, bool)
    band[y0:y1, x0:x1] = True
    band &= ~inside

    unexplained = bad & ~near & inside & (diff > LOD_SLACK)
    tolerated = bad & ~near & inside & (diff <= LOD_SLACK)
    pct = lambda m: m.mean() * 100
    return (dict(differing=pct(bad), margin=pct(bad & near), outside=pct(bad & ~band & ~inside),
                 border=pct(bad & band), unexplained=int(unexplained.sum()),
                 worst=int(diff[tolerated].max()) if tolerated.any() else 0),
            unexplained)


def main():
    a = parse_args()
    art = pick_artwork(a.artwork)
    w, h = (int(v) for v in a.size.lower().split("x"))
    out = pathlib.Path(a.out) if a.out else None
    if out:
        out.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    print(f"artwork: {art.name}  (loaded as every design)")
    print(f"frames:  {w}x{h}, flat vs progress {a.progress}\n")
    print(f"{'stage':<7} {'differing':>10} {'margin+aa':>10} {'outside':>9} "
          f"{'border':>8} {'worst ok':>9} {'UNEXPLAINED':>12}")

    failures, errors = 0, []
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=CHROME_ARGS)
        page = br.new_page(viewport={"width": 1400, "height": 1000})
        page.on("pageerror", lambda e: errors.append(str(e)))
        # both scripts supply their own designs, so skip the page's startup
        # load of assets/ - it would be work thrown away, and a late resolve
        # racing the picker
        page.add_init_script("window.__noAutoload = true")
        page.goto(pathlib.Path(a.engine).resolve().as_uri())
        page.wait_for_function("() => !!window.RENDER", timeout=30_000)
        page.set_input_files("#pick", [str(art.resolve())] * 2)   # the same file, twice
        page.wait_for_function("() => window.__loads >= 1", timeout=120_000)
        page.evaluate("([w,h]) => window.RENDER.size(w,h)", [w, h])
        for k, v in FLAT.items():
            apply_set(page, k, v)

        def shot(i, p):
            d = page.evaluate(
                "([i,p]) => { window.RENDER.frame(i,p); return window.RENDER.png(); }", [i, p])
            raw = base64.b64decode(d.split(",", 1)[1])
            return raw, np.asarray(Image.open(io.BytesIO(raw)).convert("RGB")).astype(np.int16)

        for name, build in STAGES:
            for k, v in build().items():
                apply_set(page, k, v)
            probe = page.evaluate("() => window.RENDER.probe()")
            flat_raw, flat = shot(0, 0.0)
            mid_raw, mid = shot(0, a.progress)
            if out:
                (out / f"{name}_flat.png").write_bytes(flat_raw)
                (out / f"{name}_mid.png").write_bytes(mid_raw)
            row, mask = classify(flat, mid, probe, w, h)
            failures += row["unexplained"]
            print(f"{name:<7} {row['differing']:9.2f}% {row['margin']:9.2f}% "
                  f"{row['outside']:8.2f}% {row['border']:7.2f}% {row['worst']:8d}/255"
                  f" {row['unexplained']:12d}"
                  f"   (lum {probe['lum']:.3f}, lift {probe['lift']:.2f})")
            if out and mask.any():
                Image.fromarray((mask * 255).astype("uint8")).save(out / f"{name}_unexplained.png")
        br.close()

    if errors:
        print("\npage errors:", errors[:5])
        return 1
    print("\n" + ("PASS - the sheet is invisible on every stage" if failures == 0
                  else f"FAIL - {failures} pixels nothing explains"))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
