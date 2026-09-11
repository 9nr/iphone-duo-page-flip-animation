/* The stage: what is behind the artwork, and everything derived from how light
   it is. stageFill() is the one value the clear colour, the CSS and the texture
   padding all come from. */

/* ONE value drives three surfaces: the GL clear colour, the fill behind the
   canvas, and the padding mkTex bakes into every texture. They cannot be
   allowed to disagree - that disagreement IS the halo. */
let BG = { img:null, w:1, h:1, avg:[0.965, 0.965, 0.953] };

const hexRGB = h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255)/255, (n >> 8 & 255)/255, (n & 255)/255];
};
function stageFill(){
  // an image background cannot be matched pixel for pixel by a flat padding
  // fill, so its flat average stands in for it - close enough that the
  // overhang reads as stage, never as a ring
  return (bgMode() === 'image' && BG.img) ? BG.avg : hexRGB($('bgcol').value);
}
const bgMode = () => $('bgmode').value;
const stageFillCss = () => 'rgb(' + stageFill().map(v => Math.round(v*255)).join(',') + ')';

const lum = c => 0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x-a)/(b-a))); return t*t*(3-2*t); };

// Everything that depends on how light the stage is, derived in one place from
// stageFill() - the same value the padding and the clear colour come from.
function grounding(){
  const fill = stageFill();
  const lift = 1 - sstep(GROUND.lo, GROUND.hi, lum(fill));
  return { fill, lift,
           floor: fill.map(v => lift * (v * GROUND.floor.scale + GROUND.floor.base)) };
}

function loadBgImage(src){
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      if (BG.img) gl.deleteTexture(BG.img);
      const sc = document.createElement('canvas'); sc.width = sc.height = 32;
      const sx = sc.getContext('2d'); sx.imageSmoothingQuality = 'high';
      sx.drawImage(im, 0, 0, 32, 32);
      const d = sx.getImageData(0, 0, 32, 32).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4){ r += d[i]; g += d[i+1]; b += d[i+2]; }
      const n = d.length / 4;
      BG.avg = [r/n/255, g/n/255, b/n/255];
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,im);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      BG.img = t; BG.w = im.naturalWidth || im.width; BG.h = im.naturalHeight || im.height;
      $('bgmode').value = 'image';
      applyBackground(true);
      res(true);
    };
    im.onerror = () => rej(new Error('background image failed to load: ' + src.slice(0, 64)));
    im.src = src;
  });
}
