# Frequency Oasis

Personal music player. Built for **Frequency Oasis** by Smokey Eye Beats.

Static site, no backend, no login. Installable as a Progressive Web App on
desktop and mobile. Works offline after first load.

## What it does

- Queue tracks from a direct MP3 URL or local file upload, drag-and-drop
  anywhere on the page
- Drag-to-reorder queue, shuffle, repeat (off/all/one/A–B), crossfade,
  sleep timer, adjustable playback speed
- **Vault** — save tracks by URL, persists in this browser via
  `localStorage`. Local file uploads can't be vaulted (a blob URL dies
  when the tab closes — nothing to persist)
- Favorites and recently-played, both persisted
- **10-band EQ** (31Hz–16kHz) with save/export/import as JSON presets
- **7 signature sound modes** (Flat, Studio Reference, Gold Room,
  Midnight, Chaos, Vinyl Ritual, Trauma Room) — each is an EQ curve plus
  real DSP: warmth (low-shelf), drive (waveshaper saturation), true
  mid-side stereo width, and a limiter on the harder modes
- 4 visualizer modes: bars, circular spectrum, oscilloscope, bass-reactive
  ripple ring
- Settings panel: reduced motion, storage usage, vault export/import
  (JSON backup), full reset
- Media Session API — lockscreen, headset, and Bluetooth controls

## What it deliberately doesn't do

No Google sign-in, no server-side auth, no cloud sync across devices,
no push notifications. All of those need a backend; this app doesn't
have one by design. The vault lives in one browser, on one device.

Also not included, and not planned as settings-toggle-sized features:
lossless codec decoding (FLAC/ALAC — needs a heavy WASM decoder,
would blow the load-time budget), LUFS/true-peak/BPM/key detection
(real audio-engineering projects, not quick additions).

## Project structure

```
.
├── index.html
├── manifest.json     # PWA manifest — relative paths, shortcuts to Vault/EQ
├── sw.js             # service worker — caches the static shell only
├── css/
│   └── player.css
├── js/
│   └── player.js     # all player logic, EQ/DSP, vault, PWA hooks
└── icons/            # 192/512, maskable variants, apple-touch, favicons
```

## Local setup

No build step. Serve the folder with any static file server and open it:

```bash
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`.

## Deployment

Deployed via GitHub Pages at a project subpath
(`<owner>.github.io/<repo>/`). All paths in `index.html`, `manifest.json`,
and `sw.js` are relative (`./...`) for exactly this reason — absolute
root paths (`/manifest.json`) 404 under a Pages subpath. If this ever
moves to a custom domain or a root-serving host, that's still fine;
relative paths work in both cases.

## Data & privacy

Vault, favorites, recently-played, and EQ presets all live in
`localStorage` in the visiting browser. Nothing is sent to a server —
there isn't one. Clearing browser data or using a different
browser/device starts with an empty vault. Use Settings → Export to
back up as a JSON file.
