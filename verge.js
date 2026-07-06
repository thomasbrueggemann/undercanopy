/* CANOPY split file  verge: "The Verge Engine" — a five-site escape-room expedition to the
   scorch boundary. Five contraption sites (pump valves, cross-rigged bell-ropes, interlocked
   signal levers, balance-scale weights, steam timing) each yield a machine movement; the five
   pieces assemble into the Verge Engine at the forest's edge and, in the right startup order,
   wake it — a scripted Long Rain over the burnt ground, and a lit beacon at the edge of the
   world. Mirrors puzzles.js end to end (STATE → PURE LOGIC → FINDERS → LOCATE → ITEMS → NPC →
   PROPS → INTERACT → PER-FRAME), and inherits its disciplines:
     · NO worldgen changes — sites are runtime prop pools anchored by pure-hash finders to
       existing chunk content (the Ciphers precedent). buildChunk / colData / rng streams are
       untouched, so the world is bit-identical and the smoke test can't regress.
     · Determinism — every puzzle's content derives from hash2/mulberry32 on world-stable seeds
       (site chunk coords + salts), never Math.random; a returning player faces the same puzzle
       with the same answer.
     · SHOT mode fully inert — no pools drawn, no audio, no HUD/minimap writes, no weather
       trigger, no interactions (all gated !SHOT).
   Loaded AFTER puzzles.js (needs invRegister/aimPick/sfxNote idioms at runtime) and BEFORE
   weather.js (the finale calls wxScripted via typeof-guard — it's an event handler, not
   load-time). Every cross-file symbol is touched only at runtime, typeof-guarded per the
   split-file contract. Persistence: localStorage['canopy.verge'] (v1); this file owns all writes. */
'use strict';

/* ======================================================================== */
/*  STATE + PERSISTENCE (canopy.verge v1)                                    */
/*  Solved flags / pieces held+seated / pilot / attempts / gateDone persist.  */
/*  Site POSITIONS and all puzzle content recompute every session from world- */
/*  stable hashes (identical puzzles + identical answers each session); solved */
/*  husks may relocate when chunk residency differs — the sanctioned Ciphers   */
/*  tradeoff (design D8).                                                       */
/* ======================================================================== */
let VERGE_SAVE = {
  v: 1, started: false, met: false,
  sitesSolved: { pump: false, belfry: false, signal: false, yard: false, kiln: false },
  pieces: { held: [], seated: [] },     // held = collected + unseated (piece kinds); seated = at the Gate
  pilotLit: false,                      // the one cross-reload mid-state D8 names explicitly
  // Light per-site progress persisted so a returning player doesn't redo the fetch legs (the
  // "leads are patient" scenario): the seated flywheel and the wiped signal plates. The puzzle
  // WORKING (valve positions, needle, lever throws) stays in-memory and resets on reload —
  // sanctioned, the answer is unchanged (design D8, extended for the errands scenario).
  pumpSeated: false, signalWiped: [false, false, false, false, false],
  attempts: { pump: 0, belfry: 0, signal: 0, yard: 0, kiln: 0, gate: 0 },
  gateDone: false, whistle: false, leadIntro: false, gateRevealed: false
};
try {
  const _vs = JSON.parse(localStorage.getItem('canopy.verge') || 'null');
  if (_vs && _vs.v === 1) VERGE_SAVE = Object.assign(VERGE_SAVE, _vs);
} catch (e) { }
VERGE_SAVE.sitesSolved = VERGE_SAVE.sitesSolved || { pump: false, belfry: false, signal: false, yard: false, kiln: false };
VERGE_SAVE.pieces = VERGE_SAVE.pieces || { held: [], seated: [] };
VERGE_SAVE.pieces.held = VERGE_SAVE.pieces.held || [];
VERGE_SAVE.pieces.seated = VERGE_SAVE.pieces.seated || [];
VERGE_SAVE.attempts = VERGE_SAVE.attempts || { pump: 0, belfry: 0, signal: 0, yard: 0, kiln: 0, gate: 0 };
VERGE_SAVE.signalWiped = VERGE_SAVE.signalWiped || [false, false, false, false, false];
function vergeSave() { try { localStorage.setItem('canopy.verge', JSON.stringify(VERGE_SAVE)); } catch (e) { } }

// Session-live state. `loc` holds this session's finder-computed positions + puzzle truths
// (null until vergeLocate runs). Per-site runtime substate lives under the site keys.
const verge = {
  located: false, loc: null, _ePrev: false,
  transientCarry: null,                 // 'casting' | 'taper' while a verge interaction holds one
  pump: { seated: VERGE_SAVE.pumpSeated, holdingFly: false, valves: [false, false, false, false], solvedPuzzle: false, crankTgt: false, crankT: 0, faultLeg: -1, faultT: -9 },
  belfry: { h: [0, 0, 0], holdRope: -1, holdT: 0, atT: 0, solvedPuzzle: false, cageT: 0, dropAnim: [0, 0, 0], sawMarks: false },
  signal: { lev: [0, 0, 0, 0, 0], holdLever: -1, holdT: 0, wiped: VERGE_SAVE.signalWiped.slice(), solvedPuzzle: false, trolley: 0, thunkT: -9, thunkLever: -1 },
  yard: { placed: [-1, -1], hooks: [-1, -1, -1, -1], carrying: -1, tilt: 0, held3: 0, solvedPuzzle: false, crate: 0, slamT: -9, lastSig: '', slamLatch: false },
  kiln: { taperFrac: 0, taperLit: false, pilot: VERGE_SAVE.pilotLit, stoke: 0, needle: 0, vents: 0, solvedPuzzle: false, blownT: -9, chuffT: -9, msgDay: false, shriekT: -9 },
  gate: { seatedAt: [-1, -1, -1, -1, -1], handlePulls: [], spin: 0, startT: 0, started: false }
};
var vergeGate = null;                    // the Edgewright NPC {g, anim}, once spawned (read by drawMinimap)

/* ======================================================================== */
/*  PURE LOGIC — transcribed verbatim from the tested scratch harness         */
/*  (verge-harness.js, proven ALL-GREEN across 5000 seeds: pump exactly-1-of- */
/*  16 floods, belfry reachable ≤12 pulls & naive-order fails, signal-box      */
/*  interlock reachable + ≥2 naive orders blocked + no deadlock, yard exactly- */
/*  1-of-24 balance, kiln band window ≥450 ms). Depends only on hash2/         */
/*  mulberry32 — deterministic, world-stable, so runtime never needs the       */
/*  harness. Names carry a `vg` prefix so no global collides across the split.  */
/* ======================================================================== */

/* ---- 1. Pump manifold: wheel→leg permutation; exactly 1 of 16 states floods ---- */
function vgGenPump(seed) {
  let attempt = 0;
  const s = (seed + attempt * 0x9E3779B1) >>> 0;
  const rng = mulberry32(s);
  const perm = [0, 1, 2, 3];            // perm[wheel] = leg (0=chamber 1=bypass 2=burst 3=drain)
  for (let i = 3; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const band = [0, 1, 2, 3];            // pipe colour-band tint per wheel (the clue surface)
  for (let i = 3; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = band[i]; band[i] = band[j]; band[j] = t; }
  return { perm, band, attempt };
}
function vgPumpSolution(def) { const open = [false, false, false, false]; for (let w = 0; w < 4; w++) open[w] = (def.perm[w] === 0 || def.perm[w] === 1); return open; }
function vgPumpFloods(def, open) { const leg = { 0: false, 1: false, 2: false, 3: false }; for (let w = 0; w < 4; w++) leg[def.perm[w]] = open[w]; return leg[0] && leg[1] && !leg[2] && !leg[3]; }
// The offending open leg for a wrong state (for the localized hiss/dust): first open leg that
// should be shut, else first shut leg that should be open (0=chamber 1=bypass 2=burst 3=drain).
function vgPumpFault(def, open) {
  const leg = { 0: false, 1: false, 2: false, 3: false };
  for (let w = 0; w < 4; w++) leg[def.perm[w]] = open[w];
  if (leg[2]) return { wheel: def.perm.indexOf(2), leg: 2 };   // burst wrongly open
  if (leg[3]) return { wheel: def.perm.indexOf(3), leg: 3 };   // drain wrongly open
  if (!leg[0]) return { wheel: def.perm.indexOf(0), leg: 0 };  // chamber wrongly shut
  if (!leg[1]) return { wheel: def.perm.indexOf(1), leg: 1 };  // bypass wrongly shut
  return { wheel: 0, leg: 0 };
}

/* ---- 2. Belfry: 3 notch heights (0..4), 2 directed cross-pairs; target reachable ≤12 ---- */
function vgBelfryApplyPull(h, i, cross) { const n = h.slice(); n[i] = Math.min(4, n[i] + 1); for (const p of cross) if (p[0] === i) n[p[1]] = Math.max(0, n[p[1]] - 1); return n; }
function vgBelfryKey(h) { return h[0] * 25 + h[1] * 5 + h[2]; }
function vgBelfryBFS(cross) {
  const depth = new Int16Array(125).fill(-1); depth[0] = 0; const q = [[0, 0, 0]]; let head = 0;
  while (head < q.length) { const h = q[head++]; const d = depth[vgBelfryKey(h)]; for (let i = 0; i < 3; i++) { const n = vgBelfryApplyPull(h, i, cross); const k = vgBelfryKey(n); if (depth[k] < 0) { depth[k] = d + 1; q.push(n); } } }
  return depth;
}
function vgBelfryNaiveReaches(target, cross) { let h = [0, 0, 0]; for (let i = 0; i < 3; i++) for (let k = 0; k < target[i]; k++) h = vgBelfryApplyPull(h, i, cross); return h[0] === target[0] && h[1] === target[1] && h[2] === target[2]; }
function vgGenBelfry(seed) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const s = (seed + attempt * 0x9E3779B1) >>> 0; const rng = mulberry32(s);
    const pairs = []; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) pairs.push([a, b]);
    for (let i = pairs.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = pairs[i]; pairs[i] = pairs[j]; pairs[j] = t; }
    const cross = [pairs[0]]; let second = null;
    for (let k = 1; k < pairs.length; k++) { const p = pairs[k]; if (p[0] === cross[0][0] && p[1] === cross[0][1]) continue; if (p[0] === cross[0][1] && p[1] === cross[0][0]) continue; second = p; break; }
    if (!second) continue; cross.push(second);
    const depth = vgBelfryBFS(cross); const cands = [];
    for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) for (let c = 1; c <= 4; c++) { const t = [a, b, c]; const d = depth[vgBelfryKey(t)]; if (d < 3 || d > 12) continue; if (vgBelfryNaiveReaches(t, cross)) continue; cands.push({ t, d }); }
    if (!cands.length) continue;
    cands.sort((x, y) => (y.d - x.d) || (hash2(x.t[0], x.t[1] * 5 + x.t[2], s) - hash2(y.t[0], y.t[1] * 5 + y.t[2], s)));
    const pick = cands[hash2(cands.length, 0, s) % Math.min(4, cands.length)] || cands[0];
    return { cross, target: pick.t, minPulls: pick.d, attempt };
  }
  return { cross: [[0, 1], [1, 2]], target: [2, 2, 1], minPulls: 5, attempt: 64 };
}

/* ---- 3. Signal box: 5 levers, 4 interlock rules; target reachable, ≥2 naive orders blocked ---- */
function vgLeverMovable(state, i, rules) { for (const r of rules) { if (r.i !== i) continue; if (r.form === 'A' && state[r.j] !== 1) return false; if (r.form === 'B' && state[r.j] === 1) return false; } return true; }
function vgSignalKey(state) { return state[0] | (state[1] << 1) | (state[2] << 2) | (state[3] << 3) | (state[4] << 4); }
function vgSignalBFS(rules) {
  const depth = new Int16Array(32).fill(-1); depth[0] = 0; const q = [[0, 0, 0, 0, 0]]; let head = 0;
  while (head < q.length) { const st = q[head++]; const d = depth[vgSignalKey(st)]; for (let i = 0; i < 5; i++) { if (!vgLeverMovable(st, i, rules)) continue; const n = st.slice(); n[i] = n[i] ? 0 : 1; const k = vgSignalKey(n); if (depth[k] < 0) { depth[k] = d + 1; q.push(n); } } }
  return depth;
}
let _VG_PERMS5 = null;
function vgPermutations5() { if (_VG_PERMS5) return _VG_PERMS5; const out = [], a = [0, 1, 2, 3, 4]; const rec = (k) => { if (k === 5) { out.push(a.slice()); return; } for (let i = k; i < 5; i++) { const s = a[k]; a[k] = a[i]; a[i] = s; rec(k + 1); const s2 = a[k]; a[k] = a[i]; a[i] = s2; } }; rec(0); _VG_PERMS5 = out; return out; }
function vgSignalNaiveBlockedCount(rules) { const perms = vgPermutations5(); let blocked = 0; for (const perm of perms) { let st = [0, 0, 0, 0, 0], ok = true; for (const i of perm) { if (!vgLeverMovable(st, i, rules)) { ok = false; break; } st[i] = st[i] ? 0 : 1; } if (!ok) blocked++; } return blocked; }
function vgGenSignal(seed) {
  for (let attempt = 0; attempt < 128; attempt++) {
    const s = (seed + attempt * 0x9E3779B1) >>> 0; const rng = mulberry32(s);
    const rules = []; const used = {}; let guard = 0;
    while (rules.length < 4 && guard++ < 200) { const i = (rng() * 5) | 0; let j = (rng() * 5) | 0; if (i === j) continue; const form = rng() < 0.5 ? 'A' : 'B'; const key = i + ',' + j; if (used[key]) continue; used[key] = true; rules.push({ i, j, form }); }
    if (rules.length < 4) continue;
    let anyMove = false; for (let i = 0; i < 5; i++) if (vgLeverMovable([0, 0, 0, 0, 0], i, rules)) { anyMove = true; break; }
    if (!anyMove) continue;
    const depth = vgSignalBFS(rules); const blocked = vgSignalNaiveBlockedCount(rules); if (blocked < 2) continue;
    const cands = [];
    for (let m = 1; m < 32; m++) { const d = depth[m]; if (d < 2 || d > 12) continue; const bits = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1) + ((m >> 4) & 1); if (bits < 2 || bits > 4) continue; cands.push({ m, d, bits, forced: d > bits }); }
    if (!cands.length) continue;
    cands.sort((x, y) => (Number(y.forced) - Number(x.forced)) || (y.d - x.d) || (x.m - y.m));
    const target = cands[0];
    return { rules, target: target.m, minThrows: target.d, standing: target.bits, forced: target.forced, attempt };
  }
  return { rules: [{ i: 0, j: 1, form: 'A' }, { i: 2, j: 0, form: 'B' }, { i: 3, j: 1, form: 'A' }, { i: 4, j: 2, form: 'B' }], target: 0b01001, minThrows: 4, standing: 2, forced: true, attempt: 128 };
}

/* ---- 4. Yard: masses = perm of {2,3,5,7}; crate M at arm L; exactly 1 of 24 balances ---- */
const VG_YARD_PERMS4 = (function () { const out = [], a = [0, 1, 2, 3]; const rec = (k) => { if (k === 4) { out.push(a.slice()); return; } for (let i = k; i < 4; i++) { const s = a[k]; a[k] = a[i]; a[i] = s; rec(k + 1); const s2 = a[k]; a[k] = a[i]; a[i] = s2; } }; rec(0); return out; })();
function vgGenYard(seed) {
  const MASSES = [2, 3, 5, 7];
  for (let attempt = 0; attempt < 64; attempt++) {
    const s = (seed + attempt * 0x9E3779B1) >>> 0; const rng = mulberry32(s);
    const mass = MASSES.slice(); for (let i = 3; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = mass[i]; mass[i] = mass[j]; mass[j] = t; }
    const sums = VG_YARD_PERMS4.map(p => { let t = 0; for (let c = 0; c < 4; c++) t += mass[c] * (p[c] + 1); return t; });
    const counts = {}; for (const t of sums) counts[t] = (counts[t] || 0) + 1;
    const uniques = []; for (const t in counts) if (counts[t] === 1) uniques.push(+t);
    if (!uniques.length) continue; uniques.sort((x, y) => x - y);
    const T = uniques[hash2(uniques.length, s & 0xffff, 771) % uniques.length];
    let L = 1, M = T; const Ls = [4, 3, 2].filter(l => T % l === 0 && (T / l) >= 5 && (T / l) <= 40);
    if (Ls.length) { L = Ls[hash2(Ls.length, T, 772) % Ls.length]; M = T / L; }
    let balanced = 0, solIdx = -1; for (let a = 0; a < sums.length; a++) if (sums[a] === M * L) { balanced++; solIdx = a; }
    if (balanced !== 1) continue;
    return { mass, M, L, torque: T, solution: VG_YARD_PERMS4[solIdx], attempt };   // solution[casting]=armIndex 0..3
  }
  return { mass: [7, 5, 3, 2], M: 34, L: 1, torque: 34, solution: VG_YARD_PERMS4[0], attempt: 64 };
}

/* ---- 5. Kiln: needle sweeps 0→1, 3 position-segment speeds; band window ≥450 ms ---- */
function vgGenKiln(seed) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const s = (seed + attempt * 0x9E3779B1) >>> 0; const rng = mulberry32(s);
    const b1 = 0.30 + rng() * 0.10, b2 = 0.60 + rng() * 0.10;
    const W = 0.15 + rng() * 0.04; const slotLo = b1 + 0.01, slotHi = b2 - 0.01 - W; if (slotHi <= slotLo) continue;
    const lo = slotLo + rng() * (slotHi - slotLo), hi = lo + W;
    const slow = 0.20 + rng() * 0.10, fast0 = 0.55 + rng() * 0.45, fast2 = 0.55 + rng() * 0.45;
    const speeds = [fast0, slow, fast2], bounds = [b1, b2], window = W / slow;
    if (window < 0.45) continue;
    const cyc = b1 / speeds[0] + (b2 - b1) / speeds[1] + (1 - b2) / speeds[2];
    return { bounds, speeds, bandLo: lo, bandHi: hi, redLo: hi, window, cycle: cyc, attempt };
  }
  return { bounds: [0.35, 0.65], speeds: [0.8, 0.25, 0.8], bandLo: 0.44, bandHi: 0.60, redLo: 0.60, window: 0.64, cycle: 2, attempt: 64 };
}

/* ---- Mark language + Gate startup order (independent of the Ciphers' cipher, own salts) ---- */
const VERGE_MARKS = ['✷', '❖', '⬢', '⬡', '◉'];      // 5 foundry maker's-marks, distinct from CIPH_GLYPHS
const VG_HANDLES = ['PRIME', 'SPIN', 'SEED'];
const VG_HANDLE_LINE = { PRIME: 'PRIME wakes the fire', SPIN: 'SPIN calls the wind', SEED: 'SEED sows the cloud' };
// The Gate's marks + startup order from a gate-position seed. pieceMark[pieceIndex] and the
// pedestal collar arrangement are per-seed permutations; the 3 handles carry 3 of the 5 marks;
// the lintel shows those 3 marks in the (per-seed) pull order.
function vgGenGate(seed) {
  const rng = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const marks = [0, 1, 2, 3, 4];        // piece i → mark index marks[i]
  for (let i = 4; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = marks[i]; marks[i] = marks[j]; marks[j] = t; }
  const pedestal = [0, 1, 2, 3, 4];     // pedestal k → mark index (which piece seats there)
  for (let i = 4; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = pedestal[i]; pedestal[i] = pedestal[j]; pedestal[j] = t; }
  // handles PRIME/SPIN/SEED carry marks marks[0..2] (three of the five piece marks); pull order
  // is a permutation of the 3 handles.
  const handleMark = [marks[0], marks[1], marks[2]];
  const order = [0, 1, 2];
  for (let i = 2; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
  return { marks, pedestal, handleMark, order };
}

/* ======================================================================== */
/*  SITE METADATA                                                             */
/* ======================================================================== */
const VERGE_SITES = ['pump', 'belfry', 'signal', 'yard', 'kiln'];
const SITE_NAME = { pump: 'the Pump House', belfry: 'the Bell-Crank Belfry', signal: 'the Signal Box', yard: 'the Counterweight Yard', kiln: 'the Night Kiln', gate: 'the Verge Gate' };
const SITE_PIECE = { pump: 'governor', belfry: 'windrose', signal: 'escapement', yard: 'coil', kiln: 'censer' };
const PIECE_ITEM = { governor: 'pc_governor', windrose: 'pc_windrose', escapement: 'pc_escapement', coil: 'pc_coil', censer: 'pc_censer' };
const PIECE_OF_SITE_IDX = { pump: 0, belfry: 1, signal: 2, yard: 3, kiln: 4 };
const PIECE_NAME = { governor: 'the Governor', windrose: 'the Wind Rose', escapement: 'the Escapement', coil: 'the Condenser Coil', censer: 'the Cloud-Seed Censer' };
const PIECE_ICON = { governor: '⚙', windrose: '✳', escapement: '⧗', coil: '❍', censer: '♁' };
const SITE_RUMOR = {
  pump: '“My uncle kept the reservoir pumps — the shed still has its brass, if you can make the water mind you. Find the flywheel first; it walked off years ago.”',
  belfry: '“There’s a belfry gone quiet in the old grove. The bells still hang, but two of the ropes were crossed by some fool — pull them wrong and the weights just fight you.”',
  signal: '“Down by the viaduct there’s a signal box, levers and all. They lock each other, railway-fashion. Wipe the plates and read what frees what — and find both halves of the torn timetable.”',
  yard: '“The old works yard has a crane and four blind castings, no two the same weight. There’s an assay scale to weigh them against each other. Balance the beam and the crate gives up what’s under it.”',
  kiln: '“The night kiln only wakes after dark — cold as stone by day. Borrow a flame, stoke it, and time the steam to the gauge. Miss the band and she blows out. Learn her rhythm.”'
};
const VG_COLD = ' (The trail is cold — I marked the nearest square instead.)';

/* ======================================================================== */
/*  FINDERS (pure-hash ring scans; run ONLY at session-init via vergeLocate)  */
/*  Each degrades primary → widened ring → plaza-near-SPIRE fallback with a    */
/*  "trail is cold" line, so no site can soft-lock (design D2). Origins are     */
/*  SPIRE-relative so positions don't depend on where the player stands.        */
/* ======================================================================== */
function vgRing(cx, cz, minR, maxR, pred) {
  for (let r = (minR || 0); r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ix = cx + dx, iz = cz + dz; if (!pred(ix, iz)) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = { ix, iz }; }
    }
    if (best) return best;
  }
  return null;
}
function vgCtr(c) { return { ix: c.ix, iz: c.iz, x: c.ix * CHUNK + 32, z: c.iz * CHUNK + 32 }; }
function vgPlazaNearSpire() { const p = vgRing(SPIRE.cx, SPIRE.cz, 0, 24, (ix, iz) => chunkType(ix, iz) === 'plaza') || { ix: SPIRE.cx + 2, iz: SPIRE.cz }; return vgCtr(p); }
function vgChimeChunk(ix, iz) { const t = chunkType(ix, iz); return (t === 'grove' || t === 'park') && (hash2(ix, iz, 3444) % 100 < 10); }
// Nearest viaduct line to SPIRE (own copy — never shadows puzzles.js's viaductNear).
function vgViaductNear(cx, cz, maxR) {
  let best = null, bd = 1e9;
  for (let d = 0; d <= maxR; d++) {
    for (const ix of [cx - d, cx + d]) if (hash2(ix, 0, 6001) % 7 === 0) { const dd = Math.abs(ix - cx); if (dd < bd) { bd = dd; best = { axis: 0, lineIdx: ix, cross: ix * CHUNK }; } }
    for (const iz of [cz - d, cz + d]) if (hash2(0, iz, 6002) % 7 === 0) { const dd = Math.abs(iz - cz); if (dd < bd) { bd = dd; best = { axis: 1, lineIdx: iz, cross: iz * CHUNK }; } }
  }
  return best;
}
function vgViaductSpanExists(lineIdx, g) { return (hash2(lineIdx, g, 6003) % 100) < 75; }   // mirrors buildViaductAxis
// Anchor at the base of a standing span of the nearest viaduct, nearest SPIRE along the line.
function vgViaductAnchor() {
  const v = vgViaductNear(SPIRE.cx, SPIRE.cz, 22);
  if (!v) { const d = vgPlazaNearSpire(); return { x: d.x, z: d.z, ix: d.ix, iz: d.iz, cold: true }; }
  const alongC = v.axis === 0 ? SPIRE.cz : SPIRE.cx;
  for (let d = 0; d <= 8; d++) for (const g of (d === 0 ? [alongC * 4 + 1] : [alongC * 4 + 1 - d, alongC * 4 + 1 + d])) {
    if (vgViaductSpanExists(v.lineIdx, g)) {
      const along = (g / 4) * CHUNK + 32;
      const x = v.axis === 0 ? v.cross : along, z = v.axis === 0 ? along : v.cross;
      return { x, z, ix: Math.floor(x / CHUNK), iz: Math.floor(z / CHUNK), axis: v.axis, cold: false };
    }
  }
  const along = alongC * CHUNK + 32;
  const x = v.axis === 0 ? v.cross : along, z = v.axis === 0 ? along : v.cross;
  return { x, z, ix: Math.floor(x / CHUNK), iz: Math.floor(z / CHUNK), axis: v.axis, cold: false };
}
// Scorch-boundary walk: from the nearest scorch region seed, hill-descend verdancy to the
// scorch heart, then step back toward the canopy until the biome flips; anchor last canopy-side.
function vgScorchBoundary() {
  let seed = null;
  for (let r = 0; r <= 24 && !seed; r++) for (let dx = -r; dx <= r && !seed; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    if (regionBiome(SPIRE.cx + dx, SPIRE.cz + dz) === 'scorch') { seed = { ix: SPIRE.cx + dx, iz: SPIRE.cz + dz }; break; }
  }
  if (!seed) { const d = vgPlazaNearSpire(); return { x: d.x, z: d.z, ix: d.ix, iz: d.iz, cold: true }; }
  // walk from SPIRE toward the scorch seed one chunk at a time; the last canopy-side chunk before
  // the flip is the Gate (faces the open scorch — the literal forest edge).
  let px = SPIRE.cx, pz = SPIRE.cz, lastCanopy = { ix: SPIRE.cx, iz: SPIRE.cz };
  for (let step = 0; step < 40; step++) {
    const dx = Math.sign(seed.ix - px), dz = Math.sign(seed.iz - pz);
    if (dx === 0 && dz === 0) break;
    const nx = px + dx, nz = pz + dz;
    if (regionBiome(nx, nz) === 'scorch') { const c = { ix: lastCanopy.ix, iz: lastCanopy.iz }; return { x: c.ix * CHUNK + 32, z: c.iz * CHUNK + 32, ix: c.ix, iz: c.iz, seedx: seed.ix, seedz: seed.iz, cold: false }; }
    lastCanopy = { ix: nx, iz: nz }; px = nx; pz = nz;
  }
  return { x: lastCanopy.ix * CHUNK + 32, z: lastCanopy.iz * CHUNK + 32, ix: lastCanopy.ix, iz: lastCanopy.iz, seedx: seed.ix, seedz: seed.iz, cold: false };
}

/* ======================================================================== */
/*  LOCATE — run every finder ONCE per session; compute every site truth.     */
/*  After this, updateVerge only reads verge.loc; it never peeks a chunk.      */
/* ======================================================================== */
function vergeLocate() {
  if (verge.located) return;
  if (typeof SPIRE === 'undefined' || typeof chunkType !== 'function') return;
  verge.located = true;
  const L = verge.loc = {};

  // Pump House → nearest reservoir chunk
  { let c = vgRing(SPIRE.cx, SPIRE.cz, 0, 12, (ix, iz) => chunkType(ix, iz) === 'reservoir') || vgRing(SPIRE.cx, SPIRE.cz, 0, 28, (ix, iz) => chunkType(ix, iz) === 'reservoir');
    const cold = !c; const ctr = c ? vgCtr(c) : vgPlazaNearSpire();
    const seed = hash2(ctr.ix, ctr.iz, 5510);
    const def = vgGenPump(seed);
    // flywheel pickup at a deterministic offset in the same chunk
    const fx = ctr.x + (hash2(ctr.ix, ctr.iz, 5511) % 20 - 10), fz = ctr.z + (hash2(ctr.ix, ctr.iz, 5512) % 20 - 10);
    L.pump = { id: 'pump', x: ctr.x, z: ctr.z, ix: ctr.ix, iz: ctr.iz, cold, def, fly: { x: fx, z: fz } }; }

  // Belfry → nearest grove/park chunk with chimes
  { let c = vgRing(SPIRE.cx, SPIRE.cz, 0, 16, vgChimeChunk) || vgRing(SPIRE.cx, SPIRE.cz, 0, 26, (ix, iz) => { const t = chunkType(ix, iz); return t === 'grove' || t === 'park'; });
    const cold = !c; const ctr = c ? vgCtr(c) : vgPlazaNearSpire();
    const seed = hash2(ctr.ix, ctr.iz, 5520);
    L.belfry = Object.assign({ id: 'belfry', x: ctr.x, z: ctr.z, ix: ctr.ix, iz: ctr.iz, cold, def: vgGenBelfry(seed) }); }

  // Signal Box → standing span of the nearest viaduct
  { const a = vgViaductAnchor(); const seed = hash2(a.ix, a.iz, 5530);
    L.signal = { id: 'signal', x: a.x, z: a.z, ix: a.ix, iz: a.iz, axis: a.axis || 0, cold: !!a.cold, def: vgGenSignal(seed) }; }

  // Counterweight Yard → nearest works district cell (fallback sinkhole rim)
  { let c = vgRing(SPIRE.cx, SPIRE.cz, 1, 16, (ix, iz) => chunkType(ix, iz) === 'city' && districtStyle(ix, iz) === 'works');
    if (!c) c = vgRing(SPIRE.cx, SPIRE.cz, 1, 20, (ix, iz) => chunkType(ix, iz) === 'sinkhole');
    const cold = !c; const ctr = c ? vgCtr(c) : vgPlazaNearSpire();
    const seed = hash2(ctr.ix, ctr.iz, 5540);
    L.yard = { id: 'yard', x: ctr.x, z: ctr.z, ix: ctr.ix, iz: ctr.iz, cold, def: vgGenYard(seed) }; }

  // Night Kiln → nearest ashen-biome chunk centre
  { let c = vgRing(SPIRE.cx, SPIRE.cz, 0, 22, (ix, iz) => regionBiome(ix, iz) === 'ashen');
    const cold = !c; const ctr = c ? vgCtr(c) : vgPlazaNearSpire();
    const seed = hash2(ctr.ix, ctr.iz, 5550);
    L.kiln = { id: 'kiln', x: ctr.x, z: ctr.z, ix: ctr.ix, iz: ctr.iz, cold, def: vgGenKiln(seed) }; }

  // The Verge Gate → the scorch boundary
  { const a = vgScorchBoundary(); const seed = hash2(a.ix, a.iz, 5560);
    const gate = vgGenGate(seed);
    // face the open scorch (toward the scorch seed if known, else outward from SPIRE)
    const tox = (a.seedx !== undefined ? a.seedx * CHUNK + 32 : SPIRE.x), toz = (a.seedz !== undefined ? a.seedz * CHUNK + 32 : SPIRE.z);
    const face = Math.atan2(tox - a.x, toz - a.z);
    L.gate = { id: 'gate', x: a.x, z: a.z, ix: a.ix, iz: a.iz, cold: !!a.cold, face, gen: gate }; }

  // Dev/verify log under ?verge= only (never affects ?shot output).
  if (params.get('verge')) {
    console.log('VERGE pump perm=' + L.pump.def.perm.join('') + ' sol=' + vgPumpSolution(L.pump.def).map(b => b ? 'O' : 'S').join(''));
    console.log('VERGE belfry cross=' + JSON.stringify(L.belfry.def.cross) + ' target=' + L.belfry.def.target.join('') + ' minPulls=' + L.belfry.def.minPulls);
    console.log('VERGE signal rules=' + L.signal.def.rules.map(r => 'L' + (r.i + 1) + r.form + (r.j + 1)).join(',') + ' target=' + L.signal.def.target.toString(2).padStart(5, '0') + ' minThrows=' + L.signal.def.minThrows);
    console.log('VERGE yard mass=' + L.yard.def.mass.join('') + ' M=' + L.yard.def.M + ' L=' + L.yard.def.L + ' sol=' + L.yard.def.solution.join(''));
    console.log('VERGE kiln band=[' + L.kiln.def.bandLo.toFixed(2) + ',' + L.kiln.def.bandHi.toFixed(2) + '] window=' + L.kiln.def.window.toFixed(3) + 's');
    console.log('VERGE gate marks=' + L.gate.gen.marks.map(m => VERGE_MARKS[m]).join('') + ' order=' + L.gate.gen.order.map(o => VG_HANDLES[o]).join('>'));
  }
}

/* ======================================================================== */
/*  ITEMS — machine pieces, plate rubbing, timetable halves, taper, whistle    */
/*  Examine notes are the clue surfaces (the socket mark + a foundry-motto      */
/*  fragment on each piece — the satchel is the Gate's codebook). Registered    */
/*  once at load; the clue-bearing note is stored at collection via invAdd.     */
/* ======================================================================== */
(function vergeRegisterItems() {
  if (typeof invRegister !== 'function') return;
  invRegister('pc_governor', { name: 'The Governor', icon: '⚙', stack: false, desc: 'A brass flyball governor, arms still true. It wants a socket at the forest’s edge.' });
  invRegister('pc_windrose', { name: 'The Wind Rose', icon: '✳', stack: false, desc: 'A glass compass-rose in a brass ring — it turns to a wind that isn’t blowing.' });
  invRegister('pc_escapement', { name: 'The Escapement', icon: '⧗', stack: false, desc: 'A gear and pallet-fork, oiled black. It keeps a beat when you hold it still.' });
  invRegister('pc_coil', { name: 'The Condenser Coil', icon: '❍', stack: false, desc: 'Stacked brass rings, cold to the touch — they pull the damp right out of the air.' });
  invRegister('pc_censer', { name: 'The Cloud-Seed Censer', icon: '♁', stack: false, desc: 'A hanging censer that smells of rain before rain. It seeds a cloud, they say.' });
  invRegister('vg_rubbing', { name: 'Schematic rubbing', icon: '✎', stack: false, desc: 'A charcoal rubbing of the pump-house schematic plate.' });
  invRegister('vg_ttA', { name: 'Timetable — upper half', icon: '☰', stack: false, desc: 'The top of a torn working timetable, spiked in the signal box.' });
  invRegister('vg_ttB', { name: 'Timetable — lower half', icon: '☱', stack: false, desc: 'The bottom of a torn working timetable, found at the buffer stop.' });
  invRegister('vg_timetable', { name: 'Timetable — joined', icon: '☷', stack: false, desc: 'Both halves of the working timetable, read together.' });
  invRegister('vg_taper', { name: 'Burning taper', icon: '🕯', stack: false, desc: 'A wax taper, lit from a street lamp. It will not last forever.' });
  invRegister('vg_whistle', { name: 'The Warden’s Whistle', icon: '☙', stack: false, desc: 'Bone and brass, on a chime-string. The Edgewright pressed it into your hand when the rain came.' });
})();

// A piece's examine note: its socket MARK + a foundry-motto FRAGMENT. Read in socket order the
// fragments restate the lintel's startup order — the satchel is a second, independent path to
// the answer (design D4). Computed at collection time from the located Gate truth.
function vgPieceNote(kind) {
  const g = verge.loc && verge.loc.gate; if (!g) return 'A movement of the Verge Engine. It carries a maker’s mark for its socket.';
  const pieceIdx = PIECE_OF_SITE_IDX[Object.keys(SITE_PIECE).find(s => SITE_PIECE[s] === kind)];
  const mark = VERGE_MARKS[g.gen.marks[pieceIdx]];
  // which pedestal this piece seats in (its mark's pedestal), and the motto fragment at that pedestal
  const ped = g.gen.pedestal.indexOf(g.gen.marks[pieceIdx]);
  const frag = vgMottoFragment(g.gen, ped);
  return 'Cast into its collar, the maker’s mark ' + mark + ' — it will seat only where that mark is stamped.\n\nFoundry motto (read your movements in the order of their sockets): “' + frag + '”';
}
// The Gate lintel reads three marks in the startup order; the foundry motto (split one fragment
// per pedestal 0..4) names PRIME/SPIN/SEED in that same order at three of the pedestals.
function vgMottoFragment(gen, ped) {
  // build the 5-slot motto once: slots for the 3 order-bearing handle lines at the 3 lowest
  // pedestals that hold a handle-marked piece, flavor bookends elsewhere.
  const slots = ['Where the edge burns,', 'and the rain remembers,', 'the Engine keeps its word,', 'as the wardens set it down,', 'so the green holds the line.'];
  // place the ordered handle lines at pedestals holding the handle-marked pieces, in socket order
  const handlePeds = [];   // pedestal index → handle line (in pull order across ascending pedestals)
  for (let k = 0; k < 5; k++) { const markAtPed = gen.pedestal[k]; const hi = gen.handleMark.indexOf(markAtPed); if (hi >= 0) handlePeds.push({ ped: k, handle: hi }); }
  handlePeds.sort((a, b) => a.ped - b.ped);
  // assign the pull-order lines to the ascending handle pedestals so socket-order reading == order
  const orderedHandles = gen.order;   // handle indices in pull order
  for (let n = 0; n < handlePeds.length && n < orderedHandles.length; n++) {
    slots[handlePeds[n].ped] = VG_HANDLE_LINE[VG_HANDLES[orderedHandles[n]]] + ',';
  }
  return slots[ped] || slots[0];
}

/* ======================================================================== */
/*  PROPS — one shared pool, nearest site only (design: ≤28 box, 6 cyl, 4 spr) */
/*  Never added in buildChunk. A dev assert warns if a site overflows a pool.  */
/* ======================================================================== */
const vgMatIron = new THREE.MeshStandardMaterial({ color: 0x33342b, roughness: 0.85, metalness: 0.2 });
const vgMatBrass = new THREE.MeshStandardMaterial({ color: 0x9a7b3a, roughness: 0.5, metalness: 0.35, envMap: envRT.texture, envMapIntensity: 0.5 });
const vgMatBrassLt = new THREE.MeshStandardMaterial({ color: 0xc4a55e, roughness: 0.45, metalness: 0.4, envMap: envRT.texture, envMapIntensity: 0.5 });
const vgMatWood = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 1 });
const vgMatStone = new THREE.MeshStandardMaterial({ color: 0x6b675e, roughness: 0.95 });
const vgMatGrime = new THREE.MeshStandardMaterial({ color: 0x2a2a22, roughness: 1 });
const vgMatGlass = new THREE.MeshStandardMaterial({ color: 0x9fc6c0, roughness: 0.3, metalness: 0.1, emissive: srgb(0x2a4a44), emissiveIntensity: 0.3, envMap: envRT.texture, envMapIntensity: 0.8 });
const vgMatRed = new THREE.MeshStandardMaterial({ color: 0x8a2f22, roughness: 0.7 });
const vgMatWater = new THREE.MeshStandardMaterial({ color: 0x1b4668, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.78, envMap: envRT.texture, envMapIntensity: 1.0 });   // deep blue, matches matWater's body
const vgMatGold = new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false });
const vgMatMoss = new THREE.MeshBasicMaterial({ color: 0x8fe27a, fog: false });
const vgMatEmber = new THREE.MeshBasicMaterial({ color: 0xff7a2a, fog: false });   // firebox / lamp glow
// four distinct valve-band tints (the pipe colour clue) + a name each
const VG_BAND_MAT = [
  new THREE.MeshStandardMaterial({ color: 0xb5552f, roughness: 0.7 }),   // rust-red
  new THREE.MeshStandardMaterial({ color: 0x3f6ea5, roughness: 0.7 }),   // slate-blue
  new THREE.MeshStandardMaterial({ color: 0x6f8f3a, roughness: 0.7 }),   // moss-green
  new THREE.MeshStandardMaterial({ color: 0xcaa63a, roughness: 0.7 })    // ochre
];
const VG_BAND_NAME = ['red', 'blue', 'green', 'ochre'];

const VG_BOX_N = 34, VG_CYL_N = 8, VG_SPR_N = 4;
const VG_BOXES = Array.from({ length: VG_BOX_N }, () => { const m = new THREE.Mesh(tplBox, vgMatIron); m.visible = false; scene.add(m); return m; });
const VG_CYLS = Array.from({ length: VG_CYL_N }, () => { const m = new THREE.Mesh(tplCyl, vgMatBrass); m.visible = false; scene.add(m); return m; });
const VG_SPRS = Array.from({ length: VG_SPR_N }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSoft, color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.visible = false; scene.add(s); return s; });
let _vgB = 0, _vgC = 0, _vgS = 0, _vgOverflow = false;
function vgBegin() { _vgB = 0; _vgC = 0; _vgS = 0; }
function vgBox(x, y, z, sx, sy, sz, mat, rx, ry, rz) { const m = VG_BOXES[_vgB++]; if (!m) { _vgWarn('box'); return null; } m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.material = mat || vgMatIron; m.rotation.set(rx || 0, ry || 0, rz || 0); m.visible = true; return m; }
function vgCylP(x, y, z, r, h, mat, rx, ry, rz) { const m = VG_CYLS[_vgC++]; if (!m) { _vgWarn('cyl'); return null; } m.position.set(x, y, z); m.scale.set(r, h, r); m.material = mat || vgMatBrass; m.rotation.set(rx || 0, ry || 0, rz || 0); m.visible = true; return m; }
function vgSpr(x, y, z, scale, opacity, color) { const s = VG_SPRS[_vgS++]; if (!s) { _vgWarn('spr'); return null; } s.position.set(x, y, z); s.scale.setScalar(scale); s.material.opacity = opacity; if (color !== undefined) s.material.color.setHex(color); s.visible = true; return s; }
function vgEnd() { for (let i = _vgB; i < VG_BOX_N; i++) VG_BOXES[i].visible = false; for (let i = _vgC; i < VG_CYL_N; i++) VG_CYLS[i].visible = false; for (let i = _vgS; i < VG_SPR_N; i++) VG_SPRS[i].visible = false; }
function _vgWarn(kind) { if (!_vgOverflow) { _vgOverflow = true; console.warn('VERGE pool overflow (' + kind + ') — a site exceeded its budget; raise VG_' + kind.toUpperCase() + '_N'); } }

/* ======================================================================== */
/*  AUDIO — reuse the Ciphers' sfxNote (loaded before us). Local guard helper. */
/* ======================================================================== */
function vgAudible() { return typeof AC !== 'undefined' && AC && !(typeof muted !== 'undefined' && muted); }
function vgNote(freq, dur, vol) { if (typeof sfxNote === 'function') sfxNote(freq, dur, vol); }

/* ======================================================================== */
/*  THE EDGEWRIGHT (giver NPC at the Gate — mirrors puzzles.js ciphSyncTinker) */
/* ======================================================================== */
let vgEdgewrightObj = null;
function vergeSyncEdgewright(dt) {
  if (!verge.loc || !verge.loc.gate) return;
  const G = verge.loc.gate;
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  const gcx = G.ix, gcz = G.iz;
  const near = Math.abs(cx - gcx) <= 1 && Math.abs(cz - gcz) <= 1;
  if (near && !vgEdgewrightObj) {
    const ex = G.x + 3.2, ez = G.z + 1.5;
    const made = (typeof makeNPCGroup === 'function') ? makeNPCGroup(false, 'archivist') : null;
    if (made) { made.g.position.set(ex, 0, ez); made.g.rotation.y = Math.atan2(player.pos.x - ex, player.pos.z - ez); scene.add(made.g); vgEdgewrightObj = made; vergeGate = made; }
  } else if (!near && vgEdgewrightObj) { scene.remove(vgEdgewrightObj.g); vgEdgewrightObj = null; vergeGate = null; }
  if (vgEdgewrightObj) {
    const d = dist2(vgEdgewrightObj.g.position.x, vgEdgewrightObj.g.position.z, player.pos.x, player.pos.z);
    if (d < 18) { const y = Math.atan2(player.pos.x - vgEdgewrightObj.g.position.x, player.pos.z - vgEdgewrightObj.g.position.z); let dy = y - vgEdgewrightObj.g.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; vgEdgewrightObj.g.rotation.y += dy * Math.min(1, 6 * (dt || 0.016)); }
    if (vgEdgewrightObj.anim && typeof matLamp !== 'undefined') vgEdgewrightObj.anim.material.emissiveIntensity = matLamp.emissiveIntensity + 0.5;
  }
}
function atEdgewright(r) { return vgEdgewrightObj && dist2(vgEdgewrightObj.g.position.x, vgEdgewrightObj.g.position.z, player.pos.x, player.pos.z) < (r || 3.4); }

// Edgewright talk: intro fiction, then a per-site hint ladder keyed to persisted attempts
// (nudge at ~3, plainer steer at ~7 — never the raw answer).
function vergeEdgewrightTalk() {
  vergeLocate();
  if (!VERGE_SAVE.met) {
    VERGE_SAVE.met = true; VERGE_SAVE.started = true; vergeSave();
    msg('An old keeper rises from beside the dead machine: “So the rumors carried true. I am the Edgewright — the last to tend the Verge Engine before it failed and the edge began to burn. Five movements were pulled from it and scattered under the canopy, each locked behind a contraption only a patient hand undoes.”', 13, true);
    setTimeout(() => msg('“Bring me the five, and we will wake it together. It shepherded the rain along this line once — kept the forest’s edge from cooking. The marks on the pieces will teach you their sockets; the lintel above will teach you the starting turn. Go on. The leads point the way.”', 13, true), 6000);
    return;
  }
  const solved = VERGE_SITES.filter(s => VERGE_SAVE.sitesSolved[s]);
  const left = VERGE_SITES.filter(s => !VERGE_SAVE.sitesSolved[s]);
  if (VERGE_SAVE.gateDone) { msg('The Edgewright watches the rain walk the burnt ground: “You did what I could not. The edge will hold a while longer. Whatever else you carry the whistle for — safe roads, warden.”', 9, true); return; }
  if (!left.length) { msg('The Edgewright runs a thumb over the five sockets: “All five movements, in the satchel. Now — seat each by its mark, then pull the handles in the lintel’s order. Read your pieces if the lintel’s worn: the motto keeps the same turn.”', 11, true); return; }
  // hint ladder for the site the player has fought hardest (most attempts among unsolved)
  let worst = left[0], wa = -1;
  for (const s of left) { const a = VERGE_SAVE.attempts[s] | 0; if (a > wa) { wa = a; worst = s; } }
  let s = 'The Edgewright taps the bench: “Still open — ' + left.map(x => SITE_NAME[x]).join(', ') + '. The answers are all out there, in the world.”';
  s += vergeLadder(worst);
  msg(s, 11, true);
}
// Per-site hint ladder — appended to the Edgewright's line. Two stages, never the raw answer.
function vergeLadder(site) {
  const a = VERGE_SAVE.attempts[site] | 0, L = verge.loc;
  let s = '';
  if (a >= 3) {
    if (site === 'pump') s += '\n\nAbout ' + SITE_NAME[site] + ': the plate you rubbed names the legs by the pipe-paint, not by the wheel. Match paint to leg before you touch a wheel.';
    else if (site === 'belfry') s += '\n\nAbout ' + SITE_NAME[site] + ': two ropes are crossed — pulling one drops another. Watch which weight sinks when you pull, and plan the order backwards from that.';
    else if (site === 'signal') s += '\n\nAbout ' + SITE_NAME[site] + ': the plates say which lever frees or locks which. A locked lever won’t throw — set its keeper first.';
    else if (site === 'yard') s += '\n\nAbout ' + SITE_NAME[site] + ': weigh them two at a time on the assay scale until you know the full order. Then the crate’s stamp tells you the balance.';
    else if (site === 'kiln') s += '\n\nAbout ' + SITE_NAME[site] + ': the needle keeps a rhythm that repeats — fast, then slow, then fast. Vent while it’s crossing the brass band, not before.';
  }
  if (a >= 7) {
    if (site === 'pump' && L) s += '\nPlainer: the chamber leg wants OPEN and the bypass OPEN; the burst and drain SHUT. Find which wheels those are by their paint.';
    else if (site === 'belfry' && L) s += '\nPlainer: the marks want the weights at ' + L.belfry.def.target.join(', ') + ' notches. Reach them despite the crossing — it takes about ' + L.belfry.def.minPulls + ' pulls.';
    else if (site === 'signal' && L) s += '\nPlainer: the timetable’s aspect stands ' + vgSignalAspectWords(L.signal.def.target) + '. Free the keepers, then set exactly those.';
    else if (site === 'yard' && L) s += '\nPlainer: the crate is stamped ' + L.yard.def.M + ' at arm ' + L.yard.def.L + '. Hang the castings so the torques match — only one arrangement does.';
    else if (site === 'kiln' && L) s += '\nPlainer: the safe window is about ' + Math.round(L.kiln.def.window * 1000) + ' milliseconds each pass. Wait for the slow stretch and hold the valve then.';
  }
  return s;
}
function vgSignalAspectWords(mask) { const on = []; for (let i = 0; i < 5; i++) if (mask & (1 << i)) on.push(i + 1); if (!on.length) return 'all at rest'; return on.join(' and ') + ' standing, the rest at rest'; }

/* ======================================================================== */
/*  PIECE COLLECTION + LEAD notification + Gate reveal                        */
/* ======================================================================== */
function vgHandPiece() { const h = VERGE_SAVE.pieces.held; return h.length ? h[h.length - 1] : null; }
function vergeCollectPiece(site) {
  const kind = SITE_PIECE[site]; if (!kind) return;
  if (VERGE_SAVE.sitesSolved[site] && VERGE_SAVE.pieces.held.indexOf(kind) < 0 && VERGE_SAVE.pieces.seated.indexOf(kind) < 0) { /* re-collect guard */ }
  VERGE_SAVE.sitesSolved[site] = true;
  if (VERGE_SAVE.pieces.held.indexOf(kind) < 0 && VERGE_SAVE.pieces.seated.indexOf(kind) < 0) VERGE_SAVE.pieces.held.push(kind);
  vergeSave();
  if (typeof invAdd === 'function') invAdd(PIECE_ITEM[kind], 1, vgPieceNote(kind));
  const held = VERGE_SAVE.pieces.held.length + VERGE_SAVE.pieces.seated.length;
  if (typeof msg === 'function') msg(PIECE_NAME[kind] + ' comes free in your hands — heavy, brass, warm from the work. A movement of the Verge Engine. (' + held + ' / 5)', 9, true);
  if (typeof hint === 'function') hint('Movements recovered — ' + held + ' / 5', 3);
  // Gate minimap reveal after the second piece
  if (held >= 2 && !VERGE_SAVE.gateRevealed) { VERGE_SAVE.gateRevealed = true; vergeSave(); if (typeof msg === 'function') setTimeout(() => msg('Two movements in the satchel — someone at the forest’s edge will want these. The Gate shows on your map now.', 8, true), 3200); }
  // notify the errand system so an active LEAD for this site completes
  if (typeof vergeLeadSolved === 'function') vergeLeadSolved(site);
}

/* ======================================================================== */
/*  CARRY SYNC — assert the in-hand prop each frame (yields to an errand parcel) */
/* ======================================================================== */
function _vergeSyncCarry() {
  if (typeof carryKind !== 'function') return;
  const cur = carryKind();
  if (cur === 'parcel') return;                        // an errand owns the rig — yield
  let want = null;
  if (verge.transientCarry) want = verge.transientCarry;         // hauling a casting, etc.
  else if (verge.kiln.taperLit && verge.kiln.taperFrac > 0) want = 'taper';
  else want = vgHandPiece();
  if (want) { if (cur !== want) carryShow(want); if (want === 'taper' && typeof carrySetBurn === 'function') carrySetBurn(verge.kiln.taperFrac); }
  else if (cur && cur !== 'parcel') carryHide();
}

/* ======================================================================== */
/*  PER-FRAME DRIVER                                                          */
/* ======================================================================== */
function nearestVergeSite() {
  const L = verge.loc; if (!L) return null;
  const px = player.pos.x, pz = player.pos.z;
  const cands = [];
  for (const s of VERGE_SITES) if (L[s]) cands.push({ id: s, x: L[s].x, z: L[s].z });
  if (L.gate) cands.push({ id: 'gate', x: L.gate.x, z: L.gate.z });
  let best = null, bd = CHUNK * 1.4;
  for (const c of cands) { const d = dist2(c.x, c.z, px, pz); if (d < bd) { bd = d; best = Object.assign({ d }, c); } }
  return best;
}
function updateVerge(dt, time) {
  if (typeof SHOT !== 'undefined' && SHOT) return;
  if (typeof player === 'undefined') return;
  vergeLocate(); if (!verge.loc) return;
  _vergeSyncCarry();
  vergeSyncEdgewright(dt);
  if (atEdgewright(3.4) && !VERGE_SAVE.gateDone) hint('Press E — the Edgewright has words for you', 0.4);

  const eDown = !!keys.KeyE, ePressed = eDown && !verge._ePrev, eReleased = !eDown && verge._ePrev;
  const site = nearestVergeSite();
  if (typeof pickupBegin === 'function') pickupBegin();
  vgBegin();
  if (site) vergeRunSite(site, dt, time, ePressed, eReleased, eDown);
  vgEnd();
  if (typeof pickupEnd === 'function') pickupEnd();
  verge._ePrev = eDown;
}

// Dispatch to the nearest site's draw + state machine. (Groups 4–9 fill these in; the group-3
// skeleton draws a husk frame + a "sealed" hint so the sites read and consume E.)
function vergeRunSite(site, dt, time, ePressed, eReleased, eDown) {
  switch (site.id) {
    case 'pump': return runPump(site, dt, time, ePressed, eReleased, eDown);
    case 'belfry': return runBelfry(site, dt, time, ePressed, eReleased, eDown);
    case 'signal': return runSignal(site, dt, time, ePressed, eReleased, eDown);
    case 'yard': return runYard(site, dt, time, ePressed, eReleased, eDown);
    case 'kiln': return runKiln(site, dt, time, ePressed, eReleased, eDown);
    case 'gate': return runGate(site, dt, time, ePressed, eReleased, eDown);
  }
}
function vgHuskStub(site) {
  const L = verge.loc[site.id]; if (!L) return;
  vgBox(L.x, 0, L.z, 3, 3, 3, vgMatIron);
  if (site.d < 4) hint('An Authority contraption — ' + SITE_NAME[site.id] + '. (not yet wired)', 0.4);
}
/* ------------------------------------------------------------------------ */
/*  SITE 1 — THE PUMP HOUSE (reservoir): repair, then valve routing.          */
/*  Phases flywheel → seat → valves → solved. The wheel→leg permutation is     */
/*  per-seed (1 of 16); the plate rubbing renders the leg↔pipe-paint mapping   */
/*  with a rose on the chamber and a ring on the bypass — read it, set the      */
/*  wheels by their paint, crank the primer.                                    */
/* ------------------------------------------------------------------------ */
function vgRubbingNote(def) {
  const legColor = (l) => VG_BAND_NAME[def.band[def.perm.indexOf(l)]];
  return 'THE PUMP MANIFOLD — four legs, four wheels, read by the pipe-paint:\n' +
    '  ✿ CHAMBER (rose-marked): the ' + legColor(0) + ' pipe — must run OPEN.\n' +
    '  ◦ BYPASS (ring-marked): the ' + legColor(1) + ' pipe — must run OPEN.\n' +
    '  BURST leg: the ' + legColor(2) + ' pipe — keep it SHUT.\n' +
    '  DRAIN: the ' + legColor(3) + ' pipe — keep it SHUT.\n' +
    '(Turn each wheel to match its paint, then hold the primer crank to test.)';
}
function vgPumpFaultColor(def, fault) { return VG_BAND_NAME[def.band[fault.wheel]]; }
function drawPumpProps(L, st, def, time, running) {
  const cx = L.x, cz = L.z;
  // shed frame — four corner posts + a low lintel
  vgBox(cx - 3.2, 0, cz - 2.6, 0.3, 3.2, 0.3, vgMatWood); vgBox(cx + 3.2, 0, cz - 2.6, 0.3, 3.2, 0.3, vgMatWood);
  vgBox(cx - 3.2, 0, cz + 2.6, 0.3, 2.6, 0.3, vgMatWood); vgBox(cx + 3.2, 0, cz + 2.6, 0.3, 2.6, 0.3, vgMatWood);
  vgBox(cx, 3.1, cz - 2.6, 6.7, 0.28, 0.28, vgMatWood);
  // pump body + piston
  vgBox(cx, 0, cz, 1.4, 1.4, 1.1, vgMatIron);
  const pistY = running ? 1.4 + 0.35 + Math.abs(Math.sin(time * 3.2)) * 0.5 : 1.4 + 0.35;
  vgCylP(cx, pistY, cz, 0.14, 0.7, vgMatBrassLt);
  // flywheel socket + flywheel (when seated)
  vgBox(cx + 0.8, 0.9, cz, 0.22, 0.4, 0.22, vgMatGrime);
  if (st.seated || running) vgCylP(cx + 0.95, 1.1, cz, 0.5, 0.14, vgMatBrass, 0, 0, running ? time * 4 : 0);
  // crank on the far side
  vgCylP(cx + 2.2, 1.0, cz, 0.32, 0.12, vgMatBrassLt, 0, 0, running ? time * 4 : 0);
  vgBox(cx + 2.2, 0, cz, 0.14, 1.0, 0.14, vgMatIron);
  // 4 valve wheels in a row (front), each on a colour-band pipe stub
  for (let w = 0; w < 4; w++) {
    const wx = cx - 2.4 + w * 1.2, wz = cz + 1.4;
    vgBox(wx, 0, wz, 0.26, 0.9, 0.26, VG_BAND_MAT[def.band[w]]);           // colour-band pipe stub
    const turn = st.valves[w] ? Math.PI / 4 : 0;                          // quarter-turn when open
    vgCylP(wx, 1.0, wz, 0.28, 0.1, vgMatBrass, Math.PI / 2, turn, 0);      // hand-wheel (flat)
  }
  // gauge + needle (needle slams on a wrong crank)
  vgBox(cx - 1.4, 1.7, cz, 0.5, 0.5, 0.16, vgMatStone);
  const slam = (time - st.faultT) < 0.6;
  const needleRot = slam ? 1.2 : (running ? 0.9 : (-0.6 + (st.valves.filter(v => v).length) * 0.2));
  vgBox(cx - 1.4, 1.78, cz + 0.09, 0.05, 0.34, 0.03, vgMatRed, 0, 0, needleRot);
  // manifold legs (chamber grate + float / bypass / burst / drain) at the base, left→right
  for (let l = 0; l < 4; l++) {
    const lx = cx - 1.8 + l * 0.7, lz = cz - 1.6;
    vgBox(lx, 0, lz, 0.4, l === 0 && running ? 0.15 : 0.6, 0.4, l === 0 ? vgMatGrime : vgMatIron);   // grate lifts when running
    if (l === 0 && running) { vgBox(lx, 0.05, lz, 0.5, 0.05, 0.5, vgMatWater); vgCylP(lx, 0.1, lz, 0.12, 0.2, vgMatBrassLt); }  // flooded + float
  }
  // schematic plate on the near post
  vgBox(cx - 3.0, 1.2, cz, 0.12, 0.7, 0.5, vgMatStone);
  // localized hiss + dust puff at the offending leg on a wrong crank
  if (slam && st.faultLeg >= 0) {
    const lx = cx - 1.8 + st.faultLeg * 0.7, lz = cz - 1.6;
    const u = (time - st.faultT) / 0.6;
    vgSpr(lx, 0.6 + u * 0.8, lz, 0.6 + u * 0.8, 0.6 * (1 - u), 0xbdb6a2);
  }
}
function pumpToggleValve(st, w) { st.valves[w] = !st.valves[w]; vgNote(300 + w * 40, 0.12, 0.05); }
function pumpCrankTest(L, st, def, time) {
  if (vgPumpFloods(def, st.valves)) {
    st.solvedPuzzle = true;
    if (typeof msg === 'function') msg('The primer catches. The piston takes up its long stroke, water floods the chamber with a deep gurgle, and the grate grinds up — something brass rises on the float.', 10, true);
    if (vgAudible()) vgNote(196, 0.7, 0.06);
  } else {
    VERGE_SAVE.attempts.pump = (VERGE_SAVE.attempts.pump | 0) + 1; vergeSave();
    const fault = vgPumpFault(def, st.valves); st.faultLeg = fault.leg; st.faultT = time;
    if (typeof msg === 'function') msg('The gauge needle slams over and the ' + vgPumpFaultColor(def, fault) + ' pipe hisses steam and grit — the routing is wrong somewhere. (Read your rubbing; set the wheels by their paint.)', 8);
    if (vgAudible()) vgNote(140, 0.4, 0.05);
  }
}
function runPump(site, dt, time, ePressed, eReleased, eDown) {
  const L = verge.loc.pump, st = verge.pump, def = L.def;
  const running = VERGE_SAVE.sitesSolved.pump || st.solvedPuzzle;
  drawPumpProps(L, st, def, time, running);

  if (running) {
    if (!VERGE_SAVE.sitesSolved.pump) {                         // Governor floats up until taken
      if (typeof pickupShow === 'function') pickupShow(L.x, 2.1 + Math.sin(time * 1.5) * 0.18, L.z, 'governor', time);
      if (dist2(L.x, L.z, player.pos.x, player.pos.z) < 3.0) { hint('Press E — take the Governor from the float', 0.4); if (ePressed) vergeCollectPiece('pump'); }
    }
    return;
  }

  // phase: fetch + seat the flywheel first
  if (!st.seated) {
    if (!st.holdingFly) {
      if (typeof pickupShow === 'function') pickupShow(L.fly.x, 0.5, L.fly.z, 'flywheel', time);
      if (dist2(L.fly.x, L.fly.z, player.pos.x, player.pos.z) < 2.6) { hint('Press E — lift the pump’s missing flywheel', 0.4); if (ePressed) { st.holdingFly = true; verge.transientCarry = 'casting'; if (typeof pickupBurst === 'function') pickupBurst(L.fly.x, 0.5, L.fly.z); msg('You heave the flywheel up out of the weeds — heavier than it looks. It wants its socket on the pump.', 7); } }
    } else {
      if (dist2(L.x, L.z, player.pos.x, player.pos.z) < 3.4) { hint('Press E — seat the flywheel on the pump shaft', 0.4); if (ePressed) { st.seated = true; st.holdingFly = false; verge.transientCarry = null; VERGE_SAVE.pumpSeated = true; vergeSave(); vgNote(220, 0.25, 0.06); msg('The flywheel drops onto its shaft with a heavy clank. Now the valves — and the primer. (There’s a schematic plate to rub.)', 8); } }
    }
    return;
  }

  // valves phase
  const wheels = []; for (let w = 0; w < 4; w++) wheels.push({ x: L.x - 2.4 + w * 1.2, y: 1.0, z: L.z + 1.4 });
  const plate = { x: L.x - 3.0, y: 1.2, z: L.z }, crank = { x: L.x + 2.2, y: 1.0, z: L.z };
  const cands = wheels.concat([plate, crank]);

  // crank hold-to-test (mirrors the shadow-clock dig hold)
  if (st.crankTgt) {
    if (eDown) { st.crankT += dt; hint('Cranking the primer…  ' + Math.min(2, st.crankT).toFixed(1) + ' s', 0.3); if (st.crankT >= 2) { pumpCrankTest(L, st, def, time); st.crankTgt = false; st.crankT = 0; } return; }
    st.crankTgt = false; st.crankT = 0; hint('The primer needs a full, steady crank — hold E.', 1.5);
  }
  if (ePressed) {
    const pick = aimPick(cands, 3.4);
    if (pick >= 0 && pick < 4) pumpToggleValve(st, pick);
    else if (pick === 4) { if (!invHas('vg_rubbing')) { invAdd('vg_rubbing', 1, vgRubbingNote(def)); msg('You lay charcoal to the brass plate and lift a rubbing of the pump schematic. The satchel keeps it — it names the legs by their pipe-paint.', 8); } else msg(vgRubbingNote(def), 12, true); }
    else if (pick === 5) { st.crankTgt = true; st.crankT = 0; }
    return;
  }
  const near = aimPick(cands, 3.4);
  if (near >= 0 && near < 4) hint('Valve wheel on the ' + VG_BAND_NAME[def.band[near]] + ' pipe — E to turn it (now ' + (st.valves[near] ? 'OPEN' : 'SHUT') + ')', 0.4);
  else if (near === 4) hint(invHas('vg_rubbing') ? 'The schematic plate — E to read the rubbing' : 'Brass schematic plate — E to take a rubbing', 0.4);
  else if (near === 5) hint('The primer crank — hold E to test the valves', 0.4);
}
/* ------------------------------------------------------------------------ */
/*  SITE 2 — THE BELL-CRANK BELFRY (grove with chimes): cross-rigged ropes.    */
/*  Three ropes ratchet counterweights up notch rails (0–4); two ropes are     */
/*  cross-rigged (pulling one drops another), so the naive "each to its mark"   */
/*  order fails. Faded paint marks show the target heights; a reset chain       */
/*  crashes all to zero. Hold the marks 2 s → the yoke tips and the cage comes  */
/*  down with the Wind Rose.                                                    */
/* ------------------------------------------------------------------------ */
const VG_BELFRY_PITCH = [523.25, 659.25, 783.99];   // C5 E5 G5 — a distinct toll per rope
const vgMatPaint = new THREE.MeshStandardMaterial({ color: 0xbfae7a, roughness: 1 });   // faded paint mark
function drawBelfryProps(L, st, def, time, solved) {
  const cx = L.x, cz = L.z, baseY = 1.0, notch = 0.75;
  const tip = (st.solvedPuzzle || solved) ? Math.min(0.35, st.cageT * 0.2) : 0;
  // frame: two tall posts + the tipping yoke crossbeam
  vgBox(cx - 2.2, 0, cz, 0.3, 4.4, 0.3, vgMatWood); vgBox(cx + 2.2, 0, cz, 0.3, 4.4, 0.3, vgMatWood);
  vgBox(cx, 4.2, cz, 4.7, 0.32, 0.5, vgMatWood, 0, 0, tip);
  // three rails, marks, counterweights, ropes
  for (let i = 0; i < 3; i++) {
    const rx = cx - 1.4 + i * 1.4;
    vgBox(rx, baseY, cz, 0.12, 3.2, 0.12, vgMatIron);                                     // notch rail
    vgBox(rx, baseY + def.target[i] * notch, cz + 0.1, 0.34, 0.08, 0.06, vgMatPaint);     // faded paint mark
    const jig = (time - st.dropAnim[i]) < 0.3 ? Math.sin((time - st.dropAnim[i]) * 40) * 0.04 : 0;
    const wY = baseY + st.h[i] * notch + jig;
    vgBox(rx, wY, cz, 0.42, 0.4, 0.3, vgMatBrass);                                        // counterweight
    const ropeTop = 4.15 - tip * (rx - cx);
    const ropeLen = Math.max(0.2, ropeTop - (wY + 0.2));
    vgBox(rx, wY + 0.2, cz, 0.05, ropeLen, 0.05, vgMatWood);                              // rope (thins to the yoke)
  }
  // reset chain, off to the side
  vgCylP(cx + 1.9, 2.4, cz + 0.3, 0.05, 1.8, vgMatIron);
  // cage with the Wind Rose, hung under the yoke; descends as the puzzle resolves
  const cageY = (st.solvedPuzzle || solved) ? Math.max(1.2, 3.6 - st.cageT * 0.9) : 3.6;
  if (!solved) {
    vgBox(cx, cageY, cz - 0.6, 0.9, 0.9, 0.9, vgMatIron);                                 // cage bars (a box shell)
    vgBox(cx, cageY, cz - 0.6, 0.7, 0.7, 0.7, vgMatGrime);
    if (!VERGE_SAVE.sitesSolved.belfry) {                                                 // the Wind Rose inside
      vgCylP(cx, cageY, cz - 0.6, 0.26, 0.06, vgMatGlass, Math.PI / 2, time * 0.6, 0);
      vgBox(cx, cageY, cz - 0.6, 0.5, 0.04, 0.06, vgMatBrassLt, 0, time * 0.6, 0);
    }
  }
}
function belfryPull(st, def, i, time) {
  st.h[i] = Math.min(4, st.h[i] + 1);
  if (vgAudible()) vgNote(VG_BELFRY_PITCH[i], 0.9, 0.09);
  for (const p of def.cross) if (p[0] === i) { st.h[p[1]] = Math.max(0, st.h[p[1]] - 1); st.dropAnim[p[1]] = time; if (vgAudible()) vgNote(170, 0.25, 0.05); }
}
function belfryReset(st) { st.h = [0, 0, 0]; st.atT = 0; if (vgAudible()) vgNote(110, 0.6, 0.06); if (typeof msg === 'function') msg('You haul the reset chain — the counterweights crash to the floor as one. Begin again.', 5); }
function runBelfry(site, dt, time, ePressed, eReleased, eDown) {
  const L = verge.loc.belfry, st = verge.belfry, def = L.def;
  const solvedSite = VERGE_SAVE.sitesSolved.belfry;
  drawBelfryProps(L, st, def, time, solvedSite);
  if (dist2(L.x, L.z, player.pos.x, player.pos.z) < 12) once('verge-belfry-marks', () => msg('Three bell-ropes, three counterweights on their rails — and faded paint where the weights hung when the gate last opened. But two ropes are crossed: pull one and another sinks. Find the order.', 10));
  if (solvedSite) return;

  if (st.solvedPuzzle) {
    st.cageT += dt;
    if (typeof pickupShow === 'function') pickupShow(L.x, Math.max(1.3, 3.6 - st.cageT * 0.9), L.z - 0.6, 'windrose', time);
    if (st.cageT > 2.4 && dist2(L.x, L.z - 0.6, player.pos.x, player.pos.z) < 3.0) { hint('Press E — take the Wind Rose from the cage', 0.4); if (ePressed) vergeCollectPiece('belfry'); }
    return;
  }

  const ropes = []; for (let i = 0; i < 3; i++) ropes.push({ x: L.x - 1.4 + i * 1.4, y: 1.6, z: L.z });
  const reset = { x: L.x + 1.9, y: 1.8, z: L.z + 0.3 };

  if (st.holdRope >= 0) {
    if (eDown) { st.holdT += dt; hint('Hauling rope ' + (st.holdRope + 1) + '…  ' + Math.min(0.6, st.holdT).toFixed(2) + ' s', 0.3); if (st.holdT >= 0.6) { belfryPull(st, def, st.holdRope, time); st.holdRope = -1; st.holdT = 0; } }
    else { st.holdRope = -1; st.holdT = 0; }
  } else if (ePressed) {
    const pick = aimPick(ropes.concat([reset]), 3.4);
    if (pick >= 0 && pick < 3) { st.holdRope = pick; st.holdT = 0; }
    else if (pick === 3) belfryReset(st);
  } else {
    const near = aimPick(ropes.concat([reset]), 3.4);
    if (near >= 0 && near < 3) hint('Bell-rope ' + (near + 1) + ' (weight at notch ' + st.h[near] + ') — hold E to haul', 0.4);
    else if (near === 3) hint('The reset chain — E to drop every weight', 0.4);
  }

  // win: all three at their painted marks, held 2 s
  if (st.h[0] === def.target[0] && st.h[1] === def.target[1] && st.h[2] === def.target[2]) {
    st.atT += dt; hint('The weights sit at the marks — hold steady… ' + Math.min(2, st.atT).toFixed(1) + ' s', 0.4);
    if (st.atT >= 2) {
      st.solvedPuzzle = true; st.cageT = 0;
      if (vgAudible()) { vgNote(523.25, 1.4, 0.1); setTimeout(() => vgNote(659.25, 1.4, 0.1), 120); setTimeout(() => vgNote(783.99, 1.6, 0.1), 260); }
      if (typeof msg === 'function') msg('The yoke tips with a groan and a great bronze peal rolls out over the grove — and the cage comes down, turning, with the Wind Rose inside.', 10, true);
    }
  } else if (st.atT > 0) st.atT = 0;
}
/* ------------------------------------------------------------------------ */
/*  SITE 3 — THE SIGNAL BOX (viaduct): interlocked lever frame.               */
/*  Five levers with railway interlocking (4 per-seed lock rules). A locked    */
/*  lever strains and springs back. Wipe the grimed plates to read what frees   */
/*  or locks what; find both torn timetable halves to learn the target aspect;  */
/*  set exactly that aspect → the point clunks, the semaphores clack, and the    */
/*  inspection trolley delivers the Escapement.                                  */
/* ------------------------------------------------------------------------ */
const VG_EXPRESS = ['UP EXPRESS', 'DOWN MAIL', 'THE NIGHT GOODS', 'THE MARKET RELIEF', 'THE ASH LINE LOCAL'];
function vgSignalPlateText(def, i) {
  const rs = def.rules.filter(r => r.i === i);
  if (!rs.length) return 'PLATE ' + (i + 1) + ' — LEVER ' + (i + 1) + ' stands free. No interlock holds it.';
  return 'PLATE ' + (i + 1) + ' — ' + rs.map(r => r.form === 'A' ? ('LEVER ' + (i + 1) + ' frees only when LEVER ' + (r.j + 1) + ' stands') : ('LEVER ' + (i + 1) + ' locks while LEVER ' + (r.j + 1) + ' stands')).join('; ') + '.';
}
function vgSignalAspectNote(def, seed) {
  const name = VG_EXPRESS[hash2(seed, 0, 5531) % VG_EXPRESS.length];
  return name + ' — set the frame so ' + vgSignalAspectWords(def.target) + '. (Read the plates: some levers won’t throw until their keeper stands.)';
}
function drawSignalProps(L, st, def, time, solved) {
  const cx = L.x, cz = L.z;
  // signal-box hut + the lever floor
  vgBox(cx, 0, cz - 0.6, 3.6, 1.4, 1.4, vgMatIron);
  vgBox(cx, 1.4, cz - 0.6, 3.8, 0.2, 1.6, vgMatWood);
  // 5 levers (lean forward when thrown) + 5 grimed plates behind them
  for (let i = 0; i < 5; i++) {
    const lx = cx - 1.4 + i * 0.7;
    const thrown = st.lev[i] === 1;
    const strain = (time - st.thunkT) < 0.35 && st.thunkLever === i ? Math.sin((time - st.thunkT) * 50) * 0.15 : 0;
    vgBox(lx, 1.5, cz, 0.09, 0.9, 0.09, thrown ? vgMatBrassLt : vgMatBrass, (thrown ? 0.5 : -0.2) + strain, 0, 0);
    vgBox(lx, 1.55, cz - 1.05, 0.5, 0.34, 0.06, st.wiped[i] ? vgMatBrassLt : vgMatGrime);   // plate (grimed→clean)
  }
  // semaphore gantry — post + two arms (clack down when solved)
  vgBox(cx + 3.0, 0, cz, 0.22, 4.2, 0.22, vgMatIron);
  const arm = (st.solvedPuzzle || solved) ? -0.7 : 0;
  vgBox(cx + 3.0, 3.6, cz + 0.6, 1.1, 0.14, 0.1, vgMatRed, 0, 0, arm);
  vgBox(cx + 3.0, 3.0, cz + 0.6, 1.1, 0.14, 0.1, vgMatRed, 0, 0, arm * 0.6);
  // point rail + trolley + buffer + chest, down the grade (−x)
  vgBox(cx - 1, -0.05, cz + 3.0, 8, 0.1, 0.5, vgMatWood);
  const trolX = (st.solvedPuzzle || solved) ? (cx - 4.4 + Math.max(0, 3.4 - st.trolley * 2)) : cx + 2.6;
  if (!solved || true) vgBox(trolX, 0.2, cz + 3.0, 0.8, 0.5, 0.6, vgMatIron);   // trolley
  vgBox(cx - 4.8, 0.2, cz + 3.0, 0.3, 0.7, 0.7, vgMatWood);                     // buffer stop
  const chestOpen = (st.solvedPuzzle || solved);
  vgBox(cx - 4.2, 0.2, cz + 3.0, 0.7, 0.5, 0.6, vgMatWood);                     // chest body
  vgBox(cx - 4.2, 0.5, cz + 3.0 - (chestOpen ? 0.35 : 0), 0.72, 0.1, 0.62, vgMatBrass, chestOpen ? -0.8 : 0);  // lid
  // timetable spike (by the box) — a small upright
  if (!invHas('vg_ttA')) vgBox(cx + 1.7, 1.5, cz, 0.05, 0.5, 0.05, vgMatBrassLt);
}
function signalThrow(st, def, i, time) {
  if (vgLeverMovable(st.lev, i, def.rules)) { st.lev[i] = st.lev[i] ? 0 : 1; if (vgAudible()) vgNote(300 + i * 30, 0.14, 0.06); }
  else { st.thunkT = time; st.thunkLever = i; if (vgAudible()) vgNote(120, 0.22, 0.05); if (typeof msg === 'function') msg('Lever ' + (i + 1) + ' strains a half-throw and springs back with a THUNK — locked. Something must stand to free it. (Wipe the plates and read the interlock.)', 7); }
}
function signalWipe(st, def, i) {
  if (!st.wiped[i]) { st.wiped[i] = true; VERGE_SAVE.signalWiped[i] = true; vergeSave(); if (vgAudible()) vgNote(240, 0.1, 0.04); }
  if (typeof msg === 'function') msg('You scrub the grime from the brass. ' + vgSignalPlateText(def, i), 9);
}
function runSignal(site, dt, time, ePressed, eReleased, eDown) {
  const L = verge.loc.signal, st = verge.signal, def = L.def, seed = hash2(L.ix, L.iz, 5530);
  const solvedSite = VERGE_SAVE.sitesSolved.signal;
  drawSignalProps(L, st, def, time, solvedSite);
  if (solvedSite) return;

  if (st.solvedPuzzle) {
    st.trolley += dt;
    if (st.trolley > 1.9 && typeof pickupShow === 'function') pickupShow(L.x - 4.2, 0.7, L.z + 3.0, 'escapement', time);
    if (st.trolley > 1.9 && dist2(L.x - 4.2, L.z + 3.0, player.pos.x, player.pos.z) < 3.0) { hint('Press E — take the Escapement from the chest', 0.4); if (ePressed) vergeCollectPiece('signal'); }
    return;
  }

  // timetable halves — half A on the box spike, half B at the buffer stop
  const spike = { x: L.x + 1.7, z: L.z }, bstop = { x: L.x - 4.8, z: L.z + 3.0 };
  if (!invHas('vg_ttA') && typeof pickupShow === 'function') pickupShow(spike.x, 1.7, spike.z, 'timetable', time);
  if (!invHas('vg_ttB') && typeof pickupShow === 'function') pickupShow(bstop.x, 0.9, bstop.z, 'timetable', time);

  const levers = [], plates = [];
  for (let i = 0; i < 5; i++) { levers.push({ x: L.x - 1.4 + i * 0.7, y: 1.6, z: L.z }); plates.push({ x: L.x - 1.4 + i * 0.7, y: 1.55, z: L.z - 1.05 }); }

  if (ePressed) {
    const pick = aimPick(levers.concat(plates), 3.4);
    if (pick >= 0 && pick < 5) signalThrow(st, def, pick, time);
    else if (pick >= 5 && pick < 10) signalWipe(st, def, pick - 5);
    else if (!invHas('vg_ttA') && dist2(spike.x, spike.z, player.pos.x, player.pos.z) < 2.6) { invAdd('vg_ttA', 1); vgSignalTryMerge(def, seed); }
    else if (!invHas('vg_ttB') && dist2(bstop.x, bstop.z, player.pos.x, player.pos.z) < 2.6) { invAdd('vg_ttB', 1); vgSignalTryMerge(def, seed); }
  } else {
    const near = aimPick(levers.concat(plates), 3.4);
    if (near >= 0 && near < 5) hint('Lever ' + (near + 1) + ' (' + (st.lev[near] ? 'standing' : 'at rest') + ') — E to throw', 0.4);
    else if (near >= 5 && near < 10) hint(st.wiped[near - 5] ? ('Plate ' + (near - 4) + ' — E to re-read the interlock') : ('Grimed plate ' + (near - 4) + ' — E to wipe it clean'), 0.4);
    else if (!invHas('vg_ttA') && dist2(spike.x, spike.z, player.pos.x, player.pos.z) < 2.6) hint('A torn timetable half, spiked in the box — E to take it', 0.4);
    else if (!invHas('vg_ttB') && dist2(bstop.x, bstop.z, player.pos.x, player.pos.z) < 2.6) hint('The other timetable half, at the buffer stop — E to take it', 0.4);
  }

  // win: frame matches the timetable aspect
  if (vgSignalKey(st.lev) === def.target) {
    st.solvedPuzzle = true; st.trolley = 0;
    if (vgAudible()) { vgNote(200, 0.3, 0.06); setTimeout(() => vgNote(440, 0.3, 0.06), 150); }
    if (typeof msg === 'function') msg('The point-motor clunks over, the semaphore arms clack down into their aspect, and an inspection trolley rolls free down the grade — coasting into the buffer, where a chest springs open.', 11, true);
  }
}
function vgSignalTryMerge(def, seed) {
  if (invHas('vg_ttA') && invHas('vg_ttB') && !invHas('vg_timetable')) {
    invAdd('vg_timetable', 1, vgSignalAspectNote(def, seed));
    if (typeof msg === 'function') msg('Both halves of the working timetable, joined at last. It names the aspect the frame must show. (Read it in the satchel.)', 8, true);
  }
}
/* ------------------------------------------------------------------------ */
/*  SITE 4 — THE COUNTERWEIGHT YARD (works cell / sinkhole): assay + torque.   */
/*  Four unlabelled castings assay at {2,3,5,7} stone (order unknown). A two-    */
/*  pan scale ranks them (strict-heavier tilt). The crane's four hooks sit at    */
/*  arms 1–4; the stamped crate hangs at arm L with mass M. Exactly one of the   */
/*  24 hangings makes Σ mass·arm = M·L — held level 3 s the pawl walks the crate  */
/*  down and unlatches the Condenser Coil. A wrong full hang slams the beam.     */
/* ------------------------------------------------------------------------ */
const VG_CASTING_NAME = ['bell', 'gear', 'ingot', 'anchor'];
const VG_CASTING_MAT = () => [vgMatBrass, vgMatIron, vgMatBrassLt, vgMatGrime];
function yardCastingPos(st, c, cx, cz) {
  const hi = st.hooks.indexOf(c); if (hi >= 0) return { x: cx + 0.62 * (hi + 1), y: 1.5, z: cz + 0.4, on: 'hook', arm: hi };
  if (st.placed[0] === c) return { x: cx - 4.6, y: 1.25, z: cz + 2, on: 'panL' };
  if (st.placed[1] === c) return { x: cx - 3.6, y: 1.25, z: cz + 2, on: 'panR' };
  return { x: cx - 1.05 + c * 0.7, y: 0.35, z: cz + 3, on: 'ground' };
}
function drawYardProps(L, st, def, time, solved) {
  const cx = L.x, cz = L.z, mats = VG_CASTING_MAT();
  // crane: fulcrum post + tilting beam; castings on arms 1..4 (+x), crate at arm L (−x)
  vgBox(cx, 0, cz + 0.4, 0.4, 2.6, 0.4, vgMatIron);
  let nearTorque = 0, full = true; for (let i = 0; i < 4; i++) { if (st.hooks[i] < 0) { full = false; } else nearTorque += def.mass[st.hooks[i]] * (i + 1); }
  const beamTilt = (st.solvedPuzzle || solved) ? 0 : (!full ? Math.sin(time * 0.6) * 0.03 : (nearTorque > def.M * def.L ? 0.18 : nearTorque < def.M * def.L ? -0.18 : 0));
  vgBox(cx, 2.5, cz + 0.4, 6.4, 0.2, 0.3, vgMatWood, 0, 0, beamTilt);
  for (let i = 0; i < 4; i++) { const hx = cx + 0.62 * (i + 1); vgBox(hx, 2.0, cz + 0.4, 0.04, 0.9, 0.04, vgMatIron); vgBox(hx, 1.55, cz + 0.4, 0.16, 0.06, 0.16, vgMatBrassLt); }   // hook + arm stamp
  // the crate at arm L on the far side, over the pit; lowers on solve
  const crateY = (st.solvedPuzzle || solved) ? Math.max(-1.4, 1.6 - st.crate * 0.9) : 1.6;
  const clx = cx - 0.62 * def.L;
  if (!solved) { vgBox(clx, crateY, cz + 0.4, 0.9, 0.9, 0.9, vgMatWood); vgBox(clx, crateY + 0.5, cz + 0.4, 0.05, 0.5, 0.05, vgMatIron); }
  vgBox(cx - 2, -0.4, cz + 0.4, 1.6, 0.4, 1.6, vgMatGrime);   // the pit lip
  // pawl + ratchet by the fulcrum
  vgCylP(cx + 0.35, 1.7, cz + 0.4, 0.22, 0.08, vgMatIron, Math.PI / 2, (st.solvedPuzzle || solved) ? time * 3 : 0, 0);
  // assay scale, off to the left: beam + two pans, tilts toward the heavier pan
  const bx = cx - 4.1, bz = cz + 2;
  vgBox(bx, 0, bz, 0.24, 1.6, 0.24, vgMatIron);
  let sc = 0; if (st.placed[0] >= 0 && st.placed[1] >= 0) sc = Math.sign(def.mass[st.placed[0]] - def.mass[st.placed[1]]);
  st.tilt += (sc * 0.22 - st.tilt) * Math.min(1, (time * 0 + 0.12));
  vgBox(bx, 1.7, bz, 1.5, 0.1, 0.14, vgMatBrass, 0, 0, st.tilt);
  vgBox(bx - 0.55, 1.5 + st.tilt * 0.55, bz, 0.5, 0.06, 0.5, vgMatBrassLt);
  vgBox(bx + 0.55, 1.5 - st.tilt * 0.55, bz, 0.5, 0.06, 0.5, vgMatBrassLt);
  // assay placard on a post
  vgBox(cx + 3, 1.3, cz + 1.4, 0.12, 0.6, 0.5, vgMatStone);
  // the four castings, wherever they are (not the one in hand)
  for (let c = 0; c < 4; c++) { if (st.carrying === c) continue; const p = yardCastingPos(st, c, cx, cz); vgBox(p.x, p.y, p.z, 0.34 + c * 0.02, 0.3, 0.28, mats[c]); }
}
function yardStamp(def) { return 'CRATE stamped: ' + def.M + ' stone, hung at arm ' + def.L + ' — torque ' + (def.M * def.L) + '. The castings assay at 2, 3, 5 and 7 stone; rank them on the scale, then hang them on arms 1–4 so the crane hangs level.'; }
function runYard(site, dt, time, ePressed, eReleased, eDown) {
  const L = verge.loc.yard, st = verge.yard, def = L.def;
  const solvedSite = VERGE_SAVE.sitesSolved.yard;
  drawYardProps(L, st, def, time, solvedSite);
  verge.transientCarry = (st.carrying >= 0) ? 'casting' : (verge.transientCarry === 'casting' ? null : verge.transientCarry);
  if (dist2(L.x, L.z, player.pos.x, player.pos.z) < 13) once('verge-yard-intro', () => msg('A crane, a two-pan assay scale, and four blank castings. The stamped crate names the torque to match — but the castings only give up their weights on the scale.', 10));
  if (solvedSite) return;

  if (st.solvedPuzzle) {
    st.crate += dt;
    const coilX = L.x - 0.62 * def.L;
    if (st.crate > 1.6 && typeof pickupShow === 'function') pickupShow(coilX, 0.6, L.z + 0.4, 'coil', time);
    if (st.crate > 1.6 && dist2(coilX, L.z + 0.4, player.pos.x, player.pos.z) < 3.2) { hint('Press E — take the Condenser Coil', 0.4); if (ePressed) { verge.transientCarry = null; vergeCollectPiece('yard'); } }
    return;
  }

  const cx = L.x, cz = L.z;
  const pans = [{ x: cx - 4.6, z: cz + 2 }, { x: cx - 3.6, z: cz + 2 }];
  const hooks = []; for (let i = 0; i < 4; i++) hooks.push({ x: cx + 0.62 * (i + 1), z: cz + 0.4 });
  const placard = { x: cx + 3, z: cz + 1.4 }, crate = { x: cx - 0.62 * def.L, z: cz + 0.4 };

  if (ePressed) {
    if (st.carrying >= 0) {
      // holding a casting: place on empty pan/hook, swap on occupied, or drop
      const slots = pans.concat(hooks).map(s => ({ x: s.x, y: 1.4, z: s.z }));
      const pick = aimPick(slots, 3.6);
      if (pick >= 0) {
        const isPan = pick < 2, arr = isPan ? st.placed : st.hooks, idx = isPan ? pick : pick - 2;
        const prev = arr[idx]; arr[idx] = st.carrying; st.carrying = prev;   // place or swap
        if (vgAudible()) vgNote(prev >= 0 ? 260 : 200, 0.12, 0.05);
      } else { st.carrying = -1; if (vgAudible()) vgNote(150, 0.12, 0.05); }   // drop to the pile
    } else {
      // empty-handed: pick up a casting, or read the placard/crate
      const cworld = []; for (let c = 0; c < 4; c++) { const p = yardCastingPos(st, c, cx, cz); cworld.push({ x: p.x, y: p.y + 0.3, z: p.z }); }
      const pick = aimPick(cworld.concat([{ x: placard.x, y: 1.3, z: placard.z }, { x: crate.x, y: 1.4, z: crate.z }]), 3.6);
      if (pick >= 0 && pick < 4) { const c = pick; for (let k = 0; k < 2; k++) if (st.placed[k] === c) st.placed[k] = -1; for (let k = 0; k < 4; k++) if (st.hooks[k] === c) st.hooks[k] = -1; st.carrying = c; if (vgAudible()) vgNote(220, 0.12, 0.05); }
      else if (pick === 4 || pick === 5) msg(yardStamp(def), 11, true);
    }
  } else {
    if (st.carrying >= 0) hint('Carrying the ' + VG_CASTING_NAME[st.carrying] + ' — E on a scale-pan or a crane hook to set it down (E on nothing to drop it)', 0.4);
    else {
      const cworld = []; for (let c = 0; c < 4; c++) { const p = yardCastingPos(st, c, cx, cz); cworld.push({ x: p.x, y: p.y + 0.3, z: p.z }); }
      const near = aimPick(cworld.concat([{ x: placard.x, y: 1.3, z: placard.z }, { x: crate.x, y: 1.4, z: crate.z }]), 3.6);
      if (near >= 0 && near < 4) hint('The ' + VG_CASTING_NAME[near] + ' casting — E to lift it', 0.4);
      else if (near === 4 || near === 5) hint('Stamped crate / assay placard — E to read the torque to match', 0.4);
    }
  }

  // balance evaluation — a wrong full hang slams once; the unique balance held 3 s solves
  const full = st.hooks.every(h => h >= 0);
  const sig = st.hooks.join(',');
  if (sig !== st.lastSig) { st.lastSig = sig; st.held3 = 0; st.slamLatch = false; }
  if (full) {
    let T = 0; for (let i = 0; i < 4; i++) T += def.mass[st.hooks[i]] * (i + 1);
    if (T === def.M * def.L) {
      st.held3 += dt; hint('The crane hangs dead level — hold it… ' + Math.min(3, st.held3).toFixed(1) + ' s', 0.4);
      if (st.held3 >= 3) {
        st.solvedPuzzle = true; st.crate = 0;
        if (vgAudible()) { vgNote(200, 0.15, 0.05); setTimeout(() => vgNote(240, 0.15, 0.05), 120); setTimeout(() => vgNote(300, 0.3, 0.06), 260); }
        if (typeof msg === 'function') msg('The beam holds true. A pawl ticks along its ratchet, tooth by tooth, and the crate walks down into the pit — unlatching the Condenser Coil on its way.', 11, true);
      }
    } else if (!st.slamLatch) {
      st.slamLatch = true; st.slamT = time; VERGE_SAVE.attempts.yard = (VERGE_SAVE.attempts.yard | 0) + 1; vergeSave();
      if (vgAudible()) vgNote(110, 0.4, 0.06);
      if (typeof msg === 'function') msg('The crane lurches — the beam crashes down out of true, dust jumping off the rail. That torque doesn’t match the crate. (Re-rank on the scale; re-check the arms.)', 8);
    }
  }
}
/* ------------------------------------------------------------------------ */
/*  SITE 5 — THE NIGHT KILN (ashen quarter): night work + pressure rhythm.     */
/*  Cold by day. Borrow a flame at the lane lamp (a 90 s taper), light the       */
/*  pilot (persists), stoke the fire ×3, then crack the relief valve as the      */
/*  gauge needle crosses the brass band — its sweep has three per-seed speeds,    */
/*  slow across the band (window ≥ 450 ms). Three good vents step the flywheel    */
/*  and the screw-vault gives up the Cloud-Seed Censer. The red zone blows the    */
/*  fire out (restoke; the pilot survives).                                       */
/* ------------------------------------------------------------------------ */
function kilnNight() { return (typeof dayT === 'undefined') ? true : (dayT > 0.71 || dayT < 0.13); }
function kilnSpeed(def, n) { return n < def.bounds[0] ? def.speeds[0] : n < def.bounds[1] ? def.speeds[1] : def.speeds[2]; }
function kilnNeedleAngle(n) { return -1.2 + n * 2.4; }
function drawKilnProps(L, st, def, time, solved) {
  const cx = L.x, cz = L.z, lit = st.pilot || VERGE_SAVE.pilotLit;
  // kiln body + firebox door (glows when the pilot is in) + coal pile
  vgBox(cx, 0, cz, 2.4, 2.8, 2.0, vgMatStone);
  vgBox(cx, 1.6, cz, 1.4, 1.0, 0.3, vgMatIron);
  vgBox(cx, 0.6, cz + 1.05, 1.0, 0.8, 0.2, lit ? vgMatEmber : vgMatIron);          // firebox door
  if (lit) vgSpr(cx, 0.7, cz + 1.2, 0.5 + Math.sin(time * 9) * 0.08, 0.8, 0xff7a2a);   // fire glow
  vgBox(cx + 1.7, 0, cz + 0.8, 0.8, 0.5 + st.stoke * 0.12, 0.8, vgMatGrime);        // coal pile (grows as stoked)
  // pressure gauge: plate + brass band mark + red mark + needle
  const gx = cx - 1.4, gy = 2.0, gz = cz + 1.02;
  vgBox(gx, gy, gz, 0.7, 0.7, 0.1, vgMatStone);
  const bandMid = (def.bandLo + def.bandHi) / 2, redMid = (def.redLo + def.bounds[1]) / 2;
  vgBox(gx, gy, gz + 0.06, 0.05, 0.3, 0.02, vgMatMoss, 0, 0, kilnNeedleAngle(bandMid));   // brass/green band
  vgBox(gx, gy, gz + 0.06, 0.05, 0.3, 0.02, vgMatRed, 0, 0, kilnNeedleAngle(redMid));      // red zone
  vgBox(gx, gy, gz + 0.09, 0.04, 0.34, 0.03, vgMatBrassLt, 0, 0, kilnNeedleAngle(st.needle));  // needle
  // relief valve + flywheel (steps 1/3 per good vent) + screw-vault
  vgCylP(cx + 0.9, 1.9, cz + 1.05, 0.16, 0.3, vgMatBrass, Math.PI / 2, 0, 0);
  vgCylP(cx - 0.9, 1.2, cz + 1.05, 0.4, 0.14, vgMatBrass, 0, 0, (st.vents / 3) * 2.09 + ((st.solvedPuzzle || solved) ? time * 3 : 0));
  const vaultOpen = st.solvedPuzzle || solved;
  vgBox(cx, 1.4, cz - 1.05, 1.0, 1.0, 0.24, vgMatIron, 0, vaultOpen ? 1.1 : 0, 0);   // screw-vault hatch (swings open)
  // the lane lamp — the working flame to borrow
  vgBox(cx - 3.4, 0, cz + 1.5, 0.18, 2.6, 0.18, vgMatIron);
  vgBox(cx - 3.4, 2.6, cz + 1.5, 0.4, 0.4, 0.4, kilnNight() ? vgMatEmber : vgMatIron);
  if (kilnNight()) vgSpr(cx - 3.4, 2.7, cz + 1.5, 0.7, 0.7, 0xffcf7a);
}
function kilnVent(st, def, time) {
  const n = st.needle;
  if (n >= def.bandLo && n <= def.bandHi) {                       // good vent
    st.vents++; st.chuffT = time; if (vgAudible()) vgNote(300 + st.vents * 60, 0.3, 0.07);
    if (typeof msg === 'function') msg('You crack the valve on the beat — a clean CHUFF of steam, and the flywheel jolts a third of a turn. (' + st.vents + ' / 3)', 6);
    if (st.vents >= 3) {
      st.solvedPuzzle = true;
      if (vgAudible()) { vgNote(360, 0.3, 0.06); setTimeout(() => vgNote(240, 0.5, 0.06), 160); }
      if (typeof msg === 'function') msg('On the third stroke the flywheel spins free, the screw-vault backs open with a long metallic sigh, and the Cloud-Seed Censer swings out on its chain.', 11, true);
    }
  } else if (n > def.redLo && n < def.bounds[1]) {                // red zone → blowout
    st.shriekT = time; st.stoke = 0; VERGE_SAVE.attempts.kiln = (VERGE_SAVE.attempts.kiln | 0) + 1; vergeSave();
    if (vgAudible()) vgNote(90, 0.6, 0.07);
    if (typeof msg === 'function') msg('Too late — the needle’s in the red. The kiln SHRIEKS and blows its fire out in a gout of soot. (The pilot holds; stoke it up again.)', 8);
  } else {                                                        // early/late → harmless dump
    if (vgAudible()) vgNote(180, 0.2, 0.05);
    if (typeof msg === 'function') msg('The valve dumps a harmless puff of steam — the needle wasn’t on the band. Watch its slow crossing.', 6);
  }
}
function runKiln(site, dt, time, ePressed, eReleased, eDown) {
  const L = verge.loc.kiln, st = verge.kiln, def = L.def;
  const solvedSite = VERGE_SAVE.sitesSolved.kiln;
  drawKilnProps(L, st, def, time, solvedSite);
  if (solvedSite) return;

  if (st.solvedPuzzle) {
    if (typeof pickupShow === 'function') pickupShow(L.x, 1.4 + Math.sin(time * 1.4) * 0.12, L.z - 1.2, 'censer', time);
    if (dist2(L.x, L.z - 1.2, player.pos.x, player.pos.z) < 3.0) { hint('Press E — take the Cloud-Seed Censer', 0.4); if (ePressed) vergeCollectPiece('kiln'); }
    return;
  }

  if (!kilnNight()) {
    if (dist2(L.x, L.z, player.pos.x, player.pos.z) < 10) { once('verge-kiln-day', () => msg('The kiln stands stone-cold. A chalked board by the door reads: NIGHT FIRING ONLY — the draught won’t draw till the air cools. Come back at dusk.', 9)); hint('The Night Kiln — cold by day. Return after dusk.', 0.4); }
    return;
  }

  // taper burn-down (90 s); expiry means relight at the lamp
  if (st.taperLit) { st.taperFrac -= dt / 90; if (st.taperFrac <= 0) { st.taperLit = false; st.taperFrac = 0; if (typeof msg === 'function') msg('The taper gutters out to a thread of smoke. Borrow another flame from the lamp.', 6); } }
  // needle sweeps only while the fire is up (stoked)
  if (st.stoke >= 3) { st.needle += kilnSpeed(def, st.needle) * dt; if (st.needle >= 1) st.needle -= 1; } else st.needle = 0;

  const lamp = { x: L.x - 3.4, y: 2.4, z: L.z + 1.5 }, firebox = { x: L.x, y: 1.0, z: L.z + 1.05 };
  const coal = { x: L.x + 1.7, y: 1.0, z: L.z + 0.8 }, valve = { x: L.x + 0.9, y: 1.9, z: L.z + 1.05 };
  const cands = [lamp, firebox, coal, valve];

  if (ePressed) {
    const pick = aimPick(cands, 3.4);
    if (pick === 0) { st.taperLit = true; st.taperFrac = 1; if (vgAudible()) vgNote(360, 0.15, 0.05); msg('You touch the taper to the lamp and it takes — a small, urgent flame. It won’t last; move.', 6); }
    else if (pick === 1) {
      if (VERGE_SAVE.pilotLit || st.pilot) msg('The pilot’s already lit and holding.', 4);
      else if (st.taperLit && st.taperFrac > 0) { st.pilot = true; VERGE_SAVE.pilotLit = true; vergeSave(); if (vgAudible()) vgNote(220, 0.3, 0.06); msg('You reach the taper into the firebox and the pilot catches with a soft WHUMP. That flame will hold now, taper or no. Stoke it up.', 8); }
      else msg('The firebox is dark. You need a live flame — borrow one from the lamp on its taper.', 6);
    }
    else if (pick === 2) {
      if (!(VERGE_SAVE.pilotLit || st.pilot)) msg('No fire to feed. Light the pilot first.', 5);
      else if (st.stoke < 3) { st.stoke++; if (vgAudible()) vgNote(150, 0.2, 0.05); msg(st.stoke >= 3 ? 'You bank the coals high — the fire roars up and the pressure needle begins to climb and fall.' : 'You feed the firebox. The coals catch and glow. (' + st.stoke + ' / 3)', 6); }
      else msg('The fire’s already roaring.', 4);
    }
    else if (pick === 3) {
      if (!(VERGE_SAVE.pilotLit || st.pilot) || st.stoke < 3) msg('The relief valve won’t answer — there’s no pressure yet. Light the pilot and stoke the fire.', 6);
      else kilnVent(st, def, time);
    }
    return;
  }
  const near = aimPick(cands, 3.4);
  if (near === 0) hint(st.taperLit ? 'The lane lamp — your taper’s already lit' : 'The lane lamp — E to borrow a flame on a taper', 0.4);
  else if (near === 1) hint((VERGE_SAVE.pilotLit || st.pilot) ? 'The firebox — pilot lit' : 'The firebox — E to light the pilot (needs a lit taper)', 0.4);
  else if (near === 2) hint((VERGE_SAVE.pilotLit || st.pilot) ? ('The coal pile — E to stoke (' + st.stoke + ' / 3)') : 'The coal pile — light the pilot first', 0.4);
  else if (near === 3) hint(st.stoke >= 3 ? 'The relief valve — E to vent as the needle crosses the band' : 'The relief valve — no pressure yet', 0.4);
}
/* ------------------------------------------------------------------------ */
/*  THE VERGE GATE (scorch boundary): assemble, then wake the Engine.          */
/*  Seat each movement on the pedestal stamped with its cast mark (a mismatch   */
/*  shivers out). With all five seated the three startup handles unlock; pull    */
/*  PRIME/SPIN/SEED in the lintel's order (the satchel motto is a second path).  */
/*  Right order → staged startup: flywheel spin-up, a seeding charge to the mast, */
/*  a scripted LONG RAIN over the burnt edge, a permanent beacon + a green line   */
/*  along the boundary, and the Warden's Whistle. Wrong order coughs soot.        */
/* ------------------------------------------------------------------------ */
const VG_MARK_MAT = [
  new THREE.MeshStandardMaterial({ color: 0xb06a3a, roughness: 0.6, metalness: 0.3 }),
  new THREE.MeshStandardMaterial({ color: 0x4a7fae, roughness: 0.6, metalness: 0.3 }),
  new THREE.MeshStandardMaterial({ color: 0x7aa64a, roughness: 0.6, metalness: 0.3 }),
  new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.6, metalness: 0.3 }),
  new THREE.MeshStandardMaterial({ color: 0x9a6bc0, roughness: 0.6, metalness: 0.3 })
];
function gatePedPos(g, k) { return { x: g.x + (k - 2) * 1.5, y: 1.0, z: g.z + 2.7 - Math.abs(k - 2) * 0.3 }; }
function gateHandlePos(g, h) { return { x: g.x + (h - 1) * 1.3, y: 1.75, z: g.z + 0.5 }; }
function gateLintelPos(g) { return { x: g.x, y: 3.5, z: g.z - 0.2 }; }
function gatePieceIdxOfKind(kind) { return PIECE_OF_SITE_IDX[Object.keys(SITE_PIECE).find(s => SITE_PIECE[s] === kind)]; }
function gateSeatedIdxAt(gen, k) {
  const mark = gen.pedestal[k];
  for (const s of VERGE_SITES) { const idx = PIECE_OF_SITE_IDX[s]; if (gen.marks[idx] === mark) { const kind = SITE_PIECE[s]; return (VERGE_SAVE.pieces.seated.indexOf(kind) >= 0) ? idx : -1; } }
  return -1;
}
function gateLintelText(gen) {
  return 'The lintel is cut with three maker’s-marks, left to right — the waking order:  ' +
    gen.order.map(o => VERGE_MARKS[gen.handleMark[o]]).join('  →  ') +
    '   (' + gen.order.map(o => VG_HANDLES[o]).join(' → ') + ').';
}
function drawGateProps(L, st, time, done) {
  const gx = L.x, gz = L.z, gen = L.gen;
  const running = done || st.started;
  // machine body, mast, flywheel, glass rose, pipe ring
  vgBox(gx, 0, gz, 2.6, 3.0, 1.4, vgMatIron);
  vgBox(gx, 0, gz, 3.2, 0.5, 2.0, vgMatStone);
  vgCylP(gx, 4.5, gz, 0.12, 3.0, vgMatIron);                                   // seeding mast
  vgCylP(gx - 1.0, 1.6, gz + 0.75, 0.6, 0.16, vgMatBrass, 0, 0, running ? st.spin : 0);   // flywheel
  vgCylP(gx, 6.0, gz, 0.4, 0.5, running ? vgMatGlass : vgMatGlass, Math.PI / 2, time * 0.4, 0);   // glass rose atop the mast
  for (let a = 0; a < 6; a++) { const an = a / 6 * Math.PI * 2; vgBox(gx + Math.cos(an) * 1.5, 2.4, gz + Math.sin(an) * 0.9, 0.16, 0.16, 0.16, vgMatBrassLt); }   // pipe ring
  // lintel with the three order marks (tinted plates in pull order)
  const lp = gateLintelPos(L);
  vgBox(lp.x, lp.y, lp.z, 3.4, 0.5, 0.3, vgMatStone);
  for (let n = 0; n < 3; n++) vgBox(lp.x - 1 + n * 1, lp.y, lp.z + 0.18, 0.34, 0.34, 0.06, VG_MARK_MAT[gen.handleMark[gen.order[n]]]);
  // five pedestals, each stamped with its mark; seated pieces sit on top
  for (let k = 0; k < 5; k++) {
    const p = gatePedPos(L, k);
    vgBox(p.x, 0, p.z, 0.7, 1.0, 0.7, vgMatStone);
    vgBox(p.x, 1.02, p.z, 0.5, 0.08, 0.5, VG_MARK_MAT[gen.pedestal[k]]);         // mark collar
    const seated = gateSeatedIdxAt(gen, k);
    if (seated >= 0) { vgCylP(p.x, 1.3, p.z, 0.2, 0.3, vgMatBrass, 0, 0, running ? time * 2 : 0); vgBox(p.x, 1.55, p.z, 0.28, 0.14, 0.2, vgMatBrassLt); }
  }
  // three startup handles on the machine face (glow once unlocked)
  const unlocked = VERGE_SAVE.pieces.seated.length >= 5;
  for (let h = 0; h < 3; h++) { const hp = gateHandlePos(L, h); const pulled = st.handlePulls.indexOf(h) >= 0; vgBox(hp.x, hp.y - 0.4, hp.z, 0.1, 0.8, 0.1, vgMatIron); vgBox(hp.x, hp.y + (pulled ? -0.15 : 0.1), hp.z, 0.22, 0.22, 0.16, unlocked ? VG_MARK_MAT[gen.handleMark[h]] : vgMatGrime); }
  // startup effects + permanent aftermath
  if (st.started && !done) {
    if (st.charged) vgSpr(gx, 6.2 + Math.min(6, (st.startT - 1.4) * 4), gz, 1.0, Math.max(0, 1 - (st.startT - 1.4) * 0.3), 0xbfe6ff);   // seeding charge climbs the mast
    if (st.plumeFallback) vgSpr(gx, 8 + Math.sin(time * 2) * 0.5, gz, 3.0, 0.4, 0x9fb6c8);
  }
  if (done || st.finished) {
    vgBox(gx + 2.2, 0, gz + 2.2, 0.2, 4.0, 0.2, vgMatIron);                       // beacon post
    vgSpr(gx + 2.2, 4.2, gz + 2.2, 1.4 + Math.sin(time * 2.5) * 0.15, 0.9, 0x8affd0);   // permanent beacon
    for (let q = 0; q < 4; q++) vgBox(gx - 9 + q * 6, 0.06, gz + 0.1, 5.5, 0.04, 0.5, vgMatMoss);   // glow-moss line along the edge
  }
}
function gateBeginStartup(st, time) {
  st.started = true; st.startT = 0; st.spin = 0; st.synthStage = 0; st.charged = false; st.stormed = false; st.finished = false; st.plumeFallback = false;
  if (typeof msg === 'function') msg('The handles bite home in order. Deep in the machine something long-stopped turns over — and keeps turning.', 9, true);
}
function gateFinish(L) {
  VERGE_SAVE.gateDone = true;
  // any still-held pieces are now part of the running Engine
  for (const k of VERGE_SAVE.pieces.held.slice()) if (VERGE_SAVE.pieces.seated.indexOf(k) < 0) VERGE_SAVE.pieces.seated.push(k);
  VERGE_SAVE.pieces.held = [];
  if (typeof carryHide === 'function') carryHide();
  if (!VERGE_SAVE.whistle) { VERGE_SAVE.whistle = true; if (typeof invAdd === 'function' && !invHas('vg_whistle')) invAdd('vg_whistle', 1); }
  vergeSave();
  if (typeof msg === 'function') msg('Rain — real rain — walks in across the scorched ground, hissing where it lands, and the glass rose over the mast burns steady green. The edge will hold. The Edgewright presses a bone-and-brass whistle into your hand: “Warden, now. Safe roads.”', 14, true);
  if (typeof hint === 'function') hint('The Verge Engine runs. The edge holds.', 4);
}
function runGate(site, dt, time, ePressed, eReleased, eDown) {
  const L = verge.loc.gate; if (!L) return; const gen = L.gen, st = verge.gate;
  const done = VERGE_SAVE.gateDone;
  drawGateProps(L, st, time, done);
  if (done) return;

  // staged startup timeline
  if (st.started) {
    st.startT += dt; st.spin += dt * (1.5 + st.startT * 3.5);
    while (st.synthStage < 6 && st.startT > st.synthStage * 0.28) { if (vgAudible()) vgNote(180 + st.synthStage * 70, 0.25, 0.05); st.synthStage++; }
    if (st.startT > 1.4 && !st.charged) { st.charged = true; if (vgAudible()) vgNote(520, 0.4, 0.07); if (typeof msg === 'function') msg('A charge races up the mast and bursts off the glass rose with a flat crack, out into the low cloud.', 8); }
    if (st.startT > 2.1 && !st.stormed) { st.stormed = true; const ok = (typeof wxScripted === 'function') && wxScripted('storm'); st.plumeFallback = !ok; if (!ok && typeof msg === 'function') msg('The sky is already busy — but a grey seeding-plume climbs from the mast all the same.', 7); }
    if (st.startT > 2.8 && !st.finished) { st.finished = true; gateFinish(L); }
    return;
  }

  const allSeated = VERGE_SAVE.pieces.seated.length >= 5;

  // interaction: seat pieces, read the lintel, pull handles
  const peds = []; for (let k = 0; k < 5; k++) { const p = gatePedPos(L, k); peds.push({ x: p.x, y: 1.1, z: p.z }); }
  const handles = []; for (let h = 0; h < 3; h++) { const hp = gateHandlePos(L, h); handles.push({ x: hp.x, y: hp.y, z: hp.z }); }
  const lp = gateLintelPos(L); const lintel = { x: lp.x, y: lp.y, z: lp.z };

  if (ePressed) {
    if (!allSeated) {
      const pick = aimPick(peds.concat([lintel]), 3.6);
      if (pick >= 0 && pick < 5) gateTrySeat(gen, st, pick);
      else if (pick === 5) msg(gateLintelText(gen), 11, true);
    } else {
      const pick = aimPick(handles.concat([lintel]), 3.6);
      if (pick >= 0 && pick < 3) gatePullHandle(gen, st, pick, time);
      else if (pick === 3) msg(gateLintelText(gen), 11, true);
    }
    return;
  }
  // aim hints
  if (!allSeated) {
    const near = aimPick(peds.concat([lintel]), 3.6);
    if (near >= 0 && near < 5) { const kind = vgHandPiece(); hint('Pedestal stamped ' + VERGE_MARKS[gen.pedestal[near]] + (kind ? (' — E to seat ' + PIECE_NAME[kind]) : ' — (no movement in hand)'), 0.4); }
    else if (near === 5) hint('The Gate lintel — E to read the waking order', 0.4);
    else if (dist2(L.x, L.z, player.pos.x, player.pos.z) < 8) hint('Seat each movement on the pedestal cut with its mark (read a piece in the satchel for its mark).', 0.4);
  } else {
    const near = aimPick(handles.concat([lintel]), 3.6);
    if (near >= 0 && near < 3) hint('Startup handle ' + VG_HANDLES[near] + ' (mark ' + VERGE_MARKS[gen.handleMark[near]] + ') — E to pull', 0.4);
    else if (near === 3) hint('The Gate lintel — E to read the waking order', 0.4);
    else hint('All five movements seated. Pull the three handles in the lintel’s order.', 0.4);
  }
}
function gateTrySeat(gen, st, k) {
  if (gateSeatedIdxAt(gen, k) >= 0) { if (typeof msg === 'function') msg('That pedestal already holds its movement.', 4); return; }
  const kind = vgHandPiece();
  if (!kind) { if (typeof msg === 'function') msg('Your hands are empty — every movement you carried is seated. (Any still out there must be recovered first.)', 6); return; }
  const idx = gatePieceIdxOfKind(kind);
  if (gen.marks[idx] === gen.pedestal[k]) {
    // seat: held → seated
    const hi = VERGE_SAVE.pieces.held.indexOf(kind); if (hi >= 0) VERGE_SAVE.pieces.held.splice(hi, 1);
    if (VERGE_SAVE.pieces.seated.indexOf(kind) < 0) VERGE_SAVE.pieces.seated.push(kind);
    vergeSave();
    if (vgAudible()) vgNote(300, 0.25, 0.06);
    _vergeSyncCarry();
    const n = VERGE_SAVE.pieces.seated.length;
    if (typeof msg === 'function') msg(PIECE_NAME[kind] + ' drops into the ' + VERGE_MARKS[gen.pedestal[k]] + ' collar and locks with a satisfying clunk. (' + n + ' / 5 seated)' + (n >= 5 ? ' The three startup handles fall free.' : ''), 8, n >= 5);
  } else {
    if (vgAudible()) vgNote(150, 0.2, 0.05);
    if (typeof msg === 'function') msg('The ' + VERGE_MARKS[gen.marks[idx]] + ' movement shivers half-into the ' + VERGE_MARKS[gen.pedestal[k]] + ' collar and clunks back out — wrong mark. It seats only where its own mark is stamped.', 8);
  }
}
function gatePullHandle(gen, st, h, time) {
  if (st.handlePulls.indexOf(h) >= 0) return;
  st.handlePulls.push(h);
  if (vgAudible()) vgNote(240 + st.handlePulls.length * 40, 0.2, 0.06);
  if (typeof msg === 'function') msg('You haul the ' + VG_HANDLES[h] + ' handle (mark ' + VERGE_MARKS[gen.handleMark[h]] + ') down. It latches.', 5);
  if (st.handlePulls.length >= 3) {
    const correct = st.handlePulls.every((x, i) => x === gen.order[i]);
    if (correct) gateBeginStartup(st, time);
    else {
      VERGE_SAVE.attempts.gate = (VERGE_SAVE.attempts.gate | 0) + 1; vergeSave();
      st.handlePulls = [];
      if (vgAudible()) vgNote(90, 0.5, 0.07);
      if (typeof msg === 'function') msg('The machine coughs, gouts soot, and spins itself back down — wrong order. The handles reset. (Read the lintel, or your pieces’ motto, and try the order again.)', 9);
    }
  }
}

/* ======================================================================== */
/*  E-INTERACT (player.js E-chain: story > ciphers > VERGE > pages > ...)     */
/*  Returns true iff it consumed E. Edgewright talk happens here; site work    */
/*  happens in updateVerge via key edges, so a near-site E is consumed here    */
/*  (blocking the trial-master/giver) while the update does the work.          */
/* ======================================================================== */
function vergeInteract() {
  if (typeof player === 'undefined' || !verge.loc) return false;
  if (atEdgewright(3.6)) { vergeEdgewrightTalk(); return true; }
  const site = nearestVergeSite();
  if (site && site.d < (site.id === 'gate' ? 6 : 4.2)) return true;   // consume; updateVerge acts
  return false;
}

/* ======================================================================== */
/*  LEAD hooks — read by main.js (all typeof-guarded there).                  */
/* ======================================================================== */
function vergeUnfinished() { return !VERGE_SAVE.gateDone; }
function vergeUnsolvedSites() { if (!verge.loc) vergeLocate(); if (!verge.loc) return []; return VERGE_SITES.filter(s => !VERGE_SAVE.sitesSolved[s] && verge.loc[s]).map(s => ({ id: s, x: verge.loc[s].x, z: verge.loc[s].z })); }
function vergeNearestUnsolved(px, pz) {
  const list = vergeUnsolvedSites(); if (!list.length) return null;
  let best = null, bd = 1e18; for (const s of list) { const d = dist2(s.x, s.z, px, pz); if (d < bd) { bd = d; best = s; } }
  return best ? Object.assign({}, best, { rumor: SITE_RUMOR[best.id], name: SITE_NAME[best.id] }) : null;
}
function vergeSiteName(id) { return SITE_NAME[id] || 'a contraption site'; }
function vergeSiteProgress(id) { return VERGE_SAVE.sitesSolved[id] ? 'Recovered' : ('Find the ' + (SITE_PIECE[id] ? PIECE_NAME[SITE_PIECE[id]] : 'movement')); }
function vergeLeadIntroNeeded() { return !VERGE_SAVE.leadIntro; }
function vergeMarkLeadIntro() { VERGE_SAVE.leadIntro = true; VERGE_SAVE.started = true; vergeSave(); }
function vergeGateReady() { return VERGE_SAVE.gateRevealed && !VERGE_SAVE.gateDone; }
function vergeGatePos() { return (verge.loc && verge.loc.gate) ? verge.loc.gate : null; }

/* ======================================================================== */
/*  DEV / SMOKE-TEST HOOK — ?verge=pump|belfry|signal|yard|kiln|gate teleports  */
/*  the player to that site with the pieces needed. Guarded so ?shot is inert.  */
/* ======================================================================== */
(function vergeDevJump() {
  if (typeof SHOT !== 'undefined' && SHOT) return;
  const q = params.get('verge');
  if (!q || q === '1' || q === 'debug') { return; }   // ?verge=1 only turns on the locate log
  VERGE_SAVE.met = true; VERGE_SAVE.started = true; vergeSave();
  vergeLocate(); const L = verge.loc; if (!L) return;
  if (q === 'gate') {
    // grant all five pieces held so the gate is assemblable
    for (const s of VERGE_SITES) { const k = SITE_PIECE[s]; if (VERGE_SAVE.pieces.held.indexOf(k) < 0 && VERGE_SAVE.pieces.seated.indexOf(k) < 0) { VERGE_SAVE.pieces.held.push(k); VERGE_SAVE.sitesSolved[s] = true; if (typeof invAdd === 'function' && !invHas(PIECE_ITEM[k])) invAdd(PIECE_ITEM[k], 1, vgPieceNote(k)); } }
    vergeSave();
    player.pos.set(L.gate.x, 0, L.gate.z + 9); player.yaw = 0;   // face -z, toward the Gate
  } else if (L[q]) {
    player.pos.set(L[q].x, (L[q].y || 0), L[q].z + 12); player.yaw = 0;   // face -z, toward the site
    if (q === 'kiln' && typeof dayT !== 'undefined') dayT = 0.80;         // dusk, so the night kiln is workable to inspect
  }
  if (typeof ensureChunks === 'function') ensureChunks(player.pos.x, player.pos.z, true);
})();
