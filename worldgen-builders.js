/* CANOPY split file  worldgen: chunk-generation builders (trees, buildings, limbs, weave) (was game.js lines 653-1694). Header/error-handler in core.js. */
'use strict';
/* ======================================================================== */
/*  CHUNK GENERATION                                                        */
/* ======================================================================== */
function baseChunkType(ix, iz) {
  if (ix === SPIRE.cx && iz === SPIRE.cz) return 'spire';
  // Anomalies — rare landmark chunk types decided on their own salt so they override the
  // common types (never the spire) at fixed rates while leaving city/park/etc. dominant.
  const rr = hash2(ix, iz, 5150) / 4294967296;
  if (rr < 0.025) return 'colossus';        // ~1/40
  if (rr < 0.065) return 'fallen';          // ~1/25
  if (rr < 0.105) return 'sinkhole';        // ~1/25
  if (rr < 0.145) return 'reservoir';       // ~1/25
  const r = hash2(ix, iz, 1) / 4294967296;
  // Regions: remap the common-type weights per macro biome (anomaly/spire/hamlet
  // untouched above). Base weights match the old thresholds: city .55 park .12 plaza
  // .09 towers .16 grove .08. regionBiome is allocation-free (cheap in ring scans).
  const biome = regionBiome(ix, iz);
  let wCity = 0.55, wPark = 0.12, wPlaza = 0.09, wTowers = 0.16, wGrove = 0.08;
  if (biome === 'scorch') { wPlaza *= 2.5; wCity += wGrove; wGrove = 0; }                 // plaza-heavy, grove→city
  else if (biome === 'deepgreen') { wGrove *= 3; wPark *= 1.5; wCity += wTowers; wTowers = 0; } // groves/parks, towers→city
  if (biome === 'canopy' || biome === 'ashen') return r < 0.55 ? 'city' : r < 0.67 ? 'park' : r < 0.76 ? 'plaza' : r < 0.92 ? 'towers' : 'grove';
  const tot = wCity + wPark + wPlaza + wTowers + wGrove;
  let acc = wCity / tot; if (r < acc) return 'city';
  acc += wPark / tot; if (r < acc) return 'park';
  acc += wPlaza / tot; if (r < acc) return 'plaza';
  acc += wTowers / tot; if (r < acc) return 'towers';
  return 'grove';
}
// Hidden Hamlet — one deterministic chunk in ring 6–10 (Chebyshev) around the Spire.
// Scan a fixed ring-then-row order and take the first candidate whose hash gate passes
// (hash2%5===0) and whose *base* type is a common one (never spire/anomaly). Computed once
// at load; the search is a few hundred integer hashes and is identical every run.
const HAMLET = (function () {
  const common = { city: 1, park: 1, plaza: 1, towers: 1, grove: 1 };
  for (let ring = 6; ring <= 10; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;   // ring perimeter only
      const ix = SPIRE.cx + dx, iz = SPIRE.cz + dz;
      if (hash2(ix, iz, 9001) % 5 !== 0) continue;
      if (!common[baseChunkType(ix, iz)]) continue;
      return { cx: ix, cz: iz, x: ix * CHUNK + 32, z: iz * CHUNK + 32 };
    }
  }
  const ix = SPIRE.cx + 7, iz = SPIRE.cz;                            // deterministic fallback (unreached)
  return { cx: ix, cz: iz, x: ix * CHUNK + 32, z: iz * CHUNK + 32 };
})();
_hamletCell = HAMLET;   // Regions: enable the hamlet full-canopy clamp now that HAMLET is known
function chunkType(ix, iz) {
  if (ix === HAMLET.cx && iz === HAMLET.cz) return 'hamlet';
  return baseChunkType(ix, iz);
}
// Deterministic ring of giants carrying the treehouse village (pure from HAMLET — no rng —
// so the resident-NPC anchors and the platform build agree). h 32–40, platforms y 15–19.
function hamletGiants() {
  const out = [], n = 6, R = 15, cx = HAMLET.x, cz = HAMLET.z;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2 + 0.35;
    out.push({
      x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, ang: a,
      h: 32 + (hash2(k, 0, 4711) % 80) / 10,     // 32.0 .. 39.9
      platY: 15 + (k % 3) * 2                     // 15 / 17 / 19
    });
  }
  return out;
}

function addTree(B, colData, mini, rng, x, z, h, R, opts) {
  opts = opts || {};
  const tr = opts.trunkR || (0.55 + h * 0.028);
  // trunk
  B.plain.addGeo(tplTrunk, compose(x, 0, z, tr, h * 0.97, tr, 0, rng() * 7, (rng() - 0.5) * 0.06), COL.bark, 0.18, rng);
  // roots
  const nRoots = 3 + (rng() * 3 | 0);
  for (let k = 0; k < nRoots; k++) {
    const a = rng() * Math.PI * 2, rl = tr * (0.9 + rng() * 1.1);
    B.plain.addGeo(tplRoot,
      compose(x + Math.cos(a) * tr * 0.75, 0, z + Math.sin(a) * tr * 0.75, tr * 0.38, rl, tr * 0.38, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5),
      COL.barkDark, 0.15, rng);
  }
  if (opts.dead) { mini.trees.push([x, z, R * 0.4, 1]); colData.trunks.push({ x, z, r: tr, h }); return; }
  // canopy blobs
  const nB = opts.blobs || (4 + (rng() * 4 | 0));
  const cy = h * 0.92;
  let padTop = 0;
  for (let k = 0; k < nB; k++) {
    const a = rng() * Math.PI * 2, rr = rng() * R * 0.55;
    const bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr;
    const by = cy + (rng() - 0.4) * R * 0.4;
    const br = R * (0.42 + rng() * 0.33);
    const leafCol = [COL.leafA, COL.leafB, COL.leafC, COL.leafA][(rng() * 4) | 0];
    B.leaf.addGeo(tplBlob, compose(bx, by, bz, br, br * 0.72, br, 0, rng() * 7, 0), leafTintByY(leafCol, by), 0.22, rng);
    padTop = Math.max(padTop, by + br * 0.5);
  }
  // low hanging blob for silhouettes
  if (rng() < 0.5) {
    const br = R * 0.36, a = rng() * 7, ly = cy - R * 0.55;
    B.leaf.addGeo(tplBlob, compose(x + Math.cos(a) * R * 0.5, ly, z + Math.sin(a) * R * 0.5, br, br * 0.6, br, 0, rng() * 7, 0), leafTintByY(COL.leafC, ly), 0.2, rng);
  }
  colData.trunks.push({ x, z, r: tr, h });
  colData.pads.push({ x, z, r: R * 0.8, y: padTop - R * 0.18 });
  mini.trees.push([x, z, R, 0]);
  // Crown Nest on grove giants — reached by climbing the full-height trunk (h).
  // Regions: no nests in scorch (bough/weave/nest layer skipped), a touch more in deepgreen.
  const nestMul = CUR_REG ? (CUR_REG.biome === 'scorch' ? 0 : CUR_REG.biome === 'deepgreen' ? 1.3 : 1) : 1;
  if ((opts.trunkR || 0) >= 1.9 && h >= 32 && rng() < 0.75 * nestMul)
    addCrownNest(B, colData, rng, x, h, z, 2.5 + rng() * 1.4);
}

/* ---- multi-layered canopy (Phase 1): walkable limbs + weave lattice --------
   All batched through the existing `plain`/`leaf` batches, deterministic per
   chunk, and integrated into colData.pads so the existing support check
   (feet within pad.y-1.3 .. +0.6) carries the player along a limb / platter. */
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _qq = new THREE.Quaternion(), _limbM = new THREE.Matrix4();
// Map the unit cylinder (tplCyl: y 0..1, r 1) onto the segment a→b at radius r.
function segMat(ax, ay, az, bx, by, bz, r) {
  _dir.set(bx - ax, by - ay, bz - az);
  const L = _dir.length() || 1e-4;
  _dir.multiplyScalar(1 / L);
  _qq.setFromUnitVectors(_up, _dir);
  _pv.set(ax, ay, az); _s.set(r, L, r);
  return _limbM.compose(_pv, _qq, _s);
}
// A gently curved walkable limb of 3–6 chained cylinder segments, bark below with
// a mossy top strip. Registers a run of small `pads` (r ≈ limb r + 0.3) along the
// top so walking is smooth but the sides are narrow enough to fall off.
function addLimb(B, colData, rng, x0, y0, z0, x1, y1, z1, r, opts) {
  opts = opts || {};
  const segs = opts.segs || (3 + (rng() * 4 | 0));                 // 3..6
  const sag = opts.sag !== undefined ? opts.sag : (0.5 + rng() * 1.3);
  const wob = (rng() - 0.5) * 0.5;                                 // tiny lateral weave
  const bark = _c.copy(COL.bark).multiplyScalar(0.82 + rng() * 0.3).clone();
  const moss = _c.copy(COL.moss).multiplyScalar(0.8 + rng() * 0.4).clone();
  // sample the curve (gentle sag + slight wobble → the per-segment rotation)
  const pts = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const px = lerp(x0, x1, t), pz = lerp(z0, z1, t);
    const py = lerp(y0, y1, t) - Math.sin(t * Math.PI) * sag + Math.sin(t * Math.PI * 2) * wob;
    pts.push([px, py, pz]);
  }
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[k + 1], rr = r * (1 - 0.12 * (k / segs));
    B.plain.addGeo(tplCyl, segMat(a[0], a[1], a[2], b[0], b[1], b[2], rr), bark, 0.16, rng);
    // mossy top strip (two-tone vertex colour via quad), normal facing up
    let hx = b[0] - a[0], hz = b[2] - a[2]; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const px2 = -hz, pz2 = hx, hw = rr * 0.9;
    B.plain.quad(
      [a[0] - px2 * hw, a[1] + rr, a[2] - pz2 * hw],
      [a[0] + px2 * hw, a[1] + rr, a[2] + pz2 * hw],
      [b[0] + px2 * hw, b[1] + rr, b[2] + pz2 * hw],
      [b[0] - px2 * hw, b[1] + rr, b[2] - pz2 * hw],
      [0, 0, 1, 1], moss);
  }
  // epiphyte tufts (Phase 3): occasional tiny leaf blobs perched on the limb top —
  // the mossy, overgrown Bough-Road underside look. Visual only (no collision).
  if (opts.tufts) {
    const nT = 1 + (rng() * 3 | 0);
    for (let k = 0; k < nT; k++) {
      const tt = 0.15 + rng() * 0.7, fp = tt * segs, si = Math.min(segs - 1, fp | 0), sf = fp - si;
      const a = pts[si], b = pts[si + 1];
      const ex = lerp(a[0], b[0], sf), ey = lerp(a[1], b[1], sf), ez = lerp(a[2], b[2], sf);
      const er = 0.32 + rng() * 0.5;
      const ecol = leafTintByY([COL.leafA, COL.leafC, COL.moss][(rng() * 3) | 0], ey);
      B.leaf.addGeo(tplBlob, compose(ex + (rng() - 0.5) * r, ey + r * 0.6, ez + (rng() - 0.5) * r, er, er * 0.55, er, 0, rng() * 7, 0), ecol, 0.25, rng);
    }
  }
  if (opts.noPads) return;
  // walkable pads at ~1.3 m spacing along the limb top (overlapping so it's smooth)
  const step = 1.3;
  const layer = opts.layer || null;
  const dropPad = (p) => colData.pads.push({ x: p[0], z: p[2], r: r + 0.3, y: p[1] + r, layer });
  dropPad(pts[0]);
  let dist = 0, nextAt = step;
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[k + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-4;
    while (nextAt <= dist + L) {
      const t = (nextAt - dist) / L;
      dropPad([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
      nextAt += step;
    }
    dist += L;
  }
  dropPad(pts[segs]);
}

// L1 Bough Roads (~15–20 m): 2–4 walkable limb spans per chunk connecting street
// trees to each other or to a nearby building rooftop (landing just above the roof).
function addBoughRoads(B, colData, rng, ox, oz, type) {
  const trees = [];
  for (const t of colData.trunks) if (t.h >= 14 && t.r >= 0.7) trees.push(t);   // real trees only
  if (trees.length === 0) return;
  const roofs = [];
  for (const s of colData.solids) if (s.h >= 8) roofs.push(s);                   // building tops
  let nSpans = 2 + (rng() * 2 | 0);
  if (type === 'park' || type === 'grove') nSpans = 3 + (rng() * 2 | 0);
  else if (type === 'plaza') nSpans = 1 + (rng() * 2 | 0);
  for (let s = 0; s < nSpans; s++) {
    const src = trees[(rng() * trees.length) | 0];
    let tgt = null, tgtY = 0, ex = 0, ez = 0, bd = 1e9;
    const preferRoof = roofs.length && rng() < 0.5;
    for (let k = 0; k < trees.length; k++) {                                     // tree ↔ tree
      const o = trees[k]; if (o === src) continue;
      const d = Math.hypot(o.x - src.x, o.z - src.z);
      if (d < 10 || d > 40) continue;
      if (d < bd) { bd = d; tgt = o; tgtY = clamp(o.h * 0.68, 14, 20); ex = o.x; ez = o.z; }
    }
    for (let k = 0; k < roofs.length; k++) {                                     // tree ↔ rooftop
      const rf = roofs[k];
      const rx = clamp(src.x, rf.x0, rf.x1), rz = clamp(src.z, rf.z0, rf.z1);    // nearest parapet point
      const d = Math.hypot(rx - src.x, rz - src.z);
      if (d < 8 || d > 40) continue;
      if (d < bd || (preferRoof && tgt && d < bd * 1.4)) { bd = d; tgt = rf; tgtY = rf.h + 0.5; ex = rx; ez = rz; }
    }
    if (!tgt) continue;
    const srcY = clamp(src.h * 0.68, 14, 20);                                    // attach at 60–75% trunk height
    const dx = ex - src.x, dz = ez - src.z, dl = Math.hypot(dx, dz) || 1;
    const sx = src.x + dx / dl * (src.r + 0.2), sz = src.z + dz / dl * (src.r + 0.2);
    addLimb(B, colData, rng, sx, srcY, sz, ex, tgtY, ez, 0.5 + rng() * 0.3, { layer: 'bough', tufts: true });
    // a vine dangling from the fork down to the street — a way up onto the bough road
    if (rng() < 0.5) addVineRope(B, colData, rng, sx, sz, srcY, 0);
  }
}

// L2 The Weave (~24–28 m): interlocking flattened leaf platters tying crowns
// together, ~60–75% coverage with deliberate 4–8 m light-well gaps, none over
// plaza, thinner over the street borders. Placement is decided on a GLOBAL cell
// grid via hash2(gx,gz,…) so neighbouring chunks agree on the field; each chunk
// only emits the cells whose centre lies inside it (owner emits whole geometry),
// with large radii overhanging the borders for a seamless canopy.
function addWeave(B, colData, rng, ix, iz, ox, oz, type) {
  if (type === 'plaza') return;                          // plazas keep open sky
  if (type === 'colossus') return;                       // the colossus crown replaces the Weave
  if (type === 'sinkhole') return;                       // open sky over the pit is dramatic
  const N = 5, S = CHUNK / N;                            // 5×5 global cells, 12.8 m each
  const norm = (h) => (h >>> 0) / 4294967296;
  const cov = (CUR_REG && CUR_REG.biome === 'deepgreen') ? 0.90 : 0.66;   // Regions: deepgreen ≈90% coverage
  const placed = [];
  const wells = [];                                       // interior light-well cells (for net hammocks)
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const gx = ix * N + i, gz = iz * N + j;
    const h = hash2(gx, gz, 4242);
    const edge = (i === 0 || j === 0 || i === N - 1 || j === N - 1);   // over the street borders
    // Sky nets (Feature B): interior threshold nudged 0.60→0.66 so a little more of the
    // canopy fills in — noticeably less open sky from the street, still dappled, not a lid.
    if (norm(h) > (edge ? 0.30 : cov)) {                 // else: a light well — dappled, sky through
      if (!edge) wells.push({ x: ox + (i + 0.5) * S, z: oz + (j + 0.5) * S, h });
      continue;
    }
    const h2 = hash2(gx, gz, 99), h3 = hash2(gz, gx, 77);
    const jx = (((h >>> 8) & 255) / 255 - 0.5) * S * 0.5;
    const jz = (((h >>> 16) & 255) / 255 - 0.5) * S * 0.5;
    const cxp = ox + (i + 0.5) * S + jx, czp = oz + (j + 0.5) * S + jz;
    const R = 4 + norm(h2) * 4;                           // r 4..8
    const py = 24 + norm(h3) * 4;                         // y 24..28
    const flat = 0.25 + ((h2 >>> 10) & 15) / 15 * 0.1;    // y-scale 0.25..0.35
    const leafCol = [COL.leafA, COL.leafB, COL.leafC][(h2 >>> 5) % 3];
    B.leaf.addGeo(tplBlob, compose(cxp, py, czp, R, R * flat, R, 0, ((h >>> 3) & 255) / 255 * 7, 0), leafTintByY(leafCol, py), 0.2, rng);
    colData.pads.push({ x: cxp, z: czp, r: R * 0.82, y: py, layer: 'weave' });   // walkable platter
    placed.push({ x: cxp, y: py, z: czp, R, flat });
  }
  // Hanging fringe (Phase 3): short vine ribbons dangling from each platter's underside
  // rim — the "delicately intertwined" look seen from the street below. Visual only.
  for (let k = 0; k < placed.length; k++) {
    const pl = placed[k];
    const nFr = 3 + (rng() * 4 | 0);                      // 3..6 ribbons per platter
    const under = pl.y - pl.R * pl.flat * 0.7;            // just below the platter's flattened rim
    for (let f = 0; f < nFr; f++) {
      const a = rng() * Math.PI * 2, rr = pl.R * (0.5 + rng() * 0.38);
      const fx = pl.x + Math.cos(a) * rr, fz = pl.z + Math.sin(a) * rr;
      const len = rng() < 0.3 ? 2.8 + rng() * 1.4 : 0.5 + rng() * 2.0, w = 0.22 + rng() * 0.34;   // some hang to ~4 m (head height under platters)
      const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
      const col = _c.copy(COL.vine).multiplyScalar(0.58 + rng() * 0.34).clone();
      B.vine.quad([fx - dx, under - len, fz - dz], [fx + dx, under - len, fz + dz], [fx + dx, under, fz + dz], [fx - dx, under, fz - dz],
        [0, 0, 1, Math.max(1, Math.round(len / 2))], col);
    }
  }
  // thin lattice limbs weaving between nearby platters — visual intertwining, no pads.
  // Record which platter pairs a limb ties so net panels only fill the gaps that don't
  // already have a woody link (Feature B).
  const pairKey = (a, b) => a < b ? a + '_' + b : b + '_' + a;
  const linked = new Set();
  for (let k = 0; k < placed.length; k++) {
    let bestI = -1, bd = 1e9;
    for (let m = 0; m < placed.length; m++) {
      if (m === k) continue;
      const d = Math.hypot(placed[m].x - placed[k].x, placed[m].z - placed[k].z);
      if (d > 6 && d < bd) { bd = d; bestI = m; }
    }
    if (bestI < 0 || bd >= 18) continue;
    if (rng() < 0.55) continue;
    linked.add(pairKey(k, bestI));
    addLimb(B, colData, rng, placed[k].x, placed[k].y - 0.4, placed[k].z, placed[bestI].x, placed[bestI].y - 0.4, placed[bestI].z, 0.18, { noPads: true, segs: 3, sag: 0.5 });
  }

  /* ---- Sky nets (Feature B): sagging woven panels between un-linked crown pairs,
          horizontal hammocks half-covering some light wells, and long aerial creepers.
          Kept clear of the canal sky-corridor so the water line stays a touch more open. */
  const overCanal = (x, z) => {
    const m = CANAL.half + 2;
    if (isCanalX(ix) && Math.abs(x - ox) < m) return true;
    if (isCanalX(ix + 1) && Math.abs(x - (ox + CHUNK)) < m) return true;
    if (isCanalZ(iz) && Math.abs(z - oz) < m) return true;
    if (isCanalZ(iz + 1) && Math.abs(z - (oz + CHUNK)) < m) return true;
    return false;
  };
  // sagging net panels between nearby platters that no limb already ties (~3–5 / chunk)
  let nets = 0;
  const netCap = 5;
  const madeNet = new Set();
  for (let k = 0; k < placed.length && nets < netCap; k++) {
    let bestI = -1, bd = 1e9;
    for (let m = 0; m < placed.length; m++) {
      if (m === k) continue;
      const d = Math.hypot(placed[m].x - placed[k].x, placed[m].z - placed[k].z);
      if (d > 7 && d < bd) { bd = d; bestI = m; }
    }
    if (bestI < 0 || bd >= 20) continue;
    const key = pairKey(k, bestI);
    if (linked.has(key) || madeNet.has(key)) continue;
    if (rng() < 0.45) continue;
    madeNet.add(key);
    addNetPanel(B, rng, placed[k], placed[bestI]);
    nets++;
  }
  // horizontal hammocks partially spanning a light well (well stays partly open); ~20% walkable
  for (let k = 0; k < wells.length && nets < netCap; k++) {
    const w = wells[k];
    if (norm(hash2(w.x | 0, w.z | 0, 7788)) > 0.5) continue;   // only some wells get one
    if (overCanal(w.x, w.z)) continue;                          // keep the canal corridor open
    const walk = norm(hash2(w.x | 0, w.z | 0, 3311)) < 0.20;    // ~20% register a walkable pad
    addNetHammock(B, colData, rng, w.x, w.z, 25 + norm(w.h) * 2, S * 0.5, walk);
    nets++;
  }
  // aerial creepers: long diagonal/horizontal catenary vine strands crown-to-crown (20–30 m)
  if (placed.length >= 2) {
    const nCreep = 4 + (rng() * 5 | 0);                         // 4..8
    for (let k = 0; k < nCreep; k++) {
      const a = placed[(rng() * placed.length) | 0];
      let b = null, bd = 1e9;
      for (let m = 0; m < placed.length; m++) {
        const d = Math.hypot(placed[m].x - a.x, placed[m].z - a.z);
        if (d >= 18 && d <= 32 && d < bd) { bd = d; b = placed[m]; }
      }
      if (!b) continue;
      addCreeper(B, rng, a.x, a.y - 0.3, a.z, b.x, b.y - 0.3, b.z);
    }
  }
  // Vine ropes: 2–4 climbable verticals hanging from platter undersides straight down
  // to whatever rooftop lies beneath (else the ground). Placed at platter centres so a
  // climber topping out lands cleanly on the platter's walkable pad.
  let ropes = 0;
  const ropeMul = (CUR_REG && CUR_REG.biome === 'deepgreen') ? 1.5 : 1;   // Regions: extra vine ropes in deepgreen
  const maxRopes = Math.round((2 + (rng() * 3 | 0)) * ropeMul);           // 2..4 (×1.5 deepgreen)
  for (let k = 0; k < placed.length && ropes < maxRopes; k++) {
    if (rng() < 0.45) continue;
    const pl = placed[k];
    let yBot = 0;
    for (const s of colData.solids) {                    // land on a roof under the platter, if any
      if (s.h < 6 || s.h > pl.y - 2) continue;
      if (pl.x > s.x0 && pl.x < s.x1 && pl.z > s.z0 && pl.z < s.z1) yBot = Math.max(yBot, s.h);
    }
    addVineRope(B, colData, rng, pl.x, pl.z, pl.y, yBot);
    ropes++;
  }
}

// Sky nets (Feature B) --------------------------------------------------------
// A sagging woven net panel strung between two crown platters' rims. Built as a
// 2×3 grid of quads into B.net (matNet, alphaTest rope texture); the middle sags,
// the ends attach just under each platter, and the whole sheet tilts with the
// height difference of the two crowns. Visual only (no pads — see hammocks).
const NET_COL = () => _c.copy(COL.deadwood).lerp(COL.bark, 0.4).multiplyScalar(0.85).clone();
function addNetPanel(B, rng, A, Bp) {
  let dx = Bp.x - A.x, dz = Bp.z - A.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const px = -dz, pz = dx;                                 // width axis (perpendicular)
  const x0 = A.x + dx * A.R * 0.8, z0 = A.z + dz * A.R * 0.8;
  const x1 = Bp.x - dx * Bp.R * 0.8, z1 = Bp.z - dz * Bp.R * 0.8;
  const y0 = A.y - A.R * A.flat * 0.5, y1 = Bp.y - Bp.R * Bp.flat * 0.5;
  const width = 2.2 + rng() * 1.8, sag = 1.1 + rng() * 1.3;
  const nu = 2 + (rng() < 0.5 ? 1 : 0), nv = 2;            // 2..3 along × 2 across
  const col = NET_COL();
  const P = (iu, iv) => {
    const tu = iu / nu, tv = iv / nv - 0.5;
    return [lerp(x0, x1, tu) + px * width * tv, lerp(y0, y1, tu) - Math.sin(tu * Math.PI) * sag, lerp(z0, z1, tu) + pz * width * tv];
  };
  for (let iu = 0; iu < nu; iu++) for (let iv = 0; iv < nv; iv++)
    B.net.quad(P(iu, iv), P(iu + 1, iv), P(iu + 1, iv + 1), P(iu, iv + 1), [0, 0, 2, 2], col);
}
// A larger horizontal hammock net half-covering a light well (well stays partly open).
// 2×2 quads with a gentle centre sag + slight tilt; ~20% register a walkable 'net' pad
// set a touch below the sheet centre so landing on it feels like sinking into the sag.
function addNetHammock(B, colData, rng, cx, cz, y, size, walk) {
  const half = size * 0.5, sag = 0.8 + rng() * 0.9;
  const tiltX = (rng() - 0.5) * 0.14, tiltZ = (rng() - 0.5) * 0.14;
  const col = NET_COL();
  const nu = 2, nv = 2;
  const P = (iu, iv) => {
    const u = (iu / nu - 0.5), v = (iv / nv - 0.5);
    const bx = cx + u * size, bz = cz + v * size;
    const by = y + u * size * tiltX + v * size * tiltZ - Math.cos(u * Math.PI) * Math.cos(v * Math.PI) * sag;
    return [bx, by, bz];
  };
  for (let iu = 0; iu < nu; iu++) for (let iv = 0; iv < nv; iv++)
    B.net.quad(P(iu, iv), P(iu + 1, iv), P(iu + 1, iv + 1), P(iu, iv + 1), [0, 0, size / 6, size / 6], col);
  if (walk) colData.pads.push({ x: cx, z: cz, r: half * 0.7, y: y - sag * 0.5, layer: 'net' });
}
// A long aerial creeper: a thin vine ribbon strung crown-to-crown in a shallow catenary
// (diagonal/horizontal, not a vertical drop). Multiple B.vine segments; sags in the middle.
function addCreeper(B, rng, x0, y0, z0, x1, y1, z1) {
  const segs = 5 + (rng() * 3 | 0), sag = 1.5 + rng() * 2.5, w = 0.22 + rng() * 0.16;
  const col = _c.copy(COL.vine).multiplyScalar(0.6 + rng() * 0.3).clone();
  const pt = (t) => [lerp(x0, x1, t), lerp(y0, y1, t) - 4 * sag * t * (1 - t), lerp(z0, z1, t)];
  const vRep = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 4));
  let prev = pt(0);
  for (let k = 1; k <= segs; k++) {
    const cur = pt(k / segs);
    // a thin vertical ribbon following the strand (top/bottom offset by w)
    B.vine.quad([prev[0], prev[1] - w, prev[2]], [cur[0], cur[1] - w, cur[2]], [cur[0], cur[1] + w, cur[2]], [prev[0], prev[1] + w, prev[2]],
      [0, 0, vRep / segs, 1], col);
    prev = cur;
  }
}

// A thin, climbable hanging vine: two crossed vine-textured ribbons + a `trunks`
// entry (r ≈ 0.35, h = yTop) so the existing climb code carries the player up it.
// yTop should sit at a walkable pad (a Weave platter or a limb) so the mantle-over
// at the top drops the player onto solid footing.
function addVineRope(B, colData, rng, x, z, yTop, yBot) {
  if (yTop - yBot < 2) return;
  const col = _c.copy(COL.vine).multiplyScalar(0.68 + rng() * 0.44).clone();
  const w = 0.5, vRep = Math.max(1, Math.round((yTop - yBot) / 5));
  const lean = (rng() - 0.5) * 0.7, bx = x + lean, bz = z + (rng() - 0.5) * 0.7;   // slight drift toward top
  B.vine.quad([x - w / 2, yBot, z], [x + w / 2, yBot, z], [bx + w / 2, yTop, bz], [bx - w / 2, yTop, bz], [0, 0, 1, vRep], col);
  B.vine.quad([x, yBot, z - w / 2], [x, yBot, z + w / 2], [bx, yTop, bz + w / 2], [bx, yTop, bz - w / 2], [0, 0, 1, vRep], col);
  colData.trunks.push({ x, z, r: 0.35, h: yTop });
}

// Spiral limb: a walkable/climbable ramp that wraps a tower's corners as it rises from
// roughly roof level up into the Weave band (24–28). 3–5 gently-sagging limb segments,
// each stepping to the next corner one level up, offset just off the facade.
function addSpiralLimb(B, colData, rng, cx, cz, w, d, h) {
  const O = 0.7;                                          // stand-off from the wall
  const corners = [
    [cx - w / 2 - O, cz - d / 2 - O], [cx + w / 2 + O, cz - d / 2 - O],
    [cx + w / 2 + O, cz + d / 2 + O], [cx - w / 2 - O, cz + d / 2 + O]
  ];
  const segs = 3 + (rng() * 3 | 0);                      // 3..5
  const startY = clamp(h - 12, 11, 20);
  const endY = clamp(h + 1, 25, 28);
  const dy = (endY - startY) / segs;
  let ci = (rng() * 4) | 0, prev = corners[ci], prevY = startY;
  for (let k = 0; k < segs; k++) {
    ci = (ci + 1) % 4;
    const nxt = corners[ci], ny = prevY + dy;
    addLimb(B, colData, rng, prev[0], prevY, prev[1], nxt[0], ny, nxt[1], 0.42, { segs: 2, sag: 0.3, layer: 'bough' });
    prev = nxt; prevY = ny;
  }
}

// L3 Crown Nest (y 32–40): a woven basket platform (walkable pad), a twig railing, 1–2
// leaf umbrellas ~3 m overhead (real shadow → shade patch), some glow plants, and on
// ~30% a lamp-material beacon blob. Sits atop a giant trunk or a tower roof.
function addCrownNest(B, colData, rng, x, y, z, r) {
  const basket = _c.copy(COL.wood).multiplyScalar(0.9 + rng() * 0.3).clone();
  B.plain.addGeo(tplCyl, compose(x, y - 0.45, z, r, 0.55, r), basket, 0.14, rng);        // basket body
  B.plain.addGeo(tplCyl, compose(x, y - 0.12, z, r, 0.18, r), _c.copy(COL.moss).multiplyScalar(0.9).clone(), 0.16, rng); // mossy rim
  colData.pads.push({ x, z, r: r * 0.82, y, layer: 'nest' });
  const posts = 8 + (rng() * 4 | 0);                                                       // twig railing
  for (let k = 0; k < posts; k++) {
    const a = k / posts * Math.PI * 2;
    B.plain.addGeo(tplCyl, compose(x + Math.cos(a) * r * 0.92, y, z + Math.sin(a) * r * 0.92, 0.05, 0.65, 0.05, (rng() - 0.5) * 0.12, 0, (rng() - 0.5) * 0.12), COL.deadwood, 0.1, rng);
  }
  const nUmb = 1 + (rng() < 0.5 ? 1 : 0);                                                  // leaf umbrellas overhead
  for (let k = 0; k < nUmb; k++) {
    const ur = r * (0.7 + rng() * 0.45);
    B.leaf.addGeo(tplBlob, compose(x + (rng() - 0.5) * r * 0.5, y + 2.8 + rng() * 0.8, z + (rng() - 0.5) * r * 0.5, ur, ur * 0.5, ur, 0, rng() * 7, 0),
      [COL.leafA, COL.leafC][(rng() * 2) | 0], 0.2, rng);
  }
  if (rng() < 0.6) {                                                                       // glow garden
    const n = 1 + (rng() * 2 | 0);
    for (let k = 0; k < n; k++) {
      const a = rng() * 7, d2 = rng() * r * 0.6, s = 0.22 + rng() * 0.25;
      B.glow.addGeo(tplBlob, compose(x + Math.cos(a) * d2, y + s * 0.4, z + Math.sin(a) * d2, s, s * 0.7, s, 0, rng() * 7, 0), COL.glowPlant, 0.3, rng);
    }
  }
  if (rng() < 0.3)                                                                         // beacon
    B.lamp.addGeo(tplBlob, compose(x, y + 0.85, z, 0.4, 0.4, 0.4), srgb(0xffe0b0), 0, rng);
}

function addGrassTuft(B, rng, x, z, s, y) {
  y = y || 0;
  let col = rng() < 0.5 ? COL.grassA : COL.grassB;
  // Regions: scorch → straw, ashen → grey-dust; deepgreen keeps the lush base green.
  if (CUR_REG) {
    if (CUR_REG.biome === 'scorch') col = _c.copy(COL.leafDry).multiplyScalar(0.92).clone();
    else if (CUR_REG.biome === 'ashen') col = _c.copy(col).lerp(srgb(0x9a9a86), 0.4).clone();
  }
  const dark = _c.copy(col).multiplyScalar(0.55).clone();
  for (let k = 0; k < 2; k++) {
    const a = rng() * Math.PI + k * Math.PI / 2;
    const dx = Math.cos(a) * s * 0.5, dz = Math.sin(a) * s * 0.5;
    B.grass.quad([x - dx, y, z - dz], [x + dx, y, z + dz], [x + dx, y + s, z + dz], [x - dx, y + s, z - dz],
      [0, 0, 1, 1], col, dark);
  }
}

function addWallVines(B, rng, x0, z0, x1, z1, h, side) {
  // side: 0:+x face 1:-x 2:+z 3:-z ; strips hang on that face
  const n = 5 + (rng() * 7 | 0);
  for (let k = 0; k < n; k++) {
    const w = 1.8 + rng() * 2.4;
    const top = h * (0.55 + rng() * 0.45);
    const len = top * (0.5 + rng() * 0.5);
    const o = 0.14;
    const t = rng();
    const col = _c.copy(COL.vine).multiplyScalar(0.8 + rng() * 0.4).clone();
    const vRep = Math.max(1, Math.round(len / 5));
    let a, b, c2, d;
    if (side === 0) { const px = x1 + o, pz = lerp(z0 + 1, z1 - 1, t); a = [px, top - len, pz - w / 2]; b = [px, top - len, pz + w / 2]; c2 = [px, top, pz + w / 2]; d = [px, top, pz - w / 2]; }
    else if (side === 1) { const px = x0 - o, pz = lerp(z0 + 1, z1 - 1, t); a = [px, top - len, pz + w / 2]; b = [px, top - len, pz - w / 2]; c2 = [px, top, pz - w / 2]; d = [px, top, pz + w / 2]; }
    else if (side === 2) { const pz = z1 + o, px = lerp(x0 + 1, x1 - 1, t); a = [px + w / 2, top - len, pz]; b = [px - w / 2, top - len, pz]; c2 = [px - w / 2, top, pz]; d = [px + w / 2, top, pz]; }
    else { const pz = z0 - o, px = lerp(x0 + 1, x1 - 1, t); a = [px - w / 2, top - len, pz]; b = [px + w / 2, top - len, pz]; c2 = [px + w / 2, top, pz]; d = [px - w / 2, top, pz]; }
    B.vine.quad(a, b, c2, d, [0, 0, 1, vRep], col);
  }
}

// Weathered facade tints — linear multipliers over the grey concrete atlas. Districts
// (Phase A) swap the pool per neighbourhood so each reads as its own architecture; the
// blocks pool doubles as the neutral fallback (concrete-heavy, the odd painted render).
const BONE_TINT = srgb(0xcfc8b4);   // Regions: scorch sun-bleached facade wash (paler, desaturated)
const DUST_TINT = srgb(0x8f8c82);   // Regions: ashen grey-dust facade wash
function mkTints(a) { return a.map(v => new THREE.Color(v[0], v[1], v[2])); }
const FACADE_TINTS = mkTints([          // blocks: pale grey / beige concrete
  [0.95, 0.94, 0.88], [0.95, 0.94, 0.88], [0.90, 0.89, 0.84], [0.86, 0.87, 0.85],
  [0.92, 0.90, 0.85], [0.82, 0.83, 0.82]
]);
const STYLE_TINTS = {
  oldtown: mkTints([                     // warm plasters
    [1.06, 0.74, 0.55], [1.03, 0.86, 0.58], [0.98, 0.79, 0.77], [1.07, 1.00, 0.85], [1.02, 0.80, 0.62]
  ]),
  blocks: FACADE_TINTS,
  glass: mkTints([                       // cool blue-greens
    [0.72, 0.82, 0.92], [0.73, 0.90, 0.85], [0.68, 0.86, 0.88], [0.75, 0.86, 0.80], [0.66, 0.80, 0.90]
  ]),
  works: mkTints([                       // rust / brown / dark red
    [0.66, 0.42, 0.30], [0.55, 0.40, 0.32], [0.60, 0.34, 0.30], [0.70, 0.52, 0.36], [0.48, 0.38, 0.34]
  ]),
  garden: mkTints([                      // pastels
    [0.98, 0.86, 0.88], [0.83, 0.92, 0.83], [1.02, 0.98, 0.82], [0.88, 0.85, 0.95], [0.82, 0.90, 0.96]
  ]),
};
// Per-style build config: window rhythm [base,range] for bay & floor, vine weight,
// roof kind, and roof colour (null → default weathered concrete roof).
const STYLE_CFG = {
  oldtown: { bay: [2.4, 1.0], flr: [3.0, 0.7], vine: 1.15, roof: 'gable', rc: 0x6b3f2f },
  blocks: { bay: [3.0, 1.6], flr: [3.2, 0.9], vine: 0.9, roof: 'flat', rc: null },
  glass: { bay: [2.0, 0.9], flr: [3.4, 0.9], vine: 0.45, roof: 'flat', rc: null, tiered: true },
  works: { bay: [4.6, 2.0], flr: [4.2, 1.4], vine: 1.1, roof: 'saw', rc: 0x6a4a35 },
  garden: { bay: [3.0, 1.1], flr: [3.0, 0.7], vine: 1.15, roof: 'hip', rc: 0x4e5a52 },
};
// District grid: 3×3-chunk regions, weighted style pick on its own salt.
const DISTRICT_SALT = 8123;
function districtStyle(ix, iz) {
  const r = hash2(Math.floor(ix / 3), Math.floor(iz / 3), DISTRICT_SALT) / 4294967296;
  if (r < 0.25) return 'oldtown';
  if (r < 0.50) return 'blocks';
  if (r < 0.65) return 'glass';
  if (r < 0.80) return 'works';
  return 'garden';
}
let CUR_STYLE = 'blocks';   // set per chunk by buildChunk; read by addBuilding
let CUR_REG = null;         // Regions: current chunk's region descriptor (set per chunk by buildChunk)

// Per-style building footprint + height ranges, applied where buildChunk sizes buildings.
// `tall` requests the taller end (towers-chunk / perimeter feature). Returns {w,d,h}.
function bldDims(style, rng, tall) {
  switch (style) {
    case 'oldtown': return { w: 7 + rng() * 4, d: 8 + rng() * 3, h: 6 + rng() * 7 };
    case 'glass': return { w: 11 + rng() * 6, d: 11 + rng() * 6, h: tall ? 28 + rng() * 27 : 12 + rng() * 13 };
    case 'works': return { w: 16 + rng() * 8, d: 14 + rng() * 6, h: 6 + rng() * 6 };
    case 'garden': return { w: 6 + rng() * 3, d: 6 + rng() * 3, h: 4 + rng() * 3 };
    default: return { w: 14 + rng() * 8, d: 11 + rng() * 5, h: tall ? 20 + rng() * 14 : 15 + rng() * 12 }; // blocks
  }
}

// Emit the 4 window walls of one box tier from y0 up by h. vFloorBase continues the
// atlas floor phase so window rows line up across stacked tiers. Returns floors used.
function bldWalls(B, x0, z0, x1, z1, y0, h, bay, flr, tint, mossy, vFloorBase, uo, vo) {
  const w = x1 - x0, d = z1 - z0, y1 = y0 + h;
  const uc = Math.max(1, Math.round(w / bay)), ucd = Math.max(1, Math.round(d / bay));
  const vc = Math.max(1, Math.round(h / flr));
  const vb = vo + vFloorBase, vt = vb + vc;
  // moss creep at ground level; Regions: deepgreen raises the moss line to y≈3 (flora climbing)
  const mossTop = (CUR_REG && CUR_REG.biome === 'deepgreen') ? 3 : 0.02;
  const low = (y0 <= mossTop) ? mossy : tint;
  B.bld.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [uo, vb, uo + ucd, vt], tint, low);
  B.bld.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [uo, vb, uo + ucd, vt], tint, low);
  B.bld.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [uo, vb, uo + uc, vt], tint, low);
  B.bld.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [uo, vb, uo + uc, vt], tint, low);
  return vc;
}
// Pitched gable roof: two sloped quads + two triangular gable ends (facade tint), ridge
// along the long horizontal axis. Slopes/ends to B.plain (no window texture on the roof).
function addGableRoof(B, x0, z0, x1, z1, y, roofCol, gableCol) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  const rh = clamp(Math.min(w, d) * 0.45, 1.4, 4.5);
  if (w >= d) {                                    // ridge runs along x, eaves at z0 / z1
    B.plain.quad([x1, y, z0], [x0, y, z0], [x0, y + rh, cz], [x1, y + rh, cz], [0, 0, 1, 1], roofCol);
    B.plain.quad([x0, y, z1], [x1, y, z1], [x1, y + rh, cz], [x0, y + rh, cz], [0, 0, 1, 1], roofCol);
    B.plain.quad([x0, y, z0], [x0, y, z1], [x0, y + rh, cz], [x0, y + rh, cz], [0, 0, 1, 1], gableCol);
    B.plain.quad([x1, y, z1], [x1, y, z0], [x1, y + rh, cz], [x1, y + rh, cz], [0, 0, 1, 1], gableCol);
  } else {                                         // ridge runs along z, eaves at x0 / x1
    B.plain.quad([x0, y, z0], [x0, y, z1], [cx, y + rh, z1], [cx, y + rh, z0], [0, 0, 1, 1], roofCol);
    B.plain.quad([x1, y, z1], [x1, y, z0], [cx, y + rh, z0], [cx, y + rh, z1], [0, 0, 1, 1], roofCol);
    B.plain.quad([x0, y, z1], [x1, y, z1], [cx, y + rh, z1], [cx, y + rh, z1], [0, 0, 1, 1], gableCol);
    B.plain.quad([x1, y, z0], [x0, y, z0], [cx, y + rh, z0], [cx, y + rh, z0], [0, 0, 1, 1], gableCol);
  }
}
// Pyramid hip roof: apex over the centre, one triangle per eave edge.
function addPyramidRoof(B, x0, z0, x1, z1, y, roofCol) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const rh = clamp(Math.min(x1 - x0, z1 - z0) * 0.5, 1.6, 5);
  const ap = [cx, y + rh, cz];
  B.plain.quad([x1, y, z0], [x0, y, z0], ap, ap, [0, 0, 1, 1], roofCol);   // -z edge
  B.plain.quad([x0, y, z1], [x1, y, z1], ap, ap, [0, 0, 1, 1], roofCol);   // +z edge
  B.plain.quad([x0, y, z0], [x0, y, z1], ap, ap, [0, 0, 1, 1], roofCol);   // -x edge
  B.plain.quad([x1, y, z1], [x1, y, z0], ap, ap, [0, 0, 1, 1], roofCol);   // +x edge
}
// Sawtooth shed roof: 3–5 asymmetric prisms across x (vertical riser + slope + side fills).
function addSawtoothRoof(B, x0, z0, x1, z1, y, roofCol, rng) {
  const n = 3 + (rng() * 3 | 0), bw = (x1 - x0) / n;
  const dark = _c.copy(roofCol).multiplyScalar(0.72).clone();
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * bw, xb = xa + bw, sh = 1.0 + rng() * 1.6, yt = y + sh;
    B.plain.quad([xa, y, z0], [xa, y, z1], [xa, yt, z1], [xa, yt, z0], [0, 0, 1, 1], dark);          // vertical riser (-x)
    B.plain.quad([xb, y, z0], [xa, yt, z0], [xa, yt, z1], [xb, y, z1], [0, 0, 1, 1], roofCol);       // slope down to next
    B.plain.quad([xa, y, z0], [xa, yt, z0], [xb, y, z0], [xb, y, z0], [0, 0, 1, 1], dark);           // side fill z0
    B.plain.quad([xb, y, z1], [xa, yt, z1], [xa, y, z1], [xa, y, z1], [0, 0, 1, 1], dark);           // side fill z1
  }
}

/* ---- Districts (Phase B): per-style ornaments — all batched, deterministic ----
   Small helpers hung on the finished building box, keyed to the same tint/rng so
   each neighbourhood reads as its own architecture. Offsets are >=0.06 off the
   facade so nothing z-fights the window atlas. */
const AWNING_COLS = [0x8a4033, 0x7a5a2f, 0x3f5e46, 0x35526b, 0x6b4a2f, 0x86502f].map(srgb);
const MURAL_COLS = [0x6a6f5c, 0x5c5750, 0x6e5a4a, 0x4e5a5c, 0x746a54, 0x5a5060].map(srgb);
const BRICK_COL = srgb(0x5a3428), BRICK_DK = srgb(0x47281f);
// Little details (sprinkle pass) palettes.
const BENCH_COL = srgb(0x6a5237), MAILBOX_COL = srgb(0x8a4a3a);
const PUDDLE_COL = srgb(0x1a222b), PUDDLE_SHEEN = srgb(0x4a5a68);
const MUSH_COLS = [0xcabfa0, 0xb87a5a, 0xd4a86a, 0xa8564a, 0xc9b28c].map(srgb), MUSH_STEM = srgb(0xd8cdb2);
const NEST_COL = srgb(0x6b5334), FRUIT_COLS = [0x9a7a3a, 0x8a4a3a, 0x6a7a3a, 0xa06a4a, 0x7a6a4a].map(srgb);
const WEB_COL = srgb(0xd6dcd8);
// side 0:+x 1:-x 2:+z 3:-z. faceMap(u,o) → world [x,z]: u runs along the face, o outward.
function faceMap(side, x0, x1, z0, z1) {
  if (side === 0) return (u, o) => [x1 + o, u];
  if (side === 1) return (u, o) => [x0 - o, u];
  if (side === 2) return (u, o) => [u, z1 + o];
  return (u, o) => [u, z0 - o];
}
function faceSpan(side, x0, x1, z0, z1) {   // [u0,u1] range along a face
  return (side === 0 || side === 1) ? [z0, z1] : [x0, x1];
}
// Flat panel flush against a face, wound so its normal faces outward. u = centre along
// the face, pw = half-width, yb..yt vertical, o = standoff.
function facePanel(batch, side, x0, x1, z0, z1, u, pw, yb, yt, o, col, colB) {
  let a, b, c2, d;
  if (side === 0) { const px = x1 + o; a = [px, yb, u + pw]; b = [px, yb, u - pw]; c2 = [px, yt, u - pw]; d = [px, yt, u + pw]; }
  else if (side === 1) { const px = x0 - o; a = [px, yb, u - pw]; b = [px, yb, u + pw]; c2 = [px, yt, u + pw]; d = [px, yt, u - pw]; }
  else if (side === 2) { const pz = z1 + o; a = [u - pw, yb, pz]; b = [u + pw, yb, pz]; c2 = [u + pw, yt, pz]; d = [u - pw, yt, pz]; }
  else { const pz = z0 - o; a = [u + pw, yb, pz]; b = [u - pw, yb, pz]; c2 = [u - pw, yt, pz]; d = [u + pw, yt, pz]; }
  batch.quad(a, b, c2, d, [0, 0, 1, 1], col, colB || col);
}
// A tilted awning slab (thin centred box) projecting from a face; robust to winding.
function faceAwning(B, side, x0, x1, z0, z1, u, pw, yTop, proj, col, rng) {
  const drop = 0.5 + rng() * 0.4, tilt = 0.28 + rng() * 0.12;
  const map = faceMap(side, x0, x1, z0, z1);
  const [mx, mz] = map(u, proj / 2);                               // slab centre, half-projected
  const yc = yTop - drop / 2;
  const dep = proj * 1.12, th = 0.09;
  if (side === 0) B.plain.addGeo(tplBoxC, compose(mx, yc, mz, dep, th, 2 * pw, 0, 0, tilt), col, 0.05, rng);
  else if (side === 1) B.plain.addGeo(tplBoxC, compose(mx, yc, mz, dep, th, 2 * pw, 0, 0, -tilt), col, 0.05, rng);
  else if (side === 2) B.plain.addGeo(tplBoxC, compose(mx, yc, mz, 2 * pw, th, dep, -tilt, 0, 0), col, 0.05, rng);
  else B.plain.addGeo(tplBoxC, compose(mx, yc, mz, 2 * pw, th, dep, tilt, 0, 0), col, 0.05, rng);
  // two thin support rods dropping from the outer edge to storefront height
  const rc = _c.copy(COL.wood).multiplyScalar(0.7).clone();
  for (const s of [-1, 1]) {
    const [rx, rz] = map(u + s * pw * 0.85, proj * 0.95);
    B.plain.addGeo(tplCyl, compose(rx, 0, rz, 0.05, yTop - drop, 0.05), rc, 0, rng);
  }
}

// oldtown: awnings + shutters + a gable chimney.
function ornOldtown(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, h, roofType, bay) {
  if (rng() < 0.5) {                                                // storefront awnings
    let sides = [0, 1, 2, 3].filter(() => rng() < 0.4);
    if (!sides.length) sides = [(rng() * 4) | 0];
    for (const s of sides.slice(0, 2)) {
      const [u0, u1] = faceSpan(s, x0, x1, z0, z1), fl = u1 - u0;
      if (fl < 3) continue;
      const pw = Math.min(1.6 + rng() * 1.2, fl / 2 - 0.6);
      const u = lerp(u0 + pw + 0.4, u1 - pw - 0.4, rng());
      const col = _c.copy(AWNING_COLS[(rng() * AWNING_COLS.length) | 0]).multiplyScalar(0.8 + rng() * 0.3).clone();
      faceAwning(B, s, x0, x1, z0, z1, u, pw, 2.9 + rng() * 0.5, 1.0 + rng() * 0.5, col, rng);
    }
  }
  if (rng() < 0.4) {                                                // window shutters on a couple of bays
    const dark = _c.copy(BRICK_DK).lerp(COL.wood, 0.5).multiplyScalar(0.8).clone();
    const sides = [0, 1, 2, 3].filter(() => rng() < 0.45);
    for (const s of sides.slice(0, 2)) {
      const [u0, u1] = faceSpan(s, x0, x1, z0, z1), fl = u1 - u0;
      const nb = Math.max(1, Math.round(fl / bay));
      const nfl = Math.max(1, Math.floor(h / 3.2));
      for (let bi = 0; bi < nb; bi++) {
        if (rng() < 0.5) continue;
        const uc = u0 + (bi + 0.5) * fl / nb, half = Math.min(0.9, fl / nb * 0.32);
        const fi = 1 + ((rng() * Math.max(1, nfl - 1)) | 0), yb = fi * 3.2 - 1.3;
        if (yb + 1.6 > h) continue;
        for (const sgn of [-1, 1])
          facePanel(B.plain, s, x0, x1, z0, z1, uc + sgn * (half + 0.3), 0.28, yb, yb + 1.6, 0.07, dark);
      }
    }
  }
  if ((roofType === 'gable' || roofType === 'hip') && rng() < 0.6) {  // brick chimney on the ridge
    const chx = cx + (rng() - 0.5) * w * 0.4, chz = cz + (rng() - 0.5) * d * 0.4;
    const ch = 1.4 + rng() * 1.4;
    B.plain.addGeo(tplBox, compose(chx, h, chz, 0.7, ch, 0.7), BRICK_COL, 0.12, rng);
    B.plain.addGeo(tplBox, compose(chx, h + ch, chz, 0.9, 0.22, 0.9), BRICK_DK, 0.1, rng);
    // Life pass: an occasional smoking oldtown chimney (runtime picks the nearest few).
    if (rng() < 0.4) colData.smokes.push({ x: chx, y: h + ch + 0.25, z: chz, r: 0.28 });
  }
  // Life pass: a NEW fluttering wall-banner at a free upper face spot (not the awnings above).
  if (rng() < 0.3 && h >= 5) {
    const s = (rng() * 4) | 0, [u0, u1] = faceSpan(s, x0, x1, z0, z1), map = faceMap(s, x0, x1, z0, z1);
    const uc = lerp(u0 + 0.9, u1 - 0.9, rng());
    const [ax, az] = map(uc, 0), [bx, bz] = map(uc, 1);
    let nx = bx - ax, nz = bz - az; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const [px, pz] = map(uc, 0.14);
    colData.bannerAnchors.push({ x: px, y: Math.min(h - 0.6, 3.2 + rng() * (h - 4)), z: pz, nx, nz, hue: (rng() * 3) | 0 });
  }
}

// blocks: balcony grids + an occasional faded mural.
function ornBlocks(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, h, roofType) {
  if (rng() < 0.55 && h >= 8) {                                    // balcony grids
    const nSides = 1 + (rng() < 0.4 ? 1 : 0);
    const chosen = [0, 1, 2, 3].sort(() => rng() - 0.5).slice(0, nSides);
    const rail = _c.copy(COL.wire).lerp(COL.rock, 0.4).clone();
    const slab = _c.copy(COL.sidewalk).multiplyScalar(0.7).clone();
    const flr = 3.2, nfl = Math.max(1, Math.floor(h / flr) - 1);
    for (const s of chosen) {
      const [u0, u1] = faceSpan(s, x0, x1, z0, z1), fl = u1 - u0;
      const map = faceMap(s, x0, x1, z0, z1);
      const nc = 1 + (rng() < 0.5 ? 1 : 0), bw = Math.min(2.4, fl / (nc + 1));
      for (let ci = 0; ci < nc; ci++) {
        const uc = lerp(u0 + bw, u1 - bw, nc === 1 ? 0.35 + rng() * 0.3 : ci / Math.max(1, nc - 1));
        const [mx, mz] = map(uc, 0.35);
        for (let f = 1; f <= nfl; f++) {
          const yb = f * flr;
          B.plain.addGeo(tplBoxC, compose(mx, yb, mz, (s < 2 ? 0.7 : bw), 0.14, (s < 2 ? bw : 0.7)), slab, 0.05, rng);
          B.plain.addGeo(tplBoxC, compose(mx, yb + 0.5, mz, (s < 2 ? 0.66 : bw), 0.5, (s < 2 ? bw : 0.66)), rail, 0.05, rng);  // rail block (open feel via thin)
          const [rx, rz] = map(uc, 0.7);
          B.plain.addGeo(tplBox, compose(rx, yb, rz, (s < 2 ? 0.06 : bw), 0.5, (s < 2 ? bw : 0.06)), rail, 0, rng);            // outer rail bar
        }
      }
    }
  }
  if (rng() < 0.15) {                                              // faded 2-tone mural
    const s = (rng() * 4) | 0, [u0, u1] = faceSpan(s, x0, x1, z0, z1), fl = u1 - u0;
    if (fl > 5 && h > 10) {
      const mw = Math.min(fl * 0.5, 4 + rng() * 3), uc = lerp(u0 + mw / 2 + 1, u1 - mw / 2 - 1, rng());
      const yb = 3 + rng() * (h - 9), mh = 3 + rng() * 3;
      const a = _c.copy(MURAL_COLS[(rng() * MURAL_COLS.length) | 0]).multiplyScalar(0.9).clone();
      const b = _c.copy(MURAL_COLS[(rng() * MURAL_COLS.length) | 0]).multiplyScalar(0.9).clone();
      facePanel(B.plain, s, x0, x1, z0, z1, uc, mw / 2, yb, yb + mh, 0.06, a);
      facePanel(B.plain, s, x0, x1, z0, z1, uc, mw / 2, yb, yb + mh * 0.42, 0.065, b);
    }
  }
}

// glass: rooftop antenna/mast cluster + occasional vertical fin strips.
function ornGlass(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, h, top) {
  if (rng() < 0.7) {                                               // mast cluster on the top tier
    const tx0 = top.x0, tz0 = top.z0, tx1 = top.x1, tz1 = top.z1, ty = top.y;
    const n = 2 + (rng() * 3 | 0);
    let tallX = cx, tallZ = cz, tallH = 0;
    for (let k = 0; k < n; k++) {
      const mx = lerp(tx0 + 0.8, tx1 - 0.8, rng()), mz = lerp(tz0 + 0.8, tz1 - 0.8, rng());
      const mh = 2.5 + rng() * 5;
      B.plain.addGeo(tplCyl, compose(mx, ty, mz, 0.06 + rng() * 0.04, mh, 0.06 + rng() * 0.04), COL.wire, 0, rng);
      if (mh > tallH) { tallH = mh; tallX = mx; tallZ = mz; }
    }
    B.lamp.addGeo(tplBlob, compose(tallX, ty + tallH, tallZ, 0.16, 0.16, 0.16), srgb(0xff5a4a), 0, rng);   // blinking-style beacon
  }
  if (rng() < 0.3) {                                               // vertical fin strips along one face
    const s = (rng() * 4) | 0, [u0, u1] = faceSpan(s, x0, x1, z0, z1), fl = u1 - u0;
    const map = faceMap(s, x0, x1, z0, z1);
    const nf = 3 + (rng() * 4 | 0), fc = _c.copy(COL.rock).multiplyScalar(0.9).clone();
    for (let k = 0; k < nf; k++) {
      const uc = lerp(u0 + 0.6, u1 - 0.6, nf === 1 ? 0.5 : k / (nf - 1));
      const [mx, mz] = map(uc, 0.2);
      B.plain.addGeo(tplBox, compose(mx, 0.5, mz, (s < 2 ? 0.4 : 0.14), h - 1, (s < 2 ? 0.14 : 0.4)), fc, 0.04, rng);
    }
  }
}

// works: brick chimney stack + a rusty silo with pipe runs to the shed.
function ornWorks(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, h) {
  if (rng() < 0.5) {                                               // tall brick chimney stack
    const chx = lerp(x0 + 1.5, x1 - 1.5, rng()), chz = lerp(z0 + 1.5, z1 - 1.5, rng());
    const ch = h * 1.5, cw = 0.8 + rng() * 0.5;
    B.plain.addGeo(tplBox, compose(chx, 0, chz, cw, ch, cw), BRICK_COL, 0.14, rng);
    B.plain.addGeo(tplBox, compose(chx, ch, chz, cw + 0.2, 0.3, cw + 0.2), BRICK_DK, 0.1, rng);
    colData.trunks.push({ x: chx, z: chz, r: cw * 0.75, h: ch });
    // Life pass: works-district chimneys smoke steadily (the runtime picks the nearest few).
    colData.smokes.push({ x: chx, y: ch + 0.3, z: chz, r: 0.45 });
  }
  if (rng() < 0.35) {                                              // silo beside the shed
    const s = (rng() * 4) | 0, map = faceMap(s, x0, x1, z0, z1), [u0, u1] = faceSpan(s, x0, x1, z0, z1);
    const uc = lerp(u0 + 3, u1 - 3, rng()), r = 2 + rng();
    const [sx, sz] = map(uc, r + 0.6), sh = 8 + rng() * 4;
    const rust = _c.copy(COL.rust).multiplyScalar(0.85 + rng() * 0.3).clone();
    B.plain.addGeo(tplCyl, compose(sx, 0, sz, r, sh, r), rust, 0.12, rng);
    B.plain.addGeo(tplBlob, compose(sx, sh, sz, r, r * 0.6, r), _c.copy(rust).multiplyScalar(0.85).clone(), 0.1, rng);  // domed cap
    colData.trunks.push({ x: sx, z: sz, r: r + 0.2, h: sh });
    // horizontal pipe runs between shed wall and silo
    const [wx, wz] = map(uc, 0.2);
    for (let p = 0; p < 2; p++) {
      const py = 2.5 + p * 2 + rng();
      B.plain.addGeo(tplCyl, segMat(wx, py, wz, sx, py, sz, 0.14 + rng() * 0.06), COL.rust, 0.1, rng);
    }
  }
}

// garden: dress a yard gap between detached houses — a low weathered-wood fence around
// its perimeter, a small shed (~25%) and a hanging laundry line (~30%). Yards live inside
// the INSET band so fences never reach the sidewalk or the street trees.
const FENCE_COL = srgb(0x6b5a44);
function addGardenYard(B, colData, rng, yx0, yz0, yx1, yz1, houseWall) {
  const yw = yx1 - yx0, yd = yz1 - yz0;
  if (yw < 1.4 || yd < 1.4) return;
  const post = _c.copy(FENCE_COL).multiplyScalar(0.8 + rng() * 0.35).clone();
  const railY = 0.55 + rng() * 0.25;
  const runFence = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(L / 1.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n, px = lerp(ax, bx, t), pz = lerp(az, bz, t);
      B.plain.addGeo(tplBox, compose(px, 0, pz, 0.09, 0.9 + rng() * 0.2, 0.09), post, 0.1, rng);
    }
    for (const ry of [railY, railY * 0.5]) {                       // 1–2 rails
      if (ry < railY * 0.5 && rng() < 0.4) continue;
      B.plain.addGeo(tplBoxC, segRailBox(ax, ry, az, bx, ry, bz), post, 0.08, rng);
    }
  };
  runFence(yx0, yz0, yx1, yz0); runFence(yx1, yz0, yx1, yz1);
  runFence(yx1, yz1, yx0, yz1); runFence(yx0, yz1, yx0, yz0);
  const cx = (yx0 + yx1) / 2, cz = (yz0 + yz1) / 2;
  if (rng() < 0.25 && yw > 2.6 && yd > 2.6) {                      // garden shed
    const sw = 1.6 + rng() * 0.6, sh = 1.8 + rng() * 0.5;
    const wall = _c.copy(COL.wood).multiplyScalar(1.1).clone();
    B.plain.addGeo(tplBox, compose(cx, 0, cz, sw, sh, sw), wall, 0.1, rng);
    addPyramidRoof(B, cx - sw / 2, cz - sw / 2, cx + sw / 2, cz + sw / 2, sh, srgb(0x4e5a52));
    colData.solids.push({ x0: cx - sw / 2, z0: cz - sw / 2, x1: cx + sw / 2, z1: cz + sw / 2, h: sh, vine: false });
  } else if (rng() < 0.3 && houseWall) {                          // laundry line: house wall → a pole
    const px = clamp(cx + (rng() - 0.5) * yw * 0.4, yx0 + 0.4, yx1 - 0.4);
    const pz = clamp(cz + (rng() - 0.5) * yd * 0.4, yz0 + 0.4, yz1 - 0.4);
    const ly = 2.0 + rng() * 0.4;
    B.plain.addGeo(tplCyl, compose(px, 0, pz, 0.05, ly + 0.2, 0.05), COL.wood, 0, rng);
    addLaundryLine(B, rng, houseWall[0], ly, houseWall[1], px, ly, pz);
  }
}

// Shared sagging laundry line: a slack cord from a→b with a few hanging cloth quads
// (muted colours, slight rotation). Used by garden yards (wall→pole) and by the Little-details
// sprinkle pass (building face→pole, or between two facing buildings across a gap).
function addLaundryLine(B, rng, ax, ay, az, bx, by, bz, opts) {
  opts = opts || {};
  const L = Math.hypot(bx - ax, bz - az) || 1;
  const sag = opts.sag != null ? opts.sag : 0.18 + L * 0.03 + rng() * 0.2;
  const w = 0.025, px = -(bz - az) / L * w, pz = (bx - ax) / L * w;
  const segs = 4;
  let lx = ax, ly = ay, lz = az;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const nx = lerp(ax, bx, t), nz = lerp(az, bz, t), ny = lerp(ay, by, t) - Math.sin(t * Math.PI) * sag;
    B.plain.quad([lx - px, ly, lz - pz], [lx + px, ly, lz + pz], [nx + px, ny, nz + pz], [nx - px, ny, nz - pz], [0, 0, 1, 1], COL.wire);
    B.plain.quad([lx + px, ly, lz + pz], [lx - px, ly, lz - pz], [nx - px, ny, nz - pz], [nx + px, ny, nz + pz], [0, 0, 1, 1], COL.wire);
    lx = nx; ly = ny; lz = nz;
  }
  const nCloth = opts.nCloth != null ? opts.nCloth : 3 + (rng() * 3 | 0);   // 3–5
  for (let k = 0; k < nCloth; k++) {
    const t = 0.15 + rng() * 0.7, hx = lerp(ax, bx, t), hz = lerp(az, bz, t);
    const hy = lerp(ay, by, t) - Math.sin(t * Math.PI) * sag;
    const cw = 0.35 + rng() * 0.35, ch = 0.5 + rng() * 0.5, rot = (rng() - 0.5) * 0.3;
    const dx = Math.cos(rot) * cw / 2, dz = Math.sin(rot) * cw / 2;
    const col = _c.copy(AWNING_COLS[(rng() * AWNING_COLS.length) | 0]).lerp(srgb(0xffffff), 0.35 + rng() * 0.2).clone();
    B.plain.quad([hx - dx, hy - ch, hz - dz], [hx + dx, hy - ch, hz + dz], [hx + dx, hy, hz + dz], [hx - dx, hy, hz - dz], [0, 0, 1, 1], col);
  }
}

// weathered park bench: seat + backrest planks on short legs, facing +z(local). Registers a
// low solid (h 0.8) so you bump it instead of walking through — matching how addStall collides.
function addBench(B, colData, rng, x, z, ang) {
  const rot = (lx, lz) => [x + lx * Math.cos(ang) + lz * Math.sin(ang), -lx * Math.sin(ang) + lz * Math.cos(ang) + z];
  const wood = _c.copy(BENCH_COL).multiplyScalar(0.8 + rng() * 0.35).clone();
  const leg = _c.copy(wood).multiplyScalar(0.75).clone();
  B.plain.addGeo(tplBoxC, compose(x, 0.44, z, 1.8, 0.1, 0.5, 0, -ang, 0), wood, 0.14, rng);          // seat
  const [brx, brz] = rot(0, -0.22);
  B.plain.addGeo(tplBoxC, compose(brx, 0.66, brz, 1.8, 0.42, 0.08, 0, -ang, 0), wood, 0.14, rng);    // backrest
  for (const [lx, lz] of [[-0.78, -0.18], [0.78, -0.18], [-0.78, 0.18], [0.78, 0.18]]) {
    const [gx, gz] = rot(lx, lz);
    B.plain.addGeo(tplBox, compose(gx, 0, gz, 0.1, 0.44, 0.1, 0, -ang, 0), leg, 0.1, rng);
  }
  const hw = Math.abs(Math.cos(ang)) * 0.95 + Math.abs(Math.sin(ang)) * 0.32;
  const hd = Math.abs(Math.sin(ang)) * 0.95 + Math.abs(Math.cos(ang)) * 0.32;
  colData.solids.push({ x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd, h: 0.8, vine: false });
}

// rusted mailbox: a thin box tilted on a short post, red-brown rust tint, near an entrance.
function addMailbox(B, colData, rng, x, z, ang) {
  const tilt = (rng() - 0.5) * 0.2;
  const rust = _c.copy(MAILBOX_COL).lerp(COL.rust, 0.4 + rng() * 0.35).multiplyScalar(0.8 + rng() * 0.3).clone();
  const ph = 1.0 + rng() * 0.2;
  B.plain.addGeo(tplCyl, compose(x, 0, z, 0.055, ph, 0.055, 0, 0, tilt), _c.copy(COL.wood).multiplyScalar(0.85).clone(), 0.1, rng);
  B.plain.addGeo(tplBox, compose(x + Math.sin(tilt) * ph, ph, z, 0.34, 0.4, 0.24, 0, -ang, tilt), rust, 0.16, rng);
  colData.trunks.push({ x, z, r: 0.2, h: ph + 0.4 });
}

// morning puddle: a flattened irregular disc (very dark blue-grey) with a lighter inner sheen
// patch. Batched into the chunk's puddle batch (matPuddle), whose opacity fades in at dawn.
function addPuddle(B, rng, x, z) {
  const r = 0.6 + rng() * 1.4, a = rng() * 7;
  const col = _c.copy(PUDDLE_COL).multiplyScalar(0.75 + rng() * 0.4).clone();
  B.puddle.addGeo(tplRock, compose(x, 0.02, z, r, 0.02, r * (0.7 + rng() * 0.5), 0, a, 0), col, 0.15, rng);
  B.puddle.addGeo(tplRock, compose(x + (rng() - 0.5) * r * 0.4, 0.035, z + (rng() - 0.5) * r * 0.4, r * 0.42, 0.02, r * 0.32, 0, rng() * 7, 0), _c.copy(PUDDLE_SHEEN).multiplyScalar(0.85 + rng() * 0.3).clone(), 0.1, rng);
}

// mushroom cluster: 2–3 tiny cap+stem pairs on deadwood / rubble / roots / sinkhole floor.
function addMushroomCluster(B, rng, x, z, y) {
  y = y || 0;
  const n = 2 + (rng() * 3 | 0);
  const cap = _c.copy(MUSH_COLS[(rng() * MUSH_COLS.length) | 0]).multiplyScalar(0.8 + rng() * 0.35).clone();
  for (let k = 0; k < n; k++) {
    const mx = x + (rng() - 0.5) * 0.6, mz = z + (rng() - 0.5) * 0.6;
    const h = 0.12 + rng() * 0.18, r = 0.06 + rng() * 0.06;
    B.plain.addGeo(tplCyl, compose(mx, y, mz, r * 0.5, h, r * 0.5), MUSH_STEM, 0.1, rng);
    B.plain.addGeo(tplRock, compose(mx, y + h, mz, r, r * 0.55, r, 0, rng() * 7, 0), cap, 0.2, rng);
  }
}

// cobweb: a pale translucent triangle fan spanning a corner. n1,n2 are the two edge
// directions ([dx,dy,dz]); the fan sweeps from n1 to n2 at radius r. Into matWeb batch.
function addCobweb(B, rng, cx, cy, cz, r, n1, n2) {
  const seg = 3;
  let prev = n1;
  for (let k = 1; k <= seg; k++) {
    const t = k / seg;
    const cur = [lerp(n1[0], n2[0], t), lerp(n1[1], n2[1], t), lerp(n1[2], n2[2], t)];
    const rr = r * (0.6 + rng() * 0.5);
    B.web.quad([cx, cy, cz], [cx + prev[0] * rr, cy + prev[1] * rr, cz + prev[2] * rr],
      [cx + cur[0] * rr, cy + cur[1] * rr, cz + cur[2] * rr], [cx, cy, cz], [0, 0, 1, 1], WEB_COL);
    prev = cur;
  }
}

// a small broken/open crate: 3–4 thin plank walls (one occasionally missing), tilted.
function addBrokenCrate(B, rng, x, z) {
  const wood = _c.copy(COL.wood).multiplyScalar(1.1 + rng() * 0.3).clone();
  const s = 0.3 + rng() * 0.15, h = 0.28 + rng() * 0.16, th = 0.04;
  const ang = rng() * 7, tilt = rng() < 0.3 ? (rng() - 0.5) * 0.4 : 0, drop = (rng() * 4) | 0;
  const walls = [[0, -s, s, th], [0, s, s, th], [-s, 0, th, s], [s, 0, th, s]];
  for (let i = 0; i < 4; i++) {
    if (i === drop && rng() < 0.5) continue;                 // a missing side reads "broken"
    const [ox2, oz2, sx, sz] = walls[i], c = Math.cos(ang), si = Math.sin(ang);
    const wx = x + ox2 * c + oz2 * si, wz = z - ox2 * si + oz2 * c;
    B.plain.addGeo(tplBoxC, compose(wx, h / 2, wz, sx * 2, h, sz * 2, 0, -ang, tilt), wood, 0.15, rng);
  }
}
// A thin horizontal rail as a centred box spanning a→b (for fence rails).
function segRailBox(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-4, ang = Math.atan2(dz, dx);
  return compose((ax + bx) / 2, ay, (az + bz) / 2, L, 0.08, 0.06, 0, -ang, 0);
}

function addBuilding(B, colData, mini, rng, cx, cz, w, d, h, opts) {
  opts = opts || {};
  const style = opts.style || CUR_STYLE;
  const cfg = STYLE_CFG[style] || STYLE_CFG.blocks;
  // Regions: deepgreen crushes the towers shorter, ashen slumps them; opts.noRegion keeps
  // landmarks (fallen tower shell) at their designed height.
  const rbiome = (CUR_REG && !opts.noRegion) ? CUR_REG.biome : 'canopy';
  if (rbiome === 'deepgreen') h *= 0.8;
  else if (rbiome === 'ashen') h *= 0.75;
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const pool = STYLE_TINTS[style] || FACADE_TINTS;
  const tint = pool[(rng() * pool.length) | 0].clone().multiplyScalar(0.82 + rng() * 0.26);
  if (rbiome === 'scorch') tint.lerp(BONE_TINT, 0.32);       // sun-bleached facades
  else if (rbiome === 'ashen') tint.lerp(DUST_TINT, 0.22);   // grey-dusted
  const mossy = _c.copy(tint).lerp(COL.moss, 0.74).multiplyScalar(0.66).clone();  // stronger ground-level moss creep
  // per-building window rhythm from the district style (glass tight, works sparse/big)
  const bay = cfg.bay[0] + rng() * cfg.bay[1], flr = cfg.flr[0] + rng() * cfg.flr[1];
  const uo = (rng() * BLD_CELLS) | 0, vo = (rng() * BLD_CELLS) | 0;
  const roofCol = cfg.rc != null ? srgb(cfg.rc).multiplyScalar(0.8 + rng() * 0.3)
    : _c.copy(COL.roof).multiplyScalar(0.85 + rng() * 0.3).clone();
  // Tiered towers: glass always; 20% of any tall building elsewhere. Boxes stack with
  // shrinking setbacks, each tier a ground-up solid + parapet.
  const tallTier = h >= 18 && rng() < 0.20;
  const tiered = !opts.noTier && (cfg.tiered || tallTier);
  // roof kind (tiers are boxes → flat top); garden picks gable vs pyramid ~50/50.
  let roofType = tiered ? 'flat' : cfg.roof;
  if (roofType === 'hip' && rng() < 0.5) roofType = 'gable';
  const flatRoof = roofType === 'flat';
  let topX0 = x0, topZ0 = z0, topX1 = x1, topZ1 = z1, topY = h;   // top-tier rect (for glass masts)
  let tier1Y = h;                                                 // first-tier top (ornaments cling below setbacks)

  // Ruin variant (~12% of non-tiered buildings, any style except glass): a reduced,
  // roofless shell with a ragged broken parapet, one exposed interior floor slab, heavy
  // vines and rubble at a corner. Self-contained → pushes its own solid + minimap rect.
  if (!opts.noTier && !opts.noRuin && !tiered && style !== 'glass' && rng() < (rbiome === 'ashen' ? 0.55 : 0.12)) {
    const rh = h * (0.4 + rng() * 0.3);
    bldWalls(B, x0, z0, x1, z1, 0, rh, bay, flr, tint, mossy, 0, uo, vo);
    const fy = rh - 3;                                             // exposed interior floor slab
    if (fy > 1.5) B.plain.quad([x0, fy, z1], [x1, fy, z1], [x1, fy, z0], [x0, fy, z0], [0, 0, 1, 1], _c.copy(COL.rock).multiplyScalar(0.45).clone());
    const pc = _c.copy(tint).multiplyScalar(0.7).clone();          // ragged parapet: short broken segments
    for (const s of [0, 1, 2, 3]) {
      const [u0, u1] = faceSpan(s, x0, x1, z0, z1), map = faceMap(s, x0, x1, z0, z1), fl = u1 - u0;
      const nseg = Math.max(2, Math.round(fl / 1.6));
      for (let k = 0; k < nseg; k++) {
        if (rng() < 0.32) continue;                                // some segments missing
        const uc = u0 + (k + 0.5) * fl / nseg, [mx, mz] = map(uc, -0.15);
        const sh = 0.3 + rng() * 0.9;
        B.plain.addGeo(tplBox, compose(mx, rh, mz, (s < 2 ? 0.3 : fl / nseg * 0.9), sh, (s < 2 ? fl / nseg * 0.9 : 0.3)), pc, 0.08, rng);
      }
    }
    for (const s of [0, 1, 2, 3]) addWallVines(B, rng, x0, z0, x1, z1, rh, s);   // heavy vines all sides
    const rcx = rng() < 0.5 ? x0 : x1, rcz = rng() < 0.5 ? z0 : z1;              // rubble at one corner
    for (let k = 0; k < 4 + (rng() * 3 | 0); k++) {
      const rr = 0.6 + rng() * 1.3, jx = (rng() - 0.5) * 4, jz = (rng() - 0.5) * 4;
      B.plain.addGeo(tplRock, compose(rcx + jx, rr * 0.25, rcz + jz, rr, rr * 0.5, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
    }
    colData.trunks.push({ x: rcx, z: rcz, r: 1.4, h: 1.2 });
    colData.solids.push({ x0, z0, x1, z1, h: rh, vine: true });
    mini.rects.push([x0, z0, w, d, rh]);
    return;
  }

  if (tiered) {
    let bx0 = x0, bz0 = z0, bx1 = x1, bz1 = z1, y0 = 0, floors = 0, hLeft = h;
    const nT = 2 + (rng() * 2 | 0);
    for (let ti = 0; ti < nT; ti++) {
      const th = (ti === nT - 1) ? hLeft : hLeft * (0.42 + rng() * 0.16);
      hLeft -= th;
      floors += bldWalls(B, bx0, bz0, bx1, bz1, y0, th, bay, flr, tint, mossy, floors, uo, vo);
      const tw = bx1 - bx0, td = bz1 - bz0;
      const ph = 0.35 + rng() * 0.4, pc = _c.copy(roofCol).multiplyScalar(0.8).clone();
      B.plain.addGeo(tplBox, compose(cx, y0 + th, bz1 - 0.15, tw, ph, 0.3), pc, 0.05, rng);
      B.plain.addGeo(tplBox, compose(cx, y0 + th, bz0 + 0.15, tw, ph, 0.3), pc, 0.05, rng);
      B.plain.addGeo(tplBox, compose(bx1 - 0.15, y0 + th, cz, 0.3, ph, td), pc, 0.05, rng);
      B.plain.addGeo(tplBox, compose(bx0 + 0.15, y0 + th, cz, 0.3, ph, td), pc, 0.05, rng);
      colData.solids.push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1, h: y0 + th, vine: ti === 0 });
      if (ti === 0) tier1Y = y0 + th;
      if (ti === nT - 1) { B.plain.quad([bx0, y0 + th, bz1], [bx1, y0 + th, bz1], [bx1, y0 + th, bz0], [bx0, y0 + th, bz0], [0, 0, 1, 1], roofCol); topX0 = bx0; topZ0 = bz0; topX1 = bx1; topZ1 = bz1; topY = y0 + th; }
      y0 += th;
      const shr = 0.15 + rng() * 0.15, nw = tw * (1 - shr), nd = td * (1 - shr);
      bx0 = cx - nw / 2; bx1 = cx + nw / 2; bz0 = cz - nd / 2; bz1 = cz + nd / 2;
    }
  } else {
    bldWalls(B, x0, z0, x1, z1, 0, h, bay, flr, tint, mossy, 0, uo, vo);
    if (roofType === 'gable') {
      // The walls render tint × the dark concrete texture; gable ends sit on the
      // untextured plain material, so raw tint reads glaring white. Pre-multiply
      // down to the texture's effective brightness and grey it toward weathered
      // render so the triangle reads as the same aged plaster as the wall below.
      const gableCol = _c.copy(tint).multiplyScalar(0.5).lerp(COL.rock, 0.22).clone();
      addGableRoof(B, x0, z0, x1, z1, h, roofCol, gableCol);
    }
    else if (roofType === 'hip') { addPyramidRoof(B, x0, z0, x1, z1, h, roofCol); }
    else if (roofType === 'saw') { B.plain.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 0, 1, 1], roofCol); addSawtoothRoof(B, x0, z0, x1, z1, h, roofCol, rng); }
    else { B.plain.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 0, 1, 1], roofCol); }
  }
  // vines on some faces (weighted per district: heavy oldtown/works/garden, light glass/blocks)
  // Regions: scorch strips vines (need shade), deepgreen thickens them; canopy drifts ±30%.
  let vineMul = CUR_REG ? (1 + clamp((CUR_REG.verdancy - 0.51) / 0.21, -1, 1) * 0.30) : 1;
  if (rbiome === 'scorch') vineMul = 0.15; else if (rbiome === 'deepgreen') vineMul = 1.6;
  const hasVines = opts.vines !== undefined ? opts.vines : rng() < clamp(0.92 * cfg.vine * vineMul, 0, 0.98);
  if (hasVines) {
    const sides = (opts.allSides || rng() < 0.4) ? [0, 1, 2, 3] : [0, 1, 2, 3].filter(() => rng() < 0.85);
    if (sides.length === 0) sides.push((rng() * 4) | 0);
    for (const s of sides) addWallVines(B, rng, x0, z0, x1, z1, h, s);
  }
  // Flat-roof-only dressing: parapet + roof clutter + rooftop garden + roofline spill.
  // Pitched / sawtooth / pyramid / tiered roofs skip these so nothing floats mid-air.
  const bareRoof = flatRoof && !tiered;
  if (bareRoof) {
    // parapet
    const ph = 0.35 + rng() * 0.4, pc = _c.copy(roofCol).multiplyScalar(0.8).clone();
    B.plain.addGeo(tplBox, compose(cx, h, z1 - 0.15, w, ph, 0.3), pc, 0.05, rng);
    B.plain.addGeo(tplBox, compose(cx, h, z0 + 0.15, w, ph, 0.3), pc, 0.05, rng);
    B.plain.addGeo(tplBox, compose(x1 - 0.15, h, cz, 0.3, ph, d), pc, 0.05, rng);
    B.plain.addGeo(tplBox, compose(x0 + 0.15, h, cz, 0.3, ph, d), pc, 0.05, rng);
    // roof clutter: water tank, AC units, antenna
    if (rng() < 0.4 && w > 10) {
      const tx = lerp(x0 + 2, x1 - 2, rng()), tz = lerp(z0 + 2, z1 - 2, rng());
      B.plain.addGeo(tplCyl, compose(tx, h, tz, 1.1, 2.1, 1.1), COL.rust, 0.15, rng);
      B.plain.addGeo(tplCyl, compose(tx, h + 2.1, tz, 1.15, 0.3, 1.15), COL.deadwood, 0.1, rng);
    }
    if (rng() < 0.55) {
      const n = 1 + (rng() * 3 | 0);
      for (let k = 0; k < n; k++)
        B.plain.addGeo(tplBox, compose(lerp(x0 + 1.4, x1 - 1.4, rng()), h, lerp(z0 + 1.4, z1 - 1.4, rng()), 1.1, 0.55, 0.85, 0, rng() * 7, 0), COL.rock, 0.15, rng);
    }
    if (rng() < 0.45) {
      const ax2 = lerp(x0 + 1.5, x1 - 1.5, rng()), az2 = lerp(z0 + 1.5, z1 - 1.5, rng());
      const ah = 2.5 + rng() * 4;
      B.plain.addGeo(tplCyl, compose(ax2, h, az2, 0.05, ah, 0.05), COL.wire, 0, rng);
      B.plain.addGeo(tplBox, compose(ax2, h + ah * 0.75, az2, 0.7, 0.05, 0.05, 0, rng() * 7, 0), COL.wire, 0, rng);
    }
  }
  // faded shop sign band at storefront height
  if (h < 22 && rng() < 0.4) {
    const sc = _c.copy(SIGN_COLS[(rng() * SIGN_COLS.length) | 0]).multiplyScalar(0.7 + rng() * 0.4).clone();
    const sw = Math.min(w - 2, 3 + rng() * 4), sy = 2.7, sh = 0.9;
    const side = (rng() * 4) | 0, o = 0.08;
    const mid = lerp(-0.3, 0.3, rng());
    if (side === 2) { const px = cx + mid * w; B.plain.quad([px - sw / 2, sy, z1 + o], [px + sw / 2, sy, z1 + o], [px + sw / 2, sy + sh, z1 + o], [px - sw / 2, sy + sh, z1 + o], [0, 0, 1, 1], sc); }
    else if (side === 3) { const px = cx + mid * w; B.plain.quad([px + sw / 2, sy, z0 - o], [px - sw / 2, sy, z0 - o], [px - sw / 2, sy + sh, z0 - o], [px + sw / 2, sy + sh, z0 - o], [0, 0, 1, 1], sc); }
    else if (side === 0) { const pz = cz + mid * d; B.plain.quad([x1 + o, sy, pz + sw / 2], [x1 + o, sy, pz - sw / 2], [x1 + o, sy + sh, pz - sw / 2], [x1 + o, sy + sh, pz + sw / 2], [0, 0, 1, 1], sc); }
    else { const pz = cz + mid * d; B.plain.quad([x0 - o, sy, pz - sw / 2], [x0 - o, sy, pz + sw / 2], [x0 - o, sy + sh, pz + sw / 2], [x0 - o, sy + sh, pz - sw / 2], [0, 0, 1, 1], sc); }
  }
  // rooftop garden
  if (bareRoof && opts.garden !== false && rng() < 0.55 && h < 40) {
    const nG = 1 + (rng() * 3 | 0);
    for (let k = 0; k < nG; k++) {
      const gr = 1.4 + rng() * 2.4;
      const gx = lerp(x0 + gr, x1 - gr, rng()), gz = lerp(z0 + gr, z1 - gr, rng());
      B.leaf.addGeo(tplBlob, compose(gx, h + gr * 0.4, gz, gr, gr * 0.6, gr, 0, rng() * 7, 0), rng() < 0.4 ? COL.leafDry : COL.leafB, 0.2, rng);
    }
  }
  // Spiral limb wrapping ~1 in 4 towers (a climb/walk route toward the Weave), and an
  // occasional Crown Nest on a tall roof (L3, y 32–40).
  // green roofline: on ~40% of buildings, small leaf blobs spill over the parapet corners
  if (bareRoof && rng() < 0.4) {
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const nBlob = 1 + (rng() * 3 | 0);
    for (let k = 0; k < nBlob; k++) {
      const cn = corners[(rng() * 4) | 0];
      const br = 0.7 + rng() * 1.3;
      const bx = clamp(cn[0] + (cn[0] < cx ? 1 : -1) * br * 0.3, x0, x1);
      const bz = clamp(cn[1] + (cn[1] < cz ? 1 : -1) * br * 0.3, z0, z1);
      B.leaf.addGeo(tplBlob, compose(bx, h - br * 0.15, bz, br, br * 0.55, br, 0, rng() * 7, 0), leafTintByY(rng() < 0.35 ? COL.leafDry : COL.leafB, h), 0.22, rng);
    }
  }
  // Regions: scorch skips the bough/weave/nest layer (spiral limbs + roof crown nests);
  // deepgreen adds a few more crown nests. rng() consumed regardless to keep the stream stable.
  const nestMul = rbiome === 'scorch' ? 0 : rbiome === 'deepgreen' ? 1.3 : 1;
  if (h > 20 && rng() < 0.25 && rbiome !== 'scorch') addSpiralLimb(B, colData, rng, cx, cz, w, d, h);
  if (h >= 30 && h <= 46 && rng() < 0.3 * nestMul) addCrownNest(B, colData, rng, cx, cz, h, 2.5 + rng() * 1.3);
  // Districts (Phase B): per-style ornaments hung on the finished box.
  const wallTop = tiered ? tier1Y : h;   // ornaments cling to the base tier (below any setback)
  if (style === 'oldtown') ornOldtown(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, h, roofType, bay);
  else if (style === 'blocks') ornBlocks(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, wallTop, roofType);
  else if (style === 'glass') {
    ornGlass(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, wallTop, { x0: topX0, z0: topZ0, x1: topX1, z1: topZ1, y: topY });
    // Night glow: a few extra lit-window quads (matLamp glows warm at night, dark by day)
    // so glass towers sparkle after dark without touching the shared window atlas.
    const nLit = 2 + (rng() * 4 | 0);
    for (let k = 0; k < nLit; k++) {
      const s = (rng() * 4) | 0, [u0, u1] = faceSpan(s, x0, x1, z0, z1);
      const uc = lerp(u0 + 1, u1 - 1, rng()), yb = 2 + rng() * (wallTop - 4);
      facePanel(B.lamp, s, x0, x1, z0, z1, uc, 0.5 + rng() * 0.5, yb, yb + 1 + rng() * 0.8, 0.09, srgb(0x33302a), null);
    }
  }
  else if (style === 'works') ornWorks(B, colData, rng, x0, z0, x1, z1, cx, cz, w, d, h);
  if (!tiered) colData.solids.push({ x0, z0, x1, z1, h, vine: hasVines });  // tiered pushed a solid per tier
  mini.rects.push([x0, z0, w, d, h]);
}

function addCurtain(B, rng, ax, ay, az, bx, by, bz) {
  const segs = 7 + (rng() * 3 | 0), sag = 2 + rng() * 3.5;
  const skip = 0.15 + rng() * 0.18;                    // density variance per curtain
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const px = lerp(ax, bx, t), pz = lerp(az, bz, t);
    const py = lerp(ay, by, t) - Math.sin(t * Math.PI) * sag;
    if (rng() < skip) continue;
    const len = 1.4 + rng() * (rng() < 0.3 ? 5.5 : 3.4), w = 1.0 + rng() * 1.2;
    const a = rng() * Math.PI;
    const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    const col = _c.copy(COL.vine).multiplyScalar(0.7 + rng() * 0.5).clone();
    B.vine.quad([px - dx, py - len, pz - dz], [px + dx, py - len, pz + dz], [px + dx, py, pz + dz], [px - dx, py, pz - dz],
      [0, 0, 1, Math.max(1, Math.round(len / 5))], col);
  }
}

function addGlowPlant(B, rng, x, z, s) {
  B.glow.addGeo(tplBlob, compose(x, s * 0.4, z, s, s * 0.7, s, 0, rng() * 7, 0), COL.glowPlant, 0.3, rng);
}

// Flat root/ivy creep patch on the ground (visual only): an irregular dark-green leaf
// quad laid just above the pavement. Cheap — one textured quad per patch.
function addIvyPatch(B, rng, x, z, s) {
  const y = 0.06 + rng() * 0.04;
  const a = rng() * Math.PI, ca = Math.cos(a) * s, sa = Math.sin(a) * s;
  const j = () => (rng() - 0.5) * s * 0.4;
  const col = _c.copy(COL.leafC).multiplyScalar(0.55 + rng() * 0.3).clone();
  B.leaf.quad(
    [x - ca + j(), y, z - sa + j()], [x + sa + j(), y, z - ca + j()],
    [x + ca + j(), y, z + sa + j()], [x - sa + j(), y, z + ca + j()],
    [0, 0, 1, 1], col);
}

/* ---- streets: asphalt, markings, sidewalks ---- */
function hquad(B, x0, z0, x1, z1, y, col, colB) {
  B.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 0, 1, 1], col, colB);
}
function addRoads(B, rng, ox, oz, canalX, canalZ) {
  const RW = 5.5, SW = 8;
  for (const axis of [0, 1]) {   // 0: street along z at x=ox · 1: street along x at z=oz
    const canal = axis === 0 ? canalX : canalZ;   // this street line is a canal → skip the asphalt (keep sidewalks as tow-paths)
    const yA = 0.05 + axis * 0.03, yS = 0.11 + axis * 0.02, yD = 0.17 + axis * 0.01;
    for (let s = 0; s < CHUNK; s += 8) {
      const mossy = rng() < 0.3;
      const rc = _c.copy(COL.road).multiplyScalar(0.85 + rng() * 0.3);
      if (mossy) rc.lerp(COL.moss, 0.25 + rng() * 0.3);
      const rcc = rc.clone();
      const sc1 = _c.copy(COL.sidewalk).multiplyScalar(0.8 + rng() * 0.35).clone();
      const sc2 = _c.copy(COL.sidewalk).multiplyScalar(0.8 + rng() * 0.35).clone();
      if (rng() < 0.25) sc1.lerp(COL.moss, 0.4); if (rng() < 0.25) sc2.lerp(COL.moss, 0.4);
      if (axis === 0) {
        if (!canal) hquad(B.plain, ox - RW, oz + s, ox + RW, oz + s + 8, yA, rcc);
        hquad(B.plain, ox - SW, oz + s, ox - RW, oz + s + 8, yS, sc1);
        hquad(B.plain, ox + RW, oz + s, ox + SW, oz + s + 8, yS, sc2);
      } else {
        if (!canal) hquad(B.plain, ox + s, oz - RW, ox + s + 8, oz + RW, yA, rcc);
        hquad(B.plain, ox + s, oz - SW, ox + s + 8, oz - RW, yS, sc1);
        hquad(B.plain, ox + s, oz + RW, ox + s + 8, oz + SW, yS, sc2);
      }
    }
    // faded center dashes
    for (let s = 3; s < CHUNK; s += 6.5) {
      if (canal || rng() < 0.4) continue;
      const dc = _c.copy(COL.dash).multiplyScalar(0.55 + rng() * 0.4).clone();
      if (axis === 0) hquad(B.plain, ox - 0.13, oz + s, ox + 0.13, oz + s + 2.6, yD, dc);
      else hquad(B.plain, ox + s, oz - 0.13, ox + s + 2.6, oz + 0.13, yD, dc);
    }
  }
}

/* ---- abandoned cars ---- */
function addCar(B, colData, rng, x, z, ang) {
  const rot = (lx, lz) => [x + lx * Math.cos(ang) + lz * Math.sin(ang), -lx * Math.sin(ang) + lz * Math.cos(ang) + z];
  const body = _c.copy(CAR_COLS[(rng() * CAR_COLS.length) | 0]).multiplyScalar(0.7 + rng() * 0.4).clone();
  if (rng() < 0.4) body.lerp(COL.rust, 0.4 + rng() * 0.3);
  if (CUR_REG && CUR_REG.biome === 'scorch') body.lerp(COL.rust, 0.35);   // Regions: sun-baked cars rust brighter
  const cabin = _c.copy(body).multiplyScalar(0.45).clone();
  B.plain.addGeo(tplBox, compose(x, 0.32, z, 4.3, 0.78, 1.9, 0, ang, 0), body, 0.12, rng);
  const [cx2, cz2] = rot(-0.35, 0);
  B.plain.addGeo(tplBox, compose(cx2, 1.1, cz2, 2.3, 0.6, 1.7, 0, ang, 0), cabin, 0.08, rng);
  for (const [wx, wz] of [[1.4, 0.85], [1.4, -0.85], [-1.4, 0.85], [-1.4, -0.85]]) {
    const [px, pz] = rot(wx, wz);
    B.plain.addGeo(tplWheel, compose(px, 0.32, pz, 0.33, 0.33, 0.24, 0, ang, 0), COL.tire, 0.05, rng);
  }
  if (rng() < 0.5) { // moss / growth on the hood
    const [mx, mz] = rot(1.2 + rng(), (rng() - 0.5) * 0.8);
    const mr = 0.5 + rng() * 0.5;
    B.leaf.addGeo(tplBlob, compose(mx, 0.75, mz, mr, mr * 0.5, mr, 0, rng() * 7, 0), COL.leafC, 0.2, rng);
  }
  if (rng() < 0.55) { // a vine drape or two spilling over the roof/hood
    const nd = 1 + (rng() < 0.4 ? 1 : 0);
    for (let k = 0; k < nd; k++) {
      const [dx0, dz0] = rot(-1.4 + rng() * 3, -0.8);
      const [dx1, dz1] = rot(-1.4 + rng() * 3, 0.8);
      const vcol = _c.copy(COL.vine).multiplyScalar(0.55 + rng() * 0.4).clone();
      const dy = 1.05 + (rng() - 0.5) * 0.3;
      B.vine.quad([dx0, dy, dz0], [dx1, dy, dz1], [dx1, dy - 0.9 - rng() * 0.5, dz1], [dx0, dy - 0.9 - rng() * 0.5, dz0], [0, 0, 1, 1], vcol);
    }
  }
  const hw = Math.abs(Math.cos(ang)) * 2.15 + Math.abs(Math.sin(ang)) * 0.95;
  const hd = Math.abs(Math.sin(ang)) * 2.15 + Math.abs(Math.cos(ang)) * 0.95;
  colData.solids.push({ x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd, h: 1.35, vine: false });
}

/* ---- street lamps (some still alive) ---- */
function addLamp(B, colData, rng, x, z, armAng) {
  const pole = _c.copy(COL.lampPole).multiplyScalar(0.8 + rng() * 0.3).clone();
  B.plain.addGeo(tplCyl, compose(x, 0, z, 0.09, 4.6, 0.09), pole, 0, rng);
  // ivy creeping up the pole (visual only): a couple of narrow vine ribbons on facing sides
  if (rng() < 0.7) {
    const vh = 1.6 + rng() * 2.4, vw = 0.26 + rng() * 0.2, o = 0.11;
    const vcol = _c.copy(COL.vine).multiplyScalar(0.6 + rng() * 0.35).clone();
    B.vine.quad([x - vw / 2, 0, z + o], [x + vw / 2, 0, z + o], [x + vw / 2, vh, z + o], [x - vw / 2, vh, z + o], [0, 0, 1, Math.max(1, vh / 2 | 0)], vcol);
    if (rng() < 0.5) B.vine.quad([x + o, 0, z - vw / 2], [x + o, 0, z + vw / 2], [x + o, vh * 0.8, z + vw / 2], [x + o, vh * 0.8, z - vw / 2], [0, 0, 1, 1], vcol);
  }
  const dx = Math.cos(armAng), dz = Math.sin(armAng);
  B.plain.addGeo(tplBox, compose(x + dx * 0.75, 4.42, z + dz * 0.75, 1.6, 0.12, 0.12, 0, -armAng, 0), pole, 0, rng);
  const head = compose(x + dx * 1.45, 4.18, z + dz * 1.45, 0.55, 0.2, 0.32, 0, -armAng, 0);
  // Regions: ashen quarters keep few working lamps (dark streets at night). rng-neutral.
  const working = rng() < 0.55 * (CUR_REG && CUR_REG.biome === 'ashen' ? 0.3 : 1);
  if (working) B.lamp.addGeo(tplBox, head, srgb(0xfff1cf), 0, rng);
  else B.plain.addGeo(tplBox, head, COL.wire, 0, rng);
  // Little details: a bird's nest on ~10% of lamp heads — a brown ring blob + a few twigs.
  if (rng() < 0.1) {
    const nx = x + dx * 1.45, nz = z + dz * 1.45, ny = 4.42;
    B.plain.addGeo(tplBlob, compose(nx, ny, nz, 0.26, 0.15, 0.26, 0, rng() * 7, 0), _c.copy(NEST_COL).multiplyScalar(0.85 + rng() * 0.3).clone(), 0.25, rng);
    for (let k = 0, nt = 2 + (rng() * 2 | 0); k < nt; k++)
      B.plain.addGeo(tplCyl, compose(nx + (rng() - 0.5) * 0.2, ny + 0.06, nz + (rng() - 0.5) * 0.2, 0.02, 0.28 + rng() * 0.18, 0.02, 0, rng() * 7, Math.PI / 2), _c.copy(COL.deadwood).multiplyScalar(0.9 + rng() * 0.3).clone(), 0, rng);
  }
  colData.trunks.push({ x, z, r: 0.14, h: 4.6 });
  colData.lamps.push({ x, z, working, hx: x + dx * 1.45, hy: 4.18, hz: z + dz * 1.45 });
}

/* ---- power poles & sagging wires ---- */
function wireSpan(B, ax, ay, az, bx, by, bz, sag, rng) {
  const segs = 5, w = 0.05;
  const rand = rng || Math.random;
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
  const px = -dz / L * w, pz = dx / L * w;
  let lx = ax, ly = ay, lz2 = az;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const nx = lerp(ax, bx, t), nz = lerp(az, bz, t);
    const ny = lerp(ay, by, t) - Math.sin(t * Math.PI) * sag;
    B.plain.quad([lx - px, ly, lz2 - pz], [lx + px, ly, lz2 + pz], [nx + px, ny, nz + pz], [nx - px, ny, nz - pz], [0, 0, 1, 1], COL.wire);
    B.plain.quad([lx + px, ly, lz2 + pz], [lx - px, ly, lz2 - pz], [nx - px, ny, nz - pz], [nx + px, ny, nz + pz], [0, 0, 1, 1], COL.wire);
    lx = nx; ly = ny; lz2 = nz;
  }
  // short dangling vine ribbons hanging off the wire (visual only) — sampled along the catenary.
  // Only the wire that was handed a deterministic rng sprouts them (keeps the lower wire bare).
  const nHang = rng ? 2 + (rand() * 4 | 0) : 0;
  for (let k = 0; k < nHang; k++) {
    const t = 0.12 + rand() * 0.76;
    const hx = lerp(ax, bx, t), hz = lerp(az, bz, t);
    const hy = lerp(ay, by, t) - Math.sin(t * Math.PI) * sag;
    const len = 1.2 + rand() * 3.0, ww = 0.3 + rand() * 0.4;
    const a = rand() * Math.PI, ddx = Math.cos(a) * ww / 2, ddz = Math.sin(a) * ww / 2;
    const col = _c.copy(COL.vine).multiplyScalar(0.62 + rand() * 0.4).clone();
    B.vine.quad([hx - ddx, hy - len, hz - ddz], [hx + ddx, hy - len, hz + ddz], [hx + ddx, hy, hz + ddz], [hx - ddx, hy, hz - ddz],
      [0, 0, 1, Math.max(1, Math.round(len / 2))], col);
  }
}
function addPowerPole(B, colData, rng, x, z, axis) {
  B.plain.addGeo(tplCyl, compose(x, 0, z, 0.11, 7.2, 0.11), COL.wood, 0.1, rng);
  const arm = axis === 0 ? compose(x, 6.7, z, 1.7, 0.1, 0.12) : compose(x, 6.7, z, 0.12, 0.1, 1.7);
  B.plain.addGeo(tplBox, arm, COL.wood, 0.1, rng);
  colData.trunks.push({ x, z, r: 0.15, h: 7.2 });
}

/* ---- market stalls ---- */
function addStall(B, colData, rng, x, z, ang) {
  const rot = (lx, lz) => [x + lx * Math.cos(ang) + lz * Math.sin(ang), -lx * Math.sin(ang) + lz * Math.cos(ang) + z];
  const awn = _c.copy(SIGN_COLS[(rng() * SIGN_COLS.length) | 0]).multiplyScalar(0.85 + rng() * 0.3).clone();
  for (const [lx, lz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) {
    const [px, pz] = rot(lx, lz);
    B.plain.addGeo(tplCyl, compose(px, 0, pz, 0.06, 2.2 + (lz < 0 ? 0.4 : 0), 0.06), COL.wood, 0.1, rng);
  }
  // sloped awning
  const [a1x, a1z] = rot(-1.5, -1.1), [a2x, a2z] = rot(1.5, -1.1), [a3x, a3z] = rot(1.5, 1.1), [a4x, a4z] = rot(-1.5, 1.1);
  B.plain.quad([a1x, 2.6, a1z], [a2x, 2.6, a2z], [a3x, 2.2, a3z], [a4x, 2.2, a4z], [0, 0, 1, 1], awn);
  B.plain.quad([a2x, 2.6, a2z], [a1x, 2.6, a1z], [a4x, 2.2, a4z], [a3x, 2.2, a3z], [0, 0, 1, 1], _c.copy(awn).multiplyScalar(0.7).clone());
  // counter + crates
  const [ccx, ccz] = rot(0, 0.2);
  B.plain.addGeo(tplBox, compose(ccx, 0, ccz, 2.4, 0.9, 1.1, 0, -ang, 0), COL.wood, 0.15, rng);
  for (let k = 0; k < 2 + (rng() * 2 | 0); k++) {
    const [bx2, bz2] = rot(-1 + rng() * 2, -0.6 + rng() * 0.5);
    B.plain.addGeo(tplBox, compose(bx2, 0.9, bz2, 0.45, 0.3, 0.45, 0, rng() * 7, 0), _c.copy(COL.wood).multiplyScalar(1.2).clone(), 0.2, rng);
  }
  if (rng() < 0.6) addGlowPlant(B, rng, ...rot(1.1, 0.3), 0.22);
  // Little details: market litter spilled in front of the stall — broken crates, a cloth
  // scrap, and a few faded fruit dots scattered on the ground.
  for (let k = 0, nc = 1 + (rng() * 2 | 0); k < nc; k++) {
    const [lx, lz] = rot(-2 + rng() * 4, 1.5 + rng() * 1.3);
    addBrokenCrate(B, rng, lx, lz);
  }
  if (rng() < 0.7) {
    const [sx, sz] = rot(1.1 + rng() * 1.4, -0.5 + rng() * 1.6), cw = 0.4 + rng() * 0.3;
    const col = _c.copy(AWNING_COLS[(rng() * AWNING_COLS.length) | 0]).lerp(srgb(0x777066), 0.35).clone();
    B.plain.quad([sx - cw, 0.02, sz - cw * 0.6], [sx + cw, 0.03, sz - cw * 0.4], [sx + cw * 0.8, 0.02, sz + cw * 0.6], [sx - cw * 0.7, 0.02, sz + cw * 0.5], [0, 0, 1, 1], col);
  }
  for (let k = 0, nf = 2 + (rng() * 3 | 0); k < nf; k++) {
    const [fx, fz] = rot(-1.6 + rng() * 3.2, -0.6 + rng() * 2.2);
    B.plain.addGeo(tplRock, compose(fx, 0.06, fz, 0.09, 0.09, 0.09, rng(), rng() * 7, rng()), _c.copy(FRUIT_COLS[(rng() * FRUIT_COLS.length) | 0]).multiplyScalar(0.7 + rng() * 0.35).clone(), 0.25, rng);
  }
  colData.solids.push({ x0: x - 1.6, z0: z - 1.3, x1: x + 1.6, z1: z + 1.3, h: 0.9, vine: false });
  // Life pass: a vendor/customer anchor. rot is the stall's local frame; the runtime places a
  // vendor behind the counter (local -z) and a customer in front (local +z).
  if (colData.stallAnchors) colData.stallAnchors.push({ x, z, rot: ang });
}

