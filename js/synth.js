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

  // Decaying-noise impulse response for the reverb convolver (cached per sample rate).
  let impulseCache = {};
  function getImpulse(ctx, seconds, decay) {
    const key = ctx.sampleRate + ":" + seconds + ":" + decay;
    if (impulseCache[key]) return impulseCache[key];
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    impulseCache[key] = buf;
    return buf;
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
      case "broom": {
        // brushed sweep: noise swelling through a bandpass that rises then falls
        const src = ctx.createBufferSource();
        src.buffer = getNoise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 0.8;
        bp.frequency.setValueAtTime(800, when);
        bp.frequency.exponentialRampToValueAtTime(5000, when + 0.18);
        bp.frequency.exponentialRampToValueAtTime(1200, when + 0.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(vel * 0.5, when + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);
        src.connect(bp).connect(g).connect(dest);
        src.start(when);
        src.stop(when + 0.45);
        break;
      }
      case "drop": {
        // water drop: resonant sine diving down then a tiny upturn ("ploink")
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(1800, when);
        o.frequency.exponentialRampToValueAtTime(700, when + 0.05);
        o.frequency.exponentialRampToValueAtTime(1400, when + 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vel * 0.7, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
        o.connect(g).connect(dest);
        o.start(when);
        o.stop(when + 0.2);
        break;
      }
      case "pop": {
        // bubble pop: very short blip rising in pitch
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(400, when);
        o.frequency.exponentialRampToValueAtTime(900, when + 0.03);
        const g = ctx.createGain();
        g.gain.setValueAtTime(vel * 0.6, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
        o.connect(g).connect(dest);
        o.start(when);
        o.stop(when + 0.08);
        break;
      }
      case "click": {
        // dry tick
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = 2200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vel * 0.5, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);
        o.connect(g).connect(dest);
        o.start(when);
        o.stop(when + 0.03);
        break;
      }
      case "snap": {
        // finger snap: tight bandpass noise burst
        const src = ctx.createBufferSource();
        src.buffer = getNoise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 2600;
        bp.Q.value = 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vel * 0.9, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
        src.connect(bp).connect(g).connect(dest);
        src.start(when);
        src.stop(when + 0.07);
        break;
      }
      case "bark": {
        // dog "woof": pitch-dropping saw through a vocal bandpass, "wu-uff" envelope + noise grit
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(420, when);
        o.frequency.exponentialRampToValueAtTime(180, when + 0.07);
        o.frequency.exponentialRampToValueAtTime(120, when + 0.18);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(900, when);
        bp.frequency.exponentialRampToValueAtTime(1600, when + 0.05);
        bp.frequency.exponentialRampToValueAtTime(700, when + 0.18);
        bp.Q.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(vel * 0.9, when + 0.015);
        g.gain.linearRampToValueAtTime(vel * 0.4, when + 0.06);
        g.gain.linearRampToValueAtTime(vel * 0.8, when + 0.09);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
        o.connect(bp).connect(g).connect(dest);
        o.start(when);
        o.stop(when + 0.24);
        const src = ctx.createBufferSource();
        src.buffer = getNoise(ctx);
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1200;
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(vel * 0.15, when);
        ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
        src.connect(hp).connect(ng).connect(dest);
        src.start(when);
        src.stop(when + 0.14);
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

    // optional vibrato (cents) — gives whistle/lead voices some life
    let lfo = null;
    if (cfg.vibrato) {
      lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = cfg.vibratoRate || 5.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = cfg.vibrato;
      lfo.connect(lfoGain);
      oscs.forEach(function (o) { lfoGain.connect(o.detune); });
      lfo.start(when);
    }

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
      if (lfo) lfo.stop(now + rel + 0.02);
    }
    return { stop: stop };
  }

  /* ---- Master FX chain (reverb + tempo-synced delay) ----
     Shared by live playback and offline render so exports match what you hear.
     Synths connect to the returned `input` node (which doubles as the master
     gain). `revSend`/`delSend` gains can be tweaked live; `delay` time follows
     the tempo. */
  function createFxChain(ctx, dest, opts) {
    opts = opts || {};
    var input = ctx.createGain();
    input.gain.value = opts.masterVol != null ? opts.masterVol : 0.9;

    // dry path
    input.connect(dest);

    // reverb send → convolver
    var revSend = ctx.createGain();
    revSend.gain.value = opts.reverb || 0;
    var conv = ctx.createConvolver();
    conv.buffer = getImpulse(ctx, 1.8, 2.5);
    input.connect(revSend).connect(conv).connect(dest);

    // delay send → feedback delay (dotted-eighth-ish, synced to tempo)
    var spb = 60 / (opts.bpm || 100);
    var delSend = ctx.createGain();
    delSend.gain.value = opts.delay || 0;
    var dl = ctx.createDelay(2.0);
    dl.delayTime.value = Math.min(1.9, spb * 0.75);
    var fb = ctx.createGain();
    fb.gain.value = 0.33;
    input.connect(delSend).connect(dl);
    dl.connect(fb).connect(dl);
    dl.connect(dest);

    return { input: input, revSend: revSend, delSend: delSend, delay: dl };
  }

  window.Synth = {
    midiToFreq: midiToFreq,
    playDrum: playDrum,
    makeVoice: makeVoice,
    createFxChain: createFxChain,
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
