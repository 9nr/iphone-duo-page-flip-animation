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

10. **One bad script takes out everything it defines.** The engine is nine
   classic scripts sharing a single global scope, so a file that fails to parse
   — or that parses and then throws on the way up — silently removes every
   function in it, and the symptom surfaces as a missing function somewhere else
   entirely. An unescaped apostrophe in a string in `engine.js` presented as
   `buildPlaceholders is not defined`. Both gates at the top of `regression.py`
   exist for this: `node --check` on every `src/*.js` before the browser starts,
   and a hard stop if the page reaches `window.RENDER` with any page or console
   error. `window.RENDER` on its own proves nothing — `render-api.js` is its own
   file and comes up fine while the engine underneath it is gone.

11. **The page needs its `<meta charset="utf-8">`.** It is loaded from
   `file://`, where there are no HTTP headers to say otherwise, so Chrome
   guesses — and once the UI text became mostly ASCII the guess flipped to
   Latin-1 and every `×`, `°` and `·` turned into mojibake. The Arabic UI hid
   this by giving the detector enough to go on. The tag is the fix; do not
   remove it.

12. **The corner routine is gated to the corner box on purpose.** Three things
   are rounded by `uRadius`: the sheet's silhouette, the base's silhouette, and
   the artwork's own boundary inside the sheet (`cov0`). All three go through
   `cornerDist`/`cornerCov` in `src/shaders.js` — one radius, one shape, no
   second copy to drift. The gotcha is that `length(max(r - e, 0)) - r` is the
   *whole* rounded-rectangle distance field, straight edges included, and those
   edges already have coverage of their own; using it wholesale double-ramps
   every edge by about a pixel. Measured: 3627 pixels changed, in thin lines
   along all four straight edges, before the box gate went back in. Reporting 0
   outside the corner box leaves the straight edges to the coverage that owns
   them, and the change then touches corners and nothing else — 441 pixels, all
   within 24px of an artwork corner where the radius is 22px.

   **Gate where it applies, never the distance itself.** The first version of
   this gate made `cornerDist` return 0 outside the corner box, which put a
   cliff in the field — and `fwidth` across the quad straddling that cliff came
   back enormous, widening the ramp until the stage showed through the artwork.
   One bright pixel row per corner, at `dy = r - 1`: invisible on light artwork,
   a light hairline arc on dark. Measured before and after: row `dy+19` went
   `245 241 232 220 196 …` where every neighbouring row read `8 9 8 9 …`. The
   distance stays continuous (`length(max(r - e, 0))`, the true field); a
   `step`-gated `mix` decides where the ramp applies.

   It is also split into distance and ramp rather than one function, because
   `fwidth` is only defined in uniform control flow and the blur loop runs
   inside `if (radius > 0.5)`, which is per-fragment. Each caller supplies a
   width it is allowed to compute where it stands: `fwidth` at the top level,
   the blur footprint inside the loop. The old inline version called `fwidth`
   inside `if (ox < uRadius && oy < uRadius)` — non-uniform, and undefined by
   the spec.

### The regression test — run this after any change

```bash
pip install playwright numpy pillow && playwright install chromium
python regression.py                  # first artwork in assets/
python regression.py my-design.jpg
python regression.py --out frames/    # keep what it compared, to look at
```

It opens with `parse check:` and `load check:` — the two gates from trap 10,
both of which stop the run outright rather than reporting a diff against a
half-loaded engine. Then it checks four stages — light, mid, dark, image — for
**two artworks**: yours, and a generated near-black one.

**Why both artworks, and why that is still not enough.** A light artwork on a
light stage cannot show a coverage gap: both sides of the hole are pale. On dark
artwork the stage shows through as a bright line. But this check compares a flat
frame against a mid-flip one, so a hole that sits in the same place in both
cancels out and reads as no difference at all — the corner defect of trap 12
passed the dark pass too. Hence the last two lines of a run:

```
holes   flat         0 px of stage showing through the card
holes   mid          0 px of stage showing through the card
```

Dark artwork on a **magenta** stage, asserting that no pixel strictly inside the
rounded card shows any stage colour. The base covers the whole card at every
angle and the sheet only ever adds to it, so any magenta inside is a gap. It
asks what is on screen rather than what moved, which is the axis the table
misses. Verified both ways: the buggy build fails it with 49 pixels and exit 1,
the fixed build reports 0.
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
const STAGE  = 16/10;  // the room a PRESET floats in; Auto derives its own
```

and, in `src/shaders.js`, the `CORNER` snippet — `cornerDist`, `cornerCov` and
`artEdge` — spliced into both fragment shaders that round anything. One radius,
one shape; see trap 12.

and one function, `stageSize()` in `src/engine.js`, which is the only place the
stage's shape is decided. Read the aspect from there, never from `SIZE` — under
Auto `SIZE` is just the preset the placeholders are drawn at.

All three live in `src/constants.js`. `GROUND` is the newest and the easiest to
scatter by accident: `lo`/`hi` are the luminance band the grounding crosses over
in, and every tint, gain and reach belongs in that object, not at a call site.

Current defaults (chosen by the user, do not change without asking):
`dur 3000ms · blur 150 · eye 560 · dark 250% · stick 0% · light 0% ·
thick 20 · fit 62% · rad 40 · crease 0% · size Auto`

The page opens on **Auto**, because the default artwork (`assets/day.png` and
`assets/night.png`, 1750x1134, 1.54:1) is no preset's shape and a preset would
stretch it by more than half. That also moves `render.py`'s default: with
`--size` omitted it now renders at the artwork's own width. Pass `--set size=0`
to get a preset and the old 2160x1350.

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

### 1c. Auto size — DONE

A fourth entry in the size dropdown, after the presets, which keeps their
behaviour exactly. Under Auto both the artwork's aspect and the room it floats
in come from the artwork itself — `uAspect` was always a uniform and every
texture already carries its own `w/h`, so this relaxes a constraint rather than
adding a path.

**The room.** A portrait design dropped into a 16:10 stage sits tiny in the
middle between two huge side margins. Auto solves for the stage that leaves the
same gap above and below the artwork as `fit` leaves at its sides:

```
artwork width = f·W      margin per side = (1-f)/2·W
artwork height = a·f·W   H = a·f·W + (1-f)·W
room = W/H = 1 / (a·f + 1 - f)                     a = artwork h/w
```

`f` is the fit control's **shipped default, read off the input's `defaultValue`**
— not its live value, or the stage would reflow while you drag a slider, and not
a second copy of `62` that could drift. At that default a 2.40:1 panorama lands
on room 1.566 against the 16:10 it replaces, so Auto and the first preset look
all but identical on the artwork the presets were chosen for. Measured:
`3240x1350 → room 1.567`, `1080x1920 → 0.675`, `1500x1500 → 1.000`.

**Mismatched artwork.** One `uAspect` serves every design, so a set that
disagrees about its shape gets stretched to whichever one wins. It now says so:
`setDesigns()` compares the aspects, and outside `ASPECT_TOL` (1%) it puts a
banner above the meta line naming every ratio and which one was adopted (the
first). It still stretches the rest — it just no longer does it quietly.

**`render.py --size`.** Omitted on a preset it is still `2160x1350`. Omitted on
an Auto stage it takes the artwork's own pixel width and the height that
artwork's room implies, so `--set size=auto` is all you need:

```bash
python render.py portrait1.png portrait2.png --set size=auto   # -> 1080x1600
```

That renders the artwork at `fit` of its native width; pass `--size` explicitly
for 1:1. An explicit `--size` always wins. `--size` is read **after** `--set`,
which is what lets the page be in Auto by the time the stage is asked.

**A preset change no longer destroys loaded artwork.** It used to call
`buildPlaceholders()` unconditionally; it now only does that when placeholders
are what is on the stage (`usingPlaceholders`). That was a latent bug, and it is
also what makes `--set size=` usable from the renderer at all.

### Known: the width-tied units do not follow the aspect

`blur`, `rad` and `thick` are all expressed against the page's width, so the
same numbers read very differently on a page that is not a wide panorama.
Nothing here is a bug and the defaults are unchanged — but know what you are
looking at before re-tuning. Measured at the Auto stage for each aspect:

| artwork | stage | artwork px | corner r | r / page height | edge strip | blur | blur / page width |
|---|---|---|---|---|---|---|---|
| 3240×1350 | 3240×2068 | 2010×838 | 40 px | 4.8% | 10.0 px | 93 px | 4.6% |
| 1080×1920 | 1080×1600 | 670×1192 | 13 px | 1.1% | 3.3 px | 93 px | 13.9% |
| 1500×1500 | 1500×1500 | 930×930 | 19 px | 2.0% | 4.7 px | 93 px | 10.0% |

`rad` and `thick` are world units where 1 = half the page width, so both shrink
with a narrower stage; on the portrait the rounded corner is about a fifth of
its panorama size relative to the page, and the edge strip is a 3 px hairline.
`blur` is in **source pixels**, so it lands on the same 93 px in all three, which
is 3× as much of the page on a 1080-wide portrait as on a 3240-wide panorama.
If these ever need to follow the page, the honest fix is to express them against
the page's **shorter** side in `stageSize()` — one place, no new branch.

### 1d. The panel — DONE

Rebuilt to a fixed one-viewport layout: settings down the left, the stage in the
middle, one pill bar and the readouts underneath. The point is being able to
watch the stage while dragging a slider — the panel used to sit below it.

- **Nothing knows a stage size.** `resize()` measures the wrapper it was given
  and fits the room's aspect *inside* that box — contain, never cover — so the
  stage is never clipped at any window size. `body{overflow:hidden}` and a
  `100dvh` grid mean the page itself cannot scroll; when the window is too short
  for the cards, the panel scrolls internally and the stage keeps its space.
- **Play/pause.** One clock, three ways to move it: `play()`, `pause()` and
  `seek()`. `held` is how far into a flip we are while stopped, in ms, so
  resuming and scrubbing mean the same thing to `tick()`. Scrubbing uses
  `unease()` — the exact inverse of `CURVE`, which is piecewise linear and
  monotonic — so dropping the playhead at 60% and pressing play carries on from
  there. Clicking the stage toggles. There is no overlay button on the stage -
  it was removed so nothing covers the artwork; the artwork itself is the play
  target, and the bar keeps its own play button.
- **Perspective and Lighting left the panel, not the engine.** `#stick` and
  `#light` are still in the document (hidden, at 0), still read by `draw()`,
  still settable with `--set stick=` / `--set light=`. Verified: `--set
  light=60` moves 5% of the frame, `--set stick=50` moves 4%, and putting both
  back to 0 gives a pixel-identical frame. Delete the inputs and you delete the
  uniforms' only route in.
- **The background mode is inferred.** There is no mode dropdown: touching the
  colour sets `solid`, uploading an image sets `image` (`loadBgImage` already
  did). `#bgmode` stays in the document for `--set bgmode=`, and `syncBg()`
  lights whichever of the two is live.

### 2. Project structure — DONE

The split is done (see the file list at the top), `regression.py` is the standing
check, the artwork loads from `assets/` on startup, and the project is under git.

### 3. Deploy to Vercel — DONE, public

Production: `https://iphone-duo-page-flip-animation.vercel.app`, project
`nader-asaad/iphone-duo-page-flip-animation` (renamed from `page-flip`; the old
`page-flip-tawny.vercel.app` domain still points at the same deployment). The
page title - the browser tab and link previews - is
`Iphone Duo - page-flip animation`. Vercel project names cannot hold capitals or
spaces, hence the slug.
Static, no build: `vercel.json` turns off framework detection and the build step,
serves the repo root and rewrites `/` to `page-flip.html`.

- **The default artwork is deployed AND in git.** The live page opens on
  `assets/day.png` and `assets/night.png`, like the local one, and the GitHub
  repository carries the same two files - GitHub is the same final version as
  the site, plus the tooling and these notes. `.vercelignore` keeps out only the
  python tooling, `HANDOFF.md` and `.claude/`. The two ignore files are
  independent, and the Vercel CLI reads only `.vercelignore` when one exists.
  Only day/night were ever committed: the four earlier `DT grid` images were
  removed from the entire history before the first push. For a while the deploy shipped no artwork at
  all (an empty-list rewrite of `src/assets.js`); that opened the public page on
  the placeholders, which is not what anyone previewing it wants.
- **Excluding a file does not remove it from earlier deploys.** Every deployment
  keeps its own files. The first one carried the artwork and had to be deleted:
  `vercel remove <deployment-url>` — the deployment URL, never the project name,
  which removes the whole project.
- **Public, with protection OFF - not merely Standard.** `ssoProtection` is
  `null`. Standard (`all_except_custom_domains`) makes the production domain
  public but keeps every per-deployment URL behind a Vercel login, and that is
  the URL the dashboard hands out - copy it and the link looks private to
  everyone else. With protection off every URL answers 200, and the page sends
  no `X-Frame-Options` or CSP, so it embeds in a cross-origin iframe (checked).
  That is what the Behance plan needs: the video in the project, a text module
  linking here.
- **The three values.** `null`: everything public. `all_except_custom_domains`:
  production public, deployment URLs behind login. `all`: everything behind
  login - and the login page refuses framing (`X-Frame-Options: DENY`,
  `frame-ancestors 'none'`), so a private site is also not embeddable.

```bash
npx vercel@59.16.0 deploy --prod
```

```bash
npx vercel@59.16.0 project protection iphone-duo-page-flip-animation
```

The CLI's `protection` command toggles protection but cannot choose its scope;
that is a PATCH to the project with `{"ssoProtection":null}` (public, as now),
`{"ssoProtection":{"deploymentType":"all"}}` (private) or
`{"ssoProtection":{"deploymentType":"all_except_custom_domains"}}` (Standard),
sent through `vercel api` so the CLI's own session authenticates it:

```bash
MSYS_NO_PATHCONV=1 npx vercel@59.16.0 api /v9/projects/iphone-duo-page-flip-animation -X PATCH --input body.json
```

From Git Bash the `MSYS_NO_PATHCONV=1` is not optional: MSYS rewrites any argument
starting with `/` into a Windows path, and the CLI then reports an invalid
endpoint without sending anything.

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
