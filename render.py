#!/usr/bin/env python3
"""
Render page-flip.html to an mp4.

The engine draws; this drives the clock. Every frame is produced by asking the
page for an exact progress value, so a render is bit-identical run to run - no
requestAnimationFrame, no dropped frames, no realtime capture.

    pip install playwright && playwright install chromium
    python render.py design1.jpg design2.jpg design3.jpg -o book.mp4

Common flags:
    --size 2160x1350     output resolution. Omit it and the stage decides: Auto,
                         the page's default, takes the artwork's own pixel width
                         and the height its room implies; a preset
                         (--set size=0, 1 or 2) renders at 2160x1350.
    --fps 30
    --flip 3000          milliseconds per flip
    --hold 700           milliseconds resting on each design
    --loop               end where it started, so it can play seamlessly
    --set blur=150 --set rad=40 --set thick=20 --set eye=560 --set fit=62

Stage background (both reachable the same way):
    --set bgcol=#101014               solid colour
    --set bgimage=backdrop.jpg        image file, inlined into the page

The engine's own control defaults are used unless overridden with --set; only
the flip duration lives here, because the harness owns the timeline.
"""

import argparse, base64, mimetypes, pathlib, shutil, subprocess, sys, tempfile

ENGINE = pathlib.Path(__file__).with_name("page-flip.html")

# swiftshader so a render is identical on any machine, with or without a GPU.
# regression.py imports this - one launch configuration, not two.
CHROME_ARGS = [
    "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
]


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("designs", nargs="+", help="artwork files, in flip order")
    p.add_argument("-o", "--out", default="page-flip.mp4")
    p.add_argument("--size", default=None,
                   help="WxH; omit to let the stage decide (see --set size=auto)")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--flip", type=int, default=3000, help="ms per flip")
    p.add_argument("--hold", type=int, default=700, help="ms resting on a design")
    p.add_argument("--loop", action="store_true",
                   help="flip through every design and back to the first")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                   help="override a control, e.g. --set blur=40")
    p.add_argument("--engine", default=str(ENGINE))
    p.add_argument("--keep-frames", action="store_true")
    return p.parse_args()


PRESET_SIZE = (2160, 1350)     # what an omitted --size has always meant


def stage_size(page, given):
    """The output resolution, in the order: what was asked for, what the stage
    implies, what it has always been.

    An Auto stage has no fixed w/h to copy, so the artwork's own pixel width
    becomes the stage's and the height follows the room the engine derived for
    it. That renders the artwork at `fit` of its native width - pass --size
    explicitly if you want it at 1:1 instead."""
    if given:
        w, h = (int(v) for v in given.lower().split("x"))
    else:
        probe = page.evaluate("() => window.RENDER.probe()")
        if probe.get("auto"):
            w = int(probe["art"][0])
            h = round(w / probe["room"])
            print(f"auto stage {w}x{h}  (artwork {probe['art'][0]}x{probe['art'][1]}"
                  f", room {probe['room']:.3f})")
        else:
            w, h = PRESET_SIZE
    return w - (w % 2), h - (h % 2)          # h264 needs even dimensions


def apply_set(page, key, value):
    """Push one control into the engine.

    Everything is a plain control value except bgimage, which is a file: the
    page is loaded from file:// and reading pixels out of a file:// image would
    taint the canvas that toDataURL() has to read, so the image is inlined.
    RENDER.set returns a promise for that case and page.evaluate awaits it.
    """
    if key == "bgimage":
        path = pathlib.Path(value).expanduser()
        if path.exists():
            mime = mimetypes.guess_type(path.name)[0] or "image/png"
            value = (f"data:{mime};base64,"
                     + base64.b64encode(path.read_bytes()).decode())
        elif not value.startswith(("data:", "http:", "https:")):
            sys.exit(f"background image not found: {value}")
    page.evaluate("([k,v]) => window.RENDER.set(k, v)", [key, value])


def build_timeline(n_designs, fps, flip_ms, hold_ms, loop):
    """(design_index, progress) for every frame, in order."""
    flip_f = max(1, round(flip_ms / 1000 * fps))
    hold_f = max(0, round(hold_ms / 1000 * fps))
    n_flips = n_designs if loop else n_designs - 1
    timeline = []
    for i in range(n_flips):
        timeline += [(i, 0.0)] * hold_f
        timeline += [(i, f / flip_f) for f in range(1, flip_f + 1)]
    if not loop:
        timeline += [(n_flips, 0.0)] * hold_f
    return timeline


def main():
    a = parse_args()
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH")

    engine = pathlib.Path(a.engine).resolve()
    if not engine.exists():
        sys.exit(f"engine not found: {engine}")

    files = [str(pathlib.Path(d).resolve()) for d in a.designs]
    for f in files:
        if not pathlib.Path(f).exists():
            sys.exit(f"design not found: {f}")

    from playwright.sync_api import sync_playwright

    tmp = pathlib.Path(tempfile.mkdtemp(prefix="flip-"))
    errors = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=CHROME_ARGS)
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        page.on("pageerror", lambda e: errors.append(str(e)))
        # both scripts supply their own designs, so skip the page's startup
        # load of assets/ - it would be work thrown away, and a late resolve
        # racing the picker
        page.add_init_script("window.__noAutoload = true")
        page.goto(engine.as_uri())
        page.wait_for_function("() => !!window.RENDER", timeout=30_000)

        # placeholders also report a count, so wait on the load counter instead
        page.set_input_files("#pick", files)
        page.wait_for_function("() => window.__loads >= 1", timeout=120_000)
        got = page.evaluate("() => window.RENDER.count()")
        if got != len(files):
            sys.exit(f"loaded {got} designs, expected {len(files)}")

        for kv in a.set:
            k, _, v = kv.partition("=")
            apply_set(page, k.strip(), v.strip())
        # after --set, so `--set size=auto` is in effect when the stage is asked
        w, h = stage_size(page, a.size)
        page.evaluate("([w,h]) => window.RENDER.size(w,h)", [w, h])

        timeline = build_timeline(len(files), a.fps, a.flip, a.hold, a.loop)
        print(f"{len(files)} designs -> {len(timeline)} frames "
              f"({len(timeline)/a.fps:.1f}s at {a.fps}fps, {w}x{h})")

        for n, (i, p) in enumerate(timeline):
            data = page.evaluate(
                "([i,p]) => { window.RENDER.frame(i,p); return window.RENDER.png(); }",
                [i, p])
            (tmp / f"f{n:05d}.png").write_bytes(
                base64.b64decode(data.split(",", 1)[1]))
            if n % 25 == 0 or n == len(timeline) - 1:
                print(f"  {n+1}/{len(timeline)}", end="\r", flush=True)
        print()
        browser.close()

    if errors:
        print("page errors:", errors[:5])

    out = pathlib.Path(a.out).resolve()
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-framerate", str(a.fps), "-i", str(tmp / "f%05d.png"),
        "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out),
    ], check=True)

    print(f"wrote {out}  ({out.stat().st_size/1e6:.1f} MB)")
    if a.keep_frames:
        print(f"frames kept in {tmp}")
    else:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
