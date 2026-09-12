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

ONE ARTWORK PER PASS, DELIBERATELY. Each pass loads a single image as every
design, and there is no flag to give it two. Past 90 degrees the sheet
legitimately carries the NEXT design, so with two different artworks about a
quarter of the frame differs for an entirely correct reason and the check tells
you nothing. This cost a cycle once; it cannot be run wrong now.

EVERY PASS RUNS TWICE: once on your artwork, once on a generated dark one. A
light artwork on a light stage cannot show a coverage gap - both sides of the
hole are pale - so a hairline where the sheet exists and the content does not
is invisible. On dark artwork the stage shows through it as a bright line.

The dark pass is not enough on its own, and that is worth understanding: this
check compares a flat frame against a mid-flip one, so a hole that sits in the
same place in both cancels out and reads as no difference at all. A corner
defect that put a bright row at every corner passed this check on dark artwork
before the hole test below was added. Hence HOLES: dark artwork on a magenta
stage, asserting that no pixel strictly inside the card shows any stage colour.
Different question, different axis - it asks what is on screen, not what moved.

Two gates run before a single pixel is compared, both of them there because the
engine is nine classic scripts sharing one global scope. A file that fails to
parse, or that throws on the way up, takes every function it defines with it,
and what you see is a missing function somewhere else entirely. A diff measured
against a half-loaded engine means nothing, so neither gate is a warning:

  * every src/*.js goes through `node --check` before the browser starts;
  * the page must reach window.RENDER with zero page errors and zero console
    errors, or the run stops there having rendered nothing.

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

import argparse, base64, io, pathlib, shutil, subprocess, sys, tempfile

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


def dark_artwork(path, w=1620, h=675):
    """Near-black artwork: any hole in the coverage lights up against the stage."""
    y, x = np.mgrid[0:h, 0:w]
    u, v = x / w, y / h
    img = np.exp(-(((u - .5) / .34) ** 2 + ((v - .62) / .30) ** 2))[..., None] \
        * np.array([0.42, 0.26, 0.12]) + 0.035
    Image.fromarray((np.clip(img, 0, 1) * 255).astype("uint8")).save(path)
    return path


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


def check_syntax(src):
    """Parse every engine script before a browser is even started.

    node is the nicer diagnostic - it names the file and the line - but it is
    not the safety net: a parse failure also surfaces as a page error, which the
    load gate catches. So a machine without node gets a warning, not a stop.
    """
    files = sorted(src.glob("*.js"))
    if not files:
        return
    node = shutil.which("node")
    if not node:
        print(f"!! node not on PATH - {len(files)} scripts unparsed. The load gate "
              f"still catches this, with a worse error message.")
        return
    bad = []
    for f in files:
        r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
        if r.returncode:
            bad.append((f.name, (r.stderr or r.stdout).strip()))
    for name, msg in bad:
        print(f"SYNTAX ERROR in {name}")
        print(msg + "\n")
    if bad:
        sys.exit(f"{len(bad)} of {len(files)} scripts will not parse. Everything they "
                 f"define is gone at runtime - fix them before comparing anything.")
    print(f"parse check: {len(files)} scripts ok")


def assert_clean_load(page, page_errors, console_errors):
    """The engine must come up whole, or the comparison is theatre.

    window.RENDER is not proof of that: render-api.js is its own file, so it can
    parse and run perfectly well while the engine underneath it is missing.
    """
    page.wait_for_timeout(250)          # let a late error arrive before judging
    if not (page_errors or console_errors):
        print("load check:  no page or console errors")
        return
    for e in page_errors:
        print("  page error:    " + e)
    for c in console_errors:
        print("  console error: " + c)
    sys.exit("the engine did not load cleanly. Every number below would have been "
             "measured against a broken page, so nothing was rendered.")


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


def card_mask(probe, w, h, inset=2.0):
    """The rounded card, eroded a little, in pixels. Nothing inside it may show
    stage: the base covers the whole shape at every angle, and the sheet only
    ever adds to it."""
    hx = probe["fit"]
    hy = probe["aspect"] * probe["fit"] * w / h
    x0, x1 = (0.5 - hx / 2) * w, (0.5 + hx / 2) * w
    y0, y1 = (0.5 - hy / 2) * h, (0.5 + hy / 2) * h
    r = probe["radius"] * (x1 - x0) / 2          # uRadius is half-artwork-width units
    y, x = np.mgrid[0:h, 0:w]
    ex = np.minimum(x - x0, x1 - x)              # distance from the nearest edge
    ey = np.minimum(y - y0, y1 - y)
    inside = (ex > inset) & (ey > inset)
    corner = (ex < r) & (ey < r)                 # inside the corner box: use the arc
    d = np.hypot(np.maximum(r - ex, 0), np.maximum(r - ey, 0))
    return inside & (~corner | (d < r - inset))


def stage_bleed(frame):
    """How much magenta stage is showing, per pixel. The dark artwork is warm
    and neutral, so nothing in it reads as magenta."""
    return np.clip((frame[..., 0] + frame[..., 2] - 2 * frame[..., 1]) / 510.0, 0, 1)


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
    engine = pathlib.Path(a.engine).resolve()
    check_syntax(engine.parent / "src")
    w, h = (int(v) for v in a.size.lower().split("x"))
    out = pathlib.Path(a.out) if a.out else None
    if out:
        out.mkdir(parents=True, exist_ok=True)

    from playwright.sync_api import sync_playwright

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="regress-"))
    artworks = [("yours", art.resolve()), ("dark", dark_artwork(tmp / "dark.png"))]
    print(f"artwork: {art.name}, and a generated dark one  (each loaded as every design)")
    print(f"frames:  {w}x{h}, flat vs progress {a.progress}\n")

    failures, errors, console = 0, [], []
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=CHROME_ARGS)
        page = br.new_page(viewport={"width": 1400, "height": 1000})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
        # both scripts supply their own designs, so skip the page's startup
        # load of assets/ - it would be work thrown away, and a late resolve
        # racing the picker
        page.add_init_script("window.__noAutoload = true")
        page.goto(engine.as_uri())
        page.wait_for_function("() => !!window.RENDER", timeout=30_000)
        assert_clean_load(page, errors, console)
        print()
        print(f"{'art':<7} {'stage':<7} {'differing':>10} {'margin+aa':>10} {'outside':>9} "
              f"{'border':>8} {'worst ok':>9} {'UNEXPLAINED':>12}")
        page.evaluate("([w,h]) => window.RENDER.size(w,h)", [w, h])

        def shot(i, p):
            d = page.evaluate(
                "([i,p]) => { window.RENDER.frame(i,p); return window.RENDER.png(); }", [i, p])
            raw = base64.b64decode(d.split(",", 1)[1])
            return raw, np.asarray(Image.open(io.BytesIO(raw)).convert("RGB")).astype(np.int16)

        holes = 0
        for n, (art_name, art_file) in enumerate(artworks, 1):
            page.set_input_files("#pick", [str(art_file)] * 2)   # the same file, twice
            page.wait_for_function(f"() => window.__loads >= {n}", timeout=120_000)
            for k, v in FLAT.items():
                apply_set(page, k, v)
            for name, build in STAGES:
                for k, v in build().items():
                    apply_set(page, k, v)
                probe = page.evaluate("() => window.RENDER.probe()")
                flat_raw, flat = shot(0, 0.0)
                mid_raw, mid = shot(0, a.progress)
                if out:
                    (out / f"{art_name}_{name}_flat.png").write_bytes(flat_raw)
                    (out / f"{art_name}_{name}_mid.png").write_bytes(mid_raw)
                row, mask = classify(flat, mid, probe, w, h)
                failures += row["unexplained"]
                print(f"{art_name:<7} {name:<7} {row['differing']:9.2f}% {row['margin']:9.2f}% "
                      f"{row['outside']:8.2f}% {row['border']:7.2f}% {row['worst']:8d}/255"
                      f" {row['unexplained']:12d}"
                      f"   (lum {probe['lum']:.3f}, lift {probe['lift']:.2f})")
                if out and mask.any():
                    Image.fromarray((mask * 255).astype("uint8")).save(
                        out / f"{art_name}_{name}_unexplained.png")

            if art_name != "dark":
                continue
            # HOLES: a magenta stage under dark artwork. Anything strictly inside
            # the card that shows magenta is a gap in the coverage - and unlike
            # the table above, this does not care whether it also moved.
            apply_set(page, "bgmode", "solid")
            apply_set(page, "bgcol", "#ff00ff")
            probe = page.evaluate("() => window.RENDER.probe()")
            keep = card_mask(probe, w, h)
            for label, prog in (("flat", 0.0), ("mid", a.progress)):
                raw, frame = shot(0, prog)
                bad = (stage_bleed(frame) > 0.15) & keep
                holes += int(bad.sum())
                print(f"holes   {label:<7} {bad.sum():6d} px of stage showing through "
                      f"the card  {'' if not bad.sum() else '  <-- COVERAGE GAP'}")
                if out:
                    (out / f"holes_{label}.png").write_bytes(raw)
                    if bad.any():
                        Image.fromarray((bad * 255).astype("uint8")).save(
                            out / f"holes_{label}_mask.png")
        failures += holes
        br.close()

    shutil.rmtree(tmp, ignore_errors=True)
    if errors or console:
        # anything raised after the load gate, while the stages were driven
        print("\nerrors raised during the run:", (errors + console)[:5])
        return 1
    print("\n" + ("PASS - the sheet is invisible on every stage" if failures == 0
                  else f"FAIL - {failures} pixels nothing explains"))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
