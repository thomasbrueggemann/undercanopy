/* CANOPY split file  weather: occasional world events — the Grey Wind (dust storm),
   the Long Rain (thunderstorm), the White Hour (heat wave). One global mixer (WX)
   recomputed every frame; existing files read it at a handful of guarded touch points.
   Weather is atmosphere, not worldgen: random per session, never persisted, fully inert
   in SHOT mode. Every event is telegraphed, bounded, and always survivable with tools the
   game already teaches (shelter, deep shade, water, pits, night, the R-key shade recall).
   Loaded after puzzles.js and before story.js; all cross-script reads are typeof-guarded. */
'use strict';

/* ------------------------------------------------------------- the WX mixer -- */
// Neutral by default so main.js/player.js are no-ops when no event is running (and in
// SHOT mode, where updateWeather is never called — WX simply stays at these values).
var WX = {
  kind: null,          // null | 'dust' | 'storm' | 'heat'  (active event only)
  phase: 'clear',      // 'clear' | 'warn' | 'active' | 'clearing'
  k: 0,                // 0..1 intensity envelope (ramps in/out smoothly, no pops)
  fogNearMul: 1, fogFarMul: 1,   // multiply the loop's computed fog near/far
  sunMul: 1,           // multiplies sun + hemi intensity after updateSky (main.js)
  heatMul: 1,          // multiplies heatRate in stepHeat
  airAdd: 0,           // added to the displayed air temperature
  shadeSafeE: 0.25,    // stepHeat's "counts as shade" threshold (heat wave lowers it)
  windX: 0, windZ: 0,  // m/s shove added to player velocity (hard-capped below WALK)
  floodSlow: 1,        // walk-speed multiplier on flooded street-level ground
  strain: 0,           // dust storm: per-second body-strain rate while unsheltered
  // --- two internal fields beyond the doc's illustrative list, both safe-defaulted ---
  flash: 0,            // additive sun/hemi bump for a lightning flash (applied after sunMul)
  heatDrainMul: 1      // Long Rain cooling: scales stepHeat's shade-drain while out in the rain
};

/* ------------------------------------------------------------- tuning -------- */
const WX_WARN = 90;            // real seconds of telegraph before an event turns active
const WX_WARN_FORCED = 2.6;    // ?wx= dev path: short warn so the frame changes fast for the verifier
const WX_CLEAR = 30;           // real seconds of ramp-out
const WX_ROLL = 0.35;          // chance of one event per in-game dawn (once clear + eligible)
const WX_GRACE = 240;          // no rolls in the first 4 real minutes of a session
const WX_DAWN = 0.24;          // dayT the roll fires at (a beat after sunrise)
// colours are authored sRGB → linear once (srgb() from core.js), so tinting is alloc-free.
const WX_BROWN = srgb(0x8a7a5e);    // the Grey Wind's paper-coloured horizon
const WX_STORMSKY = srgb(0x565f6a); // the Long Rain's bruised grey
const WX_WHITE = srgb(0xf1ead6);    // the White Hour's flat glare
const _wxCol = new THREE.Color();   // scratch (never handed out)

/* --------------------------------------------------------- particle pools ---
   Two pooled THREE.Points clouds, allocated once and parked hidden. Grey motes stream
   horizontally around the camera (drifter idiom); rain streaks fall fast. Opacity rides
   WX.k so both fade in and out with the envelope; positions recycle through a box that
   follows the camera, so a few hundred sprites cover the whole visible field. */
function _wxPool(n, size, color, additive) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const seed = new Float32Array(n), rs = mulberry32(n * 13 + 1);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rs() - 0.5) * 60; pos[i * 3 + 1] = rs() * 30; pos[i * 3 + 2] = (rs() - 0.5) * 60;
    col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
    seed[i] = rs() * 7;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({
    size, map: texSoft, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: 0
  }));
  m.frustumCulled = false; m.visible = false; scene.add(m);
  return { mesh: m, pos, seed, n, boxR: 30 };
}
const _wxDust = _wxPool(350, 0.5, srgb(0x9a8d76), false);
const _wxRain = _wxPool(500, 0.22, srgb(0xbccad8), false);

function _wxStepDust(dt, time, k) {
  const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
  const R = _wxDust.boxR, pos = _wxDust.pos, sd = _wxDust.seed;
  const wxv = WX.windX, wzv = WX.windZ;
  for (let i = 0; i < _wxDust.n; i++) {
    const s = sd[i];
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    x += (wxv * 1.7 + Math.sin(time * 1.3 + s) * 1.3) * dt;
    z += (wzv * 1.7 + Math.cos(time * 1.1 + s * 1.7) * 1.3) * dt;
    y += Math.sin(time * 0.9 + s * 3) * 0.4 * dt;
    if (x - px > R) x -= 2 * R; else if (px - x > R) x += 2 * R;
    if (z - pz > R) z -= 2 * R; else if (pz - z > R) z += 2 * R;
    const yb = py - 9, yt = py + 18;
    if (y < yb) y = yt; else if (y > yt) y = yb;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  }
  _wxDust.mesh.geometry.attributes.position.needsUpdate = true;
  _wxDust.mesh.material.opacity = 0.55 * k;
}
function _wxStepRain(dt, time, k) {
  const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
  const R = _wxRain.boxR, pos = _wxRain.pos, sd = _wxRain.seed;
  const sx = WX.windX * 0.35, sz = WX.windZ * 0.35;
  for (let i = 0; i < _wxRain.n; i++) {
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    y -= (17 + (sd[i] % 3) * 2) * dt;            // fast fall
    x += sx * dt; z += sz * dt;
    if (x - px > R) x -= 2 * R; else if (px - x > R) x += 2 * R;
    if (z - pz > R) z -= 2 * R; else if (pz - z > R) z += 2 * R;
    if (y < py - 7) y = py + 17;                 // recycle to the top of the box
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
  }
  _wxRain.mesh.geometry.attributes.position.needsUpdate = true;
  _wxRain.mesh.material.opacity = 0.62 * k;
}

/* ------------------------------------------------------- shelter test -------
   Sheltered iff a vertical ray from the player hits a solid overhead (reuse player.js's
   _rayHitsBox march over nearby.solids straight up), OR down a deep pit, OR in water, OR
   under >= 2 stacked leaf pads (the deep canopy protects; a lone platter does not).
   Throttled to ~5 Hz like the sun probe; both updateWeather and stepHeat read the cache. */
let _wxShelterT = 0, _wxSheltered = false;
function _wxComputeShelter() {
  if (typeof player === 'undefined') return false;
  const p = player, py = p.pos.y;
  if (p.inWater) return true;
  if (p.inPit && py < -1) return true;
  if (typeof nearby === 'undefined' || typeof _rayHitsBox !== 'function') return false;
  const solids = nearby.solids;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s.h <= py + 0.3) continue;                          // not genuinely overhead
    if (_rayHitsBox(p.pos.x, py + 0.1, p.pos.z, 0, 1, 0, s.x0, s.z0, s.x1, s.z1, s.h)) return true;
  }
  const pads = nearby.pads; let cnt = 0;
  for (let i = 0; i < pads.length; i++) {
    const pd = pads[i];
    if (pd.y <= py + 0.8) continue;                         // must be overhead cover
    const dx = p.pos.x - pd.x, dz = p.pos.z - pd.z;
    if (dx * dx + dz * dz <= pd.r * pd.r) { cnt++; if (cnt >= 2) return true; }
  }
  return false;
}
// Public: the cached shelter verdict. stepHeat calls this for dust-storm strain.
function weatherShelter() { return _wxSheltered; }

/* --------------------------------------------------------- weather audio ----
   All AC-gated (never in SHOT, where AC is never created; and never before the player's
   first click). A rain loop + a dust-wind loop (the wind-noise idiom, one filter each) are
   built once on first need; thunder and the strike crackle are one-shot noise bursts. */
let _wxRainSrc = null, _wxRainGain = null, _wxWindGain = null;
function _wxAudioEnsure() {
  if (typeof AC === 'undefined' || !AC) return false;
  if (_wxRainGain) return true;
  try {
    const mk = (freq, q) => {
      const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
      const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = freq; lp.Q.value = q;
      const g = AC.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(g); g.connect(master); src.start();
      return g;
    };
    _wxRainGain = mk(1700, 0.5);                            // rain: brighter noise, more gain
    _wxWindGain = mk(360, 0.6);                             // dust wind: low, scouring
    _wxRainSrc = true;
  } catch (e) { return false; }
  return true;
}
function _wxThunder(delay, vol) {
  if (typeof AC === 'undefined' || !AC || muted) return;
  const t0 = AC.currentTime + delay;
  const len = (AC.sampleRate * 1.3) | 0, buf = AC.createBuffer(1, len, AC.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = AC.createBufferSource(); src.buffer = buf;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 0.7;
  const g = AC.createGain();
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
  src.connect(lp); lp.connect(g); g.connect(master); src.start(t0); src.stop(t0 + 1.3);
}
function _wxCrackle() {
  if (typeof AC === 'undefined' || !AC || muted) return;
  const t0 = AC.currentTime + 0.01;
  const len = (AC.sampleRate * 0.25) | 0, buf = AC.createBuffer(1, len, AC.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = AC.createBufferSource(); src.buffer = buf;
  const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
  const g = AC.createGain(); g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
  src.connect(hp); hp.connect(g); g.connect(master); src.start(t0); src.stop(t0 + 0.26);
}

/* --------------------------------------------------------- scheduler state -- */
let _wxSession = performance.now() / 1000;   // real-time clock for the grace period
let _wxLastDayT = -1;
let _wxDawn = 0, _wxLastEventDawn = -999;     // in-game-day counter → one clear day between events
let _wxPending = null;                        // { kind, startAt }  scheduled, not yet warning
let _wxPhaseT = 0, _wxWarnDur = WX_WARN, _wxActiveDur = 180, _wxFlood = 0;
let _wxWindAng = Math.random() * Math.PI * 2;
let _wxNextBolt = 0, _wxFlashUntil = 0, _wxStrikeTell = 0, _wxLastTell = -999;
let _wxForced = false;                        // ?wx= dev path active (short warn, skip grace)

const WX_GLYPH = { dust: '≋', storm: '⚡', heat: '☀' };
const WX_NAME = { dust: 'GREY WIND', storm: 'LONG RAIN', heat: 'WHITE HOUR' };
const _wxHudEl = document.getElementById('wx');
const _wxHeatLabelEl = document.getElementById('heatlabel');

function _wxBusy() {
  return (typeof trial !== 'undefined' && trial) ||
         (typeof storyCarrying !== 'undefined' && storyCarrying);
}
function _wxSchedule(nowDayT) {
  // heat only rolls when the day is young (it must run in daylight and end at dusk).
  const morning = nowDayT < 0.30;
  const kinds = morning ? ['dust', 'storm', 'heat'] : ['dust', 'storm'];
  const kind = kinds[(Math.random() * kinds.length) | 0];
  // heat begins almost at once; the two street events pick a random hour later that day.
  const startAt = kind === 'heat' ? nowDayT + 0.01 : nowDayT + 0.05 + Math.random() * 0.30;
  _wxPending = { kind, startAt };
}
function _wxBeginWarn(kind) {
  WX.kind = kind; WX.phase = 'warn'; _wxPhaseT = 0; _wxFlood = 0;
  _wxWarnDur = _wxForced ? WX_WARN_FORCED : WX_WARN;
  _wxAudioEnsure();
  if (kind === 'dust')
    msg('The horizon goes the color of old paper. The Grey Wind is coming — get under a roof.', 9);
  else if (kind === 'storm')
    msg('Thunderheads pile over the canopy. The streets will drown in an hour — mind where you stand.', 9);
  else
    msg('The light goes white and flat. A killing heat rides the noon — dappled shade will not hold today. Find deep shadow, water, or the underground.', 10);
}
function _wxBeginActive() {
  WX.phase = 'active'; _wxPhaseT = 0;
  if (WX.kind === 'dust') _wxActiveDur = 150 + Math.random() * 60;
  else if (WX.kind === 'storm') { _wxActiveDur = 180 + Math.random() * 80; _wxNextBolt = (performance.now() / 1000) + 6 + Math.random() * 8; }
  else _wxActiveDur = 240;   // heat is also hard-capped by dusk (dayT > 0.72) below
  console.log('WEATHER ' + WX.kind + ' active');
}
function _wxEndToClear() {
  WX.kind = null; WX.phase = 'clear'; _wxPhaseT = 0; _wxPending = null;
  _wxLastEventDawn = _wxDawn;                 // enforce >= one full clear in-game day
  _wxDust.mesh.visible = false; _wxRain.mesh.visible = false;
  _wxForced = false;
}

/* --------------------------------------------------------- the loop tick ---- */
function updateWeather(dt, time) {
  const dayNow = (typeof dayT !== 'undefined') ? dayT : 0;

  // --- dawn roll: fire once each time dayT crosses WX_DAWN going forward ---
  if (_wxLastDayT >= 0 && _wxLastDayT < WX_DAWN && dayNow >= WX_DAWN) {
    _wxDawn++;
    if (WX.phase === 'clear' && !_wxPending) {
      const graceOK = (time - _wxSession) > WX_GRACE;
      const cooldownOK = (_wxDawn - _wxLastEventDawn) >= 2;
      if (graceOK && cooldownOK && !_wxBusy() && Math.random() < WX_ROLL) _wxSchedule(dayNow);
    }
  }
  // a pending event that never got its hour (deferred all day) is dropped at the next dawn
  if (_wxPending && _wxLastDayT > dayNow && WX.phase === 'clear') _wxPending = null;
  _wxLastDayT = dayNow;

  // --- pending → warn (held while a trial or story-carry is live) ---
  if (_wxPending && WX.phase === 'clear' && dayNow >= _wxPending.startAt && !_wxBusy()) {
    if (_wxPending.kind === 'heat' && dayNow > 0.72) _wxPending = null;   // too late for a daylight event
    else { _wxBeginWarn(_wxPending.kind); _wxPending = null; }
  }

  // --- phase advance ---
  _wxPhaseT += dt;
  if (WX.phase === 'warn' && _wxPhaseT >= _wxWarnDur && !_wxBusy()) _wxBeginActive();
  else if (WX.phase === 'active') {
    const heatDusk = WX.kind === 'heat' && dayNow > 0.72;
    if (_wxPhaseT >= _wxActiveDur || heatDusk) { WX.phase = 'clearing'; _wxPhaseT = 0; }
  } else if (WX.phase === 'clearing' && _wxPhaseT >= WX_CLEAR) {
    if (WX.kind === 'storm') once('wx-rain-after', () => msg('The streets steam. Every leaf is dripping, and the whole forest smells green.', 8));
    _wxEndToClear();
  }

  // --- shelter (throttled ~5 Hz), only meaningful while an event runs ---
  _wxShelterT += dt;
  if (_wxShelterT > 0.2) { _wxSheltered = (WX.phase !== 'clear') ? _wxComputeShelter() : false; _wxShelterT = 0; }

  // --- envelope: smooth target-k per phase, then lerp (no pops) ---
  let targetK = 0;
  if (WX.phase === 'warn') targetK = 0.28 * clamp(_wxPhaseT / _wxWarnDur, 0, 1);
  else if (WX.phase === 'active') targetK = 1;
  else if (WX.phase === 'clearing') targetK = 1 - clamp(_wxPhaseT / WX_CLEAR, 0, 1);
  WX.k = lerp(WX.k, targetK, Math.min(1, dt * 1.6));
  const k = WX.k;

  // --- reset the mixer to neutral, then paint the active event on top ---
  WX.fogNearMul = 1; WX.fogFarMul = 1; WX.sunMul = 1; WX.heatMul = 1; WX.airAdd = 0;
  WX.shadeSafeE = 0.25; WX.windX = 0; WX.windZ = 0; WX.floodSlow = 1; WX.strain = 0;
  WX.flash = 0; WX.heatDrainMul = 1;

  const kind = WX.phase === 'clear' ? null : WX.kind;
  if (kind === 'dust') _wxDust_(dt, time, k);
  else if (kind === 'storm') _wxStorm_(dt, time, k, dayNow);
  else if (kind === 'heat') _wxHeat_(dt, time, k);

  // particles follow their event; hidden (and idle) otherwise
  _wxDust.mesh.visible = kind === 'dust' && k > 0.01;
  _wxRain.mesh.visible = kind === 'storm' && k > 0.01;
  if (_wxDust.mesh.visible) _wxStepDust(dt, time, k);
  if (_wxRain.mesh.visible) _wxStepRain(dt, time, k);

  // ground: the Long Rain darkens the street to a wet blue-gloss; every other frame it's
  // driven back to white, so a single global mesh restores itself with no bookkeeping.
  if (typeof ground !== 'undefined' && ground.material) {
    const gt = kind === 'storm' ? k : 0;
    ground.material.color.setRGB(lerp(1, 0.34, gt), lerp(1, 0.40, gt), lerp(1, 0.52, gt));
  }

  // weather-audio bed levels (AC-gated; no-op before the first click / in SHOT)
  if (typeof AC !== 'undefined' && AC && !muted && _wxRainGain) {
    _wxRainGain.gain.setTargetAtTime(kind === 'storm' ? 0.13 * k : 0, AC.currentTime, 0.4);
    _wxWindGain.gain.setTargetAtTime(kind === 'dust' ? 0.11 * k : 0, AC.currentTime, 0.5);
  }

  // --- HUD: event glyph + name beside the clock; heat-bar label swaps to STRAIN ---
  if (_wxHudEl) {
    if (WX.phase === 'clear') { _wxHudEl.textContent = ''; }
    else {
      _wxHudEl.textContent = WX_GLYPH[WX.kind] + ' ' + WX_NAME[WX.kind];
      _wxHudEl.style.opacity = WX.phase === 'warn' ? 0.5 : 1;
    }
  }
  if (_wxHeatLabelEl)
    _wxHeatLabelEl.textContent = (kind === 'dust' && (WX.phase === 'active' || WX.phase === 'clearing')) ? 'STRAIN' : 'BODY HEAT';
}

/* ---- Event 1 — the Grey Wind (dust-fog storm; hide in shelter) ------------- */
function _wxDust_(dt, time, k) {
  WX.fogNearMul = lerp(1, 0.12, k);
  WX.fogFarMul = lerp(1, 0.10, k);
  WX.sunMul = lerp(1, 0.35, k);
  // a slowly rotating gust that wanders ±, magnitude ~2.2 m/s, hard-capped at 2.5 (< WALK)
  _wxWindAng += (0.12 + Math.sin(time * 0.11) * 0.25) * dt;
  const mag = 2.2 * k;
  let wx = Math.cos(_wxWindAng) * mag, wz = Math.sin(_wxWindAng) * mag;
  const wl = Math.hypot(wx, wz); if (wl > 2.5) { wx *= 2.5 / wl; wz *= 2.5 / wl; }
  WX.windX = wx; WX.windZ = wz;
  // strain only while active and out in the open; sheltered → 0 (heat then drains normally)
  WX.strain = (WX.phase === 'active' && !_wxSheltered) ? 3.2 * smooth(0.15, 0.6, k) : 0;
  if (WX.phase === 'active' && _wxSheltered)
    once('wx-dust', () => msg('Outside, the wind is a wall of grit. In here, it is only a sound.', 7));
  _wxTint(WX_BROWN, 0.72 * k, 0.42 * k);
}

/* ---- Event 2 — the Long Rain (thunderstorm; flood, gusts, lightning) ------- */
function _wxStorm_(dt, time, k, dayNow) {
  WX.fogFarMul = lerp(1, 0.45, k);
  WX.fogNearMul = lerp(1, 0.70, k);
  WX.sunMul = lerp(1, WX.phase === 'warn' ? 0.55 : 0.30, k);
  // flood rises over the first 60 s of the storm and drains over the 30 s clearing; the
  // slow floor is 0.65 so the player can always make headway (never a walk-speed lock).
  if (WX.phase === 'active') _wxFlood = Math.min(1, _wxFlood + dt / 60);
  else _wxFlood = Math.max(0, _wxFlood - dt / 30);
  WX.floodSlow = lerp(1, 0.65, _wxFlood);
  // rain cools: out in it, no heat gain and shade-drain runs 1.5×; under cover, normal.
  if (WX.phase === 'active' || WX.phase === 'clearing') {
    WX.heatMul = _wxSheltered ? 1 : 0;
    WX.heatDrainMul = _wxSheltered ? 1 : 1.5;
  }
  // intermittent gusts, up to 3 m/s and ×1.6 above the canopy line; capped as in the dust.
  const above = (typeof CANOPY_Y !== 'undefined') && player.pos.y > CANOPY_Y;
  _wxWindAng += dt * 0.2;
  const pulse = Math.max(0, Math.sin(time * 0.7)) * Math.max(0, Math.sin(time * 2.3 + 1.1));
  let gmag = pulse * 3.0 * k * (above ? 1.6 : 1);
  const gang = _wxWindAng + Math.sin(time * 0.3) * 0.6;
  let gx = Math.cos(gang) * gmag, gz = Math.sin(gang) * gmag;
  const cap = above ? 3.0 : 2.5, gl = Math.hypot(gx, gz);
  if (gl > cap) { gx *= cap / gl; gz *= cap / gl; }
  WX.windX = gx; WX.windZ = gz;

  // --- lightning: a flash every 8–20 s, thunder delayed by distance, strike hazard aloft ---
  if (WX.phase === 'active' && time > _wxNextBolt) {
    _wxNextBolt = time + 8 + Math.random() * 12;
    _wxFlashUntil = time + 0.12;
    const dist = 0.3 + Math.random() * 2.2;                 // seconds of delay ≈ distance
    _wxThunder(dist, 0.16 + Math.random() * 0.12);
    // strike-tell: silhouetted above the canopy and exposed → a 4 s warning, then blackout
    const aloft = (typeof CANOPY_Y !== 'undefined') && player.pos.y > CANOPY_Y + 3;
    if (aloft && !_wxSheltered && _wxStrikeTell <= 0 && (time - _wxLastTell) > 25) {
      _wxStrikeTell = 4; _wxLastTell = time;
      hint('Your hair lifts. The sky is looking at you.', 3);
      _wxCrackle();
    }
  }
  WX.flash = (time < _wxFlashUntil) ? 3.4 * Math.max(0.3, k) : 0;
  if (_wxStrikeTell > 0) {
    _wxStrikeTell -= dt;
    const aloft = (typeof CANOPY_Y !== 'undefined') && player.pos.y > CANOPY_Y + 3;
    if (!aloft || _wxSheltered) _wxStrikeTell = 0;          // descended ~3 m or got under cover → safe
    else if (_wxStrikeTell <= 0) {
      _wxStrikeTell = 0;
      if (typeof blackout === 'function') blackout('The sky found you.');
    }
  }
  _wxTint(WX_STORMSKY, 0.55 * k, 0.30 * k);
}

/* ---- Event 3 — the White Hour (extreme heat wave; deep shade only) --------- */
function _wxHeat_(dt, time, k) {
  WX.heatMul = lerp(1, 2.1, k);            // dappled light now burns at a real rate
  WX.shadeSafeE = lerp(0.25, 0.12, k);     // only deep shade still counts as safe
  WX.airAdd = 9 * k;
  WX.sunMul = lerp(1, 1.22, k);            // the sun goes white: sun + hemi brighten, flat glare
  if (player.heat > 60)
    once('wx-heat', () => msg('This is the heat the world died of. Respect it.', 7));
  _wxTint(WX_WHITE, 0.32 * k, 0.5 * k);
}

// Re-tint fog (+ clear colour) and hemi after updateSky has set them this frame. updateSky
// rewrites both every frame, so there is never anything to restore.
function _wxTint(col, fogAmt, hemiAmt) {
  if (fogAmt > 0 && scene.fog) {
    scene.fog.color.lerp(col, clamp(fogAmt, 0, 1));
    renderer.setClearColor(scene.fog.color);
  }
  if (hemiAmt > 0 && typeof hemi !== 'undefined') hemi.color.lerp(col, clamp(hemiAmt, 0, 1));
}

/* ------------------------------------------------- scripted trigger ---------
   wxScripted(kind) — a story beat (the Verge Engine's cloud-seed) asks for a named event.
   Reuses the forced dev path (short warn, grace skipped). Declines cleanly — no side effects,
   returns false — when a system event is already running (WX.phase !== 'clear') or in SHOT, so
   the caller can fall back to a purely local effect. Console-logs like the ?wx= hook. */
function wxScripted(kind) {
  if (typeof SHOT !== 'undefined' && SHOT) return false;
  if (kind !== 'dust' && kind !== 'storm' && kind !== 'heat') return false;
  if (WX.phase !== 'clear') return false;                 // already busy — let the caller fall back
  _wxForced = true;                                        // short warn; _wxEndToClear clears this flag
  _wxPending = null;
  _wxBeginWarn(kind);
  console.log('WEATHER ' + kind + ' scripted');
  return true;
}

/* --------------------------------------------------------- dev hook ---------
   ?wx=dust|storm|heat forces the named event: skip the grace period and drop straight into
   a short warn so the frame changes fast for a headless verifier. Never in SHOT mode. */
(function () {
  if (typeof SHOT !== 'undefined' && SHOT) return;
  const w = params.get('wx');
  if (w === 'dust' || w === 'storm' || w === 'heat') {
    _wxForced = true;
    _wxSession -= (WX_GRACE + 10);              // grace already satisfied
    _wxPending = { kind: w, startAt: -1 };       // begins warn on the first tick
    _wxLastDayT = (typeof dayT !== 'undefined') ? dayT : 0.3;
    console.log('WEATHER ' + w + ' scheduled');
  }
})();
