/* The single sources of truth: the timing curve, the size presets, the
   padding factor and the grounding model. Nothing else may name these
   numbers - add a row here, get a new preset, with no branch anywhere else. */

/* =====================================================================
   ONE CURVE, ONE PLACE.
   Derived from the Apple reference: near-linear through the first half,
   long deceleration through the second. Swap this table to retime
   everything - nothing else reads a timing number.
   ===================================================================== */
const CURVE = [
  [0.000,0.000],[0.100,0.075],[0.200,0.205],[0.300,0.355],[0.406,0.500],
  [0.437,0.528],[0.468,0.579],[0.500,0.630],[0.531,0.677],[0.562,0.717],
  [0.594,0.743],[0.625,0.765],[0.656,0.787],[0.688,0.805],[0.719,0.824],
  [0.750,0.841],[0.781,0.859],[0.812,0.876],[0.844,0.894],[0.875,0.910],
  [0.906,0.926],[0.938,0.943],[0.969,0.969],[1.000,1.000]
];
const ease = t => {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < CURVE.length; i++) {
    if (t <= CURVE[i][0]) {
      const [a,va] = CURVE[i-1], [b,vb] = CURVE[i];
      return va + (vb-va) * (t-a) / (b-a);
    }
  }
  return 1;
};

/* One list. Add a row, get a new preset - no code branches on size. */
const SIZES = [
  { label:'3240 × 1350  (2.40:1)', w:3240, h:1350 },
  { label:'2160 × 1350  (1.60:1)', w:2160, h:1350 },
  { label:'1920 × 1080  (1.78:1)', w:1920, h:1080 }
];

/* =====================================================================
   GROUNDING, ONE PLACE.
   How the artwork is planted on the stage, as a function of how light the
   stage is. A shadow needs headroom to darken into; below `lo` there is none
   left, so the contact cue crosses over to a lift and the sheet's overhang
   margin comes up off pure black to keep its silhouette. Between `lo` and
   `hi` the two cross-fade, so dragging the colour picker never pops.
   Luminance is measured on the sRGB values as displayed, not linearised -
   this is a perceptual threshold, not a light transport calculation.
   ===================================================================== */
const GROUND = {
  lo: 0.12, hi: 0.38,                  // stage luminance: full lift -> no lift
  shadow: [0.373, 0.383, 0.357],       // multiply factors (old shadow / old stage)
  lift:   [0.52, 0.56, 0.68],          // screen tint, cool, so it reads as bounce
  liftGain: 0.28,                      // a lift carries less weight than a shadow
  liftGrow: 0.22,                      // and reaches further: a shadow's pool sits
                                       // UNDER the artwork, where the opaque base
                                       // hides it. A lift is only worth anything
                                       // on the stage around it, so it spreads.
  floor:  { scale: 0.55, base: 0.115 } // overhang margin = lift * (stage*s + b)
};

const PAD = 1.6;   // artwork sits inside a canvas 1.6x its size
