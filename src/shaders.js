/* Every GLSL program in the engine. The sampling model lives here: read the
   handoff before touching vProj, the padding remap or the coverage maths. */

const CORNER = `
/* THE rounded corner. One radius, one shape, one routine - the sheet's
   silhouette, the base's silhouette and the artwork's own boundary inside the
   sheet all go through this, so they cannot drift apart.

   'e' is the distance from the nearest edge on each axis, in the units uRadius
   is expressed in: half the artwork width is 1, and the vertical axis carries
   the aspect so the corner is a circle and not an ellipse. Pass whichever edges
   should be rounded - the sheet leaves its hinge side square by measuring only
   its free edge.

   The distance is the true rounded-box field, length(max(r - e, 0)), which is
   continuous everywhere. That matters more than it looks: a version that
   reported 0 outside the corner box put a cliff in the distance, and fwidth
   across the quad straddling that cliff came back enormous, widening the ramp
   until the stage showed through the artwork - one bright pixel row per corner,
   invisible on light artwork and a hairline arc on dark. Keep it continuous.

   That field also describes the straight edges, and those already have coverage
   of their own, so applying it whole double-ramps every edge by a pixel. The
   corner box gates where it APPLIES, without touching the distance itself.

   Split in two because of derivatives. fwidth is only defined in uniform
   control flow, and the blur loop runs inside 'if (radius > 0.5)', which is
   per-fragment. So the distance is one function, the ramp is another, and each
   caller supplies a width it is allowed to compute where it stands. */
float cornerDist(vec2 e, float r){
  return length(max(vec2(r) - e, vec2(0.0)));
}
float cornerCov(vec2 e, float r, float w){
  if (r <= 0.0001) return 1.0;
  float ramp = 1.0 - smoothstep(r - max(w, 1e-5), r, cornerDist(e, r));
  return mix(1.0, ramp, step(e.x, r) * step(e.y, r));
}

/* Distance from the artwork's own four edges, for a sample in artwork uv. */
vec2 artEdge(vec2 uv, float aspect){
  return vec2((0.5 - abs(uv.x - 0.5)) * 2.0,
              (0.5 - abs(uv.y - 0.5)) * 2.0 * aspect);
}
`;

const VERT = `#version 300 es
in vec2 aPos;
uniform float uAngle, uAspect, uEye, uThick, uFit, uS;
out vec2 vProj;      // pinned-to-screen sample position (Apple behaviour)
out vec2 vSheet;     // locked-to-the-sheet sample position (perspective warp)
out vec3 vN;         // world normal, for lighting
out vec3 vP;         // world position
void main(){
  float u = aPos.x;
  float v = aPos.y * uAspect;
  float c = cos(uAngle), s = sin(uAngle);
  vec3 P = vec3(u*c, v, u*s);   // exactly on its plane at both rest poses
  float t = uEye / (uEye - P.z);
  vec2 sp = P.xy * t;
  // normalise y the same way the base layer does, or the sheet samples only
  // the middle band of the artwork and stretches it over the full height
  vProj  = vec2(sp.x, sp.y / uAspect);
  vSheet = vec2(u, aPos.y);          // constant in sheet space -> warps on screen
  vN = normalize(vec3(-s, 0.0, c));
  vP = P;
  gl_Position = vec4(sp.x*uFit, sp.y*uFit*uS, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vProj; in vec2 vSheet; in vec3 vN; in vec3 vP;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2  uTexel;
uniform float uProgress, uGradEnd, uMaxBlur, uDarkGain, uRadius, uAspect, uPad;
uniform vec3  uEdgeFloor;  // what the overhang margin sits at - black on a light
                           // stage, lifted on a dark one so the sheet keeps its
                           // silhouette instead of going black on black
vec2 toTex(vec2 v){ return 0.5 + (v - 0.5) / uPad; }
uniform float uStick;     // 0 = pinned to screen, 1 = locked to the sheet
uniform float uLight, uSheen;
uniform float uBack;
${CORNER}
void main(){
  // --- pinned sample (Apple): the intersection of the view ray with z=0
  vec2 uvPin = vProj * 0.5 + 0.5;  uvPin.y = 1.0 - uvPin.y;

  // --- sheet-locked sample: the image is glued to the rotating page
  float sx = uBack > 0.5 ? (0.5 - vSheet.x * 0.5) : (0.5 + vSheet.x * 0.5);
  vec2 uvSheet = vec2(sx, 1.0 - (vSheet.y * 0.5 + 0.5));

  // stick fully at the two rest poses, release through the middle of the sweep
  float mid  = sin(clamp(uProgress, 0.0, 1.0) * 1.5707963);
  vec2  uv   = mix(uvPin, uvSheet, uStick * mid);

  float edge   = (uvPin.x - 0.5) / (uGradEnd - 0.5);
  float motion = smoothstep(0.0, 1.0, uProgress);
  float blurGrad = clamp(edge, 0.0, 1.0);
  float darkGrad = clamp((edge - 0.2) / 0.8, 0.0, 1.0);
  float effect   = motion * pow(darkGrad, 1.35);
  float radius   = uMaxBlur * motion * pow(blurGrad, 1.35);

  // The texture is the artwork centred on a canvas uPad times larger, so every
  // lookup has to be remapped out of artwork space, exactly as the base does.
  // texel = one artwork pixel expressed in artwork-normalised units.
  vec2 texel = uTexel * uPad;
  vec2 dx = dFdx(uv) / texel, dy = dFdy(uv) / texel;
  float baseLod = log2(max(1.0, max(length(dx), length(dy))));

  // Anything the sheet projects OUTSIDE the artwork is black, not a smeared
  // edge pixel. Coverage is blurred together with the colour so the image
  // bleeds softly into that black margin instead of ending on a hard line.
  vec2 aa = max(fwidth(uv), texel * 0.5);
  vec2 cov0 = smoothstep(-aa, aa, uv) * (1.0 - smoothstep(vec2(1.0) - aa, vec2(1.0) + aa, uv));
  // The artwork's own boundary is the same rounded rectangle as the card it
  // belongs to, not a plain rect: a square content corner pokes out of the
  // rounded silhouette at mid-flip and reads as a sharp notch. This changes the
  // SHAPE of that boundary only - what falls outside is still the margin, still
  // uEdgeFloor, still blurred into exactly as before.
  vec2 ce = artEdge(uv, uAspect);
  float covA = cov0.x * cov0.y
             * cornerCov(ce, uRadius, fwidth(cornerDist(ce, uRadius)));
  vec3 color = textureLod(uTex, 0.5 + (clamp(uv, vec2(0.0), vec2(1.0)) - 0.5) / uPad, baseLod).rgb
             * covA;

  if (radius > 0.5) {
    float lod = max(baseLod, log2(max(1.0, radius)));
    vec2 footprint = max(aa, texel * radius * 0.75);
    // the corner rides the same footprint as the straight edges, so the whole
    // boundary softens together instead of the arc staying crisp. uv is
    // normalised to the artwork, artEdge to half its width, hence the 2.
    float soft = max(footprint.x, footprint.y * uAspect) * 2.0;
    color = vec3(0.0); covA = 0.0;   // coverage is blurred with the colour, so the
    for (int y = -2; y <= 2; y++){   // margin has to accumulate alongside it
      for (int x = -2; x <= 2; x++){
        float wx = x==0 ? 6.0 : (abs(x)==1 ? 4.0 : 1.0);
        float wy = y==0 ? 6.0 : (abs(y)==1 ? 4.0 : 1.0);
        vec2 sUV = uv + vec2(float(x), float(y)) * texel * radius;
        vec2 cv2 = smoothstep(-footprint, footprint, sUV)
                 * (1.0 - smoothstep(vec2(1.0) - footprint, vec2(1.0) + footprint, sUV));
        float w = wx * wy / 256.0;
        float cc = cv2.x * cv2.y * cornerCov(artEdge(sUV, uAspect), uRadius, soft);
        color += textureLod(uTex, 0.5 + (clamp(sUV, vec2(0.0), vec2(1.0)) - 0.5) / uPad, lod).rgb
               * cc * w;
        covA += cc * w;
      }
    }
  }

  // --- lighting: the face darkens as its normal swings away from the key light
  vec3  L   = normalize(vec3(-0.34, 0.46, 1.0));
  vec3  N   = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float lam = abs(dot(N, L));
  float lit = mix(1.0, 0.14 + 0.86 * pow(lam, 0.70), uLight);

  // --- sheen: a specular band that crawls across as the angle changes
  vec3  V = normalize(vec3(0.0, 0.0, 1.0));
  vec3  H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 42.0) * uSheen;

  color = color * (1.0 - min(1.0, effect * uDarkGain)) * lit + spec;

  // The margin is filled AFTER the darkening ramp, not before: the ramp is a
  // stylised motion effect on the artwork, and crushing the margin with it would
  // put the silhouette straight back to black at the free edge, which is the far
  // end of the ramp and exactly where the lift is needed. uEdgeFloor is zero on
  // a light stage, so this line changes nothing there.
  color += uEdgeFloor * (1.0 - covA);

  // Sub-pixel coverage along the free edge and the top/bottom rails.
  // The hinge edge (u=0) is left hard so it butts the fixed half seamlessly.
  vec2 q = vec2(vSheet.x, vSheet.y * 0.5 + 0.5);
  vec2 w = max(fwidth(q), vec2(1e-5));
  float cov = (1.0 - smoothstep(1.0 - w.x, 1.0, q.x))
            * smoothstep(0.0, w.y, q.y)
            * (1.0 - smoothstep(1.0 - w.y, 1.0, q.y));

  // round the two OUTER corners only - the hinge side stays square so the
  // two halves still butt together without a notch at the spine
  vec2 se = vec2(1.0 - q.x, (0.5 - abs(q.y - 0.5)) * 2.0 * uAspect);
  cov *= cornerCov(se, uRadius, fwidth(cornerDist(se, uRadius)));
  outColor = vec4(color, cov);
}`;

const BASE_FRAG = `#version 300 es
precision highp float;
in vec2 vProj;
out vec4 outColor;
uniform sampler2D uA, uB;
uniform float uShadow, uCrease, uShadowX, uPad, uRadius, uAspect;
${CORNER}
void main(){
  vec2 uv = vProj * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;
  vec2 tv = 0.5 + (uv - 0.5) / uPad;
  vec3 c = uv.x < 0.5 ? texture(uA, tv).rgb : texture(uB, tv).rgb;
  // crease shadow: peaks while the page stands on its edge, and masks the
  // moment the two different designs would otherwise meet at a hard seam
  float d = (uv.x - 0.5 - uShadowX) / 0.30;
  c *= 1.0 - uShadow * uCrease * exp(-d * d * 2.2);

  // round all four corners of the artwork itself, so the sheet and the fixed
  // half share one silhouette instead of the page being the only rounded part
  vec2 be = artEdge(uv, uAspect);
  float a = cornerCov(be, uRadius, fwidth(cornerDist(be, uRadius)));
  outColor = vec4(c, a);
}`;


const EDGE_VERT = `#version 300 es
in vec2 aPos;                       // x = fraction through the thickness, y = -1..1
uniform float uAngle, uAspect, uEye, uThick, uFit, uS, uRadius;
out float vK; out vec3 vN; out float vY;
void main(){
  float c = cos(uAngle), s = sin(uAngle);
  // The thickness must always sit on the far side of the free edge, never under
  // the sheet. The sheet's normal points left on screen for the whole sweep, so
  // the sign has to follow which side of the hinge the free edge is currently on.
  float side = c >= 0.0 ? -1.0 : 1.0;

  // Follow the rounded outline: near the top/bottom rails the free edge curves
  // back in by the circle, so the strip has to curve in with it. Cutting it off
  // instead left the corner with no thickness and a visible step.
  float ey = (0.5 - abs(aPos.y * 0.5)) * 2.0 * uAspect;
  float inset = 0.0;
  if (uRadius > 0.0001 && ey < uRadius) {
    float k = uRadius - ey;
    inset = uRadius - sqrt(max(uRadius * uRadius - k * k, 0.0));
  }
  float uu = 1.0 - inset;
  vec3 P = vec3(uu * c, aPos.y * uAspect, uu * s) + vec3(-s, 0.0, c) * uThick * aPos.x * side;
  float t = uEye / (uEye - P.z);
  vec2 sp = P.xy * t;
  vK = aPos.x; vN = normalize(vec3(c, 0.0, s)); vY = aPos.y * 0.5 + 0.5;
  gl_Position = vec4(sp.x*uFit, sp.y*uFit*uS, 0.0, 1.0);
}`;
const EDGE_FRAG = `#version 300 es
precision highp float;
in float vK; in vec3 vN; in float vY;
out vec4 outColor;
uniform float uLight, uRadius, uAspect;
void main(){
  vec3 L = normalize(vec3(-0.34, 0.46, 1.0));
  float lam = abs(dot(normalize(vN), L));
  float m = 0.30 + 0.72 * pow(lam, 0.55);
  m *= 0.62 + 0.38 * (1.0 - abs(vK * 2.0 - 1.0));   // rounded highlight across the thickness
  float wy = max(fwidth(vY), 1e-5);
  float cov = smoothstep(0.0, wy, vY) * (1.0 - smoothstep(1.0 - wy, 1.0, vY));

  outColor = vec4(vec3(m), cov);
}`;

const SH_VERT = `#version 300 es
in vec2 aPos;
uniform float uFit, uS, uAspect, uGrow;
out vec2 vQ;
void main(){
  vQ = aPos;
  vec2 p = aPos * (1.0 + uGrow);
  gl_Position = vec4(p.x*uFit, (p.y*uAspect - 0.012)*uFit*uS, 0.0, 1.0);
}`;
const SH_FRAG = `#version 300 es
precision highp float;
in vec2 vQ; out vec4 outColor;
uniform float uAmt, uScreen;
uniform vec3 uTint;
void main(){
  float f = (1.0 - smoothstep(0.62, 1.0, abs(vQ.x))) * (1.0 - smoothstep(0.62, 1.0, abs(vQ.y)));
  float a = f * uAmt;
  // Two grounding passes share this shader and differ only in blend mode.
  // MULTIPLY (uScreen 0) darkens the stage by a ratio - right on a light or
  // mid stage, and it follows an image instead of sitting on it as a flat grey
  // patch. Its factors are the old rgb divided by the old stage colour, so over
  // #f6f6f3 the result is pixel-identical to the original fixed-grey shadow.
  // SCREEN (uScreen 1) lifts instead, for a stage with no headroom left to
  // darken. Which one runs, and how much, is GROUND's call - see grounding().
  outColor = uScreen > 0.5 ? vec4(uTint * a, 1.0)
                           : vec4(mix(vec3(1.0), uTint, a), 1.0);
}`;
/* stage background image: one full-stage quad, cover-fitted, under everything.
   The padding fill that goes with it is a flat average of this image - see
   stageFill(). */
const BG_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUV;
uniform vec2 uCover;
void main(){
  vec2 uv = aPos * 0.5 + 0.5;
  vUV = vec2(0.5 + (uv.x - 0.5) * uCover.x,
             1.0 - (0.5 + (uv.y - 0.5) * uCover.y));
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;
const BG_FRAG = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 outColor;
uniform sampler2D uBG;
void main(){ outColor = vec4(texture(uBG, vUV).rgb, 1.0); }`;

const BASE_VERT = `#version 300 es
in vec2 aPos;
out vec2 vProj;
uniform float uFit, uS, uAspect;
void main(){ vProj = aPos;
  gl_Position = vec4(aPos.x*uFit, aPos.y*uAspect*uFit*uS, 0.0, 1.0); }`;
