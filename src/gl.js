/* Context, program linking, geometry. Runs at load, so it needs the canvas in
   the document and shaders.js already parsed. */

const $ = id => document.getElementById(id);

const cv = document.getElementById('stage');
const gl = cv.getContext('webgl2', {antialias:true, premultipliedAlpha:false, preserveDrawingBuffer:true});
if (!gl) document.body.innerHTML = '<p style="padding:40px">WebGL2 غير مدعوم بهذا المتصفح.</p>';

function prog(vs, fs){
  const c = (t,s)=>{const o=gl.createShader(t);gl.shaderSource(o,s);gl.compileShader(o);
    if(!gl.getShaderParameter(o,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o;};
  const p = gl.createProgram();
  gl.attachShader(p, c(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, c(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const pPage = prog(VERT, FRAG);
const pBase = prog(BASE_VERT, BASE_FRAG);
const pEdge = prog(EDGE_VERT, EDGE_FRAG);
const pSh   = prog(SH_VERT, SH_FRAG);
const pBG   = prog(BG_VERT, BG_FRAG);

function quad(x0,x1,y0,y1,seg){
  const v = [];
  for (let i=0;i<seg;i++) for (let j=0;j<seg;j++){
    const a=x0+(x1-x0)*i/seg, b=x0+(x1-x0)*(i+1)/seg;
    const c=y0+(y1-y0)*j/seg, d=y0+(y1-y0)*(j+1)/seg;
    v.push(a,c, b,c, b,d, a,c, b,d, a,d);
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  return {buf, n: v.length/2};
}
const pageGeo = quad(0,1,-1,1,48);   // hinge at x=0, free edge at x=1
const fullGeo = quad(-1,1,-1,1,1);
const edgeGeo = quad(0,1,-1,1,64);
