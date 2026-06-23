# Looper 🥁🎹

A mobile-first **beat looper** you run right in the browser. Make a track, pick an
instrument, tap it in, and it loops. Stack drums, piano, bass and synth; mute any
track on/off; and overdub a new part while the whole song keeps playing.

No build step, no audio files, no dependencies — every sound is synthesized with
the Web Audio API.

## How to use it

1. **Open `index.html`** on your phone or computer (best on Chrome/Safari).
   - On a phone, serve it (see below) and "Add to Home Screen" to run it full-screen.
2. **+ Add track** → pick an instrument (Drums, Piano, Synth, Bass, Trumpet,
   Trombone, French Horn).
3. Tap **REC**, then play the pads/keys at the bottom. Whatever you tap gets
   recorded into the loop, snapped to the beat (set **Quantize** to *Off* for a
   looser, human feel).
4. Hit **▶** to play. Add more tracks and **overdub** — the existing loop keeps
   playing while you record the new one.
5. Tap **On/Off** on any track to mute it live. **Clear** wipes a track's notes;
   **✕** deletes it.

### Controls
- **BPM** – tempo (40–240).
- **Loop** – loop length in bars (1/2/4/8).
- **Quantize** – snap recorded hits to a grid (1/4, 1/8, 1/16) or *Off*.
- **🅼** – metronome click.
- **Vol** – master volume.
- Desktop: **Spacebar** = play/stop.

Your session auto-saves to the browser, so it's still there when you come back.

### Sharing

Tap **⤴ Share** (top right) to:
- **Share audio** – renders your loop to a `.wav` and opens your phone's native
  share sheet (Messages, AirDrop, etc.). On desktop it downloads instead.
- **Download .wav** – save the rendered loop. Pick how many times it repeats.
- **Share arrangement** – hands off an editable copy of your whole arrangement
  (every track, note and setting) through your phone's share sheet, or **Copy
  link** to grab the URL yourself. Whoever opens it picks up right where you left
  off. Their edits stay on their copy, so your version is untouched — there's no
  server, so a link is always a snapshot, not a shared live document.

Audio is rendered entirely in the browser (offline, faster than real-time) using
the same synths you hear live — no server, no uploads.

## Running locally

Because it registers a service worker and uses modules-free scripts, just serve
the folder over HTTP:

```bash
# any static server works, e.g.
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` via `file://` mostly works too, but the service worker /
"install as app" features need `http(s)://`.

## How it works

- `js/synth.js` – synthesizes drums (kick/snare/hats/clap/tom) and melodic voices
  (piano/synth/bass) on the fly.
- `js/app.js` – state, the look-ahead scheduler (notes are stored in **beats** so
  changing tempo keeps the groove), recording/overdub, and the UI.
- `css/styles.css` – the dark, touch-friendly mobile layout.
- `sw.js` + `manifest.webmanifest` – offline + installable PWA.
