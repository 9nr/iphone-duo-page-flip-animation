/* The tuning panel. Reads nothing, owns nothing - it pokes the controls the
   engine already reads and asks for a redraw. */

SIZES.forEach((s,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=s.label; $('size').appendChild(o); });

$('flip').onclick = flip;
cv.onclick = flip;
$('reset').onclick = buildPlaceholders;
$('scrub').oninput = e => { playing = false; angle = e.target.value/1000*Math.PI; draw(); };
['dur','blur','eye','dark','crease','stick','light','thick','fit','rad'].forEach(id => $(id).oninput = e => {
  $(id+'V').textContent = e.target.value + ({dur:'ms',blur:'px',eye:'',dark:'%',crease:'%',stick:'%',light:'%',thick:'',fit:'%',rad:''})[id];
  draw();
});
$('size').onchange = e => { SIZE = SIZES[+e.target.value]; resize(); buildPlaceholders(); };
// dragging the picker previews the stage immediately; the textures are repadded
// on release, which is the only expensive half
$('bgcol').oninput   = () => applyBackground(false);
$('bgcol').onchange  = () => applyBackground(true);
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
