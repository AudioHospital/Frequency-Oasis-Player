// ─── Frequency Oasis Player ──────────────────────────────────────────────
// No server, no login. Vault persists to localStorage in this browser only.

const aud = document.getElementById('aud');
const aud2 = document.getElementById('aud2');
const vinyl = document.getElementById('vinyl');
const nowTitle = document.getElementById('nowTitle');
const nowArtist = document.getElementById('nowArtist');
const srcText = document.getElementById('srcText');
const wc = document.getElementById('wc');
const wctx = wc.getContext('2d');
const tc = document.getElementById('tc');
const td = document.getElementById('td');
const playIco = document.getElementById('playIco');
const repIco = document.getElementById('repIco');
const heartIco = document.getElementById('heartIco');
const queueEl = document.getElementById('queueEl');
const qcount = document.getElementById('qcount');
const stbar = document.getElementById('stbar');
const sttext = document.getElementById('sttext');
const libEl = document.getElementById('libEl');
const savedEl = document.getElementById('savedEl');
const resolveStatus = document.getElementById('resolveStatus');

const VAULT_KEY = 'fo_vault_v1';
const FAVORITES_KEY = 'fo_favorites_v1';
const RECENT_KEY = 'fo_recent_v1';
const EQ_PRESETS_KEY = 'fo_eq_presets_v1';
const SETTINGS_KEY = 'fo_settings_v1';
const VAULT_CAP = 100; // soft cap just for the storage bar, not enforced
const RECENT_CAP = 50;

let queue = [];
let currentIndex = -1;
let shuffle = false;
let repeatMode = 'off'; // off | one | all | ab
let abPoints = { a: null, b: null };
let volume = 0.8;
let speed = 1.0;
let sleepTimer = null;
let sleepEndsAt = null;
let visMode = 'bars';
let libFilter = 'all';

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('save failed', key, e); }
}

let liked = new Set(loadJSON(FAVORITES_KEY, []));
let recentlyPlayed = loadJSON(RECENT_KEY, []); // [{url,title,artist,ts}]
let eqPresets = loadJSON(EQ_PRESETS_KEY, {});
let settings = loadJSON(SETTINGS_KEY, { reducedMotion: false, visMode: 'bars' });

let features = { vis: true, ag: true, cf: false, sl: false, rm: settings.reducedMotion };

// ─── Vault (localStorage) ─────────────────────────────────────────────────
function loadVault() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY) || '[]');
  } catch {
    return [];
  }
}
function persistVault(v) {
  try {
    localStorage.setItem(VAULT_KEY, JSON.stringify(v));
  } catch (e) {
    console.warn('Vault save failed (storage full or blocked)', e);
  }
}
let vault = loadVault();

function updateVaultUI() {
  const pct = Math.min(100, (vault.length / VAULT_CAP) * 100);
  stbar.style.width = pct + '%';
  sttext.textContent = `${vault.length} track${vault.length !== 1 ? 's' : ''}`;

  savedEl.innerHTML = '';
  if (vault.length === 0) {
    savedEl.innerHTML = '<div style="font-size:10px;color:rgba(201,168,76,.2)">None yet</div>';
  } else {
    vault.slice(-5).reverse().forEach((t) => {
      const d = document.createElement('div');
      d.className = 'fp-saveditem';
      d.textContent = t.title;
      d.title = t.title;
      d.onclick = () => loadFromVault(t);
      savedEl.appendChild(d);
    });
  }
  renderLib();
}

function loadFromVault(t) {
  const idx = queue.findIndex((q) => q.url === t.url);
  if (idx >= 0) {
    loadTrack(idx);
  } else {
    queue.push({ ...t, isLocal: false });
    renderQueue();
    loadTrack(queue.length - 1);
  }
}

// ─── Time formatting ──────────────────────────────────────────────────────
function fmt(s) {
  if (isNaN(s) || s === Infinity) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// ─── Queue ─────────────────────────────────────────────────────────────
let dragFromIndex = null;

function renderQueue() {
  qcount.textContent = queue.length ? `(${queue.length})` : '';
  queueEl.innerHTML = '';
  queue.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'fp-qitem' + (i === currentIndex ? ' active' : '');
    d.draggable = true;
    d.innerHTML = `<span class="qn">${i + 1}</span><span class="qt">${t.title}</span><span class="qx">✕</span>`;
    d.addEventListener('click', (e) => {
      if (e.target.classList.contains('qx')) return;
      loadTrack(i);
    });
    d.querySelector('.qx').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromQueue(i);
    });
    d.addEventListener('dragstart', () => { dragFromIndex = i; d.classList.add('dragging'); });
    d.addEventListener('dragend', () => d.classList.remove('dragging'));
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('drag-over'); });
    d.addEventListener('dragleave', () => d.classList.remove('drag-over'));
    d.addEventListener('drop', (e) => {
      e.preventDefault();
      d.classList.remove('drag-over');
      if (dragFromIndex === null || dragFromIndex === i) return;
      const [moved] = queue.splice(dragFromIndex, 1);
      const insertAt = dragFromIndex < i ? i - 1 : i;
      queue.splice(insertAt, 0, moved);
      if (currentIndex === dragFromIndex) currentIndex = insertAt;
      else if (dragFromIndex < currentIndex && insertAt >= currentIndex) currentIndex--;
      else if (dragFromIndex > currentIndex && insertAt <= currentIndex) currentIndex++;
      dragFromIndex = null;
      renderQueue();
    });
    queueEl.appendChild(d);
  });
}

function removeFromQueue(i) {
  if (queue[i].isLocal && queue[i].url) URL.revokeObjectURL(queue[i].url);
  queue.splice(i, 1);
  if (currentIndex === i) {
    currentIndex = -1;
    aud.pause();
    aud.src = '';
    nowTitle.textContent = 'No track loaded';
    nowArtist.textContent = 'Drop files or paste a direct MP3 URL';
    srcText.textContent = '—';
    vinyl.classList.remove('spin');
  } else if (currentIndex > i) {
    currentIndex--;
  }
  renderQueue();
}

function loadTrack(i) {
  if (i < 0 || i >= queue.length) return;
  currentIndex = i;
  const t = queue[i];
  aud.src = t.url;
  aud.playbackRate = speed;
  aud.volume = volume;
  nowTitle.textContent = t.title;
  nowArtist.textContent = t.artist || 'Unknown artist';
  srcText.textContent = t.isLocal ? 'Local file' : 'Direct URL';
  heartIco.style.color = liked.has(t.url) ? 'var(--gold)' : '';
  aud.play().catch(() => {});
  renderQueue();
  document.title = `▶ ${t.title} — Frequency Oasis`;
  logRecentlyPlayed(t);

  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist || 'Unknown artist',
      album: 'Frequency Oasis',
      artwork: [{ src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
    });
  }
}

function addToQueueAndMaybePlay(track) {
  queue.push(track);
  renderQueue();
  if (currentIndex === -1) loadTrack(queue.length - 1);
}

// ─── Add track: URL ────────────────────────────────────────────────────
function resolveAndAdd() {
  const urlIn = document.getElementById('urlIn');
  const titleIn = document.getElementById('titleIn');
  const artistIn = document.getElementById('artistIn');
  const url = urlIn.value.trim();
  if (!url) return;

  resolveStatus.textContent = 'Adding…';
  const guessedTitle = url.split('/').pop().replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'Untitled';

  addToQueueAndMaybePlay({
    url,
    title: titleIn.value.trim() || guessedTitle,
    artist: artistIn.value.trim() || 'Unknown artist',
    isLocal: false
  });

  urlIn.value = '';
  titleIn.value = '';
  artistIn.value = '';
  resolveStatus.textContent = 'Added to queue.';
  setTimeout(() => (resolveStatus.textContent = ''), 2000);
}

// ─── Add track: local files ────────────────────────────────────────────
function addFile(input) {
  Array.from(input.files).forEach((f) => {
    const url = URL.createObjectURL(f);
    addToQueueAndMaybePlay({
      url,
      title: f.name.replace(/\.[^.]+$/, ''),
      artist: 'Local file',
      isLocal: true
    });
  });
  input.value = '';
}

function clearAll() {
  queue.forEach((t) => {
    if (t.isLocal) URL.revokeObjectURL(t.url);
  });
  queue = [];
  currentIndex = -1;
  aud.pause();
  aud.src = '';
  nowTitle.textContent = 'No track loaded';
  nowArtist.textContent = 'Drop files or paste a direct MP3 URL';
  srcText.textContent = '—';
  vinyl.classList.remove('spin');
  document.title = 'Frequency Oasis';
  renderQueue();
}

// ─── Transport controls ────────────────────────────────────────────────
function togglePlay() {
  if (!aud.src) return;
  if (aud.paused) aud.play(); else aud.pause();
}

function prevTrack() {
  if (aud.currentTime > 3) { aud.currentTime = 0; return; }
  if (shuffle) return randomTrack();
  if (currentIndex > 0) loadTrack(currentIndex - 1);
  else if (repeatMode === 'all') loadTrack(queue.length - 1);
}

function nextTrack() {
  if (shuffle) return randomTrack();
  if (currentIndex < queue.length - 1) loadTrack(currentIndex + 1);
  else if (repeatMode === 'all') loadTrack(0);
  else document.title = 'Frequency Oasis';
}

function randomTrack() {
  if (queue.length < 2) return;
  let next;
  do { next = Math.floor(Math.random() * queue.length); } while (next === currentIndex);
  loadTrack(next);
}

function toggleShuffle() {
  shuffle = !shuffle;
  document.getElementById('btnShuffle').classList.toggle('active', shuffle);
}

function cycleRepeat() {
  const order = ['off', 'all', 'one', 'ab'];
  setRepeat(order[(order.indexOf(repeatMode) + 1) % order.length]);
}

function setRepeat(mode) {
  repeatMode = mode;
  aud.loop = (mode === 'one');
  document.getElementById('btnRepeat').classList.toggle('active', mode !== 'off');
  ['off', 'one', 'all', 'ab'].forEach((m) =>
    document.getElementById('rb-' + m).classList.toggle('sel', m === mode)
  );
  if (mode === 'ab') {
    abPoints = { a: aud.currentTime, b: null };
    resolveStatus.textContent = 'A point set — play to B point, it will loop A–B.';
    setTimeout(() => (resolveStatus.textContent = ''), 3000);
  }
}

function likeTrack() {
  if (currentIndex === -1) return;
  const t = queue[currentIndex];
  if (liked.has(t.url)) { liked.delete(t.url); heartIco.style.color = ''; }
  else { liked.add(t.url); heartIco.style.color = 'var(--gold)'; }
  saveJSON(FAVORITES_KEY, Array.from(liked));
}

function logRecentlyPlayed(t) {
  recentlyPlayed = recentlyPlayed.filter((r) => r.url !== t.url);
  recentlyPlayed.unshift({ url: t.url, title: t.title, artist: t.artist, ts: Date.now() });
  if (recentlyPlayed.length > RECENT_CAP) recentlyPlayed.length = RECENT_CAP;
  saveJSON(RECENT_KEY, recentlyPlayed);
}

function saveToVault() {
  if (currentIndex === -1) return;
  const t = queue[currentIndex];
  if (t.isLocal) {
    resolveStatus.textContent = "Can't vault local files — only direct URLs persist across sessions.";
    setTimeout(() => (resolveStatus.textContent = ''), 3500);
    return;
  }
  if (!vault.some((v) => v.url === t.url)) {
    vault.push({ url: t.url, title: t.title, artist: t.artist });
    persistVault(vault);
    updateVaultUI();
    resolveStatus.textContent = 'Saved to vault.';
    setTimeout(() => (resolveStatus.textContent = ''), 2000);
  }
}

// ─── Volume / speed ────────────────────────────────────────────────────
function setVol(v) {
  volume = v / 100;
  aud.volume = volume;
  document.getElementById('volVal').textContent = v;
}

function setSpeed(v) {
  speed = v / 100;
  aud.playbackRate = speed;
  document.getElementById('speedVal').textContent = speed.toFixed(2) + '×';
}

// ─── Seek ──────────────────────────────────────────────────────────────
function seekClick(e) {
  if (!aud.duration) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  aud.currentTime = ratio * aud.duration;
}

// ─── Nav (view switching) ─────────────────────────────────────────────
function nav(view) {
  ['player', 'library', 'eq', 'settings'].forEach((v) => {
    document.getElementById('view-' + v).style.display = v === view ? '' : 'none';
    document.getElementById('nt-' + v).classList.toggle('on', v === view);
  });
  if (view === 'library') renderLib();
  if (view === 'settings') renderSettings();
}

// ─── Library / vault view ──────────────────────────────────────────────
function setLibFilter(f) {
  libFilter = f;
  document.querySelectorAll('.lfb').forEach((b) => b.classList.toggle('sel', b.dataset.lf === f));
  renderLib();
}

function renderLib() {
  const q = (document.getElementById('libSearch')?.value || '').toLowerCase();
  let base = vault;
  if (libFilter === 'fav') base = vault.filter((t) => liked.has(t.url));
  if (libFilter === 'recent') {
    const order = recentlyPlayed.map((r) => r.url);
    base = vault.filter((t) => order.includes(t.url))
      .sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
  }
  const filtered = base.filter(
    (t) => t.title.toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q)
  );
  if (filtered.length === 0) {
    libEl.innerHTML = '<div style="font-size:11px;color:rgba(201,168,76,.25)">Nothing saved yet.</div>';
    return;
  }
  libEl.innerHTML = '';
  filtered.forEach((t) => {
    const d = document.createElement('div');
    d.className = 'fp-libitem';
    d.innerHTML = `<span class="ln">${t.title}</span><span class="la">${t.artist || ''}</span><span class="lx">✕</span>`;
    d.addEventListener('click', (e) => {
      if (e.target.classList.contains('lx')) return;
      loadFromVault(t);
      nav('player');
      document.getElementById('nt-player').click();
    });
    d.querySelector('.lx').addEventListener('click', (e) => {
      e.stopPropagation();
      vault = vault.filter((v) => v.url !== t.url);
      persistVault(vault);
      updateVaultUI();
    });
    libEl.appendChild(d);
  });
}

// ─── Feature toggles ───────────────────────────────────────────────────
function togFeat(key) {
  features[key] = !features[key];
  const tog = document.getElementById('tog-' + key);
  tog.classList.toggle('on', features[key]);
  tog.setAttribute('aria-checked', features[key]);

  if (key === 'sl') {
    document.getElementById('sleepRow').style.display = features.sl ? '' : 'none';
    if (features.sl) startSleepTimer(parseInt(document.getElementById('sleepSl').value, 10));
    else clearSleepTimer();
  }
  if (key === 'ag' && audioCtx) {
    compressor.threshold.value = features.ag ? -24 : 0;
    compressor.ratio.value = features.ag ? 3 : 1;
  }
  if (key === 'rm') {
    document.body.classList.toggle('reduced-motion', features.rm);
    if (features.rm) vinyl.classList.remove('spin');
    else if (!aud.paused) vinyl.classList.add('spin');
    settings.reducedMotion = features.rm;
    saveJSON(SETTINGS_KEY, settings);
  }
}

// ─── Settings panel ────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('tog-rm').classList.toggle('on', features.rm);
  document.getElementById('tog-rm').setAttribute('aria-checked', features.rm);

  const vaultBytes = new Blob([JSON.stringify(vault)]).size;
  const favBytes = new Blob([JSON.stringify(Array.from(liked))]).size;
  const recentBytes = new Blob([JSON.stringify(recentlyPlayed)]).size;
  const totalKB = ((vaultBytes + favBytes + recentBytes) / 1024).toFixed(1);
  document.getElementById('storageDetail').textContent =
    `${vault.length} tracks · ${liked.size} favorites · ${recentlyPlayed.length} recent plays · ${totalKB} KB in localStorage`;
}

function flashSettingsStatus(msg) {
  const el = document.getElementById('settingsStatus');
  el.textContent = msg;
  setTimeout(() => (el.textContent = ''), 2500);
}

function exportVault() {
  const payload = { vault, favorites: Array.from(liked), recentlyPlayed };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'frequency-oasis-vault-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
  flashSettingsStatus('Exported.');
}

function importVault(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.vault)) {
        data.vault.forEach((t) => { if (!vault.some((v) => v.url === t.url)) vault.push(t); });
        persistVault(vault);
      }
      if (Array.isArray(data.favorites)) {
        data.favorites.forEach((u) => liked.add(u));
        saveJSON(FAVORITES_KEY, Array.from(liked));
      }
      if (Array.isArray(data.recentlyPlayed)) {
        recentlyPlayed = [...data.recentlyPlayed, ...recentlyPlayed].slice(0, RECENT_CAP);
        saveJSON(RECENT_KEY, recentlyPlayed);
      }
      updateVaultUI();
      renderSettings();
      flashSettingsStatus('Imported.');
    } catch (e) {
      flashSettingsStatus('Import failed — not a valid backup file.');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function resetEverything() {
  if (!confirm('This clears the vault, favorites, recently-played, and EQ presets from this browser. Cannot be undone. Continue?')) return;
  [VAULT_KEY, FAVORITES_KEY, RECENT_KEY, EQ_PRESETS_KEY, SETTINGS_KEY].forEach((k) => localStorage.removeItem(k));
  vault = []; liked = new Set(); recentlyPlayed = []; eqPresets = {};
  updateVaultUI();
  renderEqPresetList();
  renderSettings();
  flashSettingsStatus('Reset complete.');
}

function upSleep(mins) {
  document.getElementById('sleepV').textContent = mins;
  if (features.sl) startSleepTimer(parseInt(mins, 10));
}

function startSleepTimer(mins) {
  clearSleepTimer();
  sleepEndsAt = Date.now() + mins * 60000;
  sleepTimer = setInterval(() => {
    const remaining = Math.max(0, sleepEndsAt - Date.now());
    if (remaining <= 0) {
      aud.pause();
      clearSleepTimer();
    }
  }, 1000);
}

function clearSleepTimer() {
  if (sleepTimer) clearInterval(sleepTimer);
  sleepTimer = null;
}

// ─── EQ (10-band) ──────────────────────────────────────────────────────
const EQ_BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const eqBandsEl = document.getElementById('eqBands');
let eqFilters = [];

function saveEqPreset() {
  const name = prompt('Preset name?');
  if (!name) return;
  eqPresets[name] = EQ_BANDS.map((_, i) => parseFloat(document.getElementById(`eqs-${i}`).value));
  saveJSON(EQ_PRESETS_KEY, eqPresets);
  renderEqPresetList();
}

function renderEqPresetList() {
  const el = document.getElementById('eqPresetList');
  el.innerHTML = '';
  Object.keys(eqPresets).forEach((name) => {
    const b = document.createElement('button');
    b.className = 'fb';
    b.textContent = name;
    b.onclick = () => applyEqValues(eqPresets[name]);
    el.appendChild(b);
  });
}

function applyEqValues(vals) {
  vals.forEach((db, i) => {
    const s = document.getElementById(`eqs-${i}`);
    if (s) { s.value = db; setEqBand(i, db); }
  });
}

function exportEqPreset() {
  const vals = EQ_BANDS.map((_, i) => parseFloat(document.getElementById(`eqs-${i}`).value));
  const blob = new Blob([JSON.stringify({ bands: EQ_BANDS, gains: vals }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'frequency-oasis-eq-preset.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importEqPreset(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.gains)) applyEqValues(data.gains);
    } catch (e) { console.warn('bad preset file', e); }
  };
  reader.readAsText(file);
  input.value = '';
}

function buildEqUI() {
  eqBandsEl.innerHTML = '';
  EQ_BANDS.forEach((freq, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'fp-eqband';
    const label = freq >= 1000 ? (freq / 1000) + 'k' : freq;
    wrap.innerHTML = `
      <span class="eqv" id="eqv-${i}">0</span>
      <input type="range" min="-12" max="12" value="0" step="1" id="eqs-${i}">
      <span class="eqf">${label}</span>
    `;
    eqBandsEl.appendChild(wrap);
    wrap.querySelector('input').addEventListener('input', (e) => {
      setEqBand(i, parseFloat(e.target.value));
    });
  });
}

function setEqBand(i, db) {
  document.getElementById(`eqv-${i}`).textContent = db > 0 ? '+' + db : db;
  if (eqFilters[i]) eqFilters[i].gain.value = db;
}

// Signature sound modes: each is an EQ curve (10 bands) + real DSP settings,
// not just a gain preset. warmth = low-shelf boost, drive = waveshaper
// saturation amount (0-1), width = stereo widening (1 = normal), limiter =
// harder compressor knee for a "mastered loud" feel.
const SOUND_MODES = {
  flat:        { eq: [0,0,0,0,0,0,0,0,0,0],        warmth: 0,   drive: 0,   width: 1.0, limiter: false },
  studio:      { eq: [0,0,0,-1,-1,0,0,1,1,1],      warmth: 0,   drive: 0,   width: 1.0, limiter: false },
  goldroom:    { eq: [3,3,2,1,0,0,1,2,2,1],        warmth: 4,   drive: .15, width: 1.15, limiter: false },
  midnight:    { eq: [4,3,1,0,-1,-1,-2,-2,-1,0],   warmth: 3,   drive: .1,  width: 0.9, limiter: false },
  chaos:       { eq: [2,4,-2,3,-3,4,-2,5,-1,3],    warmth: 0,   drive: .5,  width: 1.4, limiter: true  },
  vinylritual: { eq: [5,4,2,1,0,-1,-2,-4,-6,-8],   warmth: 5,   drive: .3,  width: 0.95, limiter: false },
  traumaroom:  { eq: [6,5,3,2,-1,-2,0,3,4,2],      warmth: 2,   drive: .65, width: 1.25, limiter: true  }
};

let pendingSoundMode = 'flat';

function soundMode(name) {
  const m = SOUND_MODES[name];
  if (!m) return;
  pendingSoundMode = name;
  applyEqValues(m.eq);
  document.querySelectorAll('.sm').forEach((b) => b.classList.toggle('sel', b.dataset.sm === name));
  applyDsp(m);
}

// ─── Web Audio: EQ chain + DSP (warmth/drive/width/limiter) + analyser ──
let audioCtx, analyser, compressor, sourceNode;
let warmthShelf, driveShaper, widthSplitter, widthMerger;
let midGainL, midGainR, sideGainL, sideGainR, sideWidthPos, sideWidthNeg;

function makeDriveCurve(amount) {
  // amount 0-1: soft saturation curve, 0 = transparent passthrough
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 20; // drive strength
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k === 0 ? x : Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

function initAudioGraph() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaElementSource(aud);

  eqFilters = EQ_BANDS.map((freq) => {
    const f = audioCtx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1;
    f.gain.value = 0;
    return f;
  });

  warmthShelf = audioCtx.createBiquadFilter();
  warmthShelf.type = 'lowshelf';
  warmthShelf.frequency.value = 200;
  warmthShelf.gain.value = 0;

  driveShaper = audioCtx.createWaveShaper();
  driveShaper.curve = makeDriveCurve(0);
  driveShaper.oversample = '2x';

  // Stereo width via true mid-side: mid=(L+R)/2, side=(L-R)/2,
  // L'=mid+width*side, R'=mid-width*side. width=1 untouched, >1 widens.
  widthSplitter = audioCtx.createChannelSplitter(2);
  widthMerger = audioCtx.createChannelMerger(2);

  midGainL = audioCtx.createGain(); midGainL.gain.value = 0.5;
  midGainR = audioCtx.createGain(); midGainR.gain.value = 0.5;
  sideGainL = audioCtx.createGain(); sideGainL.gain.value = 0.5;
  sideGainR = audioCtx.createGain(); sideGainR.gain.value = -0.5;
  sideWidthPos = audioCtx.createGain(); sideWidthPos.gain.value = 1;
  sideWidthNeg = audioCtx.createGain(); sideWidthNeg.gain.value = -1;

  widthSplitter.connect(midGainL, 0);
  widthSplitter.connect(midGainR, 1);
  widthSplitter.connect(sideGainL, 0);
  widthSplitter.connect(sideGainR, 1);

  // side = sideGainL + sideGainR (sum happens automatically at shared destination)
  sideGainL.connect(sideWidthPos);
  sideGainR.connect(sideWidthPos);
  sideGainL.connect(sideWidthNeg);
  sideGainR.connect(sideWidthNeg);

  // L' = mid + width*side  → merger channel 0
  midGainL.connect(widthMerger, 0, 0);
  midGainR.connect(widthMerger, 0, 0);
  sideWidthPos.connect(widthMerger, 0, 0);

  // R' = mid - width*side  → merger channel 1
  midGainL.connect(widthMerger, 0, 1);
  midGainR.connect(widthMerger, 0, 1);
  sideWidthNeg.connect(widthMerger, 0, 1);

  compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = features.ag ? -24 : 0;
  compressor.ratio.value = features.ag ? 3 : 1;

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;

  // chain: source -> eq -> warmth -> drive -> width -> compressor/limiter -> analyser -> destination
  let node = sourceNode;
  eqFilters.forEach((f) => { node.connect(f); node = f; });
  node.connect(warmthShelf);
  warmthShelf.connect(driveShaper);
  driveShaper.connect(widthSplitter);
  widthMerger.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function applyDsp(m) {
  if (!audioCtx) return; // will apply once playback starts and graph inits
  warmthShelf.gain.value = m.warmth;
  driveShaper.curve = makeDriveCurve(m.drive);
  sideWidthPos.gain.value = m.width;
  sideWidthNeg.gain.value = -m.width;
  if (m.limiter) {
    compressor.threshold.value = -12;
    compressor.ratio.value = 12;
    compressor.knee.value = 2;
  } else {
    compressor.threshold.value = features.ag ? -24 : 0;
    compressor.ratio.value = features.ag ? 3 : 1;
    compressor.knee.value = 30;
  }
}

// ─── Waveform / visualiser canvas ─────────────────────────────────────
function resizeCanvas() {
  wc.width = wc.parentElement.clientWidth;
  wc.height = 44;
}
window.addEventListener('resize', resizeCanvas);

function setVisMode(mode) {
  visMode = mode;
  document.querySelectorAll('.vmb').forEach((b) => b.classList.toggle('sel', b.dataset.vm === mode));
  settings.visMode = mode;
  saveJSON(SETTINGS_KEY, settings);
}

function drawBars(data, w, h) {
  const barW = w / data.length;
  for (let i = 0; i < data.length; i++) {
    const barH = (data[i] / 255) * h;
    wctx.fillStyle = 'rgba(201,168,76,' + (0.25 + 0.55 * (data[i] / 255)) + ')';
    wctx.fillRect(i * barW, h - barH, barW - 1, barH);
  }
}

function drawCircular(data, w, h) {
  const cx = w / 2, cy = h / 2, baseR = h * 0.15;
  for (let i = 0; i < data.length; i++) {
    const angle = (i / data.length) * Math.PI * 2;
    const mag = (data[i] / 255) * (h * 0.4);
    const x1 = cx + Math.cos(angle) * baseR;
    const y1 = cy + Math.sin(angle) * baseR;
    const x2 = cx + Math.cos(angle) * (baseR + mag);
    const y2 = cy + Math.sin(angle) * (baseR + mag);
    wctx.strokeStyle = 'rgba(201,168,76,' + (0.3 + 0.5 * (data[i] / 255)) + ')';
    wctx.lineWidth = 1.5;
    wctx.beginPath();
    wctx.moveTo(x1, y1);
    wctx.lineTo(x2, y2);
    wctx.stroke();
  }
}

function drawScope(w, h) {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  wctx.strokeStyle = 'rgba(201,168,76,.8)';
  wctx.lineWidth = 1.5;
  wctx.beginPath();
  const step = w / data.length;
  data.forEach((v, i) => {
    const y = (v / 255) * h;
    i === 0 ? wctx.moveTo(0, y) : wctx.lineTo(i * step, y);
  });
  wctx.stroke();
}

function drawRing(data, w, h) {
  // bass-reactive concentric arcs — compact nod to the icon's ripple motif
  const bass = data.slice(0, Math.max(1, Math.floor(data.length * 0.15)));
  const bassAvg = bass.reduce((a, b) => a + b, 0) / bass.length / 255;
  const cx = w / 2, cy = h / 2;
  for (let r = 0; r < 3; r++) {
    const radius = (h * 0.18) + r * (h * 0.12) + bassAvg * (h * 0.15);
    wctx.strokeStyle = 'rgba(201,168,76,' + (0.5 - r * 0.12) + ')';
    wctx.lineWidth = 1;
    wctx.beginPath();
    wctx.arc(cx, cy, radius, 0, Math.PI * 2);
    wctx.stroke();
  }
}

function drawFrame() {
  requestAnimationFrame(drawFrame);
  const w = wc.width, h = wc.height;
  wctx.clearRect(0, 0, w, h);

  if (features.vis && analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    if (visMode === 'bars') drawBars(data, w, h);
    else if (visMode === 'circular') drawCircular(data, w, h);
    else if (visMode === 'scope') drawScope(w, h);
    else if (visMode === 'ring') drawRing(data, w, h);
  } else {
    wctx.strokeStyle = 'rgba(201,168,76,.15)';
    wctx.beginPath();
    wctx.moveTo(0, h / 2);
    wctx.lineTo(w, h / 2);
    wctx.stroke();
  }

  if (aud.duration) {
    const x = (aud.currentTime / aud.duration) * w;
    wctx.fillStyle = 'rgba(201,168,76,.9)';
    wctx.fillRect(x - 1, 0, 2, h);
  }
}

// ─── Audio element events ─────────────────────────────────────────────
aud.addEventListener('play', () => {
  playIco.className = 'ti ti-player-pause';
  if (!features.rm) vinyl.classList.add('spin');
  const firstInit = !audioCtx;
  initAudioGraph();
  if (firstInit) applyDsp(SOUND_MODES[pendingSoundMode]);
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
});
aud.addEventListener('pause', () => {
  playIco.className = 'ti ti-player-play';
  vinyl.classList.remove('spin');
});
aud.addEventListener('timeupdate', () => {
  tc.textContent = fmt(aud.currentTime);
  if (repeatMode === 'ab' && abPoints.a != null && abPoints.b != null && aud.currentTime >= abPoints.b) {
    aud.currentTime = abPoints.a;
  }
  // simple crossfade near track end
  if (features.cf && aud.duration && aud.duration - aud.currentTime < 3 && currentIndex < queue.length - 1) {
    const fadeRatio = Math.max(0, (aud.duration - aud.currentTime) / 3);
    aud.volume = volume * fadeRatio;
  } else if (!aud.paused) {
    aud.volume = volume;
  }
});
aud.addEventListener('loadedmetadata', () => { td.textContent = fmt(aud.duration); });
aud.addEventListener('ended', () => {
  aud.volume = volume;
  if (repeatMode === 'one') return; // handled by aud.loop
  nextTrack();
});

// double-click B point for A-B loop when in 'ab' mode (click waveform)
document.getElementById('waveRow').addEventListener('dblclick', () => {
  if (repeatMode === 'ab' && abPoints.a != null && abPoints.b == null) {
    abPoints.b = aud.currentTime;
    resolveStatus.textContent = 'B point set — looping A–B.';
    setTimeout(() => (resolveStatus.textContent = ''), 2000);
  }
});

// ─── Tag filter (cosmetic — filters queue display by tag, tracks untagged) ─
document.querySelectorAll('.fp-tag').forEach((tag) => {
  tag.addEventListener('click', () => tag.classList.toggle('on'));
});

// ─── Keyboard shortcuts ────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight') aud.currentTime = Math.min(aud.duration || 0, aud.currentTime + 5);
  if (e.code === 'ArrowLeft') aud.currentTime = Math.max(0, aud.currentTime - 5);
  if (e.code === 'ArrowUp') { e.preventDefault(); setVol(Math.min(100, +document.getElementById('volSl').value + 5)); document.getElementById('volSl').value = volume * 100; }
  if (e.code === 'ArrowDown') { e.preventDefault(); setVol(Math.max(0, +document.getElementById('volSl').value - 5)); document.getElementById('volSl').value = volume * 100; }
  if (e.code === 'KeyN') nextTrack();
  if (e.code === 'KeyP') prevTrack();
});

// ─── Drag & drop anywhere ──────────────────────────────────────────────
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('audio/'));
  files.forEach((f) => {
    const url = URL.createObjectURL(f);
    addToQueueAndMaybePlay({ url, title: f.name.replace(/\.[^.]+$/, ''), artist: 'Local file', isLocal: true });
  });
});

// ─── Media Session (lockscreen / headset / bluetooth controls) ───────
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => aud.play());
  navigator.mediaSession.setActionHandler('pause', () => aud.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
  navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
  navigator.mediaSession.setActionHandler('seekbackward', (d) => {
    aud.currentTime = Math.max(0, aud.currentTime - (d.seekOffset || 10));
  });
  navigator.mediaSession.setActionHandler('seekforward', (d) => {
    aud.currentTime = Math.min(aud.duration || 0, aud.currentTime + (d.seekOffset || 10));
  });
  navigator.mediaSession.setActionHandler('seekto', (d) => {
    if (d.seekTime != null) aud.currentTime = d.seekTime;
  });
}
aud.addEventListener('play', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'; });
aud.addEventListener('pause', () => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'; });

// ─── Init ──────────────────────────────────────────────────────────────
resizeCanvas();
buildEqUI();
updateVaultUI();
renderQueue();
renderEqPresetList();
visMode = settings.visMode || 'bars';
document.querySelectorAll('.vmb').forEach((b) => b.classList.toggle('sel', b.dataset.vm === visMode));
if (features.rm) document.body.classList.add('reduced-motion');

const requestedView = new URLSearchParams(location.search).get('view');
if (requestedView && ['player', 'library', 'eq', 'settings'].includes(requestedView)) {
  nav(requestedView);
}

requestAnimationFrame(drawFrame);
