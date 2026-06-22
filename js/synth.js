/* synth.js — Web Audio sound generation.
   All instruments are synthesized live, so the app needs no audio files.
   Exposes a small Synth API on window.Synth. */
(function () {
  "use strict";

  let noiseBuffer = null;
  function getNoise(ctx) {
    if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buf;
    return buf;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* ---- Drums ---- */
  function playDrum(ctx, dest, pad, when, vel) {
    vel = vel == null ? 0.9 : vel;
    switch (pad) {
      case "kick": {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(150, when);
        o.frequency.exponentialRampToValueAtTime(45, when + 0.12);
        g.gain.setValueAtTime(vel, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
        o.connect(g).connect(dest);
        o.start(when);
        o.stop(when + 0.4);
        break;
      }
      case "snare": {
        // noise body
        const src = ctx.createBufferSource();
        src.buffer = getNoise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1800;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vel * 0.8, when);
        ng.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        src.connect(bp).connect(ng).connect(dest);
        src.start(when);
        src.stop(when + 0.25);
        // tone snap
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = 180;
        const og = ctx.createGain();
        og.gain.setValueAtTime(vel * 0.5, when);
        og.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
        o.connect(og).connect(dest);
        o.start(when);
        o.stop(when + 0.13);
        break;
      }
      case "hat":
      case "openhat": {
        const src = ctx.createBufferSource();
        src.buffer = getNoise(ctx);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 7000;
        const g = ctx.createGain();
        const dur = pad === "openhat" ? 0.3 : 0.05;
        g.gain.setValueAtTime(vel * 0.5, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        src.connect(hp).connect(g).connect(dest);
        src.start(when);
        src.stop(when + dur + 0.02);
        break;
      }
      case "clap": {
        const g = ctx.createGain();
        g.connect(dest);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1000;
        bp.Q.value = 1.2;
        bp.connect(g);
        const offsets = [0, 0.012, 0.024, 0.05];
        offsets.forEach(function (off, i) {
          const src = ctx.createBufferSource();
          src.buffer = getNoise(ctx);
          const eg = ctx.createGain();
          const t = when + off;
          const peak = i === offsets.length - 1 ? vel * 0.7 : vel * 0.45;
          eg.gain.setValueAtTime(peak, t);
          eg.gain.exponentialRampToValueAtTime(0.001, t + (i === offsets.length - 1 ? 0.18 : 0.03));
          src.connect(eg).connect(bp);
          src.start(t);
          src.stop(t + 0.2);
        });
        break;
      }
      case "tom": {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(180, when);
        o.frequency.exponentialRampToValueAtTime(80, when + 0.2);
        g.gain.setValueAtTime(vel * 0.9, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
        o.connect(g).connect(dest);
        o.start(when);
        o.stop(when + 0.32);
        break;
      }
    }
  }

  /* ---- Melodic voice (piano / synth / bass) ----
     Returns a voice handle with stop(when) for note-off, so live playing
     can hold a note until the finger lifts, and the scheduler can pass a
     fixed duration for recorded notes. */
  function makeVoice(ctx, dest, cfg, midi, when, vel) {
    vel = vel == null ? 0.85 : vel;
    const freq = midiToFreq(midi);
    const out = ctx.createGain();
    out.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    out.connect(dest);
    filter.connect(out);

    const oscs = [];
    const wave = cfg.wave || "triangle";
    const detunes = cfg.fat ? [-6, 6] : [0];
    detunes.forEach(function (d) {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = freq;
      o.detune.value = d;
      o.connect(filter);
      o.start(when);
      oscs.push(o);
    });

    // filter movement & envelope per instrument
    const a = cfg.attack != null ? cfg.attack : 0.005;
    const peak = vel * (cfg.gain != null ? cfg.gain : 0.6);
    filter.frequency.setValueAtTime(cfg.cutoff || 4000, when);
    if (cfg.cutoffEnd != null) {
      filter.frequency.exponentialRampToValueAtTime(cfg.cutoffEnd, when + 0.3);
    }
    filter.Q.value = cfg.q || 0.7;

    out.gain.setValueAtTime(0, when);
    out.gain.linearRampToValueAtTime(peak, when + a);
    // decay toward sustain
    const sustain = peak * (cfg.sustain != null ? cfg.sustain : 0.6);
    out.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), when + a + (cfg.decay || 0.15));

    let stopped = false;
    function stop(t) {
      if (stopped) return;
      stopped = true;
      const rel = cfg.release != null ? cfg.release : 0.25;
      const now = Math.max(t, when + a);
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + rel);
      oscs.forEach(function (o) { o.stop(now + rel + 0.02); });
    }
    return { stop: stop };
  }

  window.Synth = {
    midiToFreq: midiToFreq,
    playDrum: playDrum,
    makeVoice: makeVoice,
    // click for metronome
    click: function (ctx, dest, when, accent) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = accent ? 1500 : 900;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(accent ? 0.3 : 0.18, when + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
      o.connect(g).connect(dest);
      o.start(when);
      o.stop(when + 0.05);
    }
  };
})();
