/* The state, the frame, and the clock. draw() is the whole picture in one
   pass: background, grounding, base, edge strip, sheet. */

let sources = [];                  // the images themselves, kept so the padded
let designs = [], idx = 0, angle = 0, playing = false, t0 = 0;  // textures can
let SIZE = SIZES[0];                                            // be rebuilt
let userSupplied = false;          // the picker or the harness has spoken
let usingPlaceholders = true;      // nothing real is loaded, so a size change
                                   // may rebuild them - see controls.js

function rebuildTextures(){
  if (!sources.length) return;
  designs.forEach(d => gl.deleteTexture(d.tex));
  designs = sources.map(mkTex);
}
function applyBackground(rebuild){
  cv.style.background = stageFillCss();
  if (rebuild) rebuildTextures();   // the padding follows the stage, always
  syncBg();
  draw();
}

// The one way artwork enters the engine. Textures are built BEFORE the old ones
// are destroyed, so a failure (a file:// page taints the canvas mkTex draws
// through) leaves what is on screen alone instead of emptying the stage.
function setDesigns(imgs){
  const next = imgs.map(mkTex);
  designs.forEach(d => gl.deleteTexture(d.tex));
  sources = imgs; designs = next;
  usingPlaceholders = false;
  idx = 0; angle = 0;
  reportAspects(imgs);
  resize();      // not draw(): under Auto the stage itself has just changed shape
}

// uAspect is one uniform for every design, so a set of artwork that disagrees
// about its shape gets stretched to whichever one wins. That is survivable, but
// it must not be silent.
const ratio = (w, h) => (w/h).toFixed(2) + ':1';
function reportAspects(imgs){
  const wh = imgs.map(dims);
  const a  = wh.map(([w,h]) => w/h);
  const el = $('warn');
  if (Math.max(...a) / Math.min(...a) - 1 <= ASPECT_TOL) { el.hidden = true; return; }
  el.textContent = 'These designs do not share one aspect ratio ('
                 + wh.map(([w,h]) => ratio(w,h)).join(' · ') + '). The first one, '
                 + ratio(wh[0][0], wh[0][1]) + ', was adopted; the rest are stretched to fill it.';
  el.hidden = false;
}

// Open ready. Only works where the images are same-origin - over http, or the
// deployed site. Opened by double-click the page is a file:// document, every
// file is its own opaque origin, and uploading one of those images taints the
// canvas: caught here, and the placeholders stay up.
function loadAssets(){
  if (window.__noAutoload || !ASSETS.length) return Promise.resolve(false);
  return Promise.all(ASSETS.map(name => new Promise(res => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = 'assets/' + encodeURIComponent(name);
  }))).then(imgs => {
    const got = imgs.filter(Boolean);
    // the picker and the render harness both outrank the startup load, however
    // late this resolves
    if (!got.length || userSupplied) return false;
    try { setDesigns(got); } catch (e) {
      console.info('assets/ not loadable from this origin (' + e.name +
                   ') - serve the folder over http to open with them:' +
                   ' python -m http.server');
      return false;
    }
    return true;
  });
}

function buildPlaceholders(){
  designs.forEach(d => gl.deleteTexture(d.tex));
  // placeholders are drawn at the last chosen preset, so under Auto they are the
  // artwork: the aspect is that preset's, and the room is derived from it
  sources = [0,1,2].map(i => placeholder(i, SIZE.w, SIZE.h));
  designs = sources.map(mkTex);
  usingPlaceholders = true;
  $('warn').hidden = true;
  idx = 0; angle = 0; resize();
}

const dims = s => [s.naturalWidth || s.width, s.naturalHeight || s.height];

/* THE one place the stage's shape comes from.

   A preset is a fixed w/h floating in a fixed 16:10 room. Auto takes both from
   the artwork itself: uAspect was always a uniform and every texture already
   carries its own w/h, so this relaxes a constraint rather than adding a path.

   The room: a portrait design inside a 16:10 stage sits tiny in the middle with
   enormous side margins. Deriving it keeps the margin proportionate instead -
   solve for the stage that puts the same gap above and below the artwork as the
   `fit` control leaves at its sides:

       artwork width   = f · W                 margin per side = (1-f)/2 · W
       artwork height  = a · f · W             H = a·f·W + (1-f)·W
       room = W/H      = 1 / (a·f + 1 - f)

   f is the fit control's SHIPPED DEFAULT, read off the input, not its live
   value - the stage should not reflow while you drag a slider, and taking the
   number from the DOM means there is no second copy of 62 to drift. At that
   default a 2.40:1 panorama lands on room 1.566, within a hair of the 16:10
   this replaces, so Auto and the first preset look all but identical on it. */
function stageSize(){
  const auto = $('size').value === 'auto';
  if (!auto || !sources.length)
    return { auto, w:SIZE.w, h:SIZE.h, aspect:SIZE.h/SIZE.w, room:STAGE };
  const [w, h] = dims(sources[0]);
  const aspect = h / w;
  const f = +$('fit').defaultValue / 100;
  return { auto, w, h, aspect, room: 1 / (aspect * f + 1 - f) };
}

let LOCK = null;                           // set by the render harness
const OVERSAMPLE = Math.max(2, Math.min(devicePixelRatio || 1, 2)) * 1.25;

/* The stage is whatever is left once the panel and the bottom bar have taken
   what they need, so it is measured rather than assumed: the wrapper is a flex
   child with min-height 0, and this fits the room's aspect INSIDE that box.
   Contain, never cover - the stage must not be clipped at any window size. */
function resize(){
  if (LOCK) { cv.width = LOCK[0]; cv.height = LOCK[1];
              cv.style.width = '100%'; cv.style.height = 'auto'; draw(); return; }
  const room = stageSize().room;
  const box = cv.parentElement.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return;      // not laid out yet
  let w = box.width, h = w / room;
  if (h > box.height) { h = box.height; w = h * room; }
  cv.style.width  = Math.round(w) + 'px';
  cv.style.height = Math.round(h) + 'px';
  cv.width  = Math.round(w * OVERSAMPLE);
  cv.height = Math.round(h * OVERSAMPLE);
  draw();
}

function draw(){
  if (!designs.length) return;
  const A = designs[idx % designs.length];
  const B = designs[(idx+1) % designs.length];
  const aspect = stageSize().aspect;
  const eye = +$('eye').value / 100;
  const fit = +$('fit').value / 100;
  const rad = +$('rad').value / 1000;
  const back = angle > Math.PI/2;
  const prog01 = back ? (Math.PI - angle) / (Math.PI/2) : angle / (Math.PI/2);

  gl.viewport(0,0,cv.width,cv.height);
  gl.disable(gl.DEPTH_TEST);
  const G = grounding();              // same value mkTex padded the texture with
  const fill = G.fill;
  gl.clearColor(fill[0], fill[1], fill[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const S = cv.width / cv.height;

  // stage background image - a full-stage quad, cover-fitted, under everything
  if (bgMode() === 'image' && BG.img){
    const stageAR = cv.width / cv.height, imgAR = BG.w / BG.h;
    const cover = imgAR > stageAR ? [stageAR/imgAR, 1] : [1, imgAR/stageAR];
    gl.useProgram(pBG);
    gl.bindBuffer(gl.ARRAY_BUFFER, fullGeo.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, BG.img);
    gl.uniform1i(gl.getUniformLocation(pBG,'uBG'), 0);
    gl.uniform2f(gl.getUniformLocation(pBG,'uCover'), cover[0], cover[1]);
    gl.drawArrays(gl.TRIANGLES, 0, fullGeo.n);
  }

  // grounding - a shadow that multiplies the stage down by a ratio, a lift that
  // screens it up, or a cross-fade of the two. Same quad, same falloff, same
  // strength curve; only the blend mode and the tint differ.
  const amt = 0.30 + 0.22*Math.sin(angle);
  const pass = (screen, tint, a) => {
    if (a <= 0.0005) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(screen ? gl.ONE_MINUS_DST_COLOR : gl.DST_COLOR,
                 screen ? gl.ONE               : gl.ZERO);
    gl.useProgram(pSh);
    gl.bindBuffer(gl.ARRAY_BUFFER, fullGeo.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.uniform1f(gl.getUniformLocation(pSh,'uFit'), fit);
    gl.uniform1f(gl.getUniformLocation(pSh,'uS'), S);
    gl.uniform1f(gl.getUniformLocation(pSh,'uAspect'), aspect);
    gl.uniform1f(gl.getUniformLocation(pSh,'uGrow'),
                 0.05 + 0.05*Math.sin(angle) + (screen ? GROUND.liftGrow : 0));
    gl.uniform1f(gl.getUniformLocation(pSh,'uAmt'), a);
    gl.uniform1f(gl.getUniformLocation(pSh,'uScreen'), screen ? 1 : 0);
    gl.uniform3f(gl.getUniformLocation(pSh,'uTint'), tint[0], tint[1], tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, fullGeo.n);
    gl.disable(gl.BLEND);
  };
  pass(false, GROUND.shadow, amt * (1 - G.lift));
  pass(true,  GROUND.lift,   amt * G.lift * GROUND.liftGain);

  // base
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(pBase);
  gl.bindBuffer(gl.ARRAY_BUFFER, fullGeo.buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B.tex);
  gl.uniform1i(gl.getUniformLocation(pBase,'uA'), 0);
  gl.uniform1i(gl.getUniformLocation(pBase,'uB'), 1);
  gl.uniform1f(gl.getUniformLocation(pBase,'uShadow'), Math.sin(angle));
  gl.uniform1f(gl.getUniformLocation(pBase,'uCrease'), +$('crease').value/100);
  gl.uniform1f(gl.getUniformLocation(pBase,'uShadowX'), Math.cos(angle)*0.16);
  gl.uniform1f(gl.getUniformLocation(pBase,'uFit'), fit);
  gl.uniform1f(gl.getUniformLocation(pBase,'uPad'), PAD);
  gl.uniform1f(gl.getUniformLocation(pBase,'uS'), S);
  gl.uniform1f(gl.getUniformLocation(pBase,'uAspect'), aspect);
  gl.uniform1f(gl.getUniformLocation(pBase,'uRadius'), rad);
  gl.drawArrays(gl.TRIANGLES, 0, fullGeo.n);
  gl.disable(gl.BLEND);

  const thick = +$('thick').value / 1000;

  // page edge - the only thing left on screen when the sheet stands upright
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(pEdge);
  gl.bindBuffer(gl.ARRAY_BUFFER, edgeGeo.buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uAngle'), angle);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uAspect'), aspect);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uEye'), eye);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uThick'), thick);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uLight'), +$('light').value/100);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uRadius'), rad);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uFit'), fit);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uS'), S);
  gl.uniform1f(gl.getUniformLocation(pEdge,'uAspect'), aspect);
  gl.drawArrays(gl.TRIANGLES, 0, edgeGeo.n);

  // page
  const T = back ? B : A;
  gl.useProgram(pPage);
  gl.bindBuffer(gl.ARRAY_BUFFER, pageGeo.buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.tex);
  gl.uniform1i(gl.getUniformLocation(pPage,'uTex'), 0);
  gl.uniform2f(gl.getUniformLocation(pPage,'uTexel'), 1/T.w, 1/T.h);
  gl.uniform1f(gl.getUniformLocation(pPage,'uAngle'), angle);
  gl.uniform1f(gl.getUniformLocation(pPage,'uAspect'), aspect);
  gl.uniform1f(gl.getUniformLocation(pPage,'uEye'), eye);
  gl.uniform1f(gl.getUniformLocation(pPage,'uProgress'), prog01);
  gl.uniform1f(gl.getUniformLocation(pPage,'uGradEnd'), back ? 0.0 : 1.0);
  gl.uniform1f(gl.getUniformLocation(pPage,'uMaxBlur'), +$('blur').value);
  gl.uniform1f(gl.getUniformLocation(pPage,'uDarkGain'), +$('dark').value/100);
  gl.uniform1f(gl.getUniformLocation(pPage,'uThick'), thick);
  gl.uniform1f(gl.getUniformLocation(pPage,'uStick'), +$('stick').value/100);
  gl.uniform1f(gl.getUniformLocation(pPage,'uLight'), +$('light').value/100);
  gl.uniform1f(gl.getUniformLocation(pPage,'uSheen'), +$('light').value/100 * 0.16);
  gl.uniform1f(gl.getUniformLocation(pPage,'uBack'), back ? 1 : 0);
  gl.uniform3f(gl.getUniformLocation(pPage,'uEdgeFloor'), G.floor[0], G.floor[1], G.floor[2]);
  gl.uniform1f(gl.getUniformLocation(pPage,'uRadius'), rad);
  gl.uniform1f(gl.getUniformLocation(pPage,'uFit'), fit);
  gl.uniform1f(gl.getUniformLocation(pPage,'uPad'), PAD);
  gl.uniform1f(gl.getUniformLocation(pPage,'uS'), S);
  gl.uniform1f(gl.getUniformLocation(pPage,'uAspect'), aspect);
  gl.drawArrays(gl.TRIANGLES, 0, pageGeo.n);
  gl.disable(gl.BLEND);

  $('mA').textContent = (angle*180/Math.PI).toFixed(1)+'°';
  $('mP').textContent = (prog01*100).toFixed(0)+'%';
  $('mF').textContent = back ? 'Back' : 'Front';
  $('mI').textContent = ((idx % designs.length)+1)+' / '+designs.length;
  $('mS').textContent = ratio(1, aspect) + (stageSize().auto ? ' · auto' : '');
  $('scrub').value = Math.round(angle/Math.PI*1000);
}

/* One clock, three ways to move it: play, pause and the scrub handle. `held` is
   how far into the flip we are while stopped, in milliseconds, so resuming and
   scrubbing both mean the same thing to tick(). */
let held = 0;
function tick(now){
  if (!playing) return;
  const p = Math.min((now - t0) / +$('dur').value, 1);
  angle = ease(p) * Math.PI;
  draw();
  if (p < 1) requestAnimationFrame(tick);
  else { playing = false; held = 0; idx = (idx+1) % designs.length; angle = 0;
         draw(); syncPlay(); }
}
function play(){
  if (playing || !designs.length) return;
  playing = true; t0 = performance.now() - held;
  syncPlay(); requestAnimationFrame(tick);
}
function pause(){
  if (!playing) return;
  playing = false; held = performance.now() - t0;
  syncPlay();
}
function toggle(){ playing ? pause() : play(); }

// dropping the playhead somewhere has to move the clock with it, or play would
// jump back to wherever it was left
function seek(v01){
  pause();
  angle = v01 * Math.PI;
  held  = unease(v01) * +$('dur').value;
  draw();
}

// the two play buttons are one state: the big one is a resting-state affordance,
// so it goes away while the thing is actually moving
function syncPlay(){
  const label = playing ? 'Pause' : 'Play';
  for (const b of [$('play'), $('playbig')]) {
    b.classList.toggle('is-playing', playing);
    b.setAttribute('aria-label', label);
  }
  $('playbig').hidden = playing;
}
