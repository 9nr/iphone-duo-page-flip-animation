/* What render.py and regression.py drive. The harness owns the clock, so a
   rendered frame at a given progress is identical every run. */

window.RENDER = {
  size(w, h){ LOCK = [w, h]; resize(); },
  // bgimage takes a URL or data: URI and returns a promise - page.evaluate
  // awaits it, so the harness never renders before the background is up
  set(k, v){
    if (k === 'bgimage') return loadBgImage(v);
    const e = $(k); if (!e) return;
    e.value = v;
    e.dispatchEvent(new Event('input'));
    // these three do their real work on change, not input
    if (k === 'bgcol' || k === 'bgmode' || k === 'size')
      e.dispatchEvent(new Event('change'));
  },
  frame(i, p){
    playing = false;
    idx = ((i % designs.length) + designs.length) % designs.length;
    angle = ease(Math.max(0, Math.min(1, p))) * Math.PI;
    draw();
  },
  count(){ return designs.length; },
  // what the shader is actually using this frame, so a test never has to
  // re-derive it and drift from the engine
  probe(){ const g = grounding(), st = stageSize();
           return { fill:g.fill, lum:lum(g.fill), lift:g.lift, floor:g.floor,
                    fit:+$('fit').value/100, aspect:st.aspect,
                    radius:+$('rad').value/1000,
                    auto:st.auto, art:[st.w, st.h], room:st.room }; },
  png(){ return cv.toDataURL('image/png'); }
};
