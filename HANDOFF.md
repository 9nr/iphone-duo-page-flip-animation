# page-flip — handoff brief

A WebGL2 page-flip engine that turns a set of panoramic designs into a book
whose pages turn. Built from scratch — no three.js, no bundler, no build step.

```
page-flip.html        markup + the control panel, loads src/ in order
src/constants.js      CURVE, SIZES, PAD, GROUND - the single sources of truth
src/shaders.js        every GLSL program; the sampling model lives here
src/gl.js             context, program linking, geometry
src/textures.js       artwork upload; mkTex, where the padding trap lives
src/stage.js          the background and everything derived from its lightness
src/engine.js         state, draw(), the clock
src/controls.js       the tuning panel
src/render-api.js     window.RENDER - what the two python scripts drive
src/style.css
render.py             offline renderer, frame by frame into an mp4
regression.py         the standing check; run it after any change
assets/               the artwork
```

The scripts are **classic, loaded in dependency order, deliberately**. ES modules
do not load from `file://`, and this page has to open by double-click as readily
as through the renderer. They share one global scope, exactly as the single file
did — so order matters, and `page-flip.html` is where it is declared.

### Opening it

```bash
python -m http.server        # then open http://localhost:8000/page-flip.html
```

`loadAssets()` opens the page on the real artwork, in the filename order listed
in `src/assets.js` — **over http only**. Double-clicked, the page is a `file://`
document where every file is its own opaque origin, so uploading one of those
images taints the canvas `mkTex` draws through and `texImage2D` throws
`SecurityError`. That is caught, the placeholders stay up, and a line goes to the
console. Nothing else degrades: the picker still works, because a picked file
arrives as a blob from this document's own origin.

The file picker overrides the startup load whichever finishes first, and both
python scripts set `window.__noAutoload` before the page runs, so they never pay
for artwork they are about to replace.

---

## How it works

A flat artwork lies on the stage. The **right half is a sheet** hinged on the
vertical centre line; it rotates 0° → 180° and lands on the left half. Underneath
it, the base layer shows design A's left half and design B's right half. When the
sheet lands, its back face carries design B's left half — so design B is complete.
One sheet, reused, for any number of designs.

### The sampling model (this is the whole effect)

The artwork is **pinned to screen space**, not glued to the sheet. Each fragment
intersects the view ray with the z=0 plane and samples the artwork at that point:

```glsl
float t = uEye / (uEye - P.z);
vec2 sp = P.xy * t;            // == screen position == sample position
```

So the image never slides or distorts; the sheet moves underneath it. Blur and
darkening ramp with distance from the hinge, both finishing at 90°:

```glsl
float progress = clamp(foldAngle / 1.5707963, 0.0, 1.0);   // done by 90 degrees
float edge     = (uv.x - 0.5) / (uGradEnd - 0.5);          // 1.0 front, 0.0 back
float radius   = uMaxBlur * motion * pow(clamp(edge,0.,1.), 1.35);
```

`uGradEnd` and the progress direction are the *only* difference between the front
and back faces. The reversal comes out of the geometry for free.

Anything the sheet projects outside the artwork is drawn **black**, with coverage
blurred together with the colour so the image bleeds into that margin. This is
deliberate and matches the reference — do not "fix" it by clamping.

---

## Traps — every one of these was a real bug, do not reintroduce

1. **Two coordinate paths must agree.** The base and the sheet both sample the
   same texture through different code. Three separate bugs came from them
   disagreeing: vertical normalisation, edge clamping, and the padding remap.
   Any change to one path must be mirrored in the other.

2. **Never clamp the sample UV.** Repeating the edge pixel smears the artwork's
   border across the overhang. Use coverage → black instead.

3. **The texture is padded.** `mkTex` draws the artwork centred on a canvas
   `PAD` times larger. Every lookup must remap out of artwork space:
   `0.5 + (uv - 0.5) / uPad`. Blur offsets must use `uTexel * uPad`, not
   `uTexel`.

4. **The sheet carries no thickness.** Offsetting its surface along the normal
   breaks registration at both rest poses, because the projection divides by
   `uEye - P.z` with opposite signs at 0° and 180°. Thickness lives only in the
   edge strip.

5. **The edge strip's side flips at 90°.** The sheet normal points left on
   screen for the entire sweep, so the strip has to switch sides or it hides
   under the sheet for half the motion:
   `float side = c >= 0.0 ? -1.0 : 1.0;`

6. **The strip follows the corner radius.** It insets along the circle rather
   than being cut off, or the rounded corner is left with no thickness.

7. **Near-horizontal edges alias badly.** Perspective tilts the sheet's top and
   bottom rails slightly, which is the worst case for rasterisation. Coverage is
   computed analytically with `fwidth`; the hinge edge is deliberately left hard
   so it butts the fixed half with no seam.

8. **The stage colour has three surfaces, not one.** The GL clear colour, the
   CSS behind the canvas and the fill `mkTex` bakes into the texture padding are
   the same value or they are a bug. `stageFill()` is that value; nothing else
   may name a colour. Pin the padding back to a literal and a pale 1–3 px rim
   appears around the whole artwork the moment the stage is not off-white
   (measured: edge pixel 189 vs 132 on a `#101014` stage).

9. **The overhang floor goes on AFTER the darkening ramp.** `uEdgeFloor` is
   composited once the artwork has been through `uDarkGain` and the lighting,
   not before. Fill the margin first and the ramp crushes it: the ramp is
   strongest at the free edge, which is exactly where the sheet is furthest off
   the page and the silhouette matters most, so a lifted margin goes straight
   back to black there and the change buys nothing. The order is the whole fix.
   It costs nothing on a light stage — `uEdgeFloor` is zero — and **it does not
   show up in a pixel diff**, because the regression compares a mid-flip frame
   against a flat one and the margin is expected to differ in both orderings.
   Verify this one by rendering a dark-stage frame and looking at it.

### The regression test — run this after any change

```bash
pip install playwright numpy pillow && playwright install chromium
python regression.py                  # first artwork in assets/
python regression.py my-design.jpg
python regression.py --out frames/    # keep what it compared, to look at
```

It checks four stages — light, mid, dark, image — and prints a line per stage.
`UNEXPLAINED 0` everywhere is a pass; anything else is a bug you just wrote.
`worst ok` is the largest difference the mip slack absorbed: watch it for drift.
The script loads **one artwork as every design and has no flag to give it two**,
for the reason below.


Set blur, dark, light, thick and crease to 0, then compare a mid-flip frame
against the flat frame. With pinned sampling and no effects, **the sheet must be
invisible**: every pixel on it equals the pixel underneath.

Load **the same artwork for every design** — `regression.py` does this for you.
Past 90° the sheet legitimately carries design B, so with two different designs
~23% of the frame differs and the test tells you nothing. Then discount three
things, all of them expected:

- the black overhang wedges, and the ~2 px of anti-aliasing around them;
- everything outside the artwork rectangle — the contact shadow grows and
  deepens with the angle, so the stage around the artwork is *supposed* to move;
- a residue of a few units out of 255 (max 7 measured) where the sheet's
  explicit-LOD lookup and the base's plain `texture()` pick different mips.

What is left must be zero. Last run, on a light, a dark and an image stage:
0 / 33 / 32 pixels, all of them on the artwork's outer border column, where the
base blends its edge texel into the padding and the sheet does not. That is the
two-paths trap (#1) showing its floor, not a new bug — it is invisible on a
light stage and ~1 px wide on a dark one.

---

## Single sources of truth — keep them that way

```js
const CURVE  = [...];  // the timing curve, measured off the reference video
const SIZES  = [...];  // add a row to add a preset; no code branches on size
const GROUND = {...};  // how the artwork is planted on the stage, as a function
                       // of how light the stage is
```

All three live in `src/constants.js`. `GROUND` is the newest and the easiest to
scatter by accident: `lo`/`hi` are the luminance band the grounding crosses over
in, and every tint, gain and reach belongs in that object, not at a call site.

Current defaults (chosen by the user, do not change without asking):
`dur 3000ms · blur 150 · eye 560 · dark 250% · stick 0% · light 0% ·
thick 10 · fit 62% · rad 40 · crease 0%`

Note `stick` and `light` are both 0: the artwork stays undistorted and there is
no angle-based shading. That is intentional.

---

## Rendering

`render.py` owns the clock. It calls `window.RENDER.frame(i, p)` for an exact
progress value per frame — no requestAnimationFrame, no wall clock, no dropped
frames. A render is identical every run.

```bash
pip install playwright && playwright install chromium
python render.py d1.jpg d2.jpg d3.jpg -o book.mp4 --loop
```

`--loop` returns to the first design so the video can play seamlessly.
Flip duration lives here (`--flip`, default 3000); every other control comes
from the engine's defaults unless overridden with `--set key=value`.

---

## Phase two — what to build

### 1. Custom background — DONE

Solid colour (`#bgcol`) and image (`#bgpick`) behind a `#bgmode` select, all
three reachable from the renderer:

```bash
python render.py a.jpg b.jpg --set bgcol=#101014
python render.py a.jpg b.jpg --set bgimage=backdrop.jpg      # sets bgmode too
```

`bgimage` is inlined as a data URI by `render.py`: the page is loaded from
`file://` and a `file://` image would taint the canvas that `toDataURL()` has to
read. `RENDER.set` returns a promise for that one key and `page.evaluate` awaits
it, so no frame is captured before the background is up.

Three things worth knowing:

- **`stageFill()` is the single value.** Solid mode returns the picker colour;
  image mode returns a flat 32×32 average of the image. It feeds the clear
  colour, the CSS behind the canvas and `mkTex`'s padding. See trap 8.
- **Changing it repads every texture.** The padding is baked in at upload, so
  `bgcol` previews on `input` and rebuilds on `change`. `RENDER.set` fires both,
  but only for `bgcol`/`bgmode` — firing `change` on `#size` would throw the
  loaded designs away.
- **Grounding follows the stage.** See below.

### 1b. Grounding — DONE

`grounding()` takes `stageFill()`, measures its luminance, and returns a
cross-fade weight plus the colour the sheet's overhang margin sits at. Above
`GROUND.hi` nothing has changed from the original at all; below `GROUND.lo` the
engine is fully in lift mode; between them the two cross-fade, so dragging the
colour picker never pops.

- **The contact cue.** A shadow multiplies the stage down by a ratio — right on
  a light or mid stage, and it follows an image instead of sitting on it as a
  flat grey patch. Its factors are the old rgb divided by the old stage colour,
  so over `#f6f6f3` the frame is pixel-identical to the original fixed-grey
  shadow. On a dark stage there is nothing left to darken into, so a screen pass
  lifts instead. Same quad, same falloff, same strength curve; only the blend
  mode and the tint differ. The lift gets its own `liftGrow`, because a shadow's
  pool sits *under* the artwork where the opaque base hides it, and a lift is
  only worth anything on the stage around it.
- **The overhang margin comes up off black.** This is the part that does not show
  up in a pixel diff and has to be looked at. On `#101014` a black margin is
  black on black, and the sheet loses its outline at exactly the angle where it
  is most lifted off the page. `uEdgeFloor` replaces the hardcoded black, and is
  filled in *after* the darkening ramp — the ramp is a stylised effect on the
  artwork, and crushing the margin with it would put the silhouette straight back
  to black at the free edge, which is the far end of the ramp and precisely where
  the lift is needed. It is zero on a light stage, so nothing there changes.

Measured: `#101014` → lum 0.06, lift 1.00, margin 38. `#7d7f7a` → lum 0.50,
lift 0, margin still pure black. The gradient backdrop → lum 0.26, lift 0.43,
margin 30.

### 2. Project structure — DONE

The split is done (see the file list at the top), `regression.py` is the standing
check, the artwork loads from `assets/` on startup, and the project is under git.

### 3. Deploy to Vercel

This becomes the interactive version. Behance cannot host it — Behance accepts
iFrame embeds only from a whitelist of providers — so the plan is: the rendered
video goes in the Behance project, and a text module links to the live version.

### 4. Presentation decisions

How many designs, their order, per-flip timing, whether to pause between them.
These are taste calls, made while watching renders, not code.

---

## Working notes

Start on Sonnet — phase two is mostly structural and repetitive, and iteration
count matters more than depth per iteration. Switch to Opus (`/model opus`) for
anything touching the shader maths or a decision that constrains everything
downstream.

Verify visually. Every bug in this project was found by rendering a frame and
looking at it, or by measuring pixels — not by reading the code.
