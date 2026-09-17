/* The tuning panel. Reads nothing, owns nothing - it pokes the controls the
   engine already reads and asks for a redraw. */

SIZES.forEach((s,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=s.label; $('size').appendChild(o); });
// Auto is listed after the presets and selected by default: the default artwork
// (day/night, 1750x1134, 1.54:1) is no preset's shape, and a preset would stretch
// it to fit. Auto takes the stage from whatever is loaded.
$('size').appendChild(Object.assign(document.createElement('option'),
  { value:'auto', textContent:'Auto  (from the artwork)' }));
$('size').value = 'auto';

$('play').onclick = toggle;
cv.onclick = toggle;
/* Reset puts the panel back as it shipped - every slider to its default, the
   stage to its default colour - and leaves the artwork alone. (It used to call
   buildPlaceholders, which threw the loaded artwork away and touched no
   setting.) Defaults are read off the inputs, so on a phone Scale returns to
   the 90 mobile.js gave it, and there is no second copy of any number here. */
function resetSettings(){
  document.querySelectorAll('.panel input[type=range]').forEach(el => {
    el.value = el.defaultValue;
    el.dispatchEvent(new Event('input'));
  });
  $('bgcol').value = $('bgcol').defaultValue;
  $('bgmode').value = 'solid';
  applyBackground(true);
}
$('reset').onclick = resetSettings;
$('scrub').oninput = e => seek(e.target.value / 1000);

// stick and light have no card any more, so no value readout to update either
['dur','blur','eye','dark','crease','stick','light','thick','fit','rad'].forEach(id => $(id).oninput = e => {
  const out = $(id+'V');
  if (out) out.textContent = e.target.value + ({dur:'ms',blur:'px',eye:'',dark:'%',crease:'%',stick:'%',light:'%',thick:'',fit:'%',rad:''})[id];
  draw();
});
$('size').onchange = e => {
  if (e.target.value !== 'auto') SIZE = SIZES[+e.target.value];
  // rebuilding the placeholders is how a preset change takes effect - but only
  // when they are what is on the stage. It used to throw real artwork away.
  if (usingPlaceholders) buildPlaceholders(); else resize();
};

/* Background. There is no mode dropdown to set any more: touching the colour
   means you want the colour, and uploading an image means you want the image
   (loadBgImage flips the mode itself). syncBg then says which one is live. */
function syncBg(){
  const image = bgMode() === 'image' && BG.img;
  $('swatch').classList.toggle('on', !image);
  $('bgbtn').classList.toggle('on', !!image);
}
// dragging the picker previews the stage immediately; the textures are repadded
// on release, which is the only expensive half
$('bgcol').oninput   = () => { $('bgmode').value = 'solid'; applyBackground(false); };
$('bgcol').onchange  = () => { $('bgmode').value = 'solid'; applyBackground(true); };
$('bgmode').onchange = () => applyBackground(true);
$('bgpick').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  loadBgImage(URL.createObjectURL(f))
    .then(() => { window.__bgLoads = (window.__bgLoads || 0) + 1; });
};
$('pick').onchange = e => {
  const files = [...e.target.files]; if (!files.length) return;
  Promise.all(files.map(f => new Promise(res => {
    const im = new Image(); im.onload = () => res(im); im.src = URL.createObjectURL(f);
  }))).then(imgs => {
    userSupplied = true;                          // outranks the startup load
    setDesigns(imgs);
    window.__loads = (window.__loads || 0) + 1;   // render harness waits on this
  });
};
addEventListener('resize', resize);

syncPlay();
syncBg();
