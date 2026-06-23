/* app.js — Looper: a mobile-first beat looper.
   - Add tracks, pick an instrument, arm REC and play it in.
   - Everything loops; tap mute to turn any track on/off.
   - The whole song keeps playing while you overdub a new part. */
(function () {
  "use strict";

  /* ---------------- Instrument definitions ---------------- */
  var INSTRUMENTS = {
    drums: {
      name: "Drums", kind: "pads", color: "#ff5470",
      desc: "Kick, snare, hats & more",
      pads: [
        { id: "kick", label: "Kick" },
        { id: "snare", label: "Snare" },
        { id: "hat", label: "Hat" },
        { id: "openhat", label: "Open Hat" },
        { id: "clap", label: "Clap" },
        { id: "tom", label: "Tom" }
      ]
    },
    piano: {
      name: "Piano", kind: "keys", color: "#4cc9f0",
      desc: "Mellow keys", baseMidi: 48, octaves: 2,
      voice: { wave: "triangle", fat: false, cutoff: 3500, q: 0.6, attack: 0.005, decay: 0.25, sustain: 0.35, release: 0.4, gain: 0.6 }
    },
    synth: {
      name: "Synth", kind: "keys", color: "#b388ff",
      desc: "Fat saw lead", baseMidi: 48, octaves: 2,
      voice: { wave: "sawtooth", fat: true, cutoff: 5000, cutoffEnd: 1200, q: 4, attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.35, gain: 0.4 }
    },
    bass: {
      name: "Bass", kind: "keys", color: "#80ffea",
      desc: "Deep & round", baseMidi: 28, octaves: 2,
      voice: { wave: "square", fat: false, cutoff: 700, q: 2, attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.2, gain: 0.5 }
    },
    trumpet: {
      name: "Trumpet", kind: "keys", color: "#ffd166",
      desc: "Bright brass lead", baseMidi: 52, octaves: 2,
      voice: { wave: "sawtooth", fat: false, cutoff: 1200, cutoffEnd: 4200, q: 3, attack: 0.04, decay: 0.1, sustain: 0.85, release: 0.18, gain: 0.34 }
    },
    trombone: {
      name: "Trombone", kind: "keys", color: "#f4a259",
      desc: "Low, bold brass", baseMidi: 40, octaves: 2,
      voice: { wave: "sawtooth", fat: false, cutoff: 700, cutoffEnd: 2400, q: 3, attack: 0.05, decay: 0.1, sustain: 0.85, release: 0.2, gain: 0.36 }
    },
    horn: {
      name: "French Horn", kind: "keys", color: "#e09f3e",
      desc: "Warm brass section", baseMidi: 45, octaves: 2,
      voice: { wave: "sawtooth", fat: true, cutoff: 900, cutoffEnd: 2000, q: 2, attack: 0.07, decay: 0.12, sustain: 0.8, release: 0.3, gain: 0.3 }
    }
  };

  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var BLACK = { 1: true, 3: true, 6: true, 8: true, 10: true };

  /* ---------------- State ---------------- */
  var state = {
    bpm: 100,
    bars: 2,
    beatsPerBar: 4,
    quantize: 0.25, // grid in beats; 0 = off
    metronome: false,
    masterVol: 0.9,
    tracks: [],
    selectedId: null,
    seq: 1
  };

  var playing = false;
  var recording = false;

  /* ---------------- Audio ---------------- */
  var ctx = null;
  var master = null;
  var schedulerId = null;
  var lookahead = 0.1; // seconds scheduled ahead
  var tickMs = 25;
  var playStartTime = 0; // ctx time of loop position 0
  var schedulerTime = 0; // up to where we've scheduled
  var liveVoices = {}; // pointerId -> { voice, trackId, midi, startBeat, el }
  var flashQueue = []; // {time, fn} visual flashes for selected track

  function ensureAudio() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = state.masterVol;
    master.connect(ctx.destination);
  }
  function resumeAudio() {
    ensureAudio();
    if (ctx.state === "suspended") ctx.resume();
  }

  function totalBeats() { return state.bars * state.beatsPerBar; }
  function secPerBeat() { return 60 / state.bpm; }
  function loopSeconds() { return totalBeats() * secPerBeat(); }

  /* ---------------- Persistence ---------------- */
  var STORAGE_KEY = "looper.session.v1";
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        bpm: state.bpm, bars: state.bars, quantize: state.quantize,
        metronome: state.metronome, masterVol: state.masterVol,
        tracks: state.tracks, selectedId: state.selectedId, seq: state.seq
      }));
    } catch (e) { /* ignore quota / private mode */ }
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      state.bpm = d.bpm || state.bpm;
      state.bars = d.bars || state.bars;
      state.quantize = d.quantize != null ? d.quantize : state.quantize;
      state.metronome = !!d.metronome;
      state.masterVol = d.masterVol != null ? d.masterVol : state.masterVol;
      state.tracks = Array.isArray(d.tracks) ? d.tracks : [];
      state.selectedId = d.selectedId || (state.tracks[0] && state.tracks[0].id) || null;
      state.seq = d.seq || (state.tracks.length + 1);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- Tracks ---------------- */
  function makeTrack(instKey) {
    var inst = INSTRUMENTS[instKey];
    var id = "t" + (state.seq++);
    var sameKind = state.tracks.filter(function (t) { return t.instrument === instKey; }).length;
    return {
      id: id,
      instrument: instKey,
      name: inst.name + " " + (sameKind + 1),
      muted: false,
      events: [] // drums: {pos, pad}; keys: {pos, midi, dur}
    };
  }
  function getTrack(id) {
    for (var i = 0; i < state.tracks.length; i++) if (state.tracks[i].id === id) return state.tracks[i];
    return null;
  }
  function selectedTrack() { return getTrack(state.selectedId); }

  /* ---------------- Transport / scheduler ---------------- */
  function play() {
    resumeAudio();
    if (playing) return;
    playing = true;
    playStartTime = ctx.currentTime + 0.08;
    schedulerTime = playStartTime;
    flashQueue = [];
    schedulerId = setInterval(scheduler, tickMs);
    document.getElementById("playBtn").setAttribute("aria-pressed", "true");
    requestAnimationFrame(animate);
  }
  function stop() {
    playing = false;
    recording = false;
    if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
    document.getElementById("playBtn").setAttribute("aria-pressed", "false");
    document.getElementById("recBtn").setAttribute("aria-pressed", "false");
    document.getElementById("recBadge").hidden = true;
    resetPlayheads();
  }
  function togglePlay() { if (playing) stop(); else play(); }

  function toggleRec() {
    resumeAudio();
    if (!selectedTrack()) { flashNeedTrack(); return; }
    recording = !recording;
    document.getElementById("recBtn").setAttribute("aria-pressed", recording ? "true" : "false");
    document.getElementById("recBadge").hidden = !recording;
    if (recording && !playing) play();
  }

  function scheduler() {
    if (!playing) return;
    var until = ctx.currentTime + lookahead;
    scheduleRange(schedulerTime, until);
    schedulerTime = until;
  }

  function scheduleRange(from, to) {
    var spb = secPerBeat();
    var loopSec = loopSeconds();
    if (loopSec <= 0) return;

    // metronome
    if (state.metronome) {
      var firstBeat = Math.ceil((from - playStartTime) / spb);
      if (firstBeat < 0) firstBeat = 0;
      for (var b = firstBeat; ; b++) {
        var bt = playStartTime + b * spb;
        if (bt >= to) break;
        if (bt >= from) Synth.click(ctx, master, bt, (b % state.beatsPerBar) === 0);
      }
    }

    var tb = totalBeats();
    for (var i = 0; i < state.tracks.length; i++) {
      var track = state.tracks[i];
      if (track.muted) continue;
      var inst = INSTRUMENTS[track.instrument];
      var isSelected = track.id === state.selectedId;
      for (var e = 0; e < track.events.length; e++) {
        var ev = track.events[e];
        if (ev.pos >= tb) continue; // outside current loop length
        var base = playStartTime + ev.pos * spb;
        var k = Math.ceil((from - base) / loopSec);
        if (k < 0) k = 0;
        var t = base + k * loopSec;
        while (t < to) {
          if (t >= from) triggerEvent(track, inst, ev, t, isSelected);
          t += loopSec;
        }
      }
    }
  }

  function triggerEvent(track, inst, ev, when, flash) {
    if (inst.kind === "pads") {
      Synth.playDrum(ctx, master, ev.pad, when, 0.9);
      if (flash) queueFlash(when, padFlasher(ev.pad));
    } else {
      var durSec = (ev.dur || 0.25) * secPerBeat();
      var v = Synth.makeVoice(ctx, master, inst.voice, ev.midi, when, 0.85);
      v.stop(when + durSec);
      if (flash) queueFlash(when, keyFlasher(ev.midi));
    }
  }

  /* ---------------- Live performance (tap to play) ---------------- */
  function loopPosBeats() {
    var p = (ctx.currentTime - playStartTime) / secPerBeat();
    var tb = totalBeats();
    p = p % tb;
    if (p < 0) p += tb;
    return p;
  }
  function quantizePos(pos) {
    if (!state.quantize) return pos;
    var tb = totalBeats();
    var q = Math.round(pos / state.quantize) * state.quantize;
    if (q >= tb) q -= tb;
    return q;
  }

  function liveDrum(track, padId) {
    resumeAudio();
    Synth.playDrum(ctx, master, padId, ctx.currentTime, 0.95);
    if (recording && playing && track.id === state.selectedId) {
      track.events.push({ pos: quantizePos(loopPosBeats()), pad: padId });
      drawTrackHits(track);
      save();
    }
  }

  function liveNoteOn(pointerId, track, midi, el) {
    resumeAudio();
    var inst = INSTRUMENTS[track.instrument];
    var voice = Synth.makeVoice(ctx, master, inst.voice, midi, ctx.currentTime, 0.9);
    liveVoices[pointerId] = {
      voice: voice, trackId: track.id, midi: midi,
      startBeat: playing ? loopPosBeats() : 0, el: el
    };
    if (el) el.classList.add("active");
  }
  function liveNoteOff(pointerId) {
    var lv = liveVoices[pointerId];
    if (!lv) return;
    lv.voice.stop(ctx.currentTime);
    if (lv.el) lv.el.classList.remove("active");
    delete liveVoices[pointerId];

    if (recording && playing && lv.trackId === state.selectedId) {
      var track = getTrack(lv.trackId);
      if (track) {
        var endBeat = loopPosBeats();
        var dur = endBeat - lv.startBeat;
        if (dur < 0) dur += totalBeats();
        if (dur < 0.05) dur = 0.25;
        track.events.push({ pos: quantizePos(lv.startBeat), midi: lv.midi, dur: dur });
        drawTrackHits(track);
        save();
      }
    }
  }

  /* ---------------- Visual flashes for selected track ---------------- */
  function queueFlash(when, fn) { flashQueue.push({ time: when, fn: fn }); }
  function padFlasher(padId) {
    return function () {
      var el = document.querySelector('.pad[data-pad="' + padId + '"]');
      if (el) { el.classList.add("active"); setTimeout(function () { el.classList.remove("active"); }, 90); }
    };
  }
  function keyFlasher(midi) {
    return function () {
      var el = document.querySelector('[data-midi="' + midi + '"]');
      if (el) { el.classList.add("active"); setTimeout(function () { el.classList.remove("active"); }, 110); }
    };
  }

  /* ---------------- Animation (playheads + flashes) ---------------- */
  function animate() {
    if (!playing) return;
    var now = ctx.currentTime;
    var pos = ((now - playStartTime) / loopSeconds());
    pos = pos - Math.floor(pos);
    if (pos < 0) pos = 0;
    var heads = document.querySelectorAll(".playhead");
    for (var i = 0; i < heads.length; i++) {
      var w = heads[i].parentElement.clientWidth;
      heads[i].style.transform = "translateX(" + (pos * w) + "px)";
    }
    // fire due flashes
    var remaining = [];
    for (var j = 0; j < flashQueue.length; j++) {
      if (flashQueue[j].time <= now) flashQueue[j].fn();
      else remaining.push(flashQueue[j]);
    }
    flashQueue = remaining;
    requestAnimationFrame(animate);
  }
  function resetPlayheads() {
    var heads = document.querySelectorAll(".playhead");
    for (var i = 0; i < heads.length; i++) heads[i].style.transform = "translateX(0px)";
  }

  /* ---------------- Rendering: tracks ---------------- */
  function renderTracks() {
    var list = document.getElementById("trackList");
    list.innerHTML = "";
    state.tracks.forEach(function (track) {
      var inst = INSTRUMENTS[track.instrument];
      var lane = document.createElement("div");
      lane.className = "lane" + (track.id === state.selectedId ? " selected" : "") + (track.muted ? " muted" : "");
      lane.style.setProperty("--lane-color", inst.color);
      lane.dataset.id = track.id;

      var top = document.createElement("div");
      top.className = "lane-top";
      top.innerHTML =
        '<span class="lane-dot"></span>' +
        '<span class="lane-name">' + escapeHtml(track.name) +
        ' <span class="lane-inst">· ' + inst.name + "</span></span>";

      var btns = document.createElement("div");
      btns.className = "lane-btns";

      var muteBtn = document.createElement("button");
      muteBtn.className = "mute" + (track.muted ? " on" : "");
      muteBtn.textContent = track.muted ? "Off" : "On";
      muteBtn.title = "Mute / unmute";
      muteBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        track.muted = !track.muted;
        renderTracks(); save();
      });

      var clearBtn = document.createElement("button");
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        track.events = [];
        drawTrackHits(track); save();
      });

      var delBtn = document.createElement("button");
      delBtn.className = "del";
      delBtn.textContent = "✕";
      delBtn.title = "Delete track";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        state.tracks = state.tracks.filter(function (t) { return t.id !== track.id; });
        if (state.selectedId === track.id) state.selectedId = state.tracks[0] ? state.tracks[0].id : null;
        renderAll(); save();
      });

      btns.appendChild(muteBtn);
      btns.appendChild(clearBtn);
      btns.appendChild(delBtn);
      top.appendChild(btns);

      var tl = document.createElement("div");
      tl.className = "timeline";
      tl.dataset.id = track.id;

      lane.appendChild(top);
      lane.appendChild(tl);
      lane.addEventListener("click", function () { selectTrack(track.id); });
      list.appendChild(lane);

      drawTrackHits(track);
    });
  }

  function drawTrackHits(track) {
    var tl = document.querySelector('.timeline[data-id="' + track.id + '"]');
    if (!tl) return;
    var inst = INSTRUMENTS[track.instrument];
    tl.innerHTML = "";
    var tb = totalBeats();
    // beat / bar grid
    for (var b = 0; b < tb; b++) {
      var m = document.createElement("div");
      m.className = "beat" + (b % state.beatsPerBar === 0 ? " bar" : "");
      m.style.left = (b / tb * 100) + "%";
      tl.appendChild(m);
    }
    // hits
    track.events.forEach(function (ev) {
      if (ev.pos >= tb) return;
      var dot = document.createElement("div");
      dot.className = "hit";
      dot.style.left = (ev.pos / tb * 100) + "%";
      tl.appendChild(dot);
    });
    var ph = document.createElement("div");
    ph.className = "playhead";
    tl.appendChild(ph);
  }

  function selectTrack(id) {
    state.selectedId = id;
    renderTracks();
    renderStage();
    save();
  }

  /* ---------------- Rendering: stage (performance pad) ---------------- */
  function renderStage() {
    var track = selectedTrack();
    var nameEl = document.getElementById("stageTrackName");
    var body = document.getElementById("stageBody");
    body.innerHTML = "";
    if (!track) {
      nameEl.textContent = "No track selected";
      body.innerHTML = '<div class="stage-placeholder">Add a track to start playing.</div>';
      return;
    }
    var inst = INSTRUMENTS[track.instrument];
    nameEl.textContent = "Playing: " + track.name;
    nameEl.style.color = inst.color;
    if (inst.kind === "pads") body.appendChild(buildPads(track, inst));
    else body.appendChild(buildKeyboard(track, inst));
  }

  function buildPads(track, inst) {
    var grid = document.createElement("div");
    grid.className = "pad-grid";
    grid.style.setProperty("--lane-color", inst.color);
    inst.pads.forEach(function (p) {
      var pad = document.createElement("button");
      pad.className = "pad";
      pad.dataset.pad = p.id;
      pad.textContent = p.label;
      pad.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        pad.classList.add("active");
        liveDrum(track, p.id);
      });
      var clear = function () { pad.classList.remove("active"); };
      pad.addEventListener("pointerup", clear);
      pad.addEventListener("pointerleave", clear);
      pad.addEventListener("pointercancel", clear);
      grid.appendChild(pad);
    });
    return grid;
  }

  function buildKeyboard(track, inst) {
    var wrap = document.createElement("div");
    wrap.className = "keys-wrap";
    var kb = document.createElement("div");
    kb.className = "keyboard";
    kb.style.setProperty("--lane-color", inst.color);

    var base = inst.baseMidi;
    var count = inst.octaves * 12 + 1;
    // first pass: white keys
    var whiteIndex = 0;
    var whiteW = 46, whiteGap = 2;
    var whitePositions = {}; // midi -> left px
    for (var i = 0; i < count; i++) {
      var midi = base + i;
      if (BLACK[midi % 12]) continue;
      var wk = makeKey("wkey", track, inst, midi);
      var label = NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
      var lbl = document.createElement("span");
      lbl.className = "lbl";
      lbl.textContent = label;
      wk.appendChild(lbl);
      kb.appendChild(wk);
      whitePositions[midi] = whiteIndex * (whiteW + whiteGap);
      whiteIndex++;
    }
    // second pass: black keys positioned between whites
    for (var j = 0; j < count; j++) {
      var bm = base + j;
      if (!BLACK[bm % 12]) continue;
      var prevWhite = bm - 1; // white key just below
      var left = whitePositions[prevWhite];
      if (left == null) continue;
      var bk = makeKey("bkey", track, inst, bm);
      bk.style.left = (left + whiteW - 15 + whiteGap) + "px";
      kb.appendChild(bk);
    }
    wrap.appendChild(kb);
    return wrap;
  }

  function makeKey(cls, track, inst, midi) {
    var key = document.createElement("div");
    key.className = cls;
    key.dataset.midi = midi;
    key.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      try { key.setPointerCapture(e.pointerId); } catch (x) {}
      liveNoteOn(e.pointerId, track, midi, key);
    });
    var off = function (e) { liveNoteOff(e.pointerId); };
    key.addEventListener("pointerup", off);
    key.addEventListener("pointercancel", off);
    return key;
  }

  /* ---------------- Modal: instrument picker ---------------- */
  function openInstrumentPicker() {
    var grid = document.getElementById("instrumentGrid");
    grid.innerHTML = "";
    Object.keys(INSTRUMENTS).forEach(function (key) {
      var inst = INSTRUMENTS[key];
      var btn = document.createElement("button");
      btn.className = "inst-choice";
      btn.innerHTML =
        '<span class="ic-swatch" style="background:' + inst.color + '"></span>' +
        '<span class="ic-name">' + inst.name + "</span>" +
        '<span class="ic-desc">' + inst.desc + "</span>";
      btn.addEventListener("click", function () {
        addTrack(key);
        closeModal();
      });
      grid.appendChild(btn);
    });
    document.getElementById("modal").hidden = false;
  }
  function closeModal() { document.getElementById("modal").hidden = true; }

  function addTrack(instKey) {
    var t = makeTrack(instKey);
    state.tracks.push(t);
    state.selectedId = t.id;
    renderAll();
    save();
  }

  /* ---------------- Helpers ---------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function flashNeedTrack() {
    var el = document.getElementById("stageTrackName");
    el.textContent = "Add or select a track first";
    setTimeout(renderStage, 1200);
  }

  function renderAll() {
    document.getElementById("bpmValue").textContent = state.bpm;
    document.getElementById("barsSelect").value = String(state.bars);
    document.getElementById("quantizeSelect").value = String(state.quantize);
    document.getElementById("masterVol").value = String(state.masterVol);
    document.getElementById("metroBtn").setAttribute("aria-pressed", state.metronome ? "true" : "false");
    renderTracks();
    renderStage();
  }

  /* ---------------- Export / share ---------------- */
  function hasAudibleContent() {
    return state.tracks.some(function (t) { return !t.muted && t.events.length > 0; });
  }

  // Render the (non-muted) loop to an AudioBuffer via OfflineAudioContext,
  // repeated `repeats` times, reusing the same synth code as live playback.
  function renderLoop(repeats) {
    var spb = secPerBeat();
    var loopSec = loopSeconds();
    var tb = totalBeats();
    var tail = 1.5; // let note/drum release tails ring out
    var sr = 44100;
    var frames = Math.ceil((loopSec * repeats + tail) * sr);
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var off = new OAC(2, frames, sr);
    var m = off.createGain();
    m.gain.value = state.masterVol;
    m.connect(off.destination);

    for (var r = 0; r < repeats; r++) {
      var rOff = r * loopSec;
      state.tracks.forEach(function (track) {
        if (track.muted) return;
        var inst = INSTRUMENTS[track.instrument];
        track.events.forEach(function (ev) {
          if (ev.pos >= tb) return;
          var when = rOff + ev.pos * spb;
          if (inst.kind === "pads") {
            Synth.playDrum(off, m, ev.pad, when, 0.9);
          } else {
            var v = Synth.makeVoice(off, m, inst.voice, ev.midi, when, 0.85);
            v.stop(when + (ev.dur || 0.25) * spb);
          }
        });
      });
    }
    return off.startRendering();
  }

  function encodeWav(buffer) {
    var numCh = buffer.numberOfChannels;
    var sr = buffer.sampleRate;
    var len = buffer.length;
    var chans = [];
    for (var c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    var blockAlign = numCh * 2;
    var dataSize = len * blockAlign;
    var ab = new ArrayBuffer(44 + dataSize);
    var view = new DataView(ab);
    function str(off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    str(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    str(8, "WAVE");
    str(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);       // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, dataSize, true);
    var offset = 44;
    for (var i = 0; i < len; i++) {
      for (var ch = 0; ch < numCh; ch++) {
        var s = Math.max(-1, Math.min(1, chans[ch][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([view], { type: "audio/wav" });
  }

  function exportFilename() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, "0"); }
    var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
    return "looper-" + state.bpm + "bpm-" + stamp + ".wav";
  }

  function shareStatus(msg, isError) {
    var el = document.getElementById("shareStatus");
    el.textContent = msg || "";
    el.className = "share-status" + (isError ? " error" : "");
  }

  function getRepeats() {
    return parseInt(document.getElementById("exportRepeats").value, 10) || 2;
  }

  function makeWavBlob() {
    resumeAudio();
    return renderLoop(getRepeats()).then(encodeWav);
  }

  function downloadAudio() {
    if (!hasAudibleContent()) { shareStatus("Add or unmute a track with some notes first.", true); return; }
    shareStatus("Rendering…");
    makeWavBlob().then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = exportFilename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      shareStatus("Saved to your downloads.");
    }).catch(function (e) { shareStatus("Couldn't render audio.", true); });
  }

  function shareAudio() {
    if (!hasAudibleContent()) { shareStatus("Add or unmute a track with some notes first.", true); return; }
    shareStatus("Rendering…");
    makeWavBlob().then(function (blob) {
      var file = new File([blob], exportFilename(), { type: "audio/wav" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: "My Looper beat" }).then(function () {
          shareStatus("Shared!");
        });
      }
      // No file-share support (e.g. desktop) — fall back to a download.
      throw new Error("no-share");
    }).catch(function (e) {
      if (e && e.name === "AbortError") { shareStatus(""); return; } // user cancelled
      downloadAudio(); // fallback
    });
  }

  /* ---- Beat link (share the editable loop) ---- */
  function encodeBeatUrl() {
    var data = { v: 1, bpm: state.bpm, bars: state.bars, quantize: state.quantize, tracks: state.tracks };
    var json = JSON.stringify(data);
    var b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return location.origin + location.pathname + "#beat=" + b64;
  }
  function decodeBeat(token) {
    var b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }
  function copyBeatLink() {
    if (!state.tracks.length) { shareStatus("Add a track first.", true); return; }
    var url = encodeBeatUrl();
    var done = function () { shareStatus("Link copied — paste it to a friend!"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(function () { promptCopy(url); });
    } else {
      promptCopy(url);
    }
  }
  function promptCopy(url) {
    try { window.prompt("Copy this beat link:", url); shareStatus("Copy the link above."); }
    catch (e) { shareStatus("Couldn't copy link.", true); }
  }
  function importFromUrl() {
    var m = (location.hash || "").match(/beat=([^&]+)/);
    if (!m) return;
    try {
      var data = decodeBeat(m[1]);
      if (!data || !Array.isArray(data.tracks)) return;
      if (state.tracks.length && !window.confirm("Open shared beat? This replaces your current loop.")) {
        history.replaceState(null, "", location.pathname);
        return;
      }
      state.bpm = data.bpm || state.bpm;
      state.bars = data.bars || state.bars;
      state.quantize = data.quantize != null ? data.quantize : state.quantize;
      state.tracks = data.tracks;
      state.tracks.forEach(function (t, i) { t.id = "t" + (i + 1); t.events = t.events || []; });
      state.seq = state.tracks.length + 1;
      state.selectedId = state.tracks[0] ? state.tracks[0].id : null;
      history.replaceState(null, "", location.pathname);
      save();
    } catch (e) { /* ignore malformed link */ }
  }

  function openShare() { shareStatus(""); document.getElementById("shareModal").hidden = false; }
  function closeShare() { document.getElementById("shareModal").hidden = true; }

  /* ---------------- Wire up controls ---------------- */
  function restartIfPlaying() {
    if (playing) { stop(); play(); }
  }

  function init() {
    load();
    importFromUrl();
    renderAll();

    document.getElementById("shareBtn").addEventListener("click", openShare);
    document.getElementById("shareCancel").addEventListener("click", closeShare);
    document.getElementById("shareModal").addEventListener("click", function (e) {
      if (e.target.id === "shareModal") closeShare();
    });
    document.getElementById("downloadBtn").addEventListener("click", downloadAudio);
    document.getElementById("shareAudioBtn").addEventListener("click", shareAudio);
    document.getElementById("copyLinkBtn").addEventListener("click", copyBeatLink);

    document.getElementById("playBtn").addEventListener("click", function () {
      resumeAudio(); togglePlay();
    });
    document.getElementById("recBtn").addEventListener("click", toggleRec);
    document.getElementById("addTrackBtn").addEventListener("click", openInstrumentPicker);
    document.getElementById("modalCancel").addEventListener("click", closeModal);
    document.getElementById("modal").addEventListener("click", function (e) {
      if (e.target.id === "modal") closeModal();
    });

    document.querySelectorAll(".bpm .step").forEach(function (b) {
      b.addEventListener("click", function () {
        var d = parseInt(b.dataset.bpm, 10) * (b.dataset.held ? 5 : 1);
        state.bpm = Math.min(240, Math.max(40, state.bpm + d));
        document.getElementById("bpmValue").textContent = state.bpm;
        restartIfPlaying(); save();
      });
    });

    document.getElementById("barsSelect").addEventListener("change", function (e) {
      state.bars = parseInt(e.target.value, 10);
      renderTracks();
      restartIfPlaying(); save();
    });
    document.getElementById("quantizeSelect").addEventListener("change", function (e) {
      state.quantize = parseFloat(e.target.value);
      save();
    });
    document.getElementById("metroBtn").addEventListener("click", function () {
      state.metronome = !state.metronome;
      document.getElementById("metroBtn").setAttribute("aria-pressed", state.metronome ? "true" : "false");
      save();
    });
    document.getElementById("masterVol").addEventListener("input", function (e) {
      state.masterVol = parseFloat(e.target.value);
      if (master) master.gain.value = state.masterVol;
      save();
    });

    // Unlock audio on first touch anywhere.
    var unlock = function () { resumeAudio(); window.removeEventListener("pointerdown", unlock); };
    window.addEventListener("pointerdown", unlock);

    // Spacebar = play/stop on desktop for convenience.
    window.addEventListener("keydown", function (e) {
      if (e.code === "Space" && e.target.tagName !== "SELECT" && e.target.tagName !== "INPUT") {
        e.preventDefault(); resumeAudio(); togglePlay();
      }
    });

    // Keep playheads sized on resize.
    window.addEventListener("resize", function () { if (!playing) resetPlayheads(); });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
