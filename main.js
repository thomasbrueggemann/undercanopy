/* CANOPY split file  main: missions, trials, minimap, HUD, audio, main loop (was game.js lines 3227-4261). Header/error-handler in core.js. */
'use strict';
/* ======================================================================== */
/*  MISSIONS — small errands the under-dwellers ask of you                  */
/* ======================================================================== */
const ARCH = { VANTAGE: 'vantage', SUNRUN: 'sun-run', LAMP: 'lamplighter', ERRAND: 'errand' };
let activeMission = null;         // the one accepted mission, or null
let activeObjective = SPIRE;      // where the minimap ✦ points (the Spire until a mission overrides)
let giver = null;                 // an NPC promoted to mission-giver (pre-accept only), or null
const doneVantages = new Set();   // "rx,rz" of summited peaks — stay pinned on the minimap
let missionsDone = 0;

/* ---- Hidden Hamlet discovery state (persisted) ---- */
let hamletFound = false, hamletErrand = false;
try { hamletFound = localStorage.getItem('canopy.hamlet') === '1'; } catch (e) { }
try { hamletErrand = localStorage.getItem('canopy.hamletErrand') === '1'; } catch (e) { }
function discoverHamlet() {
  if (!hamletFound) { hamletFound = true; try { localStorage.setItem('canopy.hamlet', '1'); } catch (e) { } }
  once('hamlet', () => msg('You climb into a hush of woodsmoke and lantern-light — rope bridges sway between the giants, huts nestle in the boughs. People live here.', 10, true));
}
let giverCd = 4;                  // seconds until the next attempt to find a giver

const missionEl = document.getElementById('mission');
const missionTitleEl = document.getElementById('missionTitle');
const missionProgEl = document.getElementById('missionProg');
const trialTimerEl = document.getElementById('trialTimer');
const mmlabelEl = document.getElementById('mmlabel');

const matGiver = new THREE.MeshBasicMaterial({ color: 0xffe27a });
const giverMark = new THREE.Mesh(tplBlob, matGiver);
giverMark.scale.setScalar(0.17); giverMark.visible = false; scene.add(giverMark);

const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/* ---- target finders: scan only loaded chunks, run once at accept ---- */
function nearestRooftop(minH) {
  let best = null, bd = 1e9;
  for (const c of chunks.values()) for (const s of c.colData.solids) {
    if (!s.vine || s.h < minH) continue;                 // vined → climbable to reach it
    const x = (s.x0 + s.x1) / 2, z = (s.z0 + s.z1) / 2;
    const d = dist2(x, z, player.pos.x, player.pos.z);
    if (d > 20 && d < bd) { bd = d; best = { x, z, y: s.h, halfX: (s.x1 - s.x0) / 2, halfZ: (s.z1 - s.z0) / 2 }; }
  }
  return best;
}
function nearestGiantTrunk() {
  let best = null, bd = 1e9;
  for (const c of chunks.values()) for (const t of c.colData.trunks) {
    if (t.h <= 20 || t.r < 1.2) continue;                // r-gate: excludes lamps/poles/fountain/mast
    const d = dist2(t.x, t.z, player.pos.x, player.pos.z);
    if (d > 14 && d < bd) { bd = d; best = { x: t.x, z: t.z, y: t.h, radius: t.r + 1.4 }; }
  }
  return best;
}
function nearestOpenRect() {
  let best = null, bd = 1e9;
  for (const c of chunks.values()) {
    if (!c.openRect) continue;
    const o = c.openRect, x = (o.x0 + o.x1) / 2, z = (o.z0 + o.z1) / 2;
    const d = dist2(x, z, player.pos.x, player.pos.z);
    if (d > 12 && d < bd) { bd = d; best = { x, z, y: 0 }; }
  }
  return best;
}
function brokenLamps(n) {
  const out = [];
  for (const c of chunks.values()) for (const L of (c.colData.lamps || []))
    if (!L.working) out.push({ x: L.x, z: L.z, hx: L.hx, hy: L.hy, hz: L.hz, lit: false, mesh: null });
  out.sort((a, b) => dist2(a.x, a.z, player.pos.x, player.pos.z) - dist2(b.x, b.z, player.pos.x, player.pos.z));
  return out.slice(0, n);
}
function errandDistrict() {
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
  const [dx, dz] = dirs[(Math.random() * dirs.length) | 0];
  const ix = cx + dx * 2, iz = cz + dz * 2;              // ~2 blocks off → a real walk
  return { x: ix * CHUNK + 32, z: iz * CHUNK + 32, y: 0, name: districtName(ix, iz) };
}

/* ---- which archetypes can start right now? (never offer an impossible one) ---- */
const isDusk = () => dayT > 0.72 && dayT < 0.87;
function pickArch() {
  const opts = [];
  if (dayF > 0.4 && (nearestOpenRect() || nearestRooftop(26))) opts.push(ARCH.SUNRUN);
  if (nearestRooftop(26) || nearestGiantTrunk()) opts.push(ARCH.VANTAGE);
  if (isDusk() && brokenLamps(3).length >= 3) opts.push(ARCH.LAMP);
  opts.push(ARCH.ERRAND);                                // always possible
  return opts[(Math.random() * opts.length) | 0];
}

function checkSummit(cx, cz, halfX, halfZ, topY) {
  return Math.abs(player.pos.x - cx) < halfX + 1 && Math.abs(player.pos.z - cz) < halfZ + 1 && player.pos.y > topY - 1.5;
}

/* ---- accept: build a concrete mission, falling back to an errand if a target
       has since unloaded so we never hand out something impossible ---- */
function acceptMission(arch) {
  const m = { arch, stage: '', target: null, home: null, summit: null, lamps: null, needN: 0, litN: 0, receiver: null, title: '', district: '' };
  const buildErrand = () => {
    const d = errandDistrict();
    m.arch = ARCH.ERRAND; m.target = { x: d.x, z: d.z, y: 0 }; m.district = d.name;
    m.title = 'Carry the parcel to ' + d.name;
    msg('A woman folds a parcel in waxcloth: “Take this to my sister in ' + d.name + '. She’ll be watching the road.”', 7);
  };
  if (arch === ARCH.VANTAGE) {
    const roof = nearestRooftop(26), trunk = nearestGiantTrunk();
    let t = roof, viaTrunk = false;
    if (trunk && (!roof || dist2(trunk.x, trunk.z, player.pos.x, player.pos.z) < dist2(roof.x, roof.z, player.pos.x, player.pos.z))) { t = trunk; viaTrunk = true; }
    if (!t) buildErrand();
    else {
      m.target = { x: t.x, z: t.z, y: t.y };
      m.summit = viaTrunk ? { halfX: t.radius, halfZ: t.radius, topY: t.y } : { halfX: t.halfX, halfZ: t.halfZ, topY: t.y };
      m.title = 'Reach the high roost';
      msg('An elder points a long finger up: “Climb the tall one yonder, and tell me the green still runs to every edge.”', 7);
    }
  } else if (arch === ARCH.SUNRUN) {
    const t = nearestOpenRect() || nearestRooftop(26);
    if (!t) buildErrand();
    else {
      m.target = { x: t.x, z: t.z, y: t.y }; m.home = lastShade.clone(); m.stage = 'out';
      m.title = 'Fetch the cache — out in the open';
      msg('A courier presses a sealed tin at you: “The cache is out in the sun. Grab it and get back under the leaves before you cook.”', 7);
    }
  } else if (arch === ARCH.LAMP) {
    m.lamps = brokenLamps(4 + ((Math.random() * 2) | 0));
    if (m.lamps.length < 3) buildErrand();
    else {
      m.needN = m.lamps.length; m.target = { x: m.lamps[0].x, z: m.lamps[0].z, y: 4.2 };
      m.title = 'Wake the dark lamps';
      msg('An out-of-oil lamplighter grips your arm: “Dusk’s nearly gone. Wake the dead lamps down the row before true night.”', 7);
    }
  } else {
    buildErrand();
  }
  activeMission = m;
  activeObjective = m.target;
  giver = null;
  updateMissionHUD();
}

function clearMissionMeshes() {
  for (const mm of LAMP_POOL) mm.visible = false;
  if (activeMission && activeMission.receiver) { scene.remove(activeMission.receiver); activeMission.receiver = null; }
}
function completeMission(goldLine) {
  if (goldLine) msg(goldLine, 9, true);
  missionsDone++;
  clearMissionMeshes();
  activeMission = null; activeObjective = SPIRE;
  giverCd = 6 + Math.random() * 6;
  updateMissionHUD();
}
function failMission(line) {
  if (line) msg(line, 7);
  clearMissionMeshes();
  activeMission = null; activeObjective = SPIRE;
  giverCd = 8 + Math.random() * 6;
  updateMissionHUD();
}

function missionProgText() {
  const m = activeMission;
  if (!m) return '';
  if (m.arch === ARCH.LAMP) return 'Lamps woken ' + m.litN + ' / ' + m.needN;
  if (m.arch === ARCH.SUNRUN) return m.stage === 'out' ? 'Reach the cache' : 'Get back to shade';
  if (m.arch === ARCH.VANTAGE) return 'Climb to the top';
  if (m.arch === ARCH.ERRAND) return 'Deliver in ' + m.district;
  return '';
}
function updateMissionHUD() {
  if (typeof trialTimerEl !== 'undefined' && trialTimerEl && !trial) trialTimerEl.style.display = 'none';
  if (!activeMission) { if (!trial) missionEl.style.display = 'none'; if (mmlabelEl && !trial) mmlabelEl.textContent = '✦ THE SPIRE'; return; }
  missionEl.style.display = 'block';
  missionTitleEl.textContent = activeMission.title;
  missionProgEl.textContent = missionProgText();
  if (mmlabelEl) mmlabelEl.textContent = '✦ ' + activeMission.title.toUpperCase();
}

function updateMissions(dt, time) {
  // ---- no active mission: find & mark a giver, offer to accept ----
  if (!activeMission) {
    if (giver && dist2(giver.g.position.x, giver.g.position.z, player.pos.x, player.pos.z) > 34) giver = null;
    giverCd -= dt;
    if (!giver && giverCd <= 0) {
      giverCd = 2.5;
      let best = null, bd = 30;
      for (const n of npcs) {
        if (n.role !== 'walk' && n.role !== 'tend') continue;
        const d = dist2(n.g.position.x, n.g.position.z, player.pos.x, player.pos.z);
        if (d < bd) { bd = d; best = n; }
      }
      if (best) { best.giverArch = pickArch(); giver = best; }
    }
    if (giver) {
      giverMark.position.set(giver.g.position.x, giver.g.position.y + 2.25 + Math.sin(time * 3) * 0.06, giver.g.position.z);
      giverMark.visible = true;
      if (dist2(giver.g.position.x, giver.g.position.z, player.pos.x, player.pos.z) < 3.2) hint('Press E — hear them out', 0.4);
    } else giverMark.visible = false;
    return;
  }
  giverMark.visible = false;

  const m = activeMission, p = player;
  if (m.arch === ARCH.VANTAGE) {
    if (checkSummit(m.target.x, m.target.z, m.summit.halfX, m.summit.halfZ, m.summit.topY)) {
      doneVantages.add(Math.round(m.target.x) + ',' + Math.round(m.target.z));
      completeMission('The roost. Wind, and the leaf-sea rolling to every horizon. You breathe it in, then start down.');
    }
  } else if (m.arch === ARCH.SUNRUN) {
    if (p.heat >= 98 && p.exposed) { failMission('The sun won this round — you drop the tin and stagger for the shade.'); return; }
    if (m.stage === 'out') {
      const reached = dist2(p.pos.x, p.pos.z, m.target.x, m.target.z) < 5 && (m.target.y < 1 ? p.exposed : p.pos.y > m.target.y - 2);
      if (reached) {
        m.stage = 'back'; activeObjective = m.home;
        msg('Cache in hand. Now RUN — the shade is back the way you came.', 6);
        updateMissionHUD();
      }
    } else if (!p.exposed && p.grounded && p.pos.y < CANOPY_Y) {
      completeMission('Back under the leaves, lungs burning, tin still cool. That was close.');
    }
  } else if (m.arch === ARCH.LAMP) {
    if (nightF > 0.55) { failMission('True night falls with lamps still dark. The lamplighter sighs and takes back the taper.'); return; }
    let nextUnlit = null, nd = 1e9;
    for (const L of m.lamps) {
      if (L.lit) continue;
      if (dist2(L.x, L.z, p.pos.x, p.pos.z) < 3.2) {
        const slot = LAMP_POOL.find(mm => !mm.visible);
        if (slot) { slot.position.set(L.hx, L.hy, L.hz); slot.visible = true; L.mesh = slot; }
        L.lit = true; m.litN++;
        hint('A lamp wakes — ' + m.litN + ' / ' + m.needN, 2.5);
        updateMissionHUD();
        continue;
      }
      const d = dist2(L.x, L.z, p.pos.x, p.pos.z);
      if (d < nd) { nd = d; nextUnlit = L; }
    }
    if (m.litN >= m.needN) { completeMission('Every lamp along the row is burning. The street glows amber, and folk nod as they pass.'); return; }
    if (nextUnlit) activeObjective = { x: nextUnlit.x, z: nextUnlit.z, y: 4.2 };
  } else if (m.arch === ARCH.ERRAND) {
    const d = dist2(p.pos.x, p.pos.z, m.target.x, m.target.z);
    if (!m.receiver && d < 55) {
      const r = makeNPCGroup(false, 'tend').g;
      r.position.set(m.target.x, 0, m.target.z); scene.add(r); m.receiver = r;
    }
    if (m.receiver) m.receiver.rotation.y = Math.atan2(p.pos.x - m.target.x, p.pos.z - m.target.z);
    if (d < 4 && m.receiver) completeMission('Delivered. Her sister folds a sprig of glow-moss into your palm — “safe roads, wanderer.”');
  }
}

/* ======================================================================== */
/*  TRIALS — timed challenges set by trial-masters at plazas & shrines       */
/*  Separate from the errand system, and mutually exclusive with it: taking  */
/*  a trial politely drops any errand. Progress persists in localStorage.    */
/* ======================================================================== */
const TRIAL = { COURIER: 'courier', TRACK: 'track', ASCENT: 'ascent', SALVAGE: 'salvage', FREEFALL: 'freefall', RUMOR: 'rumor' };
const TRIAL_ORDER = [TRIAL.COURIER, TRIAL.TRACK, TRIAL.ASCENT, TRIAL.SALVAGE, TRIAL.FREEFALL, TRIAL.RUMOR];
const TRIAL_NAME = { courier: 'Sun Courier', track: 'Track Runner', ascent: 'The Ascent', salvage: 'Night Salvage', freefall: 'Freefall Faith', rumor: 'The Rumor' };
const TIERS = ['bronze', 'silver', 'gold'];
const TIER_MULT = { bronze: 1.35, silver: 1.15, gold: 1.0 };   // timer multipliers — bronze is generous
const SPRINT_EFF = () => WALK * SPRINT * (sprintBoost ? 1.1 : 1);   // top ground speed, m/s

let trial = null;                                 // the one active trial, or null
let trialProgress = {};                           // { trialId: bestTierIndex }
try { trialProgress = JSON.parse(localStorage.getItem('canopy.trials') || '{}') || {}; } catch (e) { trialProgress = {}; }
function saveTrials() { try { localStorage.setItem('canopy.trials', JSON.stringify(trialProgress)); } catch (e) { } }
function tierIndexDone(id) { return (id in trialProgress) ? trialProgress[id] : -1; }
function nextTierIndex(id) { return Math.min(2, tierIndexDone(id) + 1); }   // bronze→silver→gold, then repeat gold
function trialsCompletedCount() { let n = 0; for (const id of TRIAL_ORDER) if (id !== TRIAL.RUMOR && tierIndexDone(id) >= 0) n++; return n; }
function trialUnlocked(i) {
  if (TRIAL_ORDER[i] === TRIAL.RUMOR) return trialsCompletedCount() >= 2;   // The Rumor: after any 2 other trials
  return i === 0 || tierIndexDone(TRIAL_ORDER[i - 1]) >= 0;                  // the rest keep ordered gating
}

// Reusable marker pool (toggled, never re-created), mirroring LAMP_POOL.
const matTrialMark = new THREE.MeshBasicMaterial({ color: 0x8affd0, fog: false });
const matRelic = new THREE.MeshBasicMaterial({ color: 0xffdf7a, fog: false });
const TRIAL_POOL = Array.from({ length: 8 }, () => {
  const m = new THREE.Mesh(tplBlob, matTrialMark); m.scale.setScalar(0.6); m.visible = false; m.renderOrder = 5; scene.add(m); return m;
});
function setMark(i, x, y, z, s, mat) {
  const m = TRIAL_POOL[i]; if (!m) return;
  m.position.set(x, y, z); m.scale.setScalar(s || 0.6); m.material = mat || matTrialMark; m.visible = true;
}
function hideMarks() { for (const m of TRIAL_POOL) m.visible = false; }

/* ---- trial-master NPCs: deterministic, rare, near plaza fountains & city shrines ---- */
const trialMasters = new Map();                   // chunkKey → npc
function trialMasterSpec(ix, iz) {
  const t = chunkType(ix, iz);
  if (t === 'plaza' && hash2(ix, iz, 7788) % 2 === 0) return { x: ix * CHUNK + 32, z: iz * CHUNK + 32, seed: hash2(ix, iz, 7790) };
  if (t === 'city' && hash2(ix, iz, 7789) % 17 === 0) return { x: ix * CHUNK + 32, z: iz * CHUNK + 32, seed: hash2(ix, iz, 7791) };
  return null;
}
function syncTrialMasters() {
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  const want = new Set();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const ix = cx + dx, iz = cz + dz, key = chunkKey(ix, iz);
    const spec = trialMasterSpec(ix, iz);
    if (!spec) continue;
    want.add(key);
    if (!trialMasters.has(key)) {
      const { g, anim } = makeNPCGroup(false, 'trialmaster');
      g.position.set(spec.x, 0, spec.z);
      scene.add(g);
      trialMasters.set(key, { g, anim, spec, faceYaw: 0 });
    }
  }
  for (const [key, tm] of trialMasters) {
    if (want.has(key)) continue;
    scene.remove(tm.g); trialMasters.delete(key);
  }
}
function nearestTrialMaster(maxD) {
  let best = null, bd = maxD || 3.4;
  for (const tm of trialMasters.values()) {
    const d = dist2(tm.g.position.x, tm.g.position.z, player.pos.x, player.pos.z);
    if (d < bd) { bd = d; best = tm; }
  }
  return best;
}

/* ---- Hidden Hamlet residents: 2–3 NPCs pinned to the hamlet, spawned when the player is
   within range and culled when they leave. Walking the platforms is complex, so they idle —
   two loiter at the ground fire pit, one keeps a lantern on a platform. ---- */
const hamletResidents = [];
let hamletResidentsActive = false;
function hamletResidentAnchors() {
  const g = hamletGiants()[0];
  return [
    { x: HAMLET.x + 2.4, y: 0, z: HAMLET.z + 1.2, face: -2.3, role: 'tend' },     // by the fire
    { x: HAMLET.x - 1.8, y: 0, z: HAMLET.z + 2.4, face: -1.0, role: 'tend' },     // by the fire
    { x: g.x - Math.cos(g.ang) * 1.8, y: g.platY + 0.02, z: g.z - Math.sin(g.ang) * 1.8, face: g.ang + Math.PI, role: 'lantern' }  // on a platform
  ];
}
function syncHamletResidents(dt) {
  const near = Math.hypot(player.pos.x - HAMLET.x, player.pos.z - HAMLET.z) < CHUNK * 1.7;
  if (near && !hamletResidentsActive) {
    hamletResidentsActive = true;
    for (const a of hamletResidentAnchors()) {
      const { g, anim } = makeNPCGroup(false, a.role);
      g.position.set(a.x, a.y, a.z); g.rotation.y = a.face;
      scene.add(g); hamletResidents.push({ g, anim, base: a });
    }
  } else if (!near && hamletResidentsActive) {
    for (const r of hamletResidents) scene.remove(r.g);
    hamletResidents.length = 0; hamletResidentsActive = false;
  }
  for (const r of hamletResidents) {
    if (r.anim) r.anim.material.emissiveIntensity = matLamp.emissiveIntensity + 0.4;
    const d = dist2(r.g.position.x, r.g.position.z, player.pos.x, player.pos.z);
    if (d < 10) {
      const yaw = Math.atan2(player.pos.x - r.g.position.x, player.pos.z - r.g.position.z);
      let dy = yaw - r.g.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      r.g.rotation.y += dy * Math.min(1, 6 * (dt || 0.016));
      // after The Rumor, the elders offer a standing thank-you (a unique repeatable line)
      if (hamletErrand && d < 3.2) once('hamletthanks', () => msg('An elder rests a hand on your shoulder: “The one who followed the rumor. Whatever you need under these leaves, ask — the hamlet remembers.”', 8, true));
    }
  }
}

/* ---- world search helpers (pure hashes → no chunk need be loaded) ---- */
function nearestChunkOfType(type, maxR) {
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  let best = null, bd = 1e9;
  for (let r = 0; r <= maxR; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const ix = cx + dx, iz = cz + dz;
    if (chunkType(ix, iz) !== type) continue;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = { ix, iz }; }
  }
  return best;
}
function nearestViaduct(maxR) {
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  let best = null, bd = 1e9;
  for (let d = 0; d <= maxR; d++) {
    for (const ix of [cx - d, cx + d]) if (hash2(ix, 0, 6001) % 7 === 0) { const dd = Math.abs(ix - cx); if (dd < bd) { bd = dd; best = { axis: 0, cross: ix * CHUNK, lineChunk: ix }; } }
    for (const iz of [cz - d, cz + d]) if (hash2(0, iz, 6002) % 7 === 0) { const dd = Math.abs(iz - cz); if (dd < bd) { bd = dd; best = { axis: 1, cross: iz * CHUNK, lineChunk: iz }; } }
  }
  return best;
}
// Read a chunk's colData without keeping it: reuse the live chunk if loaded, else build a
// throwaway copy and dispose its geometry (deterministic → identical when it loads for real).
function peekColData(ix, iz) {
  const c = chunks.get(chunkKey(ix, iz));
  if (c) return c.colData;
  const built = buildChunk(ix, iz);
  built.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  return built.colData;
}
function roofTargetIn(ix, iz) {
  const cd = peekColData(ix, iz), cxp = ix * CHUNK + 32, czp = iz * CHUNK + 32;
  let best = null, bd = 1e9;
  for (const s of cd.solids) {                                    // prefer a vined (climbable) rooftop
    if (!s.vine || s.h < 8) continue;
    const x = (s.x0 + s.x1) / 2, z = (s.z0 + s.z1) / 2, d = dist2(x, z, cxp, czp);
    if (d < bd) { bd = d; best = { x, z, y: s.h }; }
  }
  if (best) return best;
  for (const p of cd.pads) {                                      // else a high tree-canopy pad
    if ((p.layer && p.layer !== 'bough') || p.y < 12) continue;
    const d = dist2(p.x, p.z, cxp, czp);
    if (d < bd) { bd = d; best = { x: p.x, z: p.z, y: p.y }; }
  }
  return best || { x: cxp, z: czp, y: 0 };
}
function highCanopyStart() {                                      // nearest Weave / crown-nest pad, for Freefall
  let best = null, bd = 1e9;
  for (const c of chunks.values()) for (const p of c.colData.pads) {
    if (p.layer !== 'weave' && p.layer !== 'nest') continue;
    if (p.y < 24) continue;
    const d = dist2(p.x, p.z, player.pos.x, player.pos.z);
    if (d < bd) { bd = d; best = { x: p.x, z: p.z, y: p.y }; }
  }
  return best;
}

/* ---- The Rumor: three sequential waypoints, each a real deterministic world feature.
   (a) a viaduct broken span, (b) the nearest sinkhole / fern circle / wind-chime, (c) the
   hamlet itself. Located by the same hash formulas the world-gen uses (peeking a throwaway
   chunk only where a feature's exact position needs the rng stream). ---- */
function viaductSpanExists(lineIdx, g) { return (hash2(lineIdx, g, 6003) % 100) < 75; }   // mirrors buildViaductAxis
function findRumorClue1(fromX, fromZ) {
  const v = nearestViaduct(4); if (!v) return null;
  const lineIdx = v.lineChunk, cross = v.cross, along = v.axis === 0 ? fromZ : fromX;
  const centerG = Math.round(along / 16);
  for (let d = 0; d <= 28; d++) {
    for (const g of (d === 0 ? [centerG] : [centerG - d, centerG + d])) {
      if (viaductSpanExists(lineIdx, g)) continue;                        // want a *missing* span…
      let u = null;
      if (viaductSpanExists(lineIdx, g - 1)) u = g * 16 - 1.5;            // …with an existing deck edge beside it
      else if (viaductSpanExists(lineIdx, g + 1)) u = (g + 1) * 16 + 1.5;
      if (u === null) continue;
      return v.axis === 0 ? { x: cross, z: u, y: 9 } : { x: u, z: cross, y: 9 };
    }
  }
  return v.axis === 0 ? { x: cross, z: centerG * 16, y: 9 } : { x: centerG * 16, z: cross, y: 9 };
}
function findRumorClue2(fromX, fromZ) {
  const cx = Math.floor(fromX / CHUNK), cz = Math.floor(fromZ / CHUNK);
  for (let r = 0; r <= 6; r++) {
    let best = null, bd = 1e9, kind = null;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const ix = cx + dx, iz = cz + dz, t = chunkType(ix, iz);
      if (t === 'hamlet') continue;
      let hit = null, hk = null;
      if (t === 'sinkhole') { hit = { x: ix * CHUNK + 32, z: iz * CHUNK + 32, y: -3 }; hk = 'sink'; }
      else if ((t === 'park' || t === 'grove') && hash2(ix, iz, 3221) % 100 < 20) {
        const f = peekColData(ix, iz).ferns[0]; if (f) { hit = { x: f.x, z: f.z, y: 0 }; hk = 'fern'; }
      } else if (hash2(ix, iz, 3444) % 100 < 10) {
        const cd = peekColData(ix, iz); const ch = cd.chimes && cd.chimes[0]; if (ch) { hit = { x: ch.x, z: ch.z, y: 0 }; hk = 'chime'; }
      }
      if (hit) { const dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = hit; kind = hk; } }
    }
    if (best) { best.kind = kind; return best; }
  }
  return null;
}
function bearingPhrase(fromX, fromZ, toX, toZ) {
  const ang = Math.atan2(toX - fromX, -(toZ - fromZ));   // 0 = north(-z), clockwise
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  return dirs[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
}

/* ---- which trials can start right now? ---- */
function trialFeasible(id) {
  if (id === TRIAL.COURIER) return true;                          // a far rooftop can always be computed
  if (id === TRIAL.TRACK) return !!nearestViaduct(2);
  if (id === TRIAL.ASCENT) return true;                           // colossus, else the Spire
  if (id === TRIAL.SALVAGE) return dayF < 0.35 && !!nearestChunkOfType('sinkhole', 8);
  if (id === TRIAL.FREEFALL) return !!highCanopyStart();
  if (id === TRIAL.RUMOR) return !!findRumorClue1(player.pos.x, player.pos.z) && !!findRumorClue2(player.pos.x, player.pos.z);
  return false;
}
function offerableTrials() {
  const out = [];
  for (let i = 0; i < TRIAL_ORDER.length; i++) {
    const id = TRIAL_ORDER[i];
    if (trialUnlocked(i) && trialFeasible(id)) out.push(id);
  }
  return out;
}

/* ---- offer & start ---- */
function offerTrial(tm) {
  if (trial) return;
  const offerable = offerableTrials();
  const allGold = TRIAL_ORDER.every(id => tierIndexDone(id) >= 2);
  if (allGold) { msg('The trial-master bows: “You have gold in every trial. There is nothing left I can teach you.”', 7); return; }
  if (!offerable.length) {
    // find the first locked-but-real reason to steer the player
    const next = TRIAL_ORDER.find((id, i) => trialUnlocked(i) && !trialFeasible(id));
    if (next === TRIAL.SALVAGE) msg('The trial-master eyes the sky: “Night Salvage waits on the dark, and a sinkhole nearby. Come back after dusk.”', 7);
    else if (next === TRIAL.RUMOR) msg('The trial-master lowers their voice: “There is a rumor I could set you on… but it starts at a broken hightrain span, and there is none within reach of here.”', 8);
    else if (next === TRIAL.TRACK) msg('The trial-master shakes their head: “The Track Runner needs a viaduct within reach. Not here.”', 7);
    else msg('The trial-master studies you: “No trial for you here, just now. Prove yourself where the way is open.”', 6);
    return;
  }
  const prefer = TRIAL_ORDER[tm.spec.seed % TRIAL_ORDER.length];
  const id = offerable.includes(prefer) ? prefer : offerable[0];
  startTrial(id, nextTierIndex(id), tm);
}

function fmtTime(s) { s = Math.max(0, s); const m = Math.floor(s / 60), ss = Math.floor(s % 60); return m + ':' + String(ss).padStart(2, '0'); }

function startTrial(id, tierIdx, tm) {
  if (activeMission) failMission('“Leave the errand,” the trial-master says. “This is a greater test.”');
  const tier = TIERS[tierIdx], mult = TIER_MULT[tier];
  const p = player, T = { id, tierIdx, tier, phase: '', timeLeft: 0, title: TRIAL_NAME[id] + ' · ' + tier.toUpperCase(), obj: '', target: null, cpTime: 0, armed: false, carrying: false };
  hideMarks();
  const startMsg = (rule) => msg('TRIAL — ' + TRIAL_NAME[id] + ' (' + tier + '). ' + rule + ' Hold G to abandon.', 9, true);

  if (id === TRIAL.COURIER) {
    const cx = Math.floor(p.pos.x / CHUNK), cz = Math.floor(p.pos.z / CHUNK);
    const dir = [[3, 0], [0, 3], [3, 1], [-3, 1], [1, 3], [1, -3], [-3, 0], [0, -3]][tm ? tm.spec.seed % 8 : 0];
    const ix = cx + dir[0], iz = cz + dir[1];
    T.target = roofTargetIn(ix, iz);
    const dist = dist2(p.pos.x, p.pos.z, T.target.x, T.target.z);
    T.timeLeft = dist / SPRINT_EFF() * mult;
    T.phase = 'run'; T.obj = 'Deliver the satchel to the marked rooftop';
    startMsg('Carry the satchel to the far rooftop before the sun-glass runs out — the ground route is too slow; take to the canopy.');
  } else if (id === TRIAL.TRACK) {
    const v = nearestViaduct(2);
    const along0 = v.axis === 0 ? p.pos.z : p.pos.x;
    const gateAlong = Math.round(along0 / CHUNK) * CHUNK + 8;      // a deck point at a chunk border
    T.v = v; T.dir = 1; T.gateAlong = gateAlong; T.cpIdx = 0; T.nCp = 3;
    T.cpTime = 64 / SPRINT_EFF() * 1.7 * mult;                     // per-64 m checkpoint budget (room for jumps)
    T.phase = 'gate'; T.timeLeft = 999; T.obj = 'Reach the start gate on the deck';
    startMsg('Reach the deck, then run three spans down the line — hit each checkpoint before its clock empties. Fall off the deck and you fail.');
  } else if (id === TRIAL.ASCENT) {
    const col = nearestChunkOfType('colossus', 8);
    if (col) { const ox = col.ix * CHUNK, oz = col.iz * CHUNK; T.target = { x: ox + 32, z: oz + 32, y: 56.5 }; T.baseY = 2; }
    else { T.target = { x: SPIRE.x + 6, z: SPIRE.z + 6, y: SPIRE.h + 10 }; T.baseY = 0; }
    const horiz = dist2(p.pos.x, p.pos.z, T.target.x, T.target.z);
    T.timeLeft = (T.target.y / 1.05 + horiz / SPRINT_EFF()) * 1.7 * mult;
    T.phase = 'climb'; T.obj = 'Reach the beacon at the top'; T.cp1 = false; T.cp2 = false;
    startMsg('Climb to the beacon without ever touching the ground once you have left it. Two rings mark the way up.');
  } else if (id === TRIAL.SALVAGE) {
    const sk = nearestChunkOfType('sinkhole', 8);
    const ox = sk.ix * CHUNK, oz = sk.iz * CHUNK;
    T.relic = { x: ox + 32, z: oz + 32, y: -4 }; T.home = tm ? { x: tm.g.position.x, z: tm.g.position.z } : { x: p.pos.x, z: p.pos.z };
    const dist = dist2(p.pos.x, p.pos.z, T.relic.x, T.relic.z);
    T.timeLeft = (2 * dist) / SPRINT_EFF() * 2.0 * mult;
    T.phase = 'fetch'; T.obj = 'Recover the relic from the sinkhole floor';
    startMsg('Bring the relic up from the sinkhole and back to me. It fouls your flashlight — trust the glow-plants on the way back.');
  } else if (id === TRIAL.FREEFALL) {
    const s = highCanopyStart();
    T.start = s; const cx = Math.floor(p.pos.x / CHUNK), cz = Math.floor(p.pos.z / CHUNK);
    T.ground = { x: cx * CHUNK + 32, z: (cz + 1) * CHUNK + 32, y: 0 };
    T.timeLeft = 999; T.phase = 'ascend'; T.obj = 'Climb to the high start marker';
    T.fallTime = s.y * 0.6 * mult;
    startMsg('Climb to the marker high in the canopy, then drop to the ground marker — fast. Only the leaf layers can catch you; open air onto stone will not.');
  } else if (id === TRIAL.RUMOR) {
    // Second Seed interplay (Part 2, Ch5): if the campaign already discovered the hamlet by
    // walking this very rumor, don't make the player re-run it — record the tier and nod.
    if (typeof STORY_SAVE !== 'undefined' && STORY_SAVE.foundHamletViaStory && hamletFound) {
      if (tierIdx > tierIndexDone(id)) { trialProgress[id] = tierIdx; saveTrials(); }
      if (!hamletErrand) { hamletErrand = true; try { localStorage.setItem('canopy.hamletErrand', '1'); } catch (e) { } }
      msg('The trial-master studies you and nods slowly: “…you have already followed that rumor to its end. The hamlet knows your face now.”', 8, true);
      return;
    }
    // Untimed. Three sequential clues; markers appear only for the already-given clue,
    // and never for the final hamlet clue — the words must be enough.
    T.timeLeft = 999; T.phase = 'clue1';
    T.wp = findRumorClue1(p.pos.x, p.pos.z);
    T.obj = 'Follow the rails until they bend into air';
    startMsg('An old rumor, in three parts. First: “Follow the old hightrain until the rails bend into air.” Seek the broken span.');
  }
  trial = T;
  activeObjective = T.target || (T.relic) || (T.start) || SPIRE;
  updateTrialHUD();
}

function endTrialCommon() {
  hideMarks();
  if (trial && trial.relicMesh) { trial.relicMesh.visible = false; }
  trial = null; activeObjective = SPIRE;
  flashlight.color.setHex(0xfff2d0);
  updateMissionHUD();
}
function failTrial(reason, line) {
  if (line) msg(line, 7);
  endTrialCommon();
}
function abandonTrial() {
  msg('You let the trial go. The trial-master only nods — the way stays open.', 5);
  endTrialCommon();
}
function completeTrial() {
  const T = trial; if (!T) return;
  const prev = tierIndexDone(T.id);
  if (T.tierIdx > prev) { trialProgress[T.id] = T.tierIdx; saveTrials(); }
  sfxTrialDone();
  msg('TRIAL COMPLETE — ' + TRIAL_NAME[T.id] + ', ' + T.tier + ' earned. The trial-master presses a token into your hand.', 9, true);
  const allGold = TRIAL_ORDER.every(id => tierIndexDone(id) >= 2);
  if (allGold && !sprintBoost) {
    sprintBoost = true; try { localStorage.setItem('canopy.sprintboost', '1'); } catch (e) { }
    setTimeout(() => msg('The trial-masters have nothing left to teach you. Your legs feel lighter — you run a shade faster now, always.', 10, true), 9500);
  } else if (allGold) {
    setTimeout(() => msg('The trial-masters have nothing left to teach you.', 8, true), 9500);
  }
  endTrialCommon();
}

function completeRumor() {
  const T = trial; if (!T) return;
  if (T.tierIdx > tierIndexDone(T.id)) { trialProgress[T.id] = T.tierIdx; saveTrials(); }
  sfxTrialDone();
  discoverHamlet();                                       // permanent minimap marker + '…people live here.'
  if (!hamletErrand) { hamletErrand = true; try { localStorage.setItem('canopy.hamletErrand', '1'); } catch (e) { } }
  setTimeout(() => msg('THE RUMOR — followed to its end. The hamlet was real all along. Its elders welcome you into the leaves; there will always be a place for you here now.', 11, true), 4000);
  endTrialCommon();
}

function updateTrialHUD() {
  if (!trial) { trialTimerEl.style.display = 'none'; return; }
  missionEl.style.display = 'block';
  missionTitleEl.textContent = trial.title;
  missionProgEl.textContent = trial.obj;
  if (mmlabelEl) mmlabelEl.textContent = '✦ ' + TRIAL_NAME[trial.id].toUpperCase();
  trialTimerEl.style.display = 'block';
  const t = trial.timeLeft;
  trialTimerEl.textContent = (t >= 999 ? '· · ·' : fmtTime(t));
  trialTimerEl.style.color = t >= 999 ? '#8affd0' : t < 8 ? '#ff5a4a' : t < 20 ? '#ffc061' : '#8affd0';
}

function updateTrials(dt, time) {
  syncTrialMasters();
  // face any nearby master toward the player, gently
  for (const tm of trialMasters.values()) {
    const d = dist2(tm.g.position.x, tm.g.position.z, player.pos.x, player.pos.z);
    if (d < 18) {
      tm.faceYaw = Math.atan2(player.pos.x - tm.g.position.x, player.pos.z - tm.g.position.z);
      let dy = tm.faceYaw - tm.g.rotation.y; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      tm.g.rotation.y += dy * Math.min(1, 6 * dt);
    }
    if (tm.anim) tm.anim.material.emissiveIntensity = matLamp.emissiveIntensity + 0.4;
  }
  if (!trial) {
    const tm = nearestTrialMaster(3.4);
    if (tm) hint('Press E — the trial-master offers a trial', 0.4);
    return;
  }

  const T = trial, p = player;
  // shared fail conditions
  if (T.timeLeft < 999) { T.timeLeft -= dt; if (T.timeLeft <= 0) { failTrial('time', 'The clock beat you. The trial is lost.'); return; } }
  if (T.id !== TRIAL.RUMOR && p.heat >= 98 && p.exposed) { failTrial('heat', 'The sun took you mid-trial — you fold and stagger for the shade.'); return; }   // The Rumor has no fail but abandon

  if (T.id === TRIAL.COURIER) {
    setMark(0, T.target.x, T.target.y + 1.4, T.target.z, 0.8);
    activeObjective = T.target;
    if (dist2(p.pos.x, p.pos.z, T.target.x, T.target.z) < 5 && p.pos.y > T.target.y - 2.2) completeTrial();
  } else if (T.id === TRIAL.TRACK) {
    const v = T.v, cross = v.cross;
    const gatePos = v.axis === 0 ? { x: cross, z: T.gateAlong } : { x: T.gateAlong, z: cross };
    if (T.phase === 'gate') {
      setMark(0, gatePos.x, 9.6, gatePos.z, 0.9);
      activeObjective = { x: gatePos.x, z: gatePos.z };
      if (dist2(p.pos.x, p.pos.z, gatePos.x, gatePos.z) < 3 && p.pos.y > 7) {
        T.phase = 'run'; T.timeLeft = T.cpTime; T.cpIdx = 0;
        msg('Go! Hit each checkpoint before its clock runs out.', 4);
      }
    } else {
      if (p.pos.y < 7) { failTrial('fell', 'You went off the deck. The run is over.'); return; }
      const cpAlong = T.gateAlong + T.dir * 64 * (T.cpIdx + 1);
      const cp = v.axis === 0 ? { x: cross, z: cpAlong } : { x: cpAlong, z: cross };
      setMark(0, cp.x, 9.8, cp.z, 0.9);
      activeObjective = { x: cp.x, z: cp.z };
      if (dist2(p.pos.x, p.pos.z, cp.x, cp.z) < 3) {
        T.cpIdx++;
        if (T.cpIdx >= T.nCp) { completeTrial(); return; }
        T.timeLeft += T.cpTime;                      // refill for the next span
        hint('Checkpoint ' + T.cpIdx + ' / ' + T.nCp, 2);
      }
    }
    T.obj = T.phase === 'gate' ? 'Reach the start gate on the deck' : ('Checkpoint ' + (T.cpIdx + 1) + ' / ' + T.nCp);
  } else if (T.id === TRIAL.ASCENT) {
    setMark(0, T.target.x, T.target.y + 1.2, T.target.z, 0.9);
    // checkpoint rings on the way up
    const h1 = T.baseY + (T.target.y - T.baseY) * 0.33, h2 = T.baseY + (T.target.y - T.baseY) * 0.66;
    if (!T.cp1) setMark(1, T.target.x, h1, T.target.z, 1.2, matRelic);
    if (!T.cp2) setMark(2, T.target.x, h2, T.target.z, 1.2, matRelic);
    activeObjective = T.target;
    if (p.pos.y > T.baseY + 3) T.armed = true;       // now off the ground
    if (T.armed && p.grounded && p.supportLayer === null && !p.onCanopy && p.pos.y < 1.5) { failTrial('ground', 'You touched the ground. The Ascent must be unbroken.'); return; }
    if (!T.cp1 && p.pos.y > h1 - 1.5 && dist2(p.pos.x, p.pos.z, T.target.x, T.target.z) < 12) { T.cp1 = true; TRIAL_POOL[1].visible = false; hint('First ring passed', 2); }
    if (!T.cp2 && p.pos.y > h2 - 1.5 && dist2(p.pos.x, p.pos.z, T.target.x, T.target.z) < 12) { T.cp2 = true; TRIAL_POOL[2].visible = false; hint('Second ring passed', 2); }
    if (dist2(p.pos.x, p.pos.z, T.target.x, T.target.z) < 8 && p.pos.y > T.target.y - 3) completeTrial();
  } else if (T.id === TRIAL.SALVAGE) {
    if (T.phase === 'fetch') {
      setMark(0, T.relic.x, T.relic.y + 0.8, T.relic.z, 0.7, matRelic);
      activeObjective = T.relic;
      if (dist2(p.pos.x, p.pos.z, T.relic.x, T.relic.z) < 3.2 && p.pos.y < 0) {
        T.phase = 'return'; T.carrying = true;
        msg('The relic is cold and heavy. Your flashlight sputters — follow the glow-plants home.', 6);
      }
    } else {
      setMark(0, T.home.x, 1.4, T.home.z, 0.8);
      activeObjective = T.home;
      // carrying fouls the flashlight: dim, flickering, off-tint
      flashlight.color.setHex(0x6a8f7a);
      flashlight.intensity = Math.max(0, flashlight.intensity * (0.3 + 0.4 * Math.abs(Math.sin(time * 11))));
      if (dist2(p.pos.x, p.pos.z, T.home.x, T.home.z) < 4) completeTrial();
    }
  } else if (T.id === TRIAL.FREEFALL) {
    if (T.phase === 'ascend') {
      setMark(0, T.start.x, T.start.y + 1.2, T.start.z, 0.9);
      activeObjective = T.start;
      if (dist2(p.pos.x, p.pos.z, T.start.x, T.start.z) < 4 && p.pos.y > T.start.y - 2) {
        T.phase = 'fall'; T.timeLeft = T.fallTime; T.obj = 'Drop to the ground marker — trust the leaves';
        msg('Now fall. Let the leaves take you down.', 5);
      }
    } else {
      setMark(0, T.ground.x, 1.4, T.ground.z, 0.9);
      activeObjective = T.ground;
      if (dist2(p.pos.x, p.pos.z, T.ground.x, T.ground.z) < 5 && p.pos.y < 4 && p.grounded) completeTrial();
    }
  } else if (T.id === TRIAL.RUMOR) {
    if (T.phase === 'clue1' || T.phase === 'clue2') {
      // a marker only for the clue you've already been given (both are real world features)
      if (T.wp) { setMark(0, T.wp.x, (T.wp.y || 0) + 1.4, T.wp.z, 0.9); activeObjective = T.wp; }
      if (T.wp && dist2(p.pos.x, p.pos.z, T.wp.x, T.wp.z) < 12) {
        if (T.phase === 'clue1') {
          T.phase = 'clue2';
          T.wp = findRumorClue2(p.pos.x, p.pos.z);
          const kindLine = !T.wp ? '' :
            T.wp.kind === 'sink' ? 'Second: “Find where the street fell into the earth.”' :
            T.wp.kind === 'fern' ? 'Second: “Find where the great ferns still grow in a ring.”' :
            'Second: “Find where the old bottles sing in the wind.”';
          T.obj = 'Follow the second clue';
          msg('The broken span — rails ending in open air. Scratched on the last girder, the next line. ' + kindLine, 9, true);
        } else {
          // clue 2 reached → give the final clue with a vague bearing to the hamlet, and NO marker
          hideMarks();
          const dir = bearingPhrase(p.pos.x, p.pos.z, HAMLET.x, HAMLET.z);
          T.phase = 'clue3'; T.wp = null; T.obj = 'Where the giants stand in a circle, look up';
          activeObjective = SPIRE;
          msg('And last: “Where the giants stand in a circle, look up.” No map, no mark — only this: it lies somewhere to the ' + dir + '. Go on foot, and watch the great trees.', 11, true);
        }
      }
    } else {   // clue3 — no marker; the hamlet must be found by the words alone
      hideMarks();
      if (dist2(p.pos.x, p.pos.z, HAMLET.x, HAMLET.z) < 12) { completeRumor(); return; }
    }
    T.timeLeft = 999;
  }
  updateTrialHUD();
}

/* ======================================================================== */
/*  MINIMAP                                                                 */
/* ======================================================================== */
const mm = document.getElementById('minimap');
const mmx = mm.getContext('2d');
const MM_S = 200, MM_SCALE = 0.82;

function drawMinimap() {
  const px = player.pos.x, pz = player.pos.z, yaw = player.yaw;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  mmx.setTransform(1, 0, 0, 1, 0, 0);
  mmx.clearRect(0, 0, MM_S, MM_S);
  mmx.save();
  mmx.beginPath(); mmx.arc(MM_S / 2, MM_S / 2, MM_S / 2 - 1, 0, 7); mmx.clip();
  mmx.fillStyle = '#0d120b'; mmx.fillRect(0, 0, MM_S, MM_S);
  // world→screen: rotate so facing = up
  mmx.setTransform(MM_SCALE * cy, MM_SCALE * sy, -MM_SCALE * sy, MM_SCALE * cy, MM_S / 2, MM_S / 2);
  const bgFor = { city: '#1a2114', towers: '#1c1f18', park: '#16290f', plaza: '#262319', grove: '#122408', spire: '#20240f', hamlet: '#122408' };
  // Regions: macro biome recolours the chunk background — tan scorch, deep-green deepgreen,
  // grey-brown ashen (canopy/spire/hamlet keep the per-type colour above).
  const bgBiome = { scorch: '#2a2412', deepgreen: '#0c1c06', ashen: '#22201c' };
  for (const c of chunks.values()) {
    const dx = c.ix * CHUNK - px, dz = c.iz * CHUNK - pz;
    if (Math.abs(dx) > 190 || Math.abs(dz) > 190) continue;
    mmx.fillStyle = (c.region && bgBiome[c.region.biome]) || bgFor[c.type] || '#1a2114';
    mmx.fillRect(dx + 1.5, dz + 1.5, CHUNK - 3, CHUNK - 3); // gap = streets
    for (const r of c.mini.rects) {
      mmx.fillStyle = r[4] > 30 ? '#4a4f45' : '#3a4036';
      mmx.fillRect(r[0] - px, r[1] - pz, r[2], r[3]);
    }
    mmx.fillStyle = 'rgba(80,150,60,0.5)';
    for (const t of c.mini.trees) {
      if (t[3]) continue;
      mmx.beginPath(); mmx.arc(t[0] - px, t[1] - pz, t[2] * 0.6, 0, 7); mmx.fill();
    }
  }
  // The Hidden Hamlet — no presence until discovered (it reads as an ordinary grove of
  // tree dots); once found, a distinctive warm hut marker persists.
  if (hamletFound) {
    const hdx = HAMLET.x - px, hdz = HAMLET.z - pz;
    if (Math.abs(hdx) < 190 && Math.abs(hdz) < 190) {
      mmx.fillStyle = '#ffb04a';
      mmx.fillRect(hdx - 3, hdz - 2, 6, 4);                        // hut body
      mmx.beginPath(); mmx.moveTo(hdx - 4, hdz - 2); mmx.lineTo(hdx, hdz - 6); mmx.lineTo(hdx + 4, hdz - 2); mmx.fill();   // roof
    }
  }
  // Second Seed (Part 2): the planted oasis — a green dot in the tan, drawn like the hamlet hut.
  if (typeof STORY_SAVE !== 'undefined' && STORY_SAVE.planted) {
    const oa = { x: (SPIRE.cx + STORY_SAVE.planted.dx) * CHUNK + 32, z: (SPIRE.cz + STORY_SAVE.planted.dz) * CHUNK + 32 };
    const odx = oa.x - px, odz = oa.z - pz;
    if (Math.abs(odx) < 190 && Math.abs(odz) < 190) {
      mmx.fillStyle = '#6fe86f';
      mmx.beginPath(); mmx.arc(odx, odz, 3.2, 0, 7); mmx.fill();
      mmx.fillStyle = 'rgba(111,232,111,0.35)';
      mmx.beginPath(); mmx.arc(odx, odz, 6.5, 0, 7); mmx.fill();
    }
  }
  // Seedbearer reward (Part 2, post-campaign): faint icons on anomaly landmarks in loaded chunks —
  // "you have learned to read the city the way the Authority did."
  if (typeof storyComplete === 'function' && storyComplete()) {
    mmx.fillStyle = 'rgba(206,191,154,0.5)';
    for (const c of chunks.values()) {
      if (c.type !== 'colossus' && c.type !== 'sinkhole' && c.type !== 'reservoir' && c.type !== 'fallen') continue;
      const lx = c.ix * CHUNK + 32 - px, lz = c.iz * CHUNK + 32 - pz;
      if (Math.abs(lx) > 190 || Math.abs(lz) > 190) continue;
      mmx.fillRect(lx - 2, lz - 2, 4, 4);
    }
  }
  // The Archivist (Part 2 campaign giver) — an amber dot at the spire base while the campaign runs.
  if (typeof archivist !== 'undefined' && archivist && typeof story !== 'undefined' && story.ch <= 7) {
    mmx.fillStyle = '#ffb04a';
    mmx.beginPath(); mmx.arc(archivist.g.position.x - px, archivist.g.position.z - pz, 3, 0, 7); mmx.fill();
  }
  // summited vantages — faint pins that persist
  mmx.fillStyle = 'rgba(180,210,120,0.55)';
  for (const k of doneVantages) {
    const ci = k.indexOf(','), vx = +k.slice(0, ci), vz = +k.slice(ci + 1);
    if (Math.abs(vx - px) < 180 && Math.abs(vz - pz) < 180) { mmx.beginPath(); mmx.arc(vx - px, vz - pz, 2.6, 0, 7); mmx.fill(); }
  }
  // an available mission-giver, before you accept
  if (giver && !activeMission) {
    mmx.fillStyle = '#ffe27a';
    mmx.beginPath(); mmx.arc(giver.g.position.x - px, giver.g.position.z - pz, 3, 0, 7); mmx.fill();
  }
  // trial-masters nearby (teal diamonds)
  if (typeof trialMasters !== 'undefined') {
    mmx.fillStyle = '#8affd0';
    for (const tm of trialMasters.values()) {
      mmx.beginPath(); mmx.arc(tm.g.position.x - px, tm.g.position.z - pz, 3, 0, 7); mmx.fill();
    }
  }
  // objective marker (the current mission target, or the Spire by default)
  const obj = activeObjective || SPIRE;
  const sdx = obj.x - px, sdz = obj.z - pz;
  const sd = Math.hypot(sdx, sdz);
  mmx.fillStyle = '#ffd85e';
  if (sd * MM_SCALE < MM_S / 2 - 10) {
    mmx.beginPath(); mmx.arc(sdx, sdz, 4.5, 0, 7); mmx.fill();
  }
  mmx.restore();
  mmx.setTransform(1, 0, 0, 1, 0, 0);
  // edge arrow to the spire
  if (sd * MM_SCALE >= MM_S / 2 - 10) {
    const ex = cy * sdx - sy * sdz, ez = sy * sdx + cy * sdz; // screen space
    const el = Math.hypot(ex, ez);
    const ax = MM_S / 2 + ex / el * (MM_S / 2 - 12), az = MM_S / 2 + ez / el * (MM_S / 2 - 12);
    mmx.fillStyle = '#ffd85e';
    mmx.save(); mmx.translate(ax, az); mmx.rotate(Math.atan2(ez, ex));
    mmx.beginPath(); mmx.moveTo(7, 0); mmx.lineTo(-4, -4.5); mmx.lineTo(-4, 4.5); mmx.fill();
    mmx.restore();
  }
  // player arrow (always up)
  mmx.fillStyle = '#e8ffd0';
  mmx.save(); mmx.translate(MM_S / 2, MM_S / 2);
  mmx.beginPath(); mmx.moveTo(0, -8); mmx.lineTo(-5.5, 6); mmx.lineTo(0, 3); mmx.lineTo(5.5, 6); mmx.fill();
  mmx.restore();
  // north tick
  const nx = -sy, nz = -cy; // world north (-z) in screen coords: x' = cy*0 - sy*(-1)= sy?  computed directly:
  const nsx = cy * 0 - sy * (-1), nsz = sy * 0 + cy * (-1);
  mmx.fillStyle = '#8fa383'; mmx.font = 'bold 11px sans-serif'; mmx.textAlign = 'center'; mmx.textBaseline = 'middle';
  mmx.fillText('N', MM_S / 2 + nsx * (MM_S / 2 - 11), MM_S / 2 + nsz * (MM_S / 2 - 11));
  // ring
  mmx.strokeStyle = 'rgba(150,200,120,0.25)'; mmx.lineWidth = 1.5;
  mmx.beginPath(); mmx.arc(MM_S / 2, MM_S / 2, MM_S / 2 - 1, 0, 7); mmx.stroke();
}

/* ======================================================================== */
/*  HUD / MESSAGES                                                          */
/* ======================================================================== */
const clockEl = document.getElementById('clock');
const districtEl = document.getElementById('district');
const airEl = document.getElementById('airtemp');
const altEl = document.getElementById('alt');
const coverEl = document.getElementById('cover');
const tempfillEl = document.getElementById('tempfill');
const hintEl = document.getElementById('hint');
const msgsEl = document.getElementById('msgs');
const vignetteEl = document.getElementById('vignette');
const fadeEl = document.getElementById('fade');
const fpsEl = document.getElementById('fps');

function msg(text, dur, gold) {
  const d = document.createElement('div');
  d.className = 'msg' + (gold ? ' gold' : '');
  d.textContent = text;
  msgsEl.appendChild(d);
  setTimeout(() => { d.style.transition = 'opacity .8s'; d.style.opacity = 0; setTimeout(() => d.remove(), 850); }, (dur || 5) * 1000);
}
let hintUntil = 0;
function hint(text, dur) {
  hintEl.textContent = text; hintEl.style.opacity = 1;
  hintUntil = perfNow() + (dur || 3) * 1000;
}
function perfNow() { return performance.now(); }

const seen = {};
function once(key, fn) { if (!seen[key]) { seen[key] = true; fn(); } }
// Districts (Phase B): first-entry mood lines, keyed by architectural style.
const DISTRICT_MOOD = {
  oldtown: 'Narrow plaster lanes and pitched roofs. Shutters hang crooked; an awning still keeps its faded stripe.',
  blocks: 'Grey slab estates, balconies stacked like drawers. A mural fades on one blank wall, half-swallowed by ivy.',
  glass: 'Glass towers, tiered and cold. The vines have barely started on these — the light still catches every pane.',
  works: 'Rust and old machines. Silos and sawtooth sheds, a dead chimney against the sky. The air tastes of iron.',
  garden: 'Little houses with yards and low fences. Someone’s laundry never came in; the gardens have gone to seed.',
};
// Regions: first-entry mood line per non-canopy macro biome (once, at ground level).
const BIOME_MOOD = {
  scorch: 'The leaves thin, then fail. Open sky over dead streets — the sun owns this quarter. Cross it fast, or cross it at night.',
  deepgreen: 'Under the deep green the day never quite arrives. Trunks like towers, towers like trunks — the city is only a rumor down here.',
  ashen: 'Whole blocks gone to rubble under a healthy roof of leaves. Whatever emptied these streets, the forest never noticed.',
};

/* ======================================================================== */
/*  AUDIO (all synthesized)                                                 */
/* ======================================================================== */
let AC = null, master = null, windGain = null, cricketGain = null, muted = false;
function initAudio() {
  if (AC || SHOT) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.35; master.connect(AC.destination);
    // wind: looped noise → lowpass
    const len = AC.sampleRate * 2, buf = AC.createBuffer(1, len, AC.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
    windGain = AC.createGain(); windGain.gain.value = 0.05;
    src.connect(lp); lp.connect(windGain); windGain.connect(master);
    src.start();
    // crickets: pulsed band of noise-ish square
    const osc = AC.createOscillator(); osc.type = 'square'; osc.frequency.value = 4100;
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4100; bp.Q.value = 9;
    cricketGain = AC.createGain(); cricketGain.gain.value = 0;
    const lfo = AC.createOscillator(); lfo.frequency.value = 17;
    const lfoG = AC.createGain(); lfoG.gain.value = 0;    // scaled at runtime
    lfo.connect(lfoG); lfoG.connect(cricketGain.gain);
    osc.connect(bp); bp.connect(cricketGain); cricketGain.connect(master);
    osc.start(); lfo.start();
    cricketGain._lfoG = lfoG;
  } catch (e) { /* no audio */ }
}
function toggleAudio() {
  if (!AC) { initAudio(); return; }
  muted = !muted;
  master.gain.setTargetAtTime(muted ? 0 : 0.35, AC.currentTime, 0.05);
  hint(muted ? 'sound off' : 'sound on', 1.5);
}
let nextBird = 0, nextChime = 0;
// Nearest wind-chime pole to the player across the 3×3 chunks around them (or null).
function nearestChimeDist() {
  const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const c = chunks.get(chunkKey(cx + dx, cz + dz));
    if (!c) continue;
    for (const ch of c.colData.chimes) {
      const d = Math.hypot(ch.x - player.pos.x, ch.z - player.pos.z);
      if (d < best) best = d;
    }
  }
  return best === Infinity ? null : best;
}
// A gentle randomized pentatonic tinkle, gain scaled by 1/distance. Gated by AC/mute
// (and never runs in SHOT mode, where AC is never created).
function sfxChime(dist) {
  if (!AC || muted) return;
  const penta = [523.25, 587.33, 698.46, 783.99, 880.0];   // C5 D5 F5 G5 A5
  const g0 = clamp(1 - dist / 10, 0, 1) * 0.06;
  const t0 = AC.currentTime + Math.random() * 0.06;
  const nNotes = 1 + (Math.random() * 3 | 0);
  for (let k = 0; k < nNotes; k++) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'triangle';
    const f = penta[(Math.random() * penta.length) | 0] * (Math.random() < 0.5 ? 1 : 2);
    const ts = t0 + k * (0.09 + Math.random() * 0.13);
    o.frequency.setValueAtTime(f, ts);
    g.gain.setValueAtTime(0, ts);
    g.gain.linearRampToValueAtTime(g0, ts + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.9 + Math.random() * 0.7);
    o.connect(g); g.connect(master);
    o.start(ts); o.stop(ts + 1.7);
  }
}
// A rising four-note fanfare on trial completion — AC-gated, same synth idiom as the chime.
function sfxTrialDone() {
  if (!AC || muted) return;
  const notes = [523.25, 659.25, 783.99, 1046.5];   // C5 E5 G5 C6
  const t0 = AC.currentTime + 0.02;
  for (let k = 0; k < notes.length; k++) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'triangle';
    const ts = t0 + k * 0.12;
    o.frequency.setValueAtTime(notes[k], ts);
    g.gain.setValueAtTime(0, ts);
    g.gain.linearRampToValueAtTime(0.09, ts + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.5);
    o.connect(g); g.connect(master);
    o.start(ts); o.stop(ts + 0.6);
  }
}
function stepAudio(time) {
  if (!AC || muted) return;
  if (time > nextChime) {
    nextChime = time + 2.2 + Math.random() * 3.2;
    const d = nearestChimeDist();
    if (d != null && d < 10) sfxChime(d);
  }
  const wind = 0.035 + clamp(player.pos.y / 70, 0, 1) * 0.1 + dayF * 0.015;
  windGain.gain.setTargetAtTime(wind, AC.currentTime, 0.4);
  const cr = nightF * 0.012;
  cricketGain.gain.setTargetAtTime(cr, AC.currentTime, 0.5);
  cricketGain._lfoG.gain.setTargetAtTime(cr, AC.currentTime, 0.5);
  if (dayF > 0.3 && time > nextBird) {
    nextBird = time + 2 + Math.random() * 7;
    const t0 = AC.currentTime + Math.random() * 0.3;
    const nNotes = 1 + (Math.random() * 3 | 0);
    for (let k = 0; k < nNotes; k++) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = 'sine';
      const f = 2000 + Math.random() * 1800;
      const ts = t0 + k * (0.12 + Math.random() * 0.1);
      o.frequency.setValueAtTime(f, ts);
      o.frequency.exponentialRampToValueAtTime(f * (0.6 + Math.random() * 0.3), ts + 0.09);
      g.gain.setValueAtTime(0, ts);
      g.gain.linearRampToValueAtTime(0.05, ts + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.14);
      o.connect(g); g.connect(master);
      o.start(ts); o.stop(ts + 0.2);
    }
  }
}
function sfxStep() {
  if (!AC || muted) return;
  const t = AC.currentTime;
  const o = AC.createBufferSource();
  const len = AC.sampleRate * 0.07, buf = AC.createBuffer(1, len, AC.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  o.buffer = buf;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300 + Math.random() * 250;
  const g = AC.createGain(); g.gain.value = 0.11;
  o.connect(f); f.connect(g); g.connect(master);
  o.start(t);
}

/* ======================================================================== */
/*  MAIN LOOP                                                               */
/* ======================================================================== */
let dayT = 0.30;  // 07:12, a long green morning
let lastT = performance.now();
let frames = 0, fpsT = 0, hudT = 0, mapT = 0;
// Persisted so the Second Seed campaign (Part 2) can gate on it across sessions: the Archivist
// only opens the trail once the player has summited the Spire and seen the whole green world.
let summited = false;
try { summited = localStorage.getItem('canopy.summited') === '1'; } catch (e) { }
let gHold = 0;

// initial world
ensureChunks(player.pos.x, player.pos.z, true);
updateSky(dayT);

/* screenshot / smoke-test presets */
if (SHOT) {
  hideOverlay();
  if (SHOT === '2') { player.pos.set(SPIRE.x - 9.5, SPIRE.h, SPIRE.z); player.yaw = Math.PI / 2; player.pitch = -0.3; dayT = 0.42; }
  else if (SHOT === '3') { dayT = 0.93; player.pos.set(0, 0, 30); player.yaw = Math.PI; }
  else if (SHOT === '4') {
    // The Hidden Hamlet — stand at the centre-facing rim of a platform, looking across the
    // clearing at the bridges and huts. Late-afternoon light so the whole village reads.
    hamletFound = true;
    const g = hamletGiants()[0];   // rim of the first platform, looking across the clearing
    player.pos.set(g.x - Math.cos(g.ang) * 4.2, g.platY + 0.05, g.z - Math.sin(g.ang) * 4.2);
    player.yaw = Math.atan2(HAMLET.x - player.pos.x, HAMLET.z - player.pos.z) + 0.5;
    player.pitch = 0.0; dayT = 0.5;
  }
  else if (SHOT === '5') {
    // Life-pass vignette shot: a conversation pair with a smoke plume behind them.
    dayT = 0.42; player.pos.set(0, 0, 30); player.yaw = Math.PI; player.pitch = 0.03;
  }
  else {
    dayT = 0.42;
    const spawnAngle = Math.random() * Math.PI * 2;
    const spawnDist = 20 + Math.random() * 80;
    player.pos.set(Math.cos(spawnAngle) * spawnDist, 0, 30 + Math.sin(spawnAngle) * spawnDist);
    player.yaw = Math.PI; player.pitch = 0.04;
  }
  // Dev/screenshot spawn override: ?px=&pz= drop the camera at chosen world coords (SHOT only).
  const _spx = params.get('px'), _spz = params.get('pz');
  if (_spx !== null && _spz !== null) { player.pos.set(+_spx, 0, +_spz); player.yaw = Math.PI; player.pitch = 0.04; }
  ensureChunks(player.pos.x, player.pos.z, true);
  if (SHOT === '4') syncHamletResidents(0.016);   // residents in frame for the hamlet shot
  if (SHOT !== '2' && SHOT !== '4' && SHOT !== '5') { // a few citizens in frame
    const spots = [[-6.1, 44, 0.3], [2.5, 52, 2.8], [6.3, 60, -0.4], [-1.5, 68, 1.6], [-6.4, 74, 2.2]];
    for (let k = 0; k < spots.length; k++) {
      const { g } = makeNPCGroup(k === 3, k === 2 ? 'sweep' : 'walk');
      g.position.set(spots[k][0], 0, spots[k][1]);
      g.rotation.y = spots[k][2];
      scene.add(g);
    }
  }
  if (SHOT === '5') {
    // deterministic face-to-face conversation pair, arms up mid-gesture, ~0.8 m apart
    const A = makeNPCGroup(false, 'chat'), B = makeNPCGroup(false, 'chat');
    A.g.position.set(-0.4, 0, 37); A.g.rotation.y = Math.atan2(0.8, 0.6); scene.add(A.g);
    B.g.position.set(0.4, 0, 37.6); B.g.rotation.y = Math.atan2(-0.8, -0.6); scene.add(B.g);
    if (A.anim) A.anim.rotation.x = -0.8;   // speaker's raised hand
    // a couple of onlookers + a smoke plume anchor behind the pair
    for (const s of [[-4.5, 46, 1.4, false], [4.2, 50, -1.2, true]]) {
      const { g } = makeNPCGroup(s[3], 'walk'); g.position.set(s[0], 0, s[1]); g.rotation.y = s[2]; scene.add(g);
    }
    const c = chunkAt(6, 44); if (c) c.colData.smokes.push({ x: 6, y: 7, z: 44, r: 0.5, warm: false });
  }
}

let shotFrames = 0;
function loop() {
  if (!SHOT || shotFrames < 6) requestAnimationFrame(loop); // freeze after a few frames in screenshot mode
  const now = performance.now();
  let dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const time = now / 1000;

  // time of day
  const timeScale = keys.KeyT ? 60 : 1;
  dayT = (dayT + dt * timeScale / DAY_LEN) % 1;

  const active = started || SHOT;
  let climbTouch = null;
  if (active && (locked || SHOT)) climbTouch = stepPlayer(dt);
  else { camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z); camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ'); }

  ensureChunks(player.pos.x, player.pos.z, false);

  // sun shadow frame follows the player (snapped, to avoid shimmer)
  const sx = Math.round(player.pos.x / 4) * 4, sz = Math.round(player.pos.z / 4) * 4;
  sun.target.position.set(sx, 0, sz);
  sun.target.updateMatrixWorld();
  updateSky(dayT, dt);
  updateLampLights();

  // flashlight ramps smoothly toward on/off when toggled
  flashlight.intensity += ((flashOn ? 4.5 : 0) - flashlight.intensity) * Math.min(1, 9 * dt);

  skyGroup.position.set(camera.position.x, 0, camera.position.z);
  ground.position.set(Math.round(player.pos.x / 8) * 8, 0, Math.round(player.pos.z / 8) * 8);

  // above the leaves: the horizon opens up and the canopy sea appears. The sea ring sits
  // at y 26.5 — right inside the Weave (24–28) — so it only reveals once the player is
  // well clear above the Weave, avoiding clipping through the leaf platters.
  const high = smooth(22, 44, player.pos.y);
  const seaReveal = smooth(31, 40, player.pos.y);
  sea.visible = seaReveal > 0.02;
  seaMat.opacity = seaReveal;
  sea.position.set(player.pos.x, 26.5, player.pos.z);
  scene.fog.far = lerp(215, 580, high);
  scene.fog.near = lerp(18, 90, high);

  updateDrifters(time, player.pos.x, player.pos.y, player.pos.z);
  if (active) updateNPCs(dt, time);
  if (active) syncHamletResidents(dt);   // Hidden Hamlet residents (spawn near / cull far)
  if (active) updateAnimals(dt, time);   // "The Returned" — ambient wildlife
  if (active) updateVignettes(dt, time); // Life pass — smoke, scraps, swinging lanterns, drips, banners

  let air = 30;
  if (active) air = stepHeat(dt);

  /* --- story beats & hints --- */
  if (active) {
    once('start', () => { msg('Morning under the leaves. The streets are cool and green.', 7); hint('Follow ✦ on the minimap to reach the Spire', 8); });
    if (climbTouch && player.pos.y < 3) once('vinehint', () => hint('Hold W while facing the vines to climb · look down + W to descend', 6));
    if (player.climbing) once('climbing', () => msg('The vines hold your weight. Up you go.', 5));
    if (player.pos.y > CANOPY_Y + 2) once('above', () => msg('You break through the canopy — raw sun. Your body heat is climbing.', 7));
    if (player.onCanopy) {
      const L = player.supportLayer;
      if (L === 'bough' && player.pos.y >= 14 && player.pos.y <= 21)
        once('boughwalk', () => msg('A great bough, worn smooth by generations of feet — the roads run limb to limb, tree to rooftop.', 7));
      else if (L === 'weave')
        once('weavewalk', () => msg('The Weave. A raft of woven leaves holds you up; the streets are a green blur far below.', 7));
      else if (L === 'nest')
        once('nestwalk', () => msg('A crown nest, alone in the open sky. Someone climbs all the way up here to tend the glow-gardens.', 8));
      else once('canopywalk', () => msg('You are walking on the roof of the forest.', 6));
    }
    if (nightF > 0.6) once('night', () => { msg('Night. The glow-moss wakes, and the fireflies with it.', 7); hint('The lamps still hum — press F for your flashlight', 6); });
    // Districts (Phase B): a mood line the first time you set foot in each style of quarter.
    if (player.pos.y < 6) {
      const dc = chunkAt(player.pos.x, player.pos.z);
      if (dc && dc.type !== 'spire') once('district-' + dc.style, () => msg(DISTRICT_MOOD[dc.style], 7));
      // Regions: mood line the first time the current chunk's biome is a non-canopy one.
      if (dc && dc.region && dc.region.biome !== 'canopy') once('biome-' + dc.region.biome, () => msg(BIOME_MOOD[dc.region.biome], 9));
    }
    for (const n of npcs) {
      if (Math.hypot(n.g.position.x - player.pos.x, n.g.position.z - player.pos.z) < 7) {
        once('people', () => msg('The under-dwellers nod as you pass. Life goes on, just… lower.', 7));
        break;
      }
    }
    if (nightF > 0.5 && player.pos.y < 3) {
      const fc = chunkAt(player.pos.x, player.pos.z);
      if (fc) for (const fr of fc.colData.ferns) {
        if (dist2(fr.x, fr.z, player.pos.x, player.pos.z) < fr.r) {
          once('ferncircle', () => msg('A ring of great ferns, breathing in the dark. Someone planted these in a circle, long ago, and something has kept them.', 8));
          break;
        }
      }
    }
    if (player.inWater) once('water', () => msg('You wade into still, cool water — the heat leaches out of you fast.', 6));
    if (player.inPit && player.pos.y < -1) once('pit', () => msg('Down in the sinkhole the air turns cold and green-lit. The city rim hangs far overhead.', 7));
    if (player.heat > 70) once('hot', () => hint('TOO HOT — get under the leaves or wait for dusk', 5));
    if (!summited && checkSummit(SPIRE.x, SPIRE.z, SPIRE.size / 2, SPIRE.size / 2, SPIRE.h)) {
      summited = true;
      try { localStorage.setItem('canopy.summited', '1'); } catch (e) { }   // unlocks the Second Seed campaign
      doneVantages.add(Math.round(SPIRE.x) + ',' + Math.round(SPIRE.z));
      msg('The Spire. From here the green goes to every horizon — the city is a forest, and the forest is the world now.', 10, true);
      setTimeout(() => msg('Outside the canopy it is 54 °C. There is nowhere to escape to. Head back down — home is under the leaves.', 9, true), 10500);
      if (activeMission && activeMission.arch === ARCH.VANTAGE && Math.round(activeMission.target.x) === Math.round(SPIRE.x)) completeMission();
    }
    if (!seen.spirenear && Math.hypot(player.pos.x - SPIRE.x, player.pos.z - SPIRE.z) < 26 && player.pos.y < 4)
      once('spirenear', () => hint('The old broadcast Spire — vines cover every wall. Climb.', 6));

    // Hidden Hamlet — discovery within 25 m of its centre: fires once, sets the persistent flag.
    if (!hamletFound && Math.hypot(player.pos.x - HAMLET.x, player.pos.z - HAMLET.z) < 25) discoverHamlet();

    if (!SHOT) updateMissions(dt, time);   // give / advance the current errand (never in screenshot mode)
    if (!SHOT) updateTrials(dt, time);     // trial-masters, active trial timing & markers
    // Second Seed campaign (Part 2): runs after trials so its objective/markers win the frame when
    // no trial/errand is live. Objective priority is trial > errand > story > SPIRE — enforced inside
    // updateStory, which only writes activeObjective/HUD when no trial or errand is active.
    if (!SHOT && typeof updateStory === 'function') updateStory(dt, time);

    // abandon a trial by holding G (hint given in the start message) — never soft-locks
    if (trial) {
      if (keys.KeyG) { gHold += dt; if (gHold > 0.9) { abandonTrial(); gHold = 0; } }
      else gHold = 0;
    } else gHold = 0;
  }

  /* --- HUD --- */
  hudT += dt;
  if (hudT > 0.2 && active) {
    hudT = 0;
    const hrs = dayT * 24, hh = Math.floor(hrs), mmn = Math.floor((hrs - hh) * 60);
    clockEl.textContent = String(hh).padStart(2, '0') + ':' + String(mmn).padStart(2, '0');
    const c = chunkAt(player.pos.x, player.pos.z);
    // Regions: append the macro biome for non-canopy quarters ("— the Scorch" etc.)
    const bsuf = (c && c.region && { scorch: ' — the Scorch', deepgreen: ' — the Deep Green', ashen: ' — the Ash Quarters' }[c.region.biome]) || '';
    districtEl.textContent = (c && c.ix === HAMLET.cx && c.iz === HAMLET.cz && hamletFound) ? 'The Hidden Hamlet' : (c ? c.name + bsuf : '—');
    airEl.textContent = Math.round(air);
    altEl.textContent = Math.round(player.pos.y);
    const coverE = player.sunE;
    coverEl.textContent = player.inWater ? 'in water'
      : (player.inPit && player.pos.y < -1) ? 'deep shade'
      : player.exposed ? 'IN THE SUN'
      : coverE < 0.25 ? 'shaded'
      : 'dappled light';
    coverEl.className = player.exposed ? 'exposed'
      : (!player.inWater && !(player.inPit && player.pos.y < -1) && coverE >= 0.25) ? 'dappled' : '';
    tempfillEl.style.width = player.heat.toFixed(0) + '%';
    vignetteEl.style.opacity = smooth(55, 100, player.heat) * 0.9;
    if (perfNow() > hintUntil) hintEl.style.opacity = 0;
  }
  mapT += dt;
  if (mapT > 0.08 && active) { mapT = 0; drawMinimap(); }

  stepAudio(time);

  renderer.render(scene, camera);

  frames++; fpsT += dt;
  if (fpsT >= 1) { fpsEl.textContent = frames + ' fps'; frames = 0; fpsT = 0; }

  if (SHOT) {
    shotFrames++;
    if (shotFrames >= 5) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      statusEl.textContent = 'READY chunks=' + chunks.size + ' err=' + gl.getError() + ' px=' + px.join(',') +
        ' calls=' + renderer.info.render.calls + ' tris=' + renderer.info.render.triangles + ' lost=' + gl.isContextLost();
      document.title = 'READY';
      if (shotFrames === 5) console.log('CANOPY_STATUS ' + statusEl.textContent);
    }
  }
}
loop();
