/* Phones. The stylesheet does the reshaping; this does the two things CSS
   cannot: a phone-sized Scale default, and the settings sheet - opening it,
   moving the artwork clear of it, and closing it by drag, tap-outside or Esc.

   Everything is gated on the same media query the stylesheet uses, so a
   desktop window never runs any of it. render.py and regression.py drive a
   1400x1000 viewport and are untouched. */

const PHONE = matchMedia('(max-width: 760px), (max-height: 520px)');
const FLAT  = matchMedia('(max-height: 520px) and (orientation: landscape)');

/* Scale: 62% suits a wide window, but on a portrait screen it leaves the
   artwork small. On a phone the shipped default is 90 instead. It is set as
   the input's defaultValue - stageSize() reads the stage's shape off that, and
   there is still only one number per layout, living on the input. */
if (PHONE.matches) {
  const fit = $('fit');
  fit.defaultValue = '90';
  fit.value = '90';
  fit.dispatchEvent(new Event('input'));
}

const sheetEl = $('panel');
const stageBox = cv.parentElement;
const EDGE = 12;                              // the .app padding on a phone (PAD is taken)

function sheetOpen(){ return document.body.classList.contains('sheet-open'); }

/* Open the sheet and slide the artwork out of its way: up to the top of the
   screen for a sheet from below, left for one from the right. The stage keeps
   its layout box - only a transform moves it - so resize() is not involved. */
function openSheet(){
  if (!PHONE.matches) return;
  stageBox.style.transform = '';
  const r = cv.getBoundingClientRect();
  if (FLAT.matches) {
    const sheetW = Math.min(360, innerWidth * 0.48);
    const overlap = r.right - (innerWidth - sheetW - EDGE);
    const shift = Math.max(0, Math.min(r.left - EDGE, overlap));
    stageBox.style.transform = `translateX(${-shift}px)`;
    sheetEl.style.height = '';
  } else {
    const lift = Math.max(0, r.top - EDGE);
    // the sheet takes what the artwork leaves, within sensible bounds
    const h = Math.max(innerHeight * 0.42, Math.min(innerHeight - (EDGE + r.height + 14), innerHeight * 0.72));
    stageBox.style.transform = `translateY(${-lift}px)`;
    sheetEl.style.height = Math.round(h) + 'px';
  }
  document.body.classList.add('sheet-open');
  $('openSettings').setAttribute('aria-expanded', 'true');
}

function closeSheet(){
  document.body.classList.remove('sheet-open');
  stageBox.style.transform = '';
  sheetEl.style.setProperty('--drag', '0px');
  $('openSettings').setAttribute('aria-expanded', 'false');
}

$('openSettings').onclick = openSheet;
$('closeSettings').onclick = closeSheet;
addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });

/* A tap anywhere outside closes it - except on the artwork, which stays a play
   button, so you can play the turn while the sheet is up. */
document.addEventListener('pointerdown', e => {
  if (!sheetOpen()) return;
  if (sheetEl.contains(e.target) || e.target === cv || $('openSettings').contains(e.target)) return;
  closeSheet();
});

/* Drag the sheet down by its handle or title to dismiss it. */
let dragFrom = null;
[$('sheetHandle'), sheetEl.querySelector('.panel-head')].forEach(el => {
  el.addEventListener('pointerdown', e => {
    if (FLAT.matches || e.target.closest('.sheet-close')) return;
    dragFrom = e.clientY;
    sheetEl.style.transition = 'none';
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', e => {
    if (dragFrom === null) return;
    sheetEl.style.setProperty('--drag', Math.max(0, e.clientY - dragFrom) + 'px');
  });
  const release = e => {
    if (dragFrom === null) return;
    const moved = e.clientY - dragFrom;
    dragFrom = null;
    sheetEl.style.transition = '';
    sheetEl.style.setProperty('--drag', '0px');
    if (e.type === 'pointerup' && moved > 80) closeSheet();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
});

/* Rotating or resizing: the stage has been re-measured by resize() (registered
   earlier, so it runs first); re-place the sheet against the new artwork, or
   drop it entirely if the window is no longer phone-sized. */
addEventListener('resize', () => {
  if (!sheetOpen()) return;
  if (!PHONE.matches) closeSheet();
  else requestAnimationFrame(openSheet);
});
