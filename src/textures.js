/* Artwork upload. mkTex is where the padding trap lives: the fill comes from
   stageFillCss(), never from a literal. */

function mkTex(src){
  // draw the artwork centred on a padded canvas filled with the stage colour,
  // so anything the perspective reaches for beyond the artwork is real surface.
  // The fill MUST come from stageFillCss() - the same value that clears the
  // stage. Hardcode it here and a pale halo appears around the artwork the
  // moment the stage changes colour.
  const pc = document.createElement('canvas');
  pc.width  = Math.round(src.width  * PAD);
  pc.height = Math.round(src.height * PAD);
  const px = pc.getContext('2d');
  px.fillStyle = stageFillCss(); px.fillRect(0, 0, pc.width, pc.height);
  px.drawImage(src, Math.round((pc.width - src.width)/2), Math.round((pc.height - src.height)/2));
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,pc);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return {tex:t, w:pc.width, h:pc.height};
}

/* placeholder panoramas so the thing runs before anything is loaded */
function placeholder(i, W, H){
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const x = c.getContext('2d');
  const tints = [['#e8eef4','#b9cede'],['#f4e9ee','#dcb9cb'],['#eaf1e6','#bed6ae']];
  const g = x.createLinearGradient(0,0,W,H);
  g.addColorStop(0, tints[i%3][0]); g.addColorStop(1, tints[i%3][1]);
  x.fillStyle=g; x.fillRect(0,0,W,H);
  x.strokeStyle='rgba(40,48,42,.10)'; x.lineWidth=Math.max(1,W/1400);
  for(let k=0;k<W;k+=Math.round(W/90)){x.beginPath();x.moveTo(k,0);x.lineTo(k,H);x.stroke();}
  for(let k=0;k<H;k+=Math.round(W/90)){x.beginPath();x.moveTo(0,k);x.lineTo(W,k);x.stroke();}
  x.fillStyle='rgba(40,48,42,.80)';
  x.font=`700 ${Math.round(H*0.42)}px -apple-system,sans-serif`;
  x.textAlign='center'; x.textBaseline='middle';
  x.fillText('DESIGN '+(i+1), W/2, H/2);
  x.font=`600 ${Math.round(H*0.075)}px -apple-system,sans-serif`;
  x.fillText('hinge  =  centre line', W/2, H*0.80);
  return c;
}
