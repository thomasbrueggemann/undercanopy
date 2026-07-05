/* CANOPY split file  story: "The Second Seed" — a 7-chapter campaign. Loaded LAST (after
   main.js) so it can call into every system. Mirrors the Trials house pattern: a state object,
   a switch in updateStory over story.ch/story.phase, pure-hash ring-scan finders (each with a
   widened-radius fallback so no chapter soft-locks), a pooled marker set (STORY_POOL), and HUD
   writers. Persistence is STORY_SAVE (bootstrapped in core.js so worldgen can read it first);
   this file owns all writes to it. */
'use strict';

/* ======================================================================== */
/*  STATE                                                                    */
/* ======================================================================== */
const STORY_TITLE = { 1: 'THE DEAD BROADCAST', 2: 'SHARDS OF NOON', 3: 'THE FLOODED ARCHIVE', 4: 'THE HELIOGRAPH', 5: "THE WARDEN'S KEY", 6: 'THE ROOT VAULT', 7: 'THE SCORCH BLOOM' };
const STORY_TITLE_FULL = { 1: 'Ch.1 — The Dead Broadcast', 2: 'Ch.2 — Shards of Noon', 3: 'Ch.3 — The Flooded Archive', 4: 'Ch.4 — The Heliograph', 5: "Ch.5 — The Warden's Key", 6: 'Ch.6 — The Root Vault', 7: 'Ch.7 — The Scorch Bloom' };
// Each shard's etched fragment foreshadows one third of the Ch4 bearing riddle (order = plaza, reservoir, nest).
const SHARD_LINES = [
  'The plaza shard, warm from noon: etched along its cut — “…the beam runs from the mouth of the tower…”',
  'The roof-lake shard, cold and dripping: “…the way the long shadow points at the top of the day…”',
  'The crown-nest shard, high in the wind: “…count the spans the years have eaten, and stop where they end.”'
];

const story = {
  ch: STORY_SAVE.ch, active: false, phase: '', stuck: false,
  shards: STORY_SAVE.shards | 0, haveKey: !!STORY_SAVE.haveKey, haveSeed: !!STORY_SAVE.haveSeed,
  title: 'The Second Seed', label: '✦ THE SECOND SEED', obj: '', reminder: '',
  // per-chapter scratch, set at chapter start / phase transitions
  hall: null, targets: null, resvCh2: null, resv: null, fallen: null, via: null, broken: null,
  gateAlong: 0, cpIdx: 0, nCp: 3, sockets: null, socketsFilled: null, vault: null, bearing: '',
  beamT: 0, rphase: '', wp: null, cross: null, knots: null, knotSeq: null, knotStep: 0, heart: null, plantT: 0
};
var storyCarrying = false;   // read by player.js (var → no cross-file TDZ): disables sprint while carrying the Seed
let storyPaused = false;     // true while a trial or errand owns the HUD; story progress freezes but is never lost

function saveStory() {
  STORY_SAVE.ch = story.ch; STORY_SAVE.shards = story.shards;
  STORY_SAVE.haveKey = story.haveKey; STORY_SAVE.haveSeed = story.haveSeed;
  try { localStorage.setItem('canopy.story', JSON.stringify(STORY_SAVE)); } catch (e) { }
}

/* ======================================================================== */
/*  MARKERS (own pool + materials — never fight the trial markers)           */
/* ======================================================================== */
const matStoryGold = new THREE.MeshBasicMaterial({ color: 0xffdf7a, fog: false });   // objective / relic (like matRelic)
const matStoryGreen = new THREE.MeshBasicMaterial({ color: 0x6fe86f, fog: false });   // sockets / knots / growth
const STORY_POOL = Array.from({ length: 6 }, () => {
  const m = new THREE.Mesh(tplBlob, matStoryGold); m.scale.setScalar(0.6); m.visible = false; m.renderOrder = 5; scene.add(m); return m;
});
function setStoryMark(i, x, y, z, s, mat) {
  const m = STORY_POOL[i]; if (!m) return;
  m.position.set(x, y, z); m.scale.setScalar(s || 0.6); m.material = mat || matStoryGold; m.visible = true;
}
function hideStoryMarks() { for (const m of STORY_POOL) m.visible = false; }
function smark(i, x, y, z, s, mat) { if (!storyPaused) setStoryMark(i, x, y, z, s, mat); }
function sObj(t) { if (!storyPaused) activeObjective = t; }

// The Ch4 heliograph beam: ONE scene-level thin emissive cylinder, created once, hidden when idle.
const matStoryBeam = new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false, transparent: true, opacity: 0.7 });
let storyBeam = null;
function ensureBeam() {
  if (!storyBeam) { storyBeam = new THREE.Mesh(tplCyl, matStoryBeam); storyBeam.visible = false; storyBeam.matrixAutoUpdate = false; scene.add(storyBeam); }
  return storyBeam;
}

/* ======================================================================== */
/*  THE ARCHIVIST (giver NPC — one deterministic anchor at the spire base)    */
/* ======================================================================== */
let archivist = null;
function syncArchivist(dt) {
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  const near = Math.abs(cx - SPIRE.cx) <= 1 && Math.abs(cz - SPIRE.cz) <= 1;   // spire chunk within the 3×3 window
  if (near && !archivist) {
    const { g, anim } = makeNPCGroup(false, 'archivist');
    g.position.set(SPIRE.x + 14, 0, SPIRE.z + 6);                              // off the spire footprint
    g.rotation.y = Math.atan2(SPIRE.x - (SPIRE.x + 14), SPIRE.z - (SPIRE.z + 6));  // facing the tower
    scene.add(g); archivist = { g, anim };
  } else if (!near && archivist) { scene.remove(archivist.g); archivist = null; }
  if (archivist) {
    const d = dist2(archivist.g.position.x, archivist.g.position.z, player.pos.x, player.pos.z);
    if (d < 18) {   // turn to face the player, gently (mirrors the trial-master face code)
      const y = Math.atan2(player.pos.x - archivist.g.position.x, player.pos.z - archivist.g.position.z);
      let dy = y - archivist.g.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      archivist.g.rotation.y += dy * Math.min(1, 6 * (dt || 0.016));
    }
    if (archivist.anim) archivist.anim.material.emissiveIntensity = matLamp.emissiveIntensity + 0.4;
  }
}
function atArchivist(r) { return archivist && dist2(archivist.g.position.x, archivist.g.position.z, player.pos.x, player.pos.z) < (r || 3.4); }

/* ======================================================================== */
/*  FINDERS (pure-hash ring scans + peek; run only at phase transitions)     */
/*  Every finder returns a target or null; callers wrap null in resolve()/    */
/*  orSpire() so no chapter can dead-end.                                     */
/* ======================================================================== */
function playerChunk() { return { cx: Math.floor(player.pos.x / CHUNK), cz: Math.floor(player.pos.z / CHUNK) }; }
function rangeBlocks() { return 4 + hash2(SPIRE.cx, SPIRE.cz, 4444) % 3; }   // 4..6, deterministic (Ch3 count / Ch4 clue)

// Nearest chunk of `type` in a Chebyshev ring scan from (cx,cz), with optional min ring + exclusion.
function nearestTypeFrom(cx, cz, type, maxR, minR, exclude) {
  for (let r = (minR || 0); r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ix = cx + dx, iz = cz + dz;
      if (chunkType(ix, iz) !== type) continue;
      if (exclude && ix === exclude.ix && iz === exclude.iz) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = { ix, iz }; }
    }
    if (best) return best;
  }
  return null;
}
// Read a chunk's openRect without keeping it (mirrors peekColData, but returns the sky-open rect).
function peekOpenRect(ix, iz) {
  const c = chunks.get(chunkKey(ix, iz));
  if (c) return c.openRect;
  const built = buildChunk(ix, iz);
  built.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  return built.openRect;
}
// Ch1: nearest oldtown district hall — a plaza-most point, else the chunk centre.
function findOldtownHall() {
  const { cx, cz } = playerChunk();
  for (let r = 0; r <= 16; r++) {
    let best = null, bd = 1e9;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ix = cx + dx, iz = cz + dz;
      if (districtStyle(ix, iz) !== 'oldtown') continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = { ix, iz }; }
    }
    if (best) {
      const o = peekOpenRect(best.ix, best.iz);
      if (o) return { x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2, y: 0 };
      return { x: best.ix * CHUNK + 32, z: best.iz * CHUNK + 32, y: 0 };
    }
  }
  return null;
}
// Ch2a: nearest plaza openRect centre (≥2 chunks off so it's a real run).
function findPlazaOpen() {
  const { cx, cz } = playerChunk();
  const p = nearestTypeFrom(cx, cz, 'plaza', 18, 2);
  if (!p) return null;
  const o = peekOpenRect(p.ix, p.iz);
  if (o) return { ix: p.ix, iz: p.iz, x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 };
  return { ix: p.ix, iz: p.iz, x: p.ix * CHUNK + 32, z: p.iz * CHUNK + 32 };
}
// Ch2b/Ch3: nearest reservoir roof (parapet y≈8). exclude = a reservoir chunk to skip.
function findReservoir(minR, exclude) {
  const { cx, cz } = playerChunk();
  const rv = nearestTypeFrom(cx, cz, 'reservoir', 20, minR || 0, exclude);
  if (!rv) return null;
  return { ix: rv.ix, iz: rv.iz, x: rv.ix * CHUNK + 32, z: rv.iz * CHUNK + 32, y: 8 };
}
// Ch2c: nearest crown-nest pad — loaded chunks first, then a ring-peek of grove/colossus chunks.
function findNestPad() {
  let best = null, bd = 1e9;
  for (const c of chunks.values()) for (const p of c.colData.pads) {
    if (p.layer !== 'nest') continue;
    const d = dist2(p.x, p.z, player.pos.x, player.pos.z);
    if (d > 20 && d < bd) { bd = d; best = { x: p.x, z: p.z, y: p.y }; }
  }
  if (best) return best;
  const { cx, cz } = playerChunk();
  for (let r = 1; r <= 16; r++) {
    let hit = null, hd = 1e9;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ix = cx + dx, iz = cz + dz, t = chunkType(ix, iz);
      if (t !== 'grove' && t !== 'colossus') continue;
      const cd = peekColData(ix, iz);
      for (const p of cd.pads) if (p.layer === 'nest') { const d = dx * dx + dz * dz; if (d < hd) { hd = d; hit = { x: p.x, z: p.z, y: p.y }; } }
    }
    if (hit) return hit;
  }
  return null;
}
// Ch3: nearest fallen tower — the top of its walkable ramp (highest 'fallen' pad).
function findFallenTop() {
  const { cx, cz } = playerChunk();
  const f = nearestTypeFrom(cx, cz, 'fallen', 20, 0);
  if (!f) return null;
  const cd = peekColData(f.ix, f.iz);
  let best = null, by = -1e9;
  for (const p of cd.pads) if (p.layer === 'fallen' && p.y > by) { by = p.y; best = p; }
  if (best) return { x: best.x, z: best.z, y: best.y };
  return { x: f.ix * CHUNK + 32, z: f.iz * CHUNK + 32, y: 20 };
}
// Ch4/Ch6: the Root Vault sinkhole — SPIRE-relative & deterministic so both chapters agree.
function findVaultSinkhole() {
  let s = nearestTypeFrom(SPIRE.cx, SPIRE.cz, 'sinkhole', 14, 5);   // beam range ≥5 rings out
  if (!s) s = nearestTypeFrom(SPIRE.cx, SPIRE.cz, 'sinkhole', 22, 0);
  if (!s) return null;
  return { ix: s.ix, iz: s.iz, x: s.ix * CHUNK + 32, z: s.iz * CHUNK + 32 };
}
// Ch5: nearest point where a viaduct line crosses a canal line (pure hash intersection).
function findCrossing(maxR) {
  const { cx, cz } = playerChunk();
  for (let r = 0; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ix = cx + dx, iz = cz + dz;
      let canalAxis = null;                                   // 1 = canal runs in x (vary x); 0 = runs in z (vary z)
      if (hash2(ix, 0, 6001) % 7 === 0 && isCanalZ(iz)) canalAxis = 1;   // viaduct x-line × canal along z (runs in x)
      else if (hash2(0, iz, 6002) % 7 === 0 && isCanalX(ix)) canalAxis = 0;   // viaduct z-line × canal along x (runs in z)
      if (canalAxis === null) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = { ix, iz, canalAxis, x: ix * CHUNK, z: iz * CHUNK }; }
    }
    if (best) return best;
  }
  return null;
}
function canalPoint(cr, dist) { return cr.canalAxis === 1 ? { x: cr.x + dist, z: cr.z } : { x: cr.x, z: cr.z + dist }; }
// Ch7: heart of the nearest Scorch region — hill-descend verdancy from the nearest scorch chunk.
function findScorchHeart() {
  const { cx, cz } = playerChunk();
  let seed = null;
  for (let r = 0; r <= 22 && !seed; r++) for (let dx = -r; dx <= r && !seed; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    if (regionBiome(cx + dx, cz + dz) === 'scorch') { seed = { ix: cx + dx, iz: cz + dz }; break; }
  }
  if (!seed) return null;
  let ix = seed.ix, iz = seed.iz;
  for (let iter = 0; iter < 40; iter++) {                     // descend to a local verdancy minimum (deterministic)
    let bx = ix, bz = iz, bv = _verdancy(ix, iz);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const v = _verdancy(ix + dx, iz + dz); if (v < bv) { bv = v; bx = ix + dx; bz = iz + dz; }
    }
    if (bx === ix && bz === iz) break;
    ix = bx; iz = bz;
  }
  return { ix, iz, x: ix * CHUNK + 32, z: iz * CHUNK + 32 };
}

// Wrap a finder result: on failure, point the objective back at the Archivist with an apologetic
// line and flag a retry (re-accepting at the hub re-runs the scan) — the no-soft-lock guarantee.
function resolve(target, name) {
  if (target) { story.stuck = false; return target; }
  story.stuck = true;
  once('st-stuck-' + story.ch + '-' + name, () => msg('The Archivist frowns at the papers: “The trail’s gone faint just here. Come back to me — I’ll read it out again.”', 8, true));
  return { x: SPIRE.x + 14, z: SPIRE.z + 6, y: 0 };
}
function orSpire(t) { return t || { x: SPIRE.x + 14, z: SPIRE.z + 6, y: 0 }; }

/* ======================================================================== */
/*  CHAPTER FLOW                                                              */
/* ======================================================================== */
function startChapter(chained) {
  const s = story, ch = s.ch;
  s.active = true; s.stuck = false; s.title = STORY_TITLE_FULL[ch]; s.label = '✦ CH.' + ch + ' — ' + STORY_TITLE[ch];
  switch (ch) {
    case 1:
      s.phase = 'top'; s.hall = resolve(findOldtownHall(), 'hall');
      msg('The Archivist: “The Spire was a mouth once — the Authority spoke to every quarter through it. In the beacon room there is a sun-clock with an empty socket. Go up and read what is missing.”', 11, true);
      break;
    case 2: {
      s.phase = 'collect'; s.shards = 0;
      const plaza = orSpire(findPlazaOpen()), resv = findReservoir(2), nest = findNestPad();
      s.targets = [
        { x: plaza.x, z: plaza.z, y: 0, hi: false, got: false },
        resv ? { x: resv.x, z: resv.z, y: 8, hi: true, got: false } : { x: plaza.x + 4, z: plaza.z, y: 0, hi: false, got: false },
        nest ? { x: nest.x, z: nest.z, y: nest.y, hi: true, got: false } : { x: plaza.x - 4, z: plaza.z, y: 0, hi: false, got: false }
      ];
      s.resvCh2 = resv ? { ix: resv.ix, iz: resv.iz } : null;
      msg('The Archivist spreads a ledger: “Three shards of the sun-clock’s glass. One went up where only the sun still visits; one drowned in the roof-lake; one lies in the open square, in plain sight of noon. They only glint at noon — you’ll never find them in shade.”', 12, true);
      break;
    }
    case 3:
      s.phase = 'wade'; s.resv = resolve(findReservoir(2, s.resvCh2), 'reservoir');
      msg('The Archivist: “The sun-clock needs its alignment table — and that sank with the survey office, out under a roof-lake. Wade for it.”', 10, true);
      break;
    case 4:
      s.phase = 'sockets'; s.shards = 3;
      s.sockets = [0, 1, 2].map(k => { const a = k / 3 * Math.PI * 2; return { x: SPIRE.x + Math.cos(a) * 6, z: SPIRE.z + Math.sin(a) * 6, y: SPIRE.h }; });
      s.socketsFilled = [false, false, false]; s.vault = resolve(findVaultSinkhole(), 'vault');
      msg('The Archivist: “Take the three shards up to the sun-clock. Set them, and let high noon speak through the glass.”', 10, true);
      break;
    case 5:
      s.phase = 'hamlet';
      msg((chained ? 'You can hear the old voice in your head: ' : 'The Archivist: ') + '“Vault doors answer to a warden’s key. The last warden went into the trees and never came out — the tree-people would remember.”', 11, true);
      if (!hamletFound) { s.rphase = 'r1'; s.wp = findRumorClue1(player.pos.x, player.pos.z); if (!s.wp) { s.rphase = 'r3'; s.wp = null; } }
      break;
    case 6: {
      s.phase = 'approach'; s.vault = resolve(findVaultSinkhole(), 'vault');
      s.knots = [0, 1, 2].map(k => { const a = k / 3 * Math.PI * 2 + 0.3; return { x: s.vault.x + Math.cos(a) * 15, z: s.vault.z + Math.sin(a) * 15, y: 0.5 }; });
      let e = 0, w = 0; for (let i = 1; i < 3; i++) { if (s.knots[i].x > s.knots[e].x) e = i; if (s.knots[i].x < s.knots[w].x) w = i; }
      s.knotSeq = [e, w, 3 - e - w]; s.knotStep = 0;                 // dawn=east, dusk=west, "water"=the other
      msg((chained ? '' : 'The Archivist: ') + '“The vault is an Authority door. The verse for it: dawn’s knot first, then dusk’s, then the knot the water feeds. And it only wakes at night, when the glow-moss does.”', 11, true);
      break;
    }
    case 7:
      s.phase = 'cross'; s.heart = resolve(findScorchHeart(), 'heart');
      msg((chained ? 'The old voice, quiet now: ' : 'The Archivist: ') + '“Now the hard mile — the heart of the Scorch. Carry the Seed there and plant it. Walk it at night if you love your skin.”', 11, true);
      break;
  }
  saveStory();
  if (!storyPaused) writeStoryHUD();
}

function completeChapter(ch, chain) {
  const s = story;
  s.ch = ch + 1; s.stuck = false; saveStory();
  hideStoryMarks();
  if (ch >= 7) { finishCampaign(); return; }
  if (chain) startChapter(true);                                    // Ch4→5 and Ch6→7 chain in the field
  else { s.active = false; s.phase = ''; s.obj = ''; }              // others return to the Archivist hub
}

function finishCampaign() {
  const s = story;
  s.active = false; s.ch = 8; STORY_SAVE.ch = 8; STORY_SAVE.seedbearer = true; saveStory();
  hideStoryMarks();
  msg('Far off, in the dead quarter: one green point in all that bone-colored ground.', 10, true);
  setTimeout(() => msg('The Archivist, when you tell them: “Sixty years of paper, one seed, one pair of young legs. The Authority is dead. Long live the gardeners.”', 11, true), 5000);
  hotSwapChunk(SPIRE.cx, SPIRE.cz);                                 // relight the beacon now (buildChunk checks storyComplete)
  if (typeof mmlabelEl !== 'undefined' && mmlabelEl && !trial && !activeMission) mmlabelEl.textContent = '✦ THE SPIRE';
  if (typeof missionEl !== 'undefined' && missionEl && !trial && !activeMission) missionEl.style.display = 'none';
}

// Dispose + rebuild one chunk in place (used to reveal the sapling on plant, the beacon on finish).
function hotSwapChunk(ix, iz) {
  const key = chunkKey(ix, iz), c = chunks.get(key);
  if (c) { scene.remove(c.group); c.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); chunks.delete(key); }
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  if (Math.abs(ix - cx) <= VIEW_R && Math.abs(iz - cz) <= VIEW_R) {
    const nc = buildChunk(ix, iz); chunks.set(key, nc); scene.add(nc.group);
  }
}

/* ======================================================================== */
/*  HUD                                                                      */
/* ======================================================================== */
function writeStoryHUD() {
  if (storyPaused || typeof missionEl === 'undefined') return;
  missionEl.style.display = 'block';
  missionTitleEl.textContent = story.title;
  missionProgEl.textContent = story.obj || '';
  if (mmlabelEl) mmlabelEl.textContent = story.label;
  if (trialTimerEl) trialTimerEl.style.display = 'none';
}

/* ======================================================================== */
/*  UPDATE — the per-frame driver (called from the main loop after trials)   */
/* ======================================================================== */
function updateStory(dt, time) {
  if (typeof player === 'undefined') return;
  syncArchivist(dt);
  storyPaused = (typeof trial !== 'undefined' && !!trial) || (typeof activeMission !== 'undefined' && !!activeMission);

  if (!summited) {                                                 // gated: climb the Spire first
    if (atArchivist(3.4)) hint('Press E — the Archivist has a thread to pull', 0.4);
    return;
  }
  if (story.ch > 7) {                                              // campaign done → SPIRE behavior returns
    if (atArchivist(3.4) && !storyPaused) hint('Press E — the Archivist', 0.4);
    return;
  }
  if (!story.active) {                                             // between chapters: ✦ points at the Archivist
    if (!storyPaused) {
      activeObjective = { x: SPIRE.x + 14, z: SPIRE.z + 6, y: 0 };
      story.title = 'The Second Seed'; story.label = '✦ THE SECOND SEED — CH.' + story.ch;
      story.obj = story.stuck ? 'The trail went cold — see the Archivist' : 'Return to the Archivist at the Spire';
      writeStoryHUD();
    }
    if (atArchivist(3.4) && !storyPaused) hint('Press E — the Archivist has a thread to pull', 0.4);
    return;
  }

  if (storyPaused) { hideStoryMarks(); return; }                  // a trial/errand owns the HUD; progress frozen, intact
  hideStoryMarks();                                               // redraw fresh each frame (collected/filled marks vanish)
  runChapter(dt, time);
  writeStoryHUD();

  storyCarrying = story.haveSeed;                                 // Ch6/7: carrying the Seed
  if (storyCarrying) {                                            // fouled flashlight (exact Salvage mechanic)
    flashlight.color.setHex(0x6a8f7a);
    flashlight.intensity = Math.max(0, flashlight.intensity * (0.3 + 0.4 * Math.abs(Math.sin(time * 11))));
  }
  if (story.beamT > 0) { story.beamT -= dt; if (story.beamT <= 0 && storyBeam) storyBeam.visible = false; }
}

function runChapter(dt, time) {
  const s = story, p = player;
  if (s.stuck) { s.obj = 'The trail went cold — return to the Archivist'; sObj({ x: SPIRE.x + 14, z: SPIRE.z + 6, y: 0 }); return; }

  if (s.ch === 1) {
    if (s.phase === 'top') {
      s.obj = 'Climb the Spire to the beacon room';
      smark(0, SPIRE.x + 6, SPIRE.h + 2, SPIRE.z + 6, 0.9, matStoryGold); sObj({ x: SPIRE.x, z: SPIRE.z, y: SPIRE.h });
      if (checkSummit(SPIRE.x, SPIRE.z, SPIRE.size / 2, SPIRE.size / 2, SPIRE.h)) {
        once('st1-top', () => msg('The sun-clock’s focusing glass is gone — pried out and cut into pieces when the Authority fell, the story goes. Three shards, three thieves, three hiding places.', 10, true));
        s.phase = 'hall'; s.hall = resolve(findOldtownHall(), 'hall'); saveStory();
      }
    } else if (s.phase === 'hall') {
      s.obj = 'Find the records hall in the old quarter';
      if (s.hall) { smark(0, s.hall.x, 1.6, s.hall.z, 0.9, matStoryGold); sObj(s.hall); }
      if (s.hall && dist2(s.hall.x, s.hall.z, p.pos.x, p.pos.z) < 5) hint('Press E — the moss-eaten seal on the hall door', 0.4);
    }

  } else if (s.ch === 2) {
    const glint = dayF > 0.5;
    s.obj = 'Shards ' + s.shards + ' / 3' + (glint ? '' : ' — wait for (or T toward) full day');
    let near = null, nd = 1e9;
    for (let i = 0; i < 3; i++) {
      const t = s.targets[i]; if (!t || t.got) continue;
      if (glint) smark(i, t.x, (t.y || 0) + 1.4, t.z, 0.8, matStoryGold);
      const d = dist2(t.x, t.z, p.pos.x, p.pos.z);
      const reach = t.hi ? (p.pos.y > t.y - 4) : true;
      if (glint && d < 2.5 && reach) { grabShard(i); continue; }
      if (d < nd) { nd = d; near = t; }
    }
    if (near) sObj(near);

  } else if (s.ch === 3) {
    if (s.phase === 'wade') {
      s.obj = 'Wade the sunken survey office (the roof-lake)';
      if (s.resv) { smark(0, s.resv.x, 8.6, s.resv.z, 0.9, matStoryGreen); sObj(s.resv); }
      const inRes = p.inWater && s.resv && Math.floor(p.pos.x / CHUNK) === s.resv.ix && Math.floor(p.pos.z / CHUNK) === s.resv.iz;
      if (inRes) {
        once('st3-wade', () => msg('The ledger is pulp. One page survives: “Fixed survey plate no. 9 — installed on the LEANING TOWER, the one that fell against its brother.”', 10, true));
        s.phase = 'fallen'; s.fallen = resolve(findFallenTop(), 'fallen'); saveStory();
      }
    } else if (s.phase === 'fallen') {
      s.obj = 'Climb the leaning tower — the fallen slab';
      if (s.fallen) { smark(0, s.fallen.x, s.fallen.y + 1.4, s.fallen.z, 0.9, matStoryGold); sObj(s.fallen); }
      if (s.fallen && dist2(s.fallen.x, s.fallen.z, p.pos.x, p.pos.z) < 6 && p.pos.y > s.fallen.y - 2) {
        once('st3-fallen', () => msg('The survey plate, bolted to dead concrete: “ALIGNMENT: from the mouth of the Spire at high noon. RANGE: ride the iron line and count what the years have eaten.”', 10, true));
        s.phase = 'viaduct'; setupViaductRun(); saveStory();
      }
    } else if (s.phase === 'viaduct') {
      runViaduct();
    }

  } else if (s.ch === 4) {
    if (s.phase === 'sockets') {
      const nf = s.socketsFilled.filter(Boolean).length;
      s.obj = 'Set the three shards in the sun-clock (' + nf + ' / 3)';
      for (let i = 0; i < 3; i++) if (!s.socketsFilled[i]) smark(i, s.sockets[i].x, s.sockets[i].y + 0.6, s.sockets[i].z, 0.7, matStoryGreen);
      sObj({ x: SPIRE.x, z: SPIRE.z, y: SPIRE.h });
    } else if (s.phase === 'noon') {
      s.obj = 'High noon at the Spire top — wait, or push the hours (hold T)';
      sObj({ x: SPIRE.x, z: SPIRE.z, y: SPIRE.h });
      if (checkSummit(SPIRE.x, SPIRE.z, SPIRE.size / 2, SPIRE.size / 2, SPIRE.h) && dayT >= 0.47 && dayT <= 0.57) fireHeliograph();
    } else if (s.phase === 'walk') {
      const n = rangeBlocks();
      s.obj = 'Follow the beam — ' + s.bearing + ', ' + n + ' blocks';
      sObj({ x: SPIRE.x, z: SPIRE.z, y: SPIRE.h });                 // NO vault marker — the words must be enough
      if (s.vault && dist2(s.vault.x, s.vault.z, p.pos.x, p.pos.z) < 20) {
        once('st4-arrive', () => msg('A street that fell into the dark, ' + n + ' blocks down the beam-line. The Authority’s door — and it is locked, of course.', 10, true));
        completeChapter(4, true);                                  // field-chain to Ch5
      }
    }

  } else if (s.ch === 5) {
    if (s.phase === 'hamlet') {
      if (hamletFound) {
        s.obj = 'Speak with the elders at the Hidden Hamlet';
        smark(0, HAMLET.x, 2.0, HAMLET.z, 0.9, matStoryGold); sObj({ x: HAMLET.x, z: HAMLET.z, y: 0 });
        if (dist2(HAMLET.x, HAMLET.z, p.pos.x, p.pos.z) < 5) hint('Press E — the elders at the fire pit', 0.4);
      } else runCh5Rumor();
    } else if (s.phase === 'crossing') {
      runCh5Crossing();
    }

  } else if (s.ch === 6) {
    if (s.phase === 'approach') {
      s.obj = 'Return to the Root Vault sinkhole — at night';
      if (s.vault) { smark(0, s.vault.x, 1.6, s.vault.z, 0.9, matStoryGold); sObj({ x: s.vault.x, z: s.vault.z, y: 0 }); }
      if (s.vault && dist2(s.vault.x, s.vault.z, p.pos.x, p.pos.z) < 20) {
        if (nightF > 0.5) { once('st6-night', () => msg('Vault doors are Authority doors — they only wake when the glow-moss does. Around the pit rim: three root-knots.', 9, true)); s.phase = 'knots'; s.knotStep = 0; }
        else once('st6-day', () => hint('The vault sleeps by day — return at night', 3));
      }
    } else if (s.phase === 'knots') {
      s.obj = 'Turn the knots: dawn’s, then dusk’s, then the one the water feeds';
      for (let i = 0; i < 3; i++) if (!knotDone(i)) smark(i, s.knots[i].x, s.knots[i].y + 1.2, s.knots[i].z, 0.7, matStoryGreen);
      sObj({ x: s.vault.x, z: s.vault.z, y: 0 });
    } else if (s.phase === 'descend') {
      s.obj = 'Descend into the pit and take the Second Seed';
      smark(0, s.vault.x, -3.2, s.vault.z, 0.8, matStoryGold); sObj({ x: s.vault.x, z: s.vault.z, y: -4 });
    }

  } else if (s.ch === 7) {
    if (s.phase === 'cross') {
      s.obj = 'Carry the Seed to the heart of the Scorch';
      if (s.heart) { smark(0, s.heart.x, 1.6, s.heart.z, 0.9, matStoryGold); sObj({ x: s.heart.x, z: s.heart.z, y: 0 }); }
      if (s.heart && dist2(s.heart.x, s.heart.z, p.pos.x, p.pos.z) < 6) { s.phase = 'plant'; s.plantT = 0; }
    } else if (s.phase === 'plant') {
      s.obj = 'Hold E to plant the Second Seed';
      smark(0, s.heart.x, 1.6, s.heart.z, 0.9, matStoryGreen); sObj({ x: s.heart.x, z: s.heart.z, y: 0 });
      if (dist2(s.heart.x, s.heart.z, p.pos.x, p.pos.z) < 6 && keys.KeyE) {
        s.plantT += dt; hint('Planting the Second Seed…  ' + Math.min(3, s.plantT).toFixed(1) + ' s', 0.3);
        if (s.plantT >= 3) plantSeed();
      } else if (s.plantT > 0 && s.plantT < 3) s.plantT = 0;       // released early → the channel resets
    } else if (s.phase === 'epilogue') {
      s.obj = 'Climb the Spire. See what you did.';
      smark(0, SPIRE.x + 6, SPIRE.h + 2, SPIRE.z + 6, 0.9, matStoryGold); sObj({ x: SPIRE.x, z: SPIRE.z, y: SPIRE.h });
      if (checkSummit(SPIRE.x, SPIRE.z, SPIRE.size / 2, SPIRE.size / 2, SPIRE.h)) completeChapter(7, false);
    }
  }
}

/* ---- Ch1/Ch2 helpers ---- */
function ch1Complete() {
  msg('A ledger fragment under the moss-eaten seal names the thieves’ hiding places: “one went up where only the sun still visits · one drowned in the roof-lake · one lies in the open square, in plain sight of noon.”', 11, true);
  completeChapter(1, false);
}
function grabShard(i) {
  const t = story.targets[i]; if (!t || t.got) return;
  t.got = true; story.shards++; STORY_SAVE.shards = story.shards; saveStory();
  msg(SHARD_LINES[i] || 'The shard is warm from the sun, a line etched along its cut edge.', 9, true);
  hint('Shard recovered — ' + story.shards + ' / 3', 2.5);
  if (story.shards >= 3) {
    setTimeout(() => msg('Three cuts of one glass. The Heliograph can speak again — but it only speaks at noon.', 9, true), 1200);
    completeChapter(2, false);
  }
}

/* ---- Ch3 viaduct run (untimed checkpoints, ending at a broken span edge) ---- */
function setupViaductRun() {
  const s = story, v = nearestViaduct(6);
  s.via = v;
  if (v) { const along0 = v.axis === 0 ? player.pos.z : player.pos.x; s.gateAlong = Math.round(along0 / CHUNK) * CHUNK + 8; }
  s.cpIdx = 0; s.nCp = 3; s.broken = findRumorClue1(player.pos.x, player.pos.z);
}
function runViaduct() {
  const s = story, v = s.via, p = player;
  if (!v) {                                                        // no viaduct within reach → don't dead-end
    once('st3-noviaduct', () => msg('The iron line is long gone here. The Archivist waves it off in your head: “Never mind the rails — I have the count another way.”', 9, true));
    finishCh3(); return;
  }
  const cross = v.cross;
  if (s.cpIdx < s.nCp) {
    const cpAlong = s.gateAlong + 64 * (s.cpIdx + 1);
    const cp = v.axis === 0 ? { x: cross, z: cpAlong } : { x: cpAlong, z: cross };
    s.obj = 'Ride the iron line — span ' + (s.cpIdx + 1) + ' / ' + s.nCp;
    smark(0, cp.x, 9.8, cp.z, 0.9, matStoryGold); sObj(cp);
    if (dist2(p.pos.x, p.pos.z, cp.x, cp.z) < 4) { s.cpIdx++; if (s.cpIdx < s.nCp) hint('Span ' + s.cpIdx + ' / ' + s.nCp, 2); }
  } else {
    s.obj = 'Follow the rails to where they end in air';
    const b = s.broken;
    if (b) { smark(0, b.x, (b.y || 9) + 1.4, b.z, 0.9, matStoryGold); sObj(b); if (dist2(p.pos.x, p.pos.z, b.x, b.z) < 12) finishCh3(); }
    else finishCh3();
  }
}
function finishCh3() {
  const n = rangeBlocks();
  msg('The rails end in open air. Count the spans the years have eaten — ' + n + ' by the old reckoning. Remember the number: the light will ask for it.', 10, true);
  completeChapter(3, false);
}

/* ---- Ch4 sockets + heliograph ---- */
function fillSocket(i) {
  const s = story; if (s.phase !== 'sockets' || s.socketsFilled[i]) return;
  s.socketsFilled[i] = true;
  const n = s.socketsFilled.filter(Boolean).length;
  const clicks = ['A shard clicks home; the glass rings like a struck bell.', 'The second shard seats; light threads the cracks.', 'The third — and the sun-clock is whole again.'];
  msg(clicks[Math.min(2, n - 1)], 6, true);
  if (s.socketsFilled.every(Boolean)) { s.phase = 'noon'; msg('Now the sun must strike it. High noon. Wait, or push the hours (hold T).', 9, true); }
  saveStory();
}
function fireHeliograph() {
  const s = story; if (s.phase !== 'noon' || !s.vault) return;
  s.bearing = bearingPhrase(SPIRE.x, SPIRE.z, s.vault.x, s.vault.z);
  const b = ensureBeam();
  b.matrix.copy(segMat(SPIRE.x + 6, SPIRE.h + 8, SPIRE.z + 6, s.vault.x, 2, s.vault.z, 0.35));
  b.visible = true; s.beamT = 20;
  s.phase = 'walk'; saveStory();
  msg('The beam runs ' + s.bearing + '. ' + rangeBlocks() + ' blocks by the old count — where the street swallowed itself, the door is the floor.', 11, true);
}

/* ---- Ch5 rumor discovery + canal chase ---- */
function runCh5Rumor() {
  const s = story, p = player;
  if (s.rphase === 'r1' || s.rphase === 'r2') {
    if (s.wp) { smark(0, s.wp.x, (s.wp.y || 0) + 1.4, s.wp.z, 0.9, matStoryGold); sObj(s.wp); }
    s.obj = s.rphase === 'r1' ? 'Follow the rails until they bend into air' : 'Follow the second clue';
    if (s.wp && dist2(p.pos.x, p.pos.z, s.wp.x, s.wp.z) < 12) {
      if (s.rphase === 'r1') {
        s.rphase = 'r2'; s.wp = findRumorClue2(p.pos.x, p.pos.z);
        const kl = !s.wp ? '' : s.wp.kind === 'sink' ? '“Find where the street fell into the earth.”' : s.wp.kind === 'fern' ? '“Find where the great ferns still grow in a ring.”' : '“Find where the old bottles sing in the wind.”';
        if (!s.wp) s.rphase = 'r3';
        msg('The broken span — rails ending in open air. Scratched on the last girder, the next line. ' + kl, 9, true);
      } else {
        s.rphase = 'r3'; s.wp = null; s.obj = 'Where the giants stand in a circle, look up';
        const dir = bearingPhrase(p.pos.x, p.pos.z, HAMLET.x, HAMLET.z); sObj({ x: SPIRE.x, z: SPIRE.z, y: SPIRE.h });
        msg('And last: “Where the giants stand in a circle, look up.” No map, no mark — only this: it lies somewhere to the ' + dir + '. Go on foot, and watch the great trees.', 11, true);
      }
    }
  } else {                                                         // r3 — no marker; find it by the words
    s.obj = 'Where the giants stand in a circle, look up'; sObj({ x: SPIRE.x, z: SPIRE.z, y: SPIRE.h });
    if (dist2(p.pos.x, p.pos.z, HAMLET.x, HAMLET.z) < 12) {
      discoverHamlet();                                            // permanent minimap marker + '…people live here.'
      STORY_SAVE.foundHamletViaStory = true; saveStory();          // guards the Rumor trial (see startTrial)
      s.phase = 'hamlet';                                          // now hamletFound → next frame asks for the elders
    }
  }
}
function ch5Elders() {
  const s = story;
  msg('An elder at the fire pit: “The warden’s key? It went down the water the night he died — dropped from the high line where the rails cross the canal. Iron sinks; strings catch. Follow the water and look under the crossings.”', 11, true);
  const cr = findCrossing(10) || findCrossing(16);
  if (!cr) {                                                       // no viaduct×canal crossing near → don't dead-end
    once('st5-nocross', () => msg('You search the crossings and find the chime-string tangled on the first footbridge — the key still on it. Luck, this once.', 8, true));
    giveKey(); return;
  }
  s.phase = 'crossing'; s.cross = cr; s.cpIdx = 0; s.nCp = 3; saveStory();
}
function runCh5Crossing() {
  const s = story, p = player, cr = s.cross;
  if (s.cpIdx < s.nCp) {
    const cp = canalPoint(cr, 64 * (s.cpIdx + 1));
    s.obj = 'Follow the water down from the crossing — ' + (s.cpIdx + 1) + ' / ' + s.nCp;
    smark(0, cp.x, 0.6, cp.z, 0.8, matStoryGreen); sObj(cp);
    if (dist2(p.pos.x, p.pos.z, cp.x, cp.z) < 5) { s.cpIdx++; if (s.cpIdx < s.nCp) hint('Under the crossings — ' + s.cpIdx + ' / ' + s.nCp, 2); }
  } else {
    const end = canalPoint(cr, 64 * s.nCp);
    s.obj = 'The key hangs on a chime-string under the footbridge — wade to it';
    smark(0, end.x, 0.4, end.z, 0.8, matStoryGold); sObj(end);
    if (dist2(p.pos.x, p.pos.z, end.x, end.z) < 2.5 && p.pos.y < 1) giveKey();
  }
}
function giveKey() {
  const s = story; s.haveKey = true; STORY_SAVE.haveKey = true; saveStory();
  msg('The warden’s key — iron, green with canal-silt, still on its chime-string. Heavy in the hand. The vault will answer to it now.', 10, true);
  completeChapter(5, false);
}

/* ---- Ch6 knot order puzzle + Seed ---- */
function knotDone(i) { const s = story; for (let k = 0; k < s.knotStep; k++) if (s.knotSeq[k] === i) return true; return false; }
function knotInteract(i) {
  const s = story; if (s.phase !== 'knots' || knotDone(i)) return;
  if (s.knotSeq[s.knotStep] === i) {
    s.knotStep++; msg('Old iron turns somewhere under the street.', 5, true);
    if (s.knotStep >= 3) { s.phase = 'descend'; msg('The pit floor shudders and folds open — a shaft of glow-light climbs out of the dark. Descend.', 9, true); }
  } else { s.knotStep = 0; msg('The knots stiffen and lock. Begin again — dawn first.', 6, true); }
}
function takeSeed() {
  const s = story; if (s.haveSeed) return;
  s.haveSeed = true; storyCarrying = true; STORY_SAVE.haveSeed = true; saveStory();
  msg('The Second Seed — a dark pod the size of a fist, warm, humming faintly. Carrying it, you cannot run, and your flashlight will not hold its colour.', 10, true);
  setTimeout(() => msg('The old voice: “Now the hard mile. The Seed wants the worst ground in the world — the heart of the Scorch. Walk it at night if you love your skin.”', 10, true), 4000);
  completeChapter(6, true);                                        // field-chain to Ch7
}

/* ---- Ch7 plant (3-second channel) + permanent world change ---- */
function plantSeed() {
  const s = story; if (s.phase !== 'plant') return;
  const ix = (s.heart.ix !== undefined) ? s.heart.ix : Math.floor(s.heart.x / CHUNK);
  const iz = (s.heart.iz !== undefined) ? s.heart.iz : Math.floor(s.heart.z / CHUNK);
  msg('You press the Second Seed into ground that has not felt shade in sixty years.', 8, true);
  STORY_SAVE.planted = { dx: ix - SPIRE.cx, dz: iz - SPIRE.cz };   // spire-relative (survives the per-session re-roll)
  s.haveSeed = false; storyCarrying = false; STORY_SAVE.haveSeed = false;
  flashlight.color.setHex(0xfff2d0);                               // un-foul the flashlight
  saveStory();
  hotSwapChunk(ix, iz);                                            // reveal the sapling immediately (buildChunk reads STORY_SAVE)
  s.phase = 'epilogue';
  setTimeout(() => msg('Nothing. Then — under your palms — the street CRACKS. Something green shoulders up through the asphalt, and keeps coming.', 9, true), 3000);
}

/* ======================================================================== */
/*  E-INTERACT (tried first from player.js; returns true if it consumed E)    */
/* ======================================================================== */
function storyInteract() {
  if (typeof story === 'undefined') return false;
  if ((typeof trial !== 'undefined' && trial) || (typeof activeMission !== 'undefined' && activeMission)) return false;   // a trial/errand owns E

  if (!summited) {                                                 // gated
    if (atArchivist(3.6)) { msg('The Archivist looks you over: “Climb it first. The trail starts where the whole green world is visible at once.”', 8, true); return true; }
    return false;
  }
  if (atArchivist(3.6)) {                                          // the hub
    if (story.ch > 7) { msg('The Archivist rests a hand on the crates: “Sixty years of paper, one seed, one pair of young legs. Go — the gardens are yours now.”', 8, true); return true; }
    if (!story.active || story.stuck) { startChapter(false); return true; }
    msg('The Archivist nods you back to the thread: ' + story.obj, 6, true); return true;
  }
  if (!story.active) return false;
  return chapterInteract();
}
function chapterInteract() {
  const s = story, p = player;
  if (s.ch === 1 && s.phase === 'hall') {
    if (s.hall && dist2(s.hall.x, s.hall.z, p.pos.x, p.pos.z) < 3) { ch1Complete(); return true; }
  } else if (s.ch === 4 && s.phase === 'sockets') {
    for (let i = 0; i < 3; i++) {
      if (s.socketsFilled[i]) continue;
      if (dist2(s.sockets[i].x, s.sockets[i].z, p.pos.x, p.pos.z) < 2 && p.pos.y > SPIRE.h - 3) { fillSocket(i); return true; }
    }
  } else if (s.ch === 5 && s.phase === 'hamlet' && hamletFound) {
    if (dist2(HAMLET.x, HAMLET.z, p.pos.x, p.pos.z) < 4) { ch5Elders(); return true; }
  } else if (s.ch === 6 && s.phase === 'knots') {
    for (let i = 0; i < 3; i++) if (dist2(s.knots[i].x, s.knots[i].z, p.pos.x, p.pos.z) < 2.6) { knotInteract(i); return true; }
  } else if (s.ch === 6 && s.phase === 'descend') {
    if (dist2(s.vault.x, s.vault.z, p.pos.x, p.pos.z) < 3.5 && p.pos.y < -2) { takeSeed(); return true; }
  } else if (s.ch === 7 && s.phase === 'plant') {
    if (dist2(s.heart.x, s.heart.z, p.pos.x, p.pos.z) < 6) { hint('Hold E to press the Seed into the ground', 2); return true; }
  }
  return false;
}

/* ======================================================================== */
/*  DEV / SMOKE-TEST HOOK — ?story=N jumps to chapter N with prerequisites    */
/* ======================================================================== */
(function storyDevJump() {
  const n = +(params.get('story') || 0);
  if (!n || n < 1 || n > 7) return;
  summited = true; try { localStorage.setItem('canopy.summited', '1'); } catch (e) { }
  story.ch = n; STORY_SAVE.ch = n;
  if (n >= 4) { story.shards = 3; STORY_SAVE.shards = 3; }         // Ch4+ needs the three shards
  if (n >= 6) { story.haveKey = true; STORY_SAVE.haveKey = true; } // Ch6+ needs the warden's key
  if (n >= 7) { story.haveSeed = true; STORY_SAVE.haveSeed = true; storyCarrying = true; }  // Ch7 carries the Seed
  saveStory();
  startChapter(false);                                             // runs this chapter's finders once at load
})();
