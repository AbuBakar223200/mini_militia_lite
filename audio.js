'use strict';
// Lightweight WebAudio sound engine - all SFX synthesized, zero assets.
const AudioSys = (function () {
  let ctx = null, master = null, muted = false, jetSrc = null, jetGain = null, noiseBuffer = null;

  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function getNoise() {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, (ctx.sampleRate * 0.6) | 0, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  // filtered noise burst
  function burst(o) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = getNoise(); src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.fEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.fEnd), t + o.dur);
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + o.dur + 0.05);
  }

  function tone(o) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.fEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.fEnd), t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.vol, t + (o.a || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  return {
    ensure,
    toggleMute() { muted = !muted; if (muted && jetGain) jetGain.gain.value = 0; return muted; },
    get muted() { return muted; },
    shoot(w) {
      if (w === 'shotgun') { burst({ f: 600, fEnd: 120, dur: 0.28, vol: 0.5, q: 0.7, type: 'lowpass' }); tone({ f: 180, fEnd: 60, dur: 0.18, vol: 0.25, type: 'triangle' }); }
      else if (w === 'sniper') { burst({ f: 1500, fEnd: 200, dur: 0.3, vol: 0.5 }); tone({ f: 220, fEnd: 50, dur: 0.25, vol: 0.3, type: 'sawtooth' }); }
      else if (w === 'uzi') { burst({ f: 1200, fEnd: 500, dur: 0.08, vol: 0.3 }); }
      else { burst({ f: 900, fEnd: 300, dur: 0.11, vol: 0.35 }); tone({ f: 200, fEnd: 90, dur: 0.08, vol: 0.15 }); }
    },
    explode() { burst({ f: 400, fEnd: 60, dur: 0.6, vol: 0.7, type: 'lowpass' }); tone({ f: 120, fEnd: 35, dur: 0.5, vol: 0.4, type: 'sine' }); },
    hit() { burst({ f: 2200, fEnd: 900, dur: 0.06, vol: 0.22 }); },
    hurt() { tone({ f: 300, fEnd: 120, dur: 0.12, vol: 0.25, type: 'sawtooth' }); },
    death() { tone({ f: 400, fEnd: 60, dur: 0.5, vol: 0.3, type: 'sawtooth' }); burst({ f: 800, fEnd: 100, dur: 0.4, vol: 0.3 }); },
    pickup() { tone({ f: 660, dur: 0.08, vol: 0.2, type: 'sine' }); setTimeout(() => tone({ f: 990, dur: 0.12, vol: 0.2, type: 'sine' }), 70); },
    reload() { burst({ f: 1800, dur: 0.05, vol: 0.18, q: 3 }); setTimeout(() => burst({ f: 1200, dur: 0.05, vol: 0.18, q: 3 }), 140); },
    dry() { tone({ f: 900, dur: 0.04, vol: 0.1 }); },
    click() { tone({ f: 750, dur: 0.05, vol: 0.18 }); },
    throwNade() { burst({ f: 1000, fEnd: 400, dur: 0.1, vol: 0.15 }); },
    jetStart() {
      if (!ctx || muted || jetSrc) return;
      jetSrc = ctx.createBufferSource();
      jetSrc.buffer = getNoise(); jetSrc.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
      jetGain = ctx.createGain(); jetGain.gain.value = 0;
      jetGain.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 0.06);
      jetSrc.connect(f); f.connect(jetGain); jetGain.connect(master);
      jetSrc.start();
    },
    jetStop() {
      if (!jetSrc) return;
      const s = jetSrc, g = jetGain;
      jetSrc = null; jetGain = null;
      try { g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.08); } catch (e) { }
      setTimeout(() => { try { s.stop(); } catch (e) { } }, 120);
    }
  };
})();
