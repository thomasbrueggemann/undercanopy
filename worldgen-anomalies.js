/* CANOPY split file  worldgen: anomalies (Tier 1/2 landmarks) and Tier 3 oddities (was game.js lines 1695-2444). Header/error-handler in core.js. */
'use strict';
/* ======================================================================== */
/*  ANOMALIES (Phase A) — Tier 1 landmarks + Tier 2 elevated line           */
/* ======================================================================== */
// A tilted flat slab: one box oriented by yaw (travel dir about +y) then pitched about
// its local x-axis. Used for fallen-tower shells and collapsed viaduct ramps.
const _qYaw = new THREE.Quaternion(), _qPit = new THREE.Quaternion(), _axX = new THREE.Vector3(1, 0, 0);
function composeSlab(x, y, z, sx, sy, sz, pitch, yaw) {
  _qYaw.setFromAxisAngle(_up, yaw);
  _qPit.setFromAxisAngle(_axX, -pitch);
  _qYaw.multiply(_qPit);
  _pv.set(x, y, z); _s.set(sx, sy, sz);
  return _m4.compose(_pv, _qYaw, _s);
}
// A walkable staircase of overlapping pads rising along an incline (collision only).
function rampPads(colData, x0, y0, z0, x1, y1, z1, r, layer) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, L = Math.hypot(dx, dy, dz);
  const n = Math.max(2, Math.round(L / 1.3));
  for (let k = 0; k <= n; k++) { const t = k / n; colData.pads.push({ x: x0 + dx * t, z: z0 + dz * t, r, y: y0 + dy * t, layer: layer || 'ramp' }); }
}

// TIER 1 — colossus: a mega-tree piercing all three veils, with root buttresses, a
// spiral limb staircase, a crown nest hamlet and a beacon. Trunk is climbable (r 6, h 55).
function addColossus(B, colData, mini, rng, ox, oz) {
  const x = ox + 32, z = oz + 32, h = 55, R = 18, tr = 6;
  addTree(B, colData, mini, rng, x, z, h, R, { trunkR: tr, blobs: 9 });   // trunk+roots+canopy+pad+minidot
  // root buttresses — big leaning roots you can walk between (thin trunks keep gaps open)
  const nBut = 4 + (rng() * 3 | 0);
  for (let k = 0; k < nBut; k++) {
    const a = k / nBut * Math.PI * 2 + rng() * 0.3, bw = tr * 0.5;
    B.plain.addGeo(tplRoot, compose(x + Math.cos(a) * tr * 0.7, 0, z + Math.sin(a) * tr * 0.7, bw, tr * 2.2, bw, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9), COL.barkDark, 0.14, rng);
    colData.trunks.push({ x: x + Math.cos(a) * (tr + 1.2), z: z + Math.sin(a) * (tr + 1.2), r: bw * 0.6, h: 3 });
  }
  // spiral limb staircase ground → crown (pads register a walkable ramp; also the trunk climbs)
  let ang = rng() * 7, py = 2, px = x + Math.cos(ang) * (tr + 2.2), pz = z + Math.sin(ang) * (tr + 2.2);
  const steps = 11, dyStep = (46 - py) / steps, rad = tr + 2.2;
  for (let k = 0; k < steps; k++) {
    ang += Math.PI * 0.62;
    const ny = py + dyStep, nx = x + Math.cos(ang) * rad, nz = z + Math.sin(ang) * rad;
    addLimb(B, colData, rng, px, py, pz, nx, ny, nz, 0.55, { segs: 2, sag: 0.15, layer: 'bough' });
    px = nx; py = ny; pz = nz;
  }
  // crown nest hamlet, linked by short limb bridges + giant leaf blobs
  const nests = [], nN = 3 + (rng() < 0.5 ? 1 : 0);
  for (let k = 0; k < nN; k++) {
    const a = k / nN * Math.PI * 2 + rng() * 0.4, d = R * 0.5 + rng() * 2.5;
    const nx = x + Math.cos(a) * d, nz = z + Math.sin(a) * d, ny = 47 + rng() * 4;
    addCrownNest(B, colData, rng, nx, ny, nz, 2.6 + rng() * 1.2);
    nests.push([nx, ny, nz]);
    const br = R * 0.4; B.leaf.addGeo(tplBlob, compose(nx, ny + 3.4, nz, br, br * 0.6, br, 0, rng() * 7, 0), leafTintByY(COL.leafB, ny + 3.4), 0.2, rng);
  }
  for (let k = 0; k < nests.length; k++) {
    const A = nests[k], C = nests[(k + 1) % nests.length];
    addLimb(B, colData, rng, A[0], A[1], A[2], C[0], C[1], C[2], 0.4, { segs: 2, sag: 0.4, layer: 'bough' });
  }
  B.lamp.addGeo(tplBlob, compose(x, h + 1.5, z, 0.7, 0.7, 0.7), srgb(0xffe0b0), 0, rng);   // beacon
  colData.trunks.push({ x, z, r: 0.3, h: h + 1.5 });
  mini.trees.push([x, z, R * 1.6, 0]);                                                     // bold minimap dot
}

// TIER 1 — fallen: a standing tower with a collapsed tower leaning against it as a
// walkable ramp (street → roof), plus rubble and vine streamers.
function addFallen(B, colData, mini, rng, ox, oz) {
  const h = 28 + rng() * 8;
  const sx = ox + 24 + rng() * 6, sz = oz + 40 + rng() * 6, w = 12 + rng() * 3, d = 12 + rng() * 3;
  addBuilding(B, colData, mini, rng, sx, sz, w, d, h, { vines: true, allSides: true, garden: false, style: 'blocks', noTier: true, noRegion: true });   // noRegion: keep h so the ramp meets the roof
  // fallen shell leans from a street base up to the standing tower's south face at roof height
  const baseX = sx, baseZ = sz - d / 2 - h * 0.72, topX = sx, topZ = sz - d / 2 - 1, topY = h - 1;
  const dxx = topX - baseX, dzz = topZ - baseZ, horiz = Math.hypot(dxx, dzz);
  const L = Math.hypot(horiz, topY), pitch = Math.atan2(topY, horiz), yaw = Math.atan2(dxx, dzz);
  const shellCol = _c.copy(COL.roof).multiplyScalar(0.8).clone();
  B.plain.addGeo(tplBoxC, composeSlab((baseX + topX) / 2, topY / 2, (baseZ + topZ) / 2, w * 0.9, 1.4, L, pitch, yaw), shellCol, 0.1, rng);
  rampPads(colData, baseX, 0.1, baseZ, topX, topY, topZ, 2.0, 'fallen');   // walkable incline
  for (let k = 0; k < 7; k++) {                                            // rubble field
    const rr = 1 + rng() * 1.8, rx = baseX + (rng() - 0.5) * 12, rz = baseZ + (rng() - 0.5) * 7;
    B.plain.addGeo(tplRock, compose(rx, rr * 0.2, rz, rr, rr * 0.5, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
    colData.trunks.push({ x: rx, z: rz, r: rr * 0.7, h: rr * 0.6 });
  }
  for (let k = 0; k < 6; k++) {                                            // vine streamers on the shell
    const t = 0.2 + rng() * 0.7, cxp = lerp(baseX, topX, t), czp = lerp(baseZ, topZ, t), cyp = lerp(1.5, topY, t);
    addCurtain(B, rng, cxp - 2, cyp, czp, cxp + 2, cyp, czp);
  }
  // Ladders: hand back the anchor for a ground→roof ladder on the standing tower's east
  // face (clear of the ramp on the south). Built later so its rng never shifts this chunk.
  return { x: sx + w / 2 + 0.2, z: sz, y1: h, nx: 1, nz: 0 };
}

// TIER 1 — sinkhole: the block interior caved into a bowl. A per-chunk `pit` descriptor
// lets stepPlayer drop the ground below y=0 inside the pit radius.
function addSinkhole(B, colData, mini, rng, ox, oz) {
  const cx = ox + 32, cz = oz + 32, pitR = 15, depth = 4;
  colData.pits.push({ x: cx, z: cz, r: pitR, depth });
  // dark pit floor disc + a grid of floor pads (collision only)
  B.plain.addGeo(new THREE.CylinderGeometry(pitR * 0.82, pitR * 0.62, 0.6, 22), compose(cx, -depth - 0.3, cz, 1, 1, 1), _c.copy(COL.rock).multiplyScalar(0.5).clone(), 0.12, rng);
  for (let gx = -pitR + 2; gx <= pitR - 2; gx += 2.4) for (let gz = -pitR + 2; gz <= pitR - 2; gz += 2.4) {
    if (gx * gx + gz * gz > (pitR - 2) * (pitR - 2)) continue;
    colData.pads.push({ x: cx + gx, z: cz + gz, r: 1.6, y: -depth, layer: 'pit' });
  }
  const nRim = 26;
  for (let k = 0; k < nRim; k++) {                                        // rock rim ring
    const a = k / nRim * Math.PI * 2, rr = 1.4 + rng() * 1.6;
    B.plain.addGeo(tplRock, compose(cx + Math.cos(a) * pitR, 0.1, cz + Math.sin(a) * pitR, rr, rr * 0.7, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
    const rd = pitR * 0.6, wr = 2 + rng() * 1.5;                          // inward-angled wall slab
    B.plain.addGeo(tplRock, compose(cx + Math.cos(a) * rd, -2, cz + Math.sin(a) * rd, wr, wr, wr, Math.cos(a) * 0.4, rng() * 7, Math.sin(a) * 0.4), _c.copy(COL.rock).multiplyScalar(0.7).clone(), 0.2, rng);
  }
  for (let k = 0; k < 10; k++) {                                          // hanging roots (vine ribbons)
    const a = rng() * 7, rx = cx + Math.cos(a) * pitR * 0.9, rz = cz + Math.sin(a) * pitR * 0.9;
    const len = 2 + rng() * 3, wv = 0.3 + rng() * 0.4, col = _c.copy(COL.vine).multiplyScalar(0.5 + rng() * 0.3).clone();
    B.vine.quad([rx - wv / 2, 0.3 - len, rz], [rx + wv / 2, 0.3 - len, rz], [rx + wv / 2, 0.3, rz], [rx - wv / 2, 0.3, rz], [0, 0, 1, Math.max(1, len / 2 | 0)], col);
  }
  for (let k = 0; k < 3; k++) {                                           // climbable roots back out (r 0.4, tall enough to climb)
    const a = rng() * 7, rx = cx + Math.cos(a) * (pitR - 0.5), rz = cz + Math.sin(a) * (pitR - 0.5);
    B.plain.addGeo(tplRoot, compose(rx, -depth, rz, 0.4, depth + 2, 0.4, 0, rng() * 7, 0), COL.barkDark, 0.15, rng);
    colData.trunks.push({ x: rx, z: rz, r: 0.4, h: 16 });                 // h>14 → the climb code engages
  }
  for (let k = 0; k < 11; k++) {                                          // dense glow garden at the bottom
    const a = rng() * 7, dd = rng() * (pitR - 3), s = 0.3 + rng() * 0.3;
    B.glow.addGeo(tplBlob, compose(cx + Math.cos(a) * dd, -depth + 0.3, cz + Math.sin(a) * dd, s, s * 0.7, s, 0, rng() * 7, 0), COL.glowPlant, 0.3, rng);
  }
  // Funnel throat: the ground plane above now opens over the pit (ground-hole shader in
  // worldgen-chunks.js), so the mouth needs a continuous earth wall from the rim down to the
  // floor — without it you'd see clean through the annulus outside the inward wall slabs into
  // sky. OWN rng stream: the shared chunk rng's call order must not shift, or every sinkhole
  // chunk's later furniture (and every chunk seeded after it) would re-roll.
  const srng = mulberry32(hash2(ox, oz, 7777));
  const nSeg = 24, R0 = pitR + 0.3, R1 = pitR * 0.64, y0 = 0.05, y1 = -depth - 0.15;
  const soilTop = _c.copy(COL.moss).lerp(srgb(0x4a3a28), 0.5).clone();
  const soilBot = _c.copy(srgb(0x3a3026)).multiplyScalar(0.6).clone();
  const jt = [], jb = [];                       // per-spoke radial jitter, shared so the ring closes
  for (let k = 0; k < nSeg; k++) { jt.push((srng() - 0.5) * 1.0); jb.push((srng() - 0.5) * 0.6); }
  for (let k = 0; k < nSeg; k++) {
    const a0 = k / nSeg * Math.PI * 2, a1 = (k + 1) / nSeg * Math.PI * 2;
    const k1 = (k + 1) % nSeg;
    const t0x = cx + Math.cos(a0) * (R0 + jt[k]),  t0z = cz + Math.sin(a0) * (R0 + jt[k]);
    const t1x = cx + Math.cos(a1) * (R0 + jt[k1]), t1z = cz + Math.sin(a1) * (R0 + jt[k1]);
    const b0x = cx + Math.cos(a0) * (R1 + jb[k]),  b0z = cz + Math.sin(a0) * (R1 + jb[k]);
    const b1x = cx + Math.cos(a1) * (R1 + jb[k1]), b1z = cz + Math.sin(a1) * (R1 + jb[k1]);
    // wound so the single-sided face is seen from INSIDE the funnel (looking down/across the
    // bowl); quad's colB colours the a,b (bottom) edge → dark soil at the floor, mossy at the lip
    B.plain.quad([b0x, y1, b0z], [b1x, y1, b1z], [t1x, y0, t1z], [t0x, y0, t0z], [0, 0, 1, 2], soilTop, soilBot);
  }
}

// TIER 1 — reservoir: a wide low open tank filled with still water. Wading inside drains
// heat fast. Built as 4 climbable rim walls + an interior wade floor + a water plane.
function addReservoir(B, colData, mini, rng, ox, oz, extra) {
  const cx = ox + 32, cz = oz + 32, half = 15, h = 8, waterY = 7.8, floorY = waterY - 0.7;
  const x0 = cx - half, x1 = cx + half, z0 = cz - half, z1 = cz + half, wt = 0.7;
  const wallCol = _c.copy(COL.roof).lerp(COL.moss, 0.35).multiplyScalar(0.7).clone();
  const walls = [[cx, z0 + wt / 2, 2 * half, wt], [cx, z1 - wt / 2, 2 * half, wt], [x0 + wt / 2, cz, wt, 2 * half], [x1 - wt / 2, cz, wt, 2 * half]];
  for (const [wx, wz, ww, wd] of walls) {
    B.plain.addGeo(tplBox, compose(wx, 0, wz, ww, h, wd), wallCol, 0.08, rng);
    colData.solids.push({ x0: wx - ww / 2, z0: wz - wd / 2, x1: wx + ww / 2, z1: wz + wd / 2, h, vine: true });  // walkable parapet, climbable
  }
  // interior wade floor (player stands here, ~0.7 m under the surface)
  B.plain.quad([x0, floorY, z1], [x1, floorY, z1], [x1, floorY, z0], [x0, floorY, z0], [0, 0, 1, 1], _c.copy(COL.rock).multiplyScalar(0.55).clone());
  colData.solids.push({ x0, z0, x1, z1, h: floorY, vine: false });
  // still water plane (one extra mesh added to the chunk group)
  const resWGeo = new THREE.PlaneGeometry(2 * half - wt, 2 * half - wt);
  scaleWaterUVs(resWGeo, 2 * half - wt, 2 * half - wt);
  const wm = new THREE.Mesh(resWGeo, matWater);
  wm.rotation.x = -Math.PI / 2; wm.position.set(cx, waterY, cz); wm.matrixAutoUpdate = false; wm.updateMatrix();
  extra.push(wm);
  // Living water (Feature A): a fainter second ripple sheet 0.02 m above, tiled coarser.
  const resWGeo2 = new THREE.PlaneGeometry(2 * half - wt, 2 * half - wt);
  scaleWaterUVs(resWGeo2, 2 * half - wt, 2 * half - wt, 6.5);
  const wm2 = new THREE.Mesh(resWGeo2, matWater2);
  wm2.rotation.x = -Math.PI / 2; wm2.position.set(cx, waterY + 0.02, cz); wm2.matrixAutoUpdate = false; wm2.updateMatrix();
  extra.push(wm2);
  colData.waters.push({ x0: x0 + wt, z0: z0 + wt, x1: x1 - wt, z1: z1 - wt, y: waterY });   // interior only (not the parapet)
  for (let k = 0; k < 3; k++) {                                           // ladders/vines up the outside
    const a = k / 3 * Math.PI * 2 + rng();
    addVineRope(B, colData, rng, cx + Math.cos(a) * (half + 0.1), cz + Math.sin(a) * (half + 0.1), h, 0);
  }
  for (let k = 0; k < 4; k++) addGlowPlant(B, rng, lerp(x0 + 1, x1 - 1, rng()), lerp(z0 + 1, z1 - 1, rng()), 0.22);
  mini.rects.push([x0, z0, 2 * half, 2 * half, h]);
}

// TIER 2 — the Elevated Line. A ruined viaduct along rare grid lines, chosen per line
// index so every chunk on the line renders its own share identically.
function uvToXZ(axis, cross, u) { return axis === 0 ? [cross, u] : [u, cross]; }
function addPier(B, colData, rng, axis, cross, u, y) {
  const [px, pz] = uvToXZ(axis, cross, u);
  B.plain.addGeo(tplBox, compose(px, 0, pz, 1.6, y - 0.3, 1.6), srgb(0x6f6f68), 0.06, rng);
  colData.trunks.push({ x: px, z: pz, r: 0.9, h: y - 0.3 });   // side-block only (h<14 → not climbable, r<1.2 → not a giant)
  // ivy climbing the concrete piers (visual only)
  const nv = 2 + (rng() * 3 | 0);
  for (let k = 0; k < nv; k++) {
    const side = (rng() * 4) | 0, o = 0.82, half = 0.7;
    const top = (y - 0.3) * (0.4 + rng() * 0.55), len = top * (0.5 + rng() * 0.5), vw = 0.4 + rng() * 0.5;
    const off = (rng() - 0.5) * half;
    const vcol = _c.copy(COL.vine).multiplyScalar(0.55 + rng() * 0.35).clone(), vRep = Math.max(1, len / 4 | 0);
    let a, b, c2, d;
    if (side === 0) { a = [px + o, top - len, pz + off - vw / 2]; b = [px + o, top - len, pz + off + vw / 2]; c2 = [px + o, top, pz + off + vw / 2]; d = [px + o, top, pz + off - vw / 2]; }
    else if (side === 1) { a = [px - o, top - len, pz + off + vw / 2]; b = [px - o, top - len, pz + off - vw / 2]; c2 = [px - o, top, pz + off - vw / 2]; d = [px - o, top, pz + off + vw / 2]; }
    else if (side === 2) { a = [px + off + vw / 2, top - len, pz + o]; b = [px + off - vw / 2, top - len, pz + o]; c2 = [px + off - vw / 2, top, pz + o]; d = [px + off + vw / 2, top, pz + o]; }
    else { a = [px + off - vw / 2, top - len, pz - o]; b = [px + off + vw / 2, top - len, pz - o]; c2 = [px + off + vw / 2, top, pz - o]; d = [px + off - vw / 2, top, pz - o]; }
    B.vine.quad(a, b, c2, d, [0, 0, 1, vRep], vcol);
  }
}
/* ---- Elevated Line: ruined narrow-gauge track on top of each surviving deck ----
   Ballast strip + weathered sleepers + two rusty rails, all batched. Sleeper
   layout is seeded off (lineIdx, gi) so it is identical from either chunk that
   shares a span and stable across reloads. Track is visual only. */
const TRACK = {
  gauge: 1.5, sleep: 0.85, railY: 0.30, ballastCol: srgb(0x574d43),
  steel: srgb(0x4a423b), steelTop: srgb(0x9c948a),
};
// map a track-local (along u, across w) point to world [x,y,z]
function trackXYZ(axis, cross, u, w) { return uvToXZ(axis, cross + w, u); }
// axis-aligned box in track space: alongLen down u, acrossW down w
function trackBox(B, axis, cross, uc, w, y, alongLen, h, acrossW, col, jit, rng, ry) {
  const [x, z] = trackXYZ(axis, cross, uc, w);
  if (axis === 0) B.plain.addGeo(tplBoxC, compose(x, y, z, acrossW, h, alongLen, 0, ry || 0, 0), col, jit, rng);
  else B.plain.addGeo(tplBoxC, compose(x, y, z, alongLen, h, acrossW, 0, ry || 0, 0), col, jit, rng);
}
// one chained, drooping rail stub jutting `jl` metres past a gap edge, in +/-u dir
function bentRail(B, axis, cross, uEdge, w, y, dir, jl, segs, col, rng) {
  let px = uEdge, py = y, drop = 0;
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs, t1 = (k + 1) / segs;
    const u0 = uEdge + dir * jl * t0, u1 = uEdge + dir * jl * t1;
    const y0 = y - jl * 0.55 * t0 * t0, y1 = y - jl * 0.55 * t1 * t1;   // quadratic droop
    const [ax, az] = trackXYZ(axis, cross, u0, w), [bx, bz] = trackXYZ(axis, cross, u1, w);
    B.plain.addGeo(tplCyl, segMat(ax, y0, az, bx, y1, bz, 0.055), col, 0.12, rng);
  }
}
// A ruined derailed carriage lying on its side, half over the deck edge. Visual
// only — matches the stranded viaduct bus (which registers no collision).
function addDerailedCarriage(B, rng, axis, cross, uc, y) {
  const col = _c.copy(COL.rust).lerp(srgb(0x5a7a55), 0.4).multiplyScalar(0.9 + rng() * 0.2).clone();
  const roof = _c.copy(col).multiplyScalar(1.25).clone();
  const w = 1.9, roll = 1.15 + rng() * 0.2, wo = 1.9;          // tipped toward the outer edge
  const bx = cross + wo, cy = y + 0.95;
  const [x, z] = trackXYZ(axis, cross, uc, wo);
  if (axis === 0) {
    B.plain.addGeo(tplBoxC, compose(x, cy, z, 2.1, 2.0, 7, 0, 0, roll), col, 0.08, rng);
    B.plain.addGeo(tplBoxC, compose(x + Math.sin(roll) * 1.0, cy + Math.cos(roll) * 1.0, z, 0.12, 0.5, 6, 0, 0, roll), roof, 0.06, rng);
  } else {
    B.plain.addGeo(tplBoxC, compose(x, cy, z, 7, 2.0, 2.1, roll, 0, 0), col, 0.08, rng);
    B.plain.addGeo(tplBoxC, compose(x, cy + Math.cos(roll) * 1.0, z + Math.sin(roll) * 1.0, 6, 0.5, 0.12, roll, 0, 0), roof, 0.06, rng);
  }
  for (let k = 0; k < 3; k++) {                                  // exposed underside wheels
    const wu = uc + (k - 1) * 2.1;
    const [wx, wz] = trackXYZ(axis, cross, wu, wo - Math.cos(roll) * 0.9);
    B.plain.addGeo(tplWheel, compose(wx, cy + Math.sin(roll) * 0.9 - 0.2, wz, 0.55, 0.55, 0.3, 0, axis === 0 ? Math.PI / 2 : 0, 0), COL.tire, 0.1, rng);
  }
}
// Full track dressing for one surviving span. `nbrPrev/nbrNext` = does the
// neighbouring span exist (false → gap → maybe bent rails). `carriage` skips
// sleepers under a derailed carriage to keep the sleeper count sane.
function addViaductTrack(B, colData, rng, axis, cross, lineIdx, gi, u0, u1, y, nbrPrev, nbrNext, carriage) {
  const srng = mulberry32(hash2(lineIdx, gi, 6010));
  const spanLen = u1 - u0, uc = (u0 + u1) / 2, hg = TRACK.gauge / 2;
  // 1. raised ballast band down the deck centre
  trackBox(B, axis, cross, uc, 0, y + 0.05, spanLen, 0.10, 3.4, TRACK.ballastCol, 0.22, rng);
  // 2. weathered sleepers every ~0.85 m (12% gone, 10% skewed), skipped under a carriage
  const sleeperY = y + 0.18;
  if (!carriage) {
    for (let u = u0 + 0.5; u < u1 - 0.3; u += TRACK.sleep) {
      if (srng() < 0.12) continue;                               // missing crosstie
      const skew = srng() < 0.10 ? (srng() - 0.5) * 0.5 : 0;
      const wood = _c.copy(COL.wood).multiplyScalar(0.65 + srng() * 0.6).lerp(COL.rock, srng() * 0.25).clone();
      trackBox(B, axis, cross, u + (srng() - 0.5) * 0.12, (srng() - 0.5) * 0.1, sleeperY, 0.5, 0.16, 2.4, wood, 0.14, rng, skew);
    }
  }
  // 3. two rails + a bright top strip each
  for (const w of [-hg, hg]) {
    trackBox(B, axis, cross, uc, w, y + TRACK.railY, spanLen, 0.14, 0.09, TRACK.steel, 0.1, rng);
    trackBox(B, axis, cross, uc, w, y + TRACK.railY + 0.085, spanLen, 0.03, 0.05, TRACK.steelTop, 0.06, rng);
  }
  // 4. sparse grass poking up between the sleepers, at deck height
  const nG = srng() < 0.6 ? 1 + (srng() * 2 | 0) : 0;
  for (let k = 0; k < nG; k++)
    addGrassTuft(B, srng, ...trackXYZ(axis, cross, u0 + srng() * spanLen, (srng() - 0.5) * 3), 0.35 + srng() * 0.4, y);
  // 5. bent, drooping rails into an adjacent gap (~60% of gap edges) + dangle debris
  const gapEdge = (uEdge, dir, nbr, salt) => {
    if (nbr || hash2(lineIdx, gi, salt) % 100 >= 60) return;
    const jl = 2 + srng() * 2, segs = 2 + (srng() * 2 | 0);
    for (const w of [-hg, hg]) bentRail(B, axis, cross, uEdge, w, y + TRACK.railY, dir, jl, segs, TRACK.steel, rng);
    const nDang = 1 + (srng() * 2 | 0);
    for (let k = 0; k < nDang; k++) {                            // dangling rotated sleepers
      const du = jl * (0.3 + srng() * 0.5), wood = _c.copy(COL.wood).multiplyScalar(0.6 + srng() * 0.5).clone();
      const [dx, dz] = trackXYZ(axis, cross, uEdge + dir * du, (srng() - 0.5) * 1.6);
      B.plain.addGeo(tplBoxC, compose(dx, y + TRACK.railY - 0.6 - srng() * 1.2, dz, 2.2, 0.15, 0.45, srng(), srng() * 7, srng()), wood, 0.14, rng);
    }
    for (let k = 0; k < 2; k++) {                                // thin rebar hanging out of the gap
      const w = (srng() - 0.5) * 1.4, [ax, az] = trackXYZ(axis, cross, uEdge, w);
      const [bx, bz] = trackXYZ(axis, cross, uEdge + dir * (0.6 + srng() * 1.6), w + (srng() - 0.5) * 0.6);
      B.plain.addGeo(tplCyl, segMat(ax, y - 0.2, az, bx, y - 1.4 - srng(), bz, 0.03), COL.rust, 0.1, rng);
    }
  };
  gapEdge(u0, -1, nbrPrev, 6013);
  gapEdge(u1, 1, nbrNext, 6014);
}
function buildViaductAxis(B, colData, mini, rng, ix, iz, ox, oz, axis) {
  const y = 9, hw = 3, spanLen = 16;
  const lineIdx = axis === 0 ? ix : iz;
  const base0 = axis === 0 ? oz : ox, cross = axis === 0 ? ox : oz;
  const spanBase = (axis === 0 ? iz : ix) * 4;
  const concrete = srgb(0x8a8a82), rail = _c.copy(COL.rock).multiplyScalar(0.9).clone();
  const lineChunk = axis === 0 ? iz : ix;
  const spanExists = (g) => (hash2(lineIdx, g, 6003) % 100) < 75;
  // a derailed carriage on ~1 in 4 line-chunks, on a chosen (existing) span
  const carChunk = hash2(lineIdx, lineChunk, 6012) % 4 === 0;
  const carSpan = carChunk ? hash2(lineIdx, lineChunk, 6015) % 4 : -1;
  for (let sp = 0; sp < 4; sp++) {
    const gi = spanBase + sp, u0 = base0 + sp * spanLen, u1 = u0 + spanLen;
    addPier(B, colData, rng, axis, cross, u0, y);
    const exists = spanExists(gi);
    if (!exists) {                                       // fallen span: debris on the street below
      for (let k = 0; k < 4; k++) {
        const rr = 1 + rng() * 1.4, [dx, dz] = uvToXZ(axis, cross + (rng() - 0.5) * 4, u0 + 2 + rng() * (spanLen - 4));
        B.plain.addGeo(tplRock, compose(dx, rr * 0.2, dz, rr, rr * 0.5, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
      }
      continue;
    }
    const [mx, mz] = uvToXZ(axis, cross, (u0 + u1) / 2);
    if (axis === 0) B.plain.addGeo(tplBoxC, compose(mx, y - 0.3, mz, hw * 2, 0.6, spanLen), concrete, 0.06, rng);
    else B.plain.addGeo(tplBoxC, compose(mx, y - 0.3, mz, spanLen, 0.6, hw * 2), concrete, 0.06, rng);
    for (let du = 0; du <= spanLen; du += 1.3) {          // dense walkable deck pads (raised deck → pads, not a ground-up solid)
      for (let dw = -1; dw <= 1; dw++) { const [px, pz] = uvToXZ(axis, cross + dw * 2, u0 + du); colData.pads.push({ x: px, z: pz, r: 1.4, y, layer: 'viaduct' }); }
    }
    colData.dripAnchors.push({ x: mx, y: y - 0.6, z: mz });   // Life pass: dew drips off the viaduct underside
    for (const edge of [-hw, hw]) {                       // guard rails
      const [rx, rz] = uvToXZ(axis, cross + edge, (u0 + u1) / 2);
      if (axis === 0) B.plain.addGeo(tplBox, compose(rx, y, rz, 0.15, 0.7, spanLen), rail, 0.05, rng);
      else B.plain.addGeo(tplBox, compose(rx, y, rz, spanLen, 0.7, 0.15), rail, 0.05, rng);
    }
    if (rng() < 0.55) {                                  // sapling on the deck
      const [tx, tz] = uvToXZ(axis, cross + (rng() - 0.5) * 3, u0 + 2 + rng() * (spanLen - 4)), sr = 0.8 + rng() * 0.7;
      B.plain.addGeo(tplTrunk, compose(tx, y, tz, 0.14, 1.4 + rng(), 0.14, 0, rng() * 7, 0), COL.bark, 0.1, rng);
      B.leaf.addGeo(tplBlob, compose(tx, y + 2, tz, sr, sr * 0.7, sr, 0, rng() * 7, 0), leafTintByY(COL.leafB, y + 2), 0.2, rng);
    }
    if (rng() < 0.7) {                                   // grass tuft on the deck
      const [gx, gz] = uvToXZ(axis, cross + (rng() - 0.5) * 4, u0 + rng() * spanLen), s = 0.4 + rng() * 0.4;
      const col = rng() < 0.5 ? COL.grassA : COL.grassB, dark = _c.copy(col).multiplyScalar(0.5).clone();
      B.grass.quad([gx - 0.2, y, gz], [gx + 0.2, y, gz], [gx + 0.2, y + s, gz], [gx - 0.2, y + s, gz], [0, 0, 1, 1], col, dark);
    }
    if (hash2(lineIdx, gi, 6005) % 9 === 0) {            // stranded rusted bus
      const [bx, bz] = uvToXZ(axis, cross, (u0 + u1) / 2), bcol = _c.copy(COL.rust).lerp(srgb(0x5a7a55), 0.4).clone();
      if (axis === 0) B.plain.addGeo(tplBoxC, compose(bx, y + 1.2, bz, 2.4, 2.2, 8), bcol, 0.06, rng);
      else B.plain.addGeo(tplBoxC, compose(bx, y + 1.2, bz, 8, 2.2, 2.4), bcol, 0.06, rng);
    }
    const carriage = sp === carSpan;                     // ruined narrow-gauge track on the deck
    addViaductTrack(B, colData, rng, axis, cross, lineIdx, gi, u0, u1, y, spanExists(gi - 1), spanExists(gi + 1), carriage);
    if (carriage) addDerailedCarriage(B, rng, axis, cross, (u0 + u1) / 2, y);
  }
  // 1–2 vine curtains hanging from the deck underside for jungliness
  const crng = mulberry32(hash2(lineIdx, lineChunk, 6017));
  const nCurt = 1 + hash2(lineIdx, lineChunk, 6016) % 2;
  for (let k = 0; k < nCurt; k++) {
    const sp = (crng() * 4) | 0, gi = spanBase + sp;
    if (!spanExists(gi)) continue;
    const uc = base0 + sp * spanLen + 3 + crng() * (spanLen - 6), w = (crng() < 0.5 ? -1 : 1) * (hw - 0.2);
    const [cxp, czp] = uvToXZ(axis, cross + w, uc);
    const span = 3 + crng() * 3;
    const [ex, ez] = uvToXZ(axis, cross + w, uc + span);
    addCurtain(B, crng, cxp, y - 0.6, czp, ex, y - 0.6, ez);
  }
  // access ramp on ~1/3 of chunks along the line: a collapsed slab down to the street beside the deck
  if (hash2(lineIdx, axis === 0 ? iz : ix, 6004) % 3 === 0) {
    const sgn = (hash2(lineIdx, 7, 6004) % 2) ? 1 : -1, u = base0 + 24;
    const [tx, tz] = uvToXZ(axis, cross + sgn * hw, u), [bx, bz] = uvToXZ(axis, cross + sgn * (hw + 7), u);
    rampPads(colData, bx, 0.1, bz, tx, y, tz, 2.0, 'viaduct');
    const dxx = tx - bx, dzz = tz - bz, horiz = Math.hypot(dxx, dzz);
    B.plain.addGeo(tplBoxC, composeSlab((bx + tx) / 2, y / 2, (bz + tz) / 2, 4, 0.5, Math.hypot(horiz, y), Math.atan2(y, horiz), Math.atan2(dxx, dzz)), srgb(0x7f7f77), 0.06, rng);
  }
}
function addViaduct(B, colData, mini, rng, ix, iz, ox, oz) {
  if (hash2(ix, 0, 6001) % 7 === 0) buildViaductAxis(B, colData, mini, rng, ix, iz, ox, oz, 0);  // runs in z along x=ox
  if (hash2(0, iz, 6002) % 7 === 0) buildViaductAxis(B, colData, mini, rng, ix, iz, ox, oz, 1);  // runs in x along z=oz
}

/* ======================================================================== */
/*  WATERWAYS — canals along rare street lines (line selection like the      */
/*  viaduct, own salts). An x-border line canal runs in z along x=ox; a      */
/*  z-border line canal runs in x along z=oz. The street strip is replaced   */
/*  by an EMBANKED channel: the water surface must sit ABOVE y=0 because the */
/*  global textured ground plane (worldgen-chunks.js, repositioned to the    */
/*  player every frame at y=0) opaquely covers anything sunk below street    */
/*  level — the original y=-0.35 water was never visible, only its wading    */
/*  collision was. So: water at +0.14 with 5 cm of freeboard under the       */
/*  coping (top +0.19), like a real city canal running full; the silt bed    */
/*  stays below via the rect pit descriptor so wading is still chest-deep.   */
/*  Where the crossing border road meets the canal an arched stone bridge    */
/*  carries it over; ~40% of chunks also get a mid-block plank footbridge.   */
/*  Canal ↔ viaduct crossings are allowed (water below, rails above).        */
/* ======================================================================== */
const CANAL = { half: 3.5, bedY: -0.9, waterY: 0.14, bank: 5.5, guard: 4.2 };
function isCanalX(ix) { return hash2(ix, 0, 7001) % 8 === 0; }   // canal along x=ix*CHUNK, running in z
function isCanalZ(iz) { return hash2(0, iz, 7002) % 8 === 0; }   // canal along z=iz*CHUNK, running in x
// canal on the street line at grid index `lineIdx`, for a walker moving along `axis`
function isCanalLine(axis, lineIdx) { return axis === 0 ? isCanalX(lineIdx) : isCanalZ(lineIdx); }

// One arched stone bridge across the channel at `along` (u), spanning the cross axis.
function addCanalBridge(B, colData, rng, axis, cross, along) {
  const S = 2 * (CANAL.half + 1.3), nSeg = 6, pathHalf = 2.0, base = 0.15, arcH = 0.9;
  const stone = _c.copy(COL.rock).multiplyScalar(0.95).clone();
  const cop = _c.copy(COL.rock).multiplyScalar(1.12).clone();
  const rail = _c.copy(COL.rock).lerp(COL.moss, 0.3).multiplyScalar(0.85).clone();
  for (let k = 0; k < nSeg; k++) {
    const tc = (k + 0.5) / nSeg, w = -S / 2 + tc * S;
    const y = base + arcH * (1 - (2 * tc - 1) * (2 * tc - 1));
    const [x, z] = uvToXZ(axis, cross + w, along);
    // walkable deck slab (a touch wider than the pad so you don't see gaps)
    if (axis === 0) B.plain.addGeo(tplBoxC, compose(x, y - 0.15, z, S / nSeg + 0.15, 0.3, pathHalf * 2), stone, 0.05, rng);
    else B.plain.addGeo(tplBoxC, compose(x, y - 0.15, z, pathHalf * 2, 0.3, S / nSeg + 0.15), stone, 0.05, rng);
    colData.pads.push({ x, z, r: 1.5, y, layer: 'bridge' });
    // side parapets
    for (const s of [-1, 1]) {
      const [px, pz] = uvToXZ(axis, cross + w, along + s * (pathHalf + 0.12));
      if (axis === 0) B.plain.addGeo(tplBox, compose(px, y, pz, S / nSeg + 0.1, 0.55, 0.24), rail, 0.05, rng);
      else B.plain.addGeo(tplBox, compose(px, y, pz, 0.24, 0.55, S / nSeg + 0.1), rail, 0.05, rng);
    }
    if (k === 0 || k === nSeg - 1) {   // coping keystones at the abutments
      B.plain.addGeo(tplBox, compose(x, y, z, 0.6, 0.3, pathHalf * 2 + 0.2), cop, 0.04, rng);
    }
  }
}

// A flat plank footbridge with a slight sag and rope rails across the channel at `along`.
function addFootbridge(B, colData, rng, axis, cross, along) {
  const S = 2 * (CANAL.half + 0.8), nPl = 7, pathHalf = 0.9, sag = 0.28, y0 = 0.55;   // mid-span sag must clear the raised waterline (+0.14)
  const wood = _c.copy(COL.wood).multiplyScalar(0.9 + rng() * 0.3).clone();
  const rope = _c.copy(COL.wire).lerp(COL.rock, 0.5).clone();
  const yAt = (t) => y0 - sag * (1 - (2 * t - 1) * (2 * t - 1));
  for (let k = 0; k < nPl; k++) {
    const tc = (k + 0.5) / nPl, w = -S / 2 + tc * S, y = yAt(tc);
    const [x, z] = uvToXZ(axis, cross + w, along);
    if (axis === 0) B.plain.addGeo(tplBoxC, compose(x, y, z, S / nPl - 0.06, 0.1, pathHalf * 2), wood, 0.12, rng);
    else B.plain.addGeo(tplBoxC, compose(x, y, z, pathHalf * 2, 0.1, S / nPl - 0.06), wood, 0.12, rng);
    colData.pads.push({ x, z, r: 1.0, y: y + 0.05, layer: 'bridge' });
  }
  // rope rails: a chained sagging cylinder each side + a couple of posts
  for (const s of [-1, 1]) {
    let prev = null;
    for (let k = 0; k <= nPl; k++) {
      const t = k / nPl, w = -S / 2 + t * S, y = yAt(t) + 0.75;
      const [x, z] = uvToXZ(axis, cross + w, along + s * (pathHalf + 0.05));
      if (prev) B.plain.addGeo(tplCyl, segMat(prev[0], prev[1], prev[2], x, y, z, 0.03), rope, 0.1, rng);
      prev = [x, y, z];
    }
    for (const end of [-1, 1]) {
      const [px, pz] = uvToXZ(axis, cross + end * (CANAL.half + 0.7), along + s * (pathHalf + 0.05));
      B.plain.addGeo(tplCyl, compose(px, 0, pz, 0.05, 1.15, 0.05), wood, 0.1, rng);
    }
  }
}

function buildCanalAxis(B, colData, rng, ix, iz, ox, oz, axis, extra) {
  const H = CANAL.half, bedY = CANAL.bedY, waterY = CANAL.waterY, bank = CANAL.bank;
  const crng = mulberry32(hash2(axis === 0 ? ix : iz, 0, 7005));   // stable per-line dressing rng
  const cross = axis === 0 ? ox : oz;                              // the fixed street line
  const base0 = axis === 0 ? oz : ox, u1 = base0 + CHUNK;
  // channel AABB in world space
  const cx0 = axis === 0 ? cross - H : base0, cx1 = axis === 0 ? cross + H : u1;
  const cz0 = axis === 0 ? base0 : cross - H, cz1 = axis === 0 ? u1 : cross + H;
  const silt = _c.copy(COL.rock).lerp(srgb(0x241d15), 0.6).multiplyScalar(0.75).clone();
  const stone = _c.copy(COL.rock).multiplyScalar(0.9).clone();
  const moss = _c.copy(COL.moss).multiplyScalar(0.9).clone();
  const bankCol = _c.copy(COL.moss).lerp(COL.rock, 0.4).multiplyScalar(0.7).clone();
  const cop = _c.copy(COL.rock).multiplyScalar(1.1).clone();
  // Living water (Feature A): pale desaturated foam/scum line clinging to each bank at the
  // waterline. Batched into B.plain (no new material); the darker water-side edge (foamDk)
  // fakes low opacity so it reads as a thin scum band, not a painted stripe.
  const foam = srgb(0xb6c2bb), foamDk = _c.copy(srgb(0xb6c2bb)).multiplyScalar(0.5).clone();

  // 1. silt bed
  B.plain.quad([cx0, bedY, cz1], [cx1, bedY, cz1], [cx1, bedY, cz0], [cx0, bedY, cz0], [0, 0, 1, CHUNK / 4], silt);

  // 2. embankment walls (inner vertical face, coping, waterline moss band) + tow-path banks
  for (const s of [-1, 1]) {
    const wallCross = cross + s * H;                               // inner face plane
    // wall box just outside the water, inner edge flush with the channel
    const wc = wallCross + s * 0.25;
    if (axis === 0) {
      B.plain.addGeo(tplBox, compose(wc, bedY, base0 + CHUNK / 2, 0.5, 0.1 - bedY + 0.05, CHUNK), stone, 0.08, crng);
      B.plain.addGeo(tplBox, compose(wc, 0.05, base0 + CHUNK / 2, 0.7, 0.14, CHUNK), cop, 0.05, crng);
      // inner moss band at the waterline
      const mx = wallCross;
      B.plain.quad([mx, waterY + 0.35, cz1], [mx, waterY + 0.35, cz0], [mx, waterY - 0.35, cz0], [mx, waterY - 0.35, cz1], [0, 0, 1, CHUNK / 3], moss);
      // foam/scum line 0.25 m wide along this bank at water level
      const ffx0 = Math.min(wallCross, wallCross - s * 0.25), ffx1 = Math.max(wallCross, wallCross - s * 0.25);
      B.plain.quad([ffx0, waterY + 0.012, cz1], [ffx1, waterY + 0.012, cz1], [ffx1, waterY + 0.012, cz0], [ffx0, waterY + 0.012, cz0], [0, 0, 1, 1], foam, foamDk);
      // tow-path bank from coping out to the sidewalk
      const bx0 = Math.min(wallCross, wallCross + s * (bank - H)), bx1 = Math.max(wallCross, wallCross + s * (bank - H));
      B.plain.quad([bx0, 0.03, cz1], [bx1, 0.03, cz1], [bx1, 0.03, cz0], [bx0, 0.03, cz0], [0, 0, 1, 1], bankCol);
    } else {
      B.plain.addGeo(tplBox, compose(base0 + CHUNK / 2, bedY, wc, CHUNK, 0.1 - bedY + 0.05, 0.5), stone, 0.08, crng);
      B.plain.addGeo(tplBox, compose(base0 + CHUNK / 2, 0.05, wc, CHUNK, 0.14, 0.7), cop, 0.05, crng);
      const mz = wallCross;
      B.plain.quad([cx0, waterY + 0.35, mz], [cx1, waterY + 0.35, mz], [cx1, waterY - 0.35, mz], [cx0, waterY - 0.35, mz], [0, 0, 1, CHUNK / 3], moss);
      // foam/scum line 0.25 m wide along this bank at water level
      const ffz0 = Math.min(wallCross, wallCross - s * 0.25), ffz1 = Math.max(wallCross, wallCross - s * 0.25);
      B.plain.quad([cx1, waterY + 0.012, ffz0], [cx1, waterY + 0.012, ffz1], [cx0, waterY + 0.012, ffz1], [cx0, waterY + 0.012, ffz0], [0, 0, 1, 1], foam, foamDk);
      const bz0 = Math.min(wallCross, wallCross + s * (bank - H)), bz1 = Math.max(wallCross, wallCross + s * (bank - H));
      B.plain.quad([cx1, 0.03, bz0], [cx1, 0.03, bz1], [cx0, 0.03, bz1], [cx0, 0.03, bz0], [0, 0, 1, 1], bankCol);
    }
  }

  // 3. still water plane (extra mesh, reuse matWater like the reservoir)
  const wgeo = axis === 0 ? new THREE.PlaneGeometry(2 * H, CHUNK) : new THREE.PlaneGeometry(CHUNK, 2 * H);
  scaleWaterUVs(wgeo, axis === 0 ? 2 * H : CHUNK, axis === 0 ? CHUNK : 2 * H);
  const wm = new THREE.Mesh(wgeo, matWater);
  wm.rotation.x = -Math.PI / 2;
  wm.position.set(axis === 0 ? cross : base0 + CHUNK / 2, waterY, axis === 0 ? base0 + CHUNK / 2 : cross);
  wm.matrixAutoUpdate = false; wm.updateMatrix();
  extra.push(wm);
  // Living water (Feature A): fainter second ripple sheet 0.02 m above, tiled coarser.
  const wgeo2 = axis === 0 ? new THREE.PlaneGeometry(2 * H, CHUNK) : new THREE.PlaneGeometry(CHUNK, 2 * H);
  scaleWaterUVs(wgeo2, axis === 0 ? 2 * H : CHUNK, axis === 0 ? CHUNK : 2 * H, 6.5);
  const wm2 = new THREE.Mesh(wgeo2, matWater2);
  wm2.rotation.x = -Math.PI / 2;
  wm2.position.set(axis === 0 ? cross : base0 + CHUNK / 2, waterY + 0.02, axis === 0 ? base0 + CHUNK / 2 : cross);
  wm2.matrixAutoUpdate = false; wm2.updateMatrix();
  extra.push(wm2);

  // 4. collision: wading water rect + a rect pit so the bed is the ground inside the channel
  colData.waters.push({ x0: cx0, z0: cz0, x1: cx1, z1: cz1, y: waterY });
  colData.pits.push({ rect: true, x0: cx0, z0: cz0, x1: cx1, z1: cz1, depth: -bedY });

  // 5. dressing: reeds on the banks, lily pads + drifting leaves on the water
  const reedCol = srgb(0x8f7a3e), seedCol = srgb(0x6a5227);
  const nReed = 10 + (crng() * 8 | 0);
  for (let k = 0; k < nReed; k++) {
    const s = crng() < 0.5 ? -1 : 1, off = H + 0.2 + crng() * (bank - H - 0.4);
    const u = base0 + crng() * CHUNK, ht = 0.9 + crng() * 0.8;
    const [x, z] = uvToXZ(axis, cross + s * off, u);
    B.grass.quad([x - 0.05, 0, z], [x + 0.05, 0, z], [x + 0.05, ht, z], [x - 0.05, ht, z], [0, 0, 1, 1], reedCol, _c.copy(reedCol).multiplyScalar(0.55).clone());
    B.plain.addGeo(tplBox, compose(x, ht, z, 0.07, 0.22, 0.07), seedCol, 0.1, crng);   // seed head
  }
  const nLily = 5 + (crng() * 5 | 0);
  for (let k = 0; k < nLily; k++) {
    const w = (crng() - 0.5) * (2 * H - 1), u = base0 + 1 + crng() * (CHUNK - 2), r = 0.28 + crng() * 0.22;
    const [x, z] = uvToXZ(axis, cross + w, u);
    B.leaf.addGeo(tplCyl, compose(x, waterY + 0.02, z, r, 0.02, r), _c.copy(COL.leafB).multiplyScalar(0.85).clone(), 0.12, crng);
  }
  const nLeaf = 6 + (crng() * 5 | 0);
  for (let k = 0; k < nLeaf; k++) {
    const w = (crng() - 0.5) * (2 * H - 0.4), u = base0 + crng() * CHUNK, r = 0.09 + crng() * 0.08;
    const [x, z] = uvToXZ(axis, cross + w, u);
    B.leaf.quad([x - r, waterY + 0.015, z + r], [x + r, waterY + 0.015, z + r], [x + r, waterY + 0.015, z - r], [x - r, waterY + 0.015, z - r], [0, 0, 1, 1], _c.copy(COL.leafDry).multiplyScalar(0.8).clone());
  }

  // 6. bridges: an arched stone bridge at the crossing border road (chunk origin corner),
  //    plus an occasional mid-block plank footbridge (~40% of chunks).
  addCanalBridge(B, colData, rng, axis, cross, base0);
  if (hash2(ix, iz, axis === 0 ? 7003 : 7004) % 100 < 40) {
    addFootbridge(B, colData, rng, axis, cross, base0 + lerp(CHUNK * 0.32, CHUNK * 0.7, crng()));
  }
}

function addCanal(B, colData, rng, ix, iz, ox, oz, extra) {
  if (isCanalX(ix)) buildCanalAxis(B, colData, rng, ix, iz, ox, oz, 0, extra);
  if (isCanalZ(iz)) buildCanalAxis(B, colData, rng, ix, iz, ox, oz, 1, extra);
}

/* ======================================================================== */
/*  TIER 3 ODDITIES (Phase B) — sprinkled deterministically at low rates     */
/* ======================================================================== */

// Greenhouse skeleton: 4–6 rusty arched ribs over a small footprint, a few surviving
// pale glass shards (lamp batch, faint night glint), dense glow plants + ferns inside,
// a rusted table. Visual only.
function addGreenhouse(B, colData, rng, cx, cz) {
  const L = 7 + rng() * 3, W = 4.5 + rng() * 2, archH = 3.2 + rng() * 1.2;
  const nRibs = 4 + (rng() * 3 | 0);
  const rust = _c.copy(COL.rust).multiplyScalar(0.8 + rng() * 0.4).clone();
  const glass = srgb(0xbfd8e0);
  const ribX = [];
  for (let r = 0; r < nRibs; r++) {
    const rx = cx - L / 2 + (r / (nRibs - 1)) * L;
    ribX.push(rx);
    const segs = 6;
    let prev = null;
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, ang = t * Math.PI;
      const p = [rx, Math.sin(ang) * archH, cz + Math.cos(ang) * W / 2];
      if (prev) B.plain.addGeo(tplCyl, segMat(prev[0], prev[1], prev[2], p[0], p[1], p[2], 0.07), rust, 0.12, rng);
      prev = p;
    }
  }
  // a couple of ridge purlins tying ribs together at the top
  B.plain.addGeo(tplCyl, segMat(ribX[0], archH, cz, ribX[ribX.length - 1], archH, cz, 0.06), rust, 0.1, rng);
  // surviving glass shards: quads spanning between adjacent ribs up near the crown
  for (let r = 0; r < nRibs - 1; r++) {
    if (rng() < 0.55) continue;
    const x0 = ribX[r], x1 = ribX[r + 1];
    const t = 0.2 + rng() * 0.5, ang = t * Math.PI;
    const zc = cz + Math.cos(ang) * W / 2, yc = Math.sin(ang) * archH;
    const zc2 = cz + Math.cos((t + 0.18) * Math.PI) * W / 2, yc2 = Math.sin((t + 0.18) * Math.PI) * archH;
    B.lamp.quad([x0, yc, zc], [x1, yc, zc], [x1, yc2, zc2], [x0, yc2, zc2], [0, 0, 1, 1], glass);
  }
  // dense glow plants + ferns inside, a rusted table
  for (let k = 0; k < 4 + (rng() * 3 | 0); k++)
    addGlowPlant(B, rng, cx + (rng() - 0.5) * L * 0.8, cz + (rng() - 0.5) * W * 0.7, 0.22 + rng() * 0.25);
  for (let k = 0; k < 5 + (rng() * 4 | 0); k++)
    addFern(B, rng, cx + (rng() - 0.5) * L * 0.8, cz + (rng() - 0.5) * W * 0.7, rng() * 7, 1.0 + rng() * 0.8);
  if (rng() < 0.7) {
    const tx = cx + (rng() - 0.5) * L * 0.5, tz = cz + (rng() - 0.5) * W * 0.4;
    B.plain.addGeo(tplBox, compose(tx, 0.7, tz, 1.8, 0.1, 0.8, 0, rng() * 7, 0), COL.rust, 0.12, rng);
    for (const lx of [-0.7, 0.7]) B.plain.addGeo(tplCyl, compose(tx + lx, 0, tz, 0.05, 0.7, 0.05), COL.rust, 0, rng);
  }
}

// A single arched fern frond: a scaled-up grass quad leaning outward. Visual only.
function addFern(B, rng, x, z, ang, s) {
  const tx = -Math.sin(ang), tz = Math.cos(ang);            // tangential (blade width)
  const ox2 = Math.cos(ang), oz2 = Math.sin(ang);           // radial outward (lean)
  const w = 0.5 + rng() * 0.5, lean = s * (0.4 + rng() * 0.4);
  const tipx = x + ox2 * lean, tipz = z + oz2 * lean;
  const col = rng() < 0.5 ? COL.grassA : COL.leafC, dark = _c.copy(col).multiplyScalar(0.5).clone();
  B.grass.quad(
    [x - tx * w / 2, 0, z - tz * w / 2], [x + tx * w / 2, 0, z + tz * w / 2],
    [tipx + tx * w / 2, s, tipz + tz * w / 2], [tipx - tx * w / 2, s, tipz - tz * w / 2],
    [0, 0, 1, 1], col, dark);
}

// Wind-chime pole: a slim pole + cross arm, 5–8 hanging strings each with a small bottle/
// shell. Registers a chime point so the audio loop can tinkle when the player is near.
function addWindChime(B, colData, rng, x, z) {
  const ph = 3.6 + rng() * 0.8;
  B.plain.addGeo(tplCyl, compose(x, 0, z, 0.07, ph, 0.07), COL.wood, 0.1, rng);
  const armAng = rng() * Math.PI, ax = Math.cos(armAng), az = Math.sin(armAng), arm = 1.1;
  B.plain.addGeo(tplBox, compose(x, ph, z, arm * 2, 0.06, 0.06, 0, -armAng, 0), COL.wood, 0.1, rng);
  colData.trunks.push({ x, z, r: 0.1, h: ph });
  const n = 5 + (rng() * 4 | 0);
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1) - 0.5) * 2;
    const hx = x + ax * arm * t, hz = z + az * arm * t;
    const sl = 0.5 + rng() * 0.7;                            // string length
    B.plain.addGeo(tplCyl, compose(hx, ph - sl, hz, 0.012, sl, 0.012), COL.wire, 0, rng);
    // little bottle / shell at the end (tiny box or cylinder), warm-tinted so it catches light
    const bcol = _c.copy(rng() < 0.5 ? srgb(0x9ab0a2) : srgb(0xb99a6a)).multiplyScalar(0.8 + rng() * 0.4).clone();
    if (rng() < 0.5) B.plain.addGeo(tplCyl, compose(hx, ph - sl - 0.22, hz, 0.05, 0.24, 0.05), bcol, 0.1, rng);
    else B.plain.addGeo(tplBox, compose(hx, ph - sl - 0.2, hz, 0.11, 0.22, 0.07, 0, rng() * 7, 0), bcol, 0.1, rng);
  }
  colData.chimes.push({ x, z });
}

// Shrine niche at a building corner: a small stone shelf, 2–3 candle stubs with lamp-
// material flame dots (glow at night), and warm dried-flower tufts. Visual only.
function addShrine(B, colData, rng, s) {
  // pick an outward-facing corner of the solid s
  const corners = [[s.x0, s.z0], [s.x1, s.z0], [s.x1, s.z1], [s.x0, s.z1]];
  const cn = corners[(rng() * 4) | 0];
  const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
  const ox2 = cn[0] < cx ? -1 : 1, oz2 = cn[1] < cz ? -1 : 1;
  const sx = cn[0] + ox2 * 0.5, sz = cn[1] + oz2 * 0.5, sy = 1.1 + rng() * 0.5;
  const stone = _c.copy(COL.rock).lerp(COL.moss, 0.2).clone();
  B.plain.addGeo(tplBox, compose(sx, sy, sz, 1.1, 0.5, 0.9, 0, rng() * 0.4, 0), stone, 0.1, rng);   // shelf box
  const nC = 2 + (rng() * 2 | 0);
  for (let k = 0; k < nC; k++) {
    const dx = (rng() - 0.5) * 0.6, dz = (rng() - 0.5) * 0.4;
    B.plain.addGeo(tplCyl, compose(sx + dx, sy + 0.25, sz + dz, 0.05, 0.16 + rng() * 0.12, 0.05), srgb(0xd8cdb0), 0.06, rng);  // candle stub
    B.lamp.addGeo(tplBlob, compose(sx + dx, sy + 0.45, sz + dz, 0.05, 0.08, 0.05), srgb(0xffdf9c), 0, rng);                   // flame dot (night emissive)
    if (k === 0) colData.swingAnchors.push({ x: sx + dx, y: sy + 0.45, z: sz + dz });   // Life pass: candle-flame flicker/sway at night
  }
  // dried-flower tufts (warm-tinted grass) at the shelf base
  for (let k = 0; k < 3; k++) {
    const fx = sx + (rng() - 0.5) * 0.8, fz = sz + (rng() - 0.5) * 0.6;
    const warm = _c.copy(COL.leafDry).lerp(srgb(0xc06a3a), rng() * 0.5).clone(), dark = _c.copy(warm).multiplyScalar(0.5).clone();
    const ss = 0.25 + rng() * 0.2;
    B.grass.quad([fx - 0.08, sy + 0.5, fz], [fx + 0.08, sy + 0.5, fz], [fx + 0.08, sy + 0.5 + ss, fz], [fx - 0.08, sy + 0.5 + ss, fz], [0, 0, 1, 1], warm, dark);
  }
}

// Fern circle: a ring of 8–12 oversized fronds with a glow-plant centre. Registers a fern
// descriptor so standing inside at night can trigger a flavour message.
function addFernCircle(B, colData, rng, cx, cz) {
  const R = 3 + rng() * 2, n = 8 + (rng() * 5 | 0);
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2 + rng() * 0.2;
    addFern(B, rng, cx + Math.cos(a) * R, cz + Math.sin(a) * R, a, 2.0 + rng() * 1.0);
  }
  addGlowPlant(B, rng, cx, cz, 0.3 + rng() * 0.2);
  colData.ferns.push({ x: cx, z: cz, r: R });
}

/* ======================================================================== */
/*  HIDDEN HAMLET — a treehouse village carried by a grove of giants, hidden  */
/*  from above by a dense Weave and off the minimap until discovered.         */
/* ======================================================================== */
// A flat plank deck between two rim points, sagging like a rope bridge, with two rope
// rails, posts, walkable pads (tagged 'bough' so a hop onto it is a soft landing), and
// a scatter of lanterns. Plank lines are thin darker strips laid over the deck.
function addHamletBridge(B, colData, rng, ax, ay, az, bx, by, bz) {
  const segs = 7, half = 1.15;
  const sag = 1.4 + rng() * 0.8;
  const plank = _c.copy(COL.wood).multiplyScalar(1.05 + rng() * 0.25).clone();
  const plankDk = _c.copy(COL.wood).multiplyScalar(0.6).clone();
  const rope = _c.copy(COL.deadwood).multiplyScalar(0.9).clone();
  let dx = bx - ax, dz = bz - az; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  const px = -dz, pz = dx;                                   // across-deck unit
  const pts = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    pts.push([lerp(ax, bx, t), lerp(ay, by, t) - Math.sin(t * Math.PI) * sag, lerp(az, bz, t)]);
  }
  for (let k = 0; k < segs; k++) {
    const a = pts[k], b = pts[k + 1];
    // deck quad (top face, up-normal)
    B.plain.quad(
      [a[0] - px * half, a[1], a[2] - pz * half], [a[0] + px * half, a[1], a[2] + pz * half],
      [b[0] + px * half, b[1], b[2] + pz * half], [b[0] - px * half, b[1], b[2] - pz * half],
      [0, 0, 1, 1], plank);
    // plank seams: a thin dark strip at each segment join
    B.plain.quad(
      [a[0] - px * half, a[1] + 0.02, a[2] - pz * half], [a[0] + px * half, a[1] + 0.02, a[2] + pz * half],
      [a[0] + px * half + dx * 0.14, a[1] + 0.02, a[2] + pz * half + dz * 0.14], [a[0] - px * half + dx * 0.14, a[1] + 0.02, a[2] - pz * half + dz * 0.14],
      [0, 0, 1, 1], plankDk);
    colData.pads.push({ x: (a[0] + b[0]) / 2, z: (a[2] + b[2]) / 2, r: half + 0.5, y: (a[1] + b[1]) / 2, layer: 'bough' });
  }
  // two rope rails (thin cylinders following the sag) + posts
  for (const s of [-1, 1]) {
    for (let k = 0; k < segs; k++) {
      const a = pts[k], b = pts[k + 1];
      const ax2 = a[0] + px * half * s, az2 = a[2] + pz * half * s, ay2 = a[1] + 0.85;
      const bx2 = b[0] + px * half * s, bz2 = b[2] + pz * half * s, by2 = b[1] + 0.85;
      B.plain.addGeo(tplCyl, segMat(ax2, ay2, az2, bx2, by2, bz2, 0.05), rope, 0.1, rng);
      if (k % 2 === 0) B.plain.addGeo(tplCyl, compose(a[0] + px * half * s, a[1], a[2] + pz * half * s, 0.05, 0.85, 0.05), rope, 0.1, rng);
    }
  }
  // a couple of lanterns strung along the bridge (lamp material → glows at night)
  for (let k = 1; k < segs; k += 3) {
    const a = pts[k];
    B.lamp.addGeo(tplBlob, compose(a[0] + px * half, a[1] + 0.75, a[2] + pz * half, 0.16, 0.2, 0.16), srgb(0xffcf87), 0, rng);
    // Life pass: this bridge lantern softly swings at night (pooled additive glow overlay).
    colData.swingAnchors.push({ x: a[0] + px * half, y: a[1] + 0.75, z: a[2] + pz * half });
  }
  // Life pass: a slow drip off the sagging deck underside after dew hours.
  { const m = pts[(segs / 2) | 0]; colData.dripAnchors.push({ x: m[0], y: m[1] - 0.3, z: m[2] }); }
  // a hanging cloth banner mid-span
  if (rng() < 0.7) {
    const m = pts[(segs / 2) | 0], cl = [srgb(0xb5552f), srgb(0x9a7a2f), srgb(0x4e6242)][(rng() * 3) | 0];
    B.plain.quad([m[0] - px * 0.6, m[1] - 1.3, m[2] - pz * 0.6], [m[0] + px * 0.6, m[1] - 1.3, m[2] + pz * 0.6],
      [m[0] + px * 0.6, m[1] - 0.1, m[2] + pz * 0.6], [m[0] - px * 0.6, m[1] - 0.1, m[2] - pz * 0.6], [0, 0, 1, 1], cl);
  }
}

// A plank platform ringing a trunk: a thin walkable disc (wood, plank seams) + a low
// railing. Registered as a 'bough'-tagged pad so the player can walk it.
function addHamletPlatform(B, colData, rng, x, z, y, r) {
  const plank = _c.copy(COL.wood).multiplyScalar(1.05 + rng() * 0.2).clone();
  const plankDk = _c.copy(COL.wood).multiplyScalar(0.62).clone();
  B.plain.addGeo(tplCyl, compose(x, y - 0.16, z, r, 0.32, r), plank, 0.12, rng);      // deck slab
  B.plain.addGeo(tplCyl, compose(x, y + 0.005, z, r, 0.02, r), plankDk, 0.1, rng);     // faint top shade (plank grain)
  // radial plank seams
  const nSeam = 10;
  for (let k = 0; k < nSeam; k++) {
    const a = k / nSeam * Math.PI * 2;
    B.plain.quad(
      [x + Math.cos(a) * 0.4, y + 0.03, z + Math.sin(a) * 0.4], [x + Math.cos(a + 0.02) * 0.4, y + 0.03, z + Math.sin(a + 0.02) * 0.4],
      [x + Math.cos(a + 0.02) * r, y + 0.03, z + Math.sin(a + 0.02) * r], [x + Math.cos(a) * r, y + 0.03, z + Math.sin(a) * r],
      [0, 0, 1, 1], plankDk);
  }
  colData.pads.push({ x, z, r: r - 0.4, y, layer: 'bough' });
  // low railing posts around ~70% of the rim (a gap where bridges/ladders meet)
  const posts = 12;
  for (let k = 0; k < posts; k++) {
    if (k % 4 === 0) continue;
    const a = k / posts * Math.PI * 2;
    B.plain.addGeo(tplCyl, compose(x + Math.cos(a) * (r - 0.2), y, z + Math.sin(a) * (r - 0.2), 0.05, 0.8, 0.05), COL.deadwood, 0.1, rng);
  }
}

// A stilt hut on a platform: a warm wooden box with a gable roof (reused at hut scale)
// and lamp-material window dots that glow at night.
function addHamletHut(B, colData, rng, x, z, y, ang) {
  const w = 3.4 + rng() * 1.0, d = 3.0 + rng() * 0.8, wall = 2.4 + rng() * 0.5;
  const wood = _c.copy(COL.wood).multiplyScalar(1.15 + rng() * 0.3).clone();
  const dark = _c.copy(COL.wood).multiplyScalar(0.7).clone();
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
  // four walls
  B.plain.addGeo(tplBox, compose(x, y + wall / 2, z0, w, wall, 0.12), wood, 0.12, rng);
  B.plain.addGeo(tplBox, compose(x, y + wall / 2, z1, w, wall, 0.12), wood, 0.12, rng);
  B.plain.addGeo(tplBox, compose(x0, y + wall / 2, z, 0.12, wall, d), dark, 0.12, rng);
  B.plain.addGeo(tplBox, compose(x1, y + wall / 2, z, 0.12, wall, d), dark, 0.12, rng);
  addGableRoof(B, x0, z0, x1, z1, y + wall, srgb(0x5a3a28), srgb(0x6b4630));
  // window dots (glow at night) on the two long walls
  for (const zz of [z0 - 0.02, z1 + 0.02]) {
    for (let k = -1; k <= 1; k += 2) {
      B.lamp.addGeo(tplBox, compose(x + k * w * 0.22, y + wall * 0.55, zz, 0.42, 0.5, 0.06), srgb(0xffcf87), 0, rng);
    }
  }
}

// The whole hamlet: giants (via addTree, so they read as ordinary trees on the minimap),
// plank platforms, rope bridges, stilt huts, ladders/vine-ropes to the ground, a ground
// fire pit + drying racks, glow gardens, and a deliberately dense Weave overhead that
// hides the village from anyone crossing the canopy above.
function addHamlet(B, colData, mini, rng, ix, iz, ox, oz) {
  const giants = hamletGiants();
  // 1) the grove of giants
  for (const g of giants)
    addTree(B, colData, mini, rng, g.x, g.z, g.h, 13 + rng() * 4, { trunkR: 2.1 + rng() * 0.6, blobs: 8 });
  // 2) platforms ringing each trunk
  const platR = 4.6;
  for (const g of giants) addHamletPlatform(B, colData, rng, g.x, g.z, g.platY, platR);
  // 3) rope bridges between consecutive platforms (rim → rim)
  for (let k = 0; k < giants.length; k++) {
    const a = giants[k], b = giants[(k + 1) % giants.length];
    if (rng() < 0.18) continue;                              // one or two gaps in the ring
    let dx = b.x - a.x, dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    addHamletBridge(B, colData, rng,
      a.x + dx * platR, a.platY, a.z + dz * platR,
      b.x - dx * platR, b.platY, b.z - dz * platR);
  }
  // 4) stilt huts on ~4 platforms, ladders/vine-ropes down to the ground on every platform
  for (let k = 0; k < giants.length; k++) {
    const g = giants[k];
    if (k % 3 !== 2) {                                       // 4 of 6 carry a hut, offset out toward the rim
      const hx = g.x + Math.cos(g.ang) * 2.4, hz = g.z + Math.sin(g.ang) * 2.4;
      addHamletHut(B, colData, rng, hx, hz, g.platY + 0.02, g.ang);
    }
    // a climbable vine-rope ladder from the platform rim down to the ground
    const lx = g.x - Math.cos(g.ang) * (platR - 0.6), lz = g.z - Math.sin(g.ang) * (platR - 0.6);
    addVineRope(B, colData, rng, lx, lz, g.platY, 0);
    // a small glow garden on the platform
    for (let j = 0; j < 3; j++) {
      const a = rng() * 7, dd = rng() * (platR - 1);
      addGlowPlant(B, rng, g.x + Math.cos(a) * dd, g.z + Math.sin(a) * dd, 0.22 + rng() * 0.22);
    }
  }
  // 5) ground level: a central fire pit (stone ring + emissive embers) + drying racks
  const cx = HAMLET.x, cz = HAMLET.z;
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2, rr = 0.4 + rng() * 0.2;
    B.plain.addGeo(tplRock, compose(cx + Math.cos(a) * 1.5, rr * 0.3, cz + Math.sin(a) * 1.5, rr, rr * 0.6, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
  }
  B.lamp.addGeo(tplBlob, compose(cx, 0.35, cz, 0.7, 0.4, 0.7), srgb(0xff7b3a), 0, rng);   // embers (glow at night)
  colData.smokes.push({ x: cx, y: 0.9, z: cz, r: 0.6, warm: true });   // Life pass: fire-pit smoke plume
  for (let j = 0; j < 3; j++) addGlowPlant(B, rng, cx + (rng() - 0.5) * 4, cz + (rng() - 0.5) * 4, 0.3);
  // drying racks: two upright poles + a cross-bar with hanging cloth
  for (let r = 0; r < 2; r++) {
    const a = r * Math.PI + 0.6, dd = 5 + r, bxp = cx + Math.cos(a) * dd, bzp = cz + Math.sin(a) * dd;
    for (const s of [-1, 1]) B.plain.addGeo(tplCyl, compose(bxp + s * 1.4, 0, bzp, 0.06, 2.0, 0.06), COL.deadwood, 0.1, rng);
    B.plain.addGeo(tplCyl, compose(bxp, 1.9, bzp, 0.05, 2.9, 0.05, 0, 0, Math.PI / 2), COL.deadwood, 0.1, rng);
    for (let c = 0; c < 3; c++) {
      const clx = bxp - 1.0 + c * 1.0, cl = [srgb(0xb5552f), srgb(0x9a7a2f), srgb(0xcfc2a0)][(rng() * 3) | 0];
      B.plain.quad([clx - 0.35, 0.7, bzp], [clx + 0.35, 0.7, bzp], [clx + 0.35, 1.85, bzp], [clx - 0.35, 1.85, bzp], [0, 0, 1, 1], cl);
    }
  }
  // 6) a deliberately dense Weave overhead — hides the hamlet from anyone crossing the
  // canopy above (near-full coverage vs the normal 60%). Walkable ('weave') platters.
  const N = 5, S = CHUNK / N, norm = (h) => (h >>> 0) / 4294967296;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (norm(hash2(ix * N + i, iz * N + j, 4243)) > 0.9) continue;   // ~92% coverage
    const h2 = hash2(ix * N + i, iz * N + j, 71);
    const jx = (((h2 >>> 8) & 255) / 255 - 0.5) * S * 0.5, jz = (((h2 >>> 16) & 255) / 255 - 0.5) * S * 0.5;
    const cxp = ox + (i + 0.5) * S + jx, czp = oz + (j + 0.5) * S + jz;
    const R = 6 + norm(h2) * 3, py = 26 + norm(hash2(i, j, 99)) * 3;
    B.leaf.addGeo(tplBlob, compose(cxp, py, czp, R, R * 0.3, R, 0, ((h2 >>> 3) & 255) / 255 * 7, 0), leafTintByY(COL.leafC, py), 0.2, rng);
    colData.pads.push({ x: cxp, z: czp, r: R * 0.82, y: py, layer: 'weave' });
  }
}

// Dispatcher — decide at most one oddity per chunk on independent hash salts (so the rng
// stream and the rest of the chunk are undisturbed by the choice), then draw with rng.
function addOddities(B, colData, rng, ix, iz, ox, oz, type) {
  const b0 = INSET, b1 = CHUNK - INSET;
  const pct = (salt) => hash2(ix, iz, salt) % 100;
  if ((type === 'park' || type === 'grove') && pct(3221) < 20) {
    addFernCircle(B, colData, rng, ox + lerp(b0 + 6, b1 - 6, rng()), oz + lerp(b0 + 6, b1 - 6, rng()));
    return;
  }
  if ((type === 'park' || type === 'plaza') && pct(3111) < 8) {
    addGreenhouse(B, colData, rng, ox + lerp(b0 + 8, b1 - 8, rng()), oz + lerp(b0 + 6, b1 - 6, rng()));
    return;
  }
  if (type === 'city' && pct(3333) < 12) {
    const cands = colData.solids.filter(s => s.h >= 8 && s.x1 - s.x0 > 4 && s.z1 - s.z0 > 4);
    if (cands.length) { addShrine(B, colData, rng, cands[(rng() * cands.length) | 0]); return; }
  }
  if (pct(3444) < 10) {
    const near = rng() < 0.5;
    const x = near ? ox + (rng() < 0.5 ? 7 : CHUNK - 7) : ox + lerp(10, CHUNK - 10, rng());
    const z = near ? oz + lerp(10, CHUNK - 10, rng()) : oz + (rng() < 0.5 ? 7 : CHUNK - 7);
    addWindChime(B, colData, rng, x, z);
  }
}

// Little details (sprinkle pass) — small deterministic ambient props, each individually
// sparse but several per chunk. Runs last (tail of the rng stream) so it barely perturbs the
// rest of the chunk. Reuses the builder helpers (addBench/addMailbox/addPuddle/… ) added
// in worldgen-builders.js and the puddle/web batches.
function addLittleDetails(B, colData, mini, rng, ix, iz, ox, oz, type, style) {
  const b0 = INSET, b1 = CHUNK - INSET;

  // 1. benches: along the sidewalks facing the street; near the plaza fountain / a park tree.
  let nBench = 2 + (rng() * 3 | 0);   // 2–4
  for (let k = 0; k < nBench; k++) {
    let bx, bz, ang;
    if (type === 'plaza' && rng() < 0.6) {                 // ring the old fountain
      const a = rng() * Math.PI * 2, d = 6.5 + rng() * 3;
      bx = ox + 32 + Math.cos(a) * d; bz = oz + 32 + Math.sin(a) * d; ang = a + Math.PI;
    } else if ((type === 'park' || type === 'grove') && mini.trees.length && rng() < 0.7) {
      const t = mini.trees[(rng() * mini.trees.length) | 0], a = rng() * Math.PI * 2, d = 2.5 + rng() * 2;
      bx = t[0] + Math.cos(a) * d; bz = t[1] + Math.sin(a) * d; ang = a + Math.PI;
    } else {                                               // sidewalk edge, back to the buildings
      const along = lerp(b0, b1, rng()), near = rng() < 0.5;
      if (rng() < 0.5) { bz = near ? oz + 5.2 : oz + CHUNK - 5.2; bx = ox + along; ang = near ? 0 : Math.PI; }
      else { bx = near ? ox + 5.2 : ox + CHUNK - 5.2; bz = oz + along; ang = near ? Math.PI / 2 : -Math.PI / 2; }
    }
    addBench(B, colData, rng, bx, bz, ang);
  }

  // 2. rusted mailboxes near building entrances (city / oldtown), ~1–2.
  if (type === 'city' || type === 'towers' || style === 'oldtown') {
    const cands = colData.solids.filter(s => s.h >= 5 && s.x1 - s.x0 > 3 && s.z1 - s.z0 > 3);
    const nM = cands.length ? 1 + (rng() < 0.5 ? 1 : 0) : 0;
    for (let k = 0; k < nM; k++) {
      const s = cands[(rng() * cands.length) | 0];
      const face = (rng() * 4) | 0;                        // 0:+x 1:-x 2:+z 3:-z outward
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const u = 0.3 + rng() * 0.4;                         // toward one end of the face (an "entrance")
      let mx, mz, ang;
      if (face === 0) { mx = s.x1 + 0.7; mz = lerp(s.z0, s.z1, u); ang = Math.PI / 2; }
      else if (face === 1) { mx = s.x0 - 0.7; mz = lerp(s.z0, s.z1, u); ang = -Math.PI / 2; }
      else if (face === 2) { mz = s.z1 + 0.7; mx = lerp(s.x0, s.x1, u); ang = 0; }
      else { mz = s.z0 - 0.7; mx = lerp(s.x0, s.x1, u); ang = Math.PI; }
      if (mx > ox + 1 && mx < ox + CHUNK - 1 && mz > oz + 1 && mz < oz + CHUNK - 1)
        addMailbox(B, colData, rng, mx, mz, ang);
    }
  }

  // 3. laundry lines from a building face out to a small pole (city / blocks / oldtown), ~1–2.
  if (type === 'city' || type === 'towers' || style === 'blocks' || style === 'oldtown') {
    const cands = colData.solids.filter(s => s.h >= 6 && s.x1 - s.x0 > 4 && s.z1 - s.z0 > 4);
    const nL = cands.length ? 1 + (rng() < 0.4 ? 1 : 0) : 0;
    for (let k = 0; k < nL; k++) {
      const s = cands[(rng() * cands.length) | 0];
      const face = (rng() * 4) | 0, ly = 3 + rng() * 2.4, u = 0.3 + rng() * 0.4, dist = 4 + rng() * 2.2;
      let ax, az, pxp, pzp;
      if (face === 0) { ax = s.x1; az = lerp(s.z0, s.z1, u); pxp = ax + dist; pzp = az; }
      else if (face === 1) { ax = s.x0; az = lerp(s.z0, s.z1, u); pxp = ax - dist; pzp = az; }
      else if (face === 2) { az = s.z1; ax = lerp(s.x0, s.x1, u); pzp = az + dist; pxp = ax; }
      else { az = s.z0; ax = lerp(s.x0, s.x1, u); pzp = az - dist; pxp = ax; }
      if (Math.min(ly, ly) > s.h - 0.3) continue;          // cord must stay below the roof
      if (pxp < ox + 2 || pxp > ox + CHUNK - 2 || pzp < oz + 2 || pzp > oz + CHUNK - 2) continue;
      B.plain.addGeo(tplCyl, compose(pxp, 0, pzp, 0.05, ly + 0.3, 0.05), COL.wood, 0, rng);
      addLaundryLine(B, rng, ax, ly, az, pxp, ly, pzp);
    }
  }

  // 4. morning puddles on streets / sidewalks (biased to street edges like the grass), ~3–6.
  const nPud = 3 + (rng() * 4 | 0);
  for (let k = 0; k < nPud; k++) {
    let px, pz;
    if (rng() < 0.6) { px = ox + (rng() < 0.5 ? 2 + rng() * 10 : CHUNK - 2 - rng() * 10); pz = oz + rng() * CHUNK; }
    else { pz = oz + (rng() < 0.5 ? 2 + rng() * 10 : CHUNK - 2 - rng() * 10); px = ox + rng() * CHUNK; }
    addPuddle(B, rng, px, pz);
  }

  // 5. mushroom clusters on roots / rubble / the sinkhole floor (park / grove / sinkhole), ~2–4.
  if (type === 'park' || type === 'grove' || type === 'sinkhole') {
    const nMush = 2 + (rng() * 3 | 0);
    const pit = colData.pits.find(p => p.r);               // sinkhole bowl
    for (let k = 0; k < nMush; k++) {
      if (type === 'sinkhole' && pit && rng() < 0.7) {
        const a = rng() * Math.PI * 2, d = rng() * pit.r * 0.7;
        addMushroomCluster(B, rng, pit.x + Math.cos(a) * d, pit.z + Math.sin(a) * d, -pit.depth + 0.02);
      } else if (mini.trees.length) {
        const t = mini.trees[(rng() * mini.trees.length) | 0], a = rng() * Math.PI * 2, d = 1 + rng() * 2;
        addMushroomCluster(B, rng, t[0] + Math.cos(a) * d, t[1] + Math.sin(a) * d, 0);
      }
    }
  }

  // 6. cobwebs in a building corner under the eaves (stands in for arcade/viaduct/rib corners),
  //    ≤2 per chunk, deterministic.
  {
    const cands = colData.solids.filter(s => s.h >= 4 && s.x1 - s.x0 > 3 && s.z1 - s.z0 > 3);
    const nW = cands.length && rng() < 0.6 ? 1 + (rng() < 0.35 ? 1 : 0) : 0;
    for (let k = 0; k < nW; k++) {
      const s = cands[(rng() * cands.length) | 0];
      const atX0 = rng() < 0.5, atZ0 = rng() < 0.5;
      const cx = atX0 ? s.x0 : s.x1, cz = atZ0 ? s.z0 : s.z1;
      const cy = Math.min(s.h - 0.3, 2 + rng() * 2.4);
      const sx = atX0 ? 1 : -1, sz = atZ0 ? 1 : -1;
      addCobweb(B, rng, cx, cy, cz, 0.5 + rng() * 0.5, [sx, -0.35, 0], [0, -0.35, sz]);
    }
  }
}

function buildChunk(ix, iz) {
  const rng = mulberry32(hash2(ix, iz, 999));
  const type = chunkType(ix, iz);
  const style = districtStyle(ix, iz);        // Districts (Phase A): architectural identity
  CUR_STYLE = style;                          // addBuilding reads this unless opts.style given
  const REG = regionAt(ix, iz);               // Regions (Part 1): macro-biome descriptor
  CUR_REG = REG;                              // builders read this (leaf tint, buildings, grass, lamps)
  const biome = REG.biome;
  const vd = clamp((REG.verdancy - 0.51) / 0.21, -1, 1);   // −1..1 across the canopy band (micro-drift)
  const ox = ix * CHUNK, oz = iz * CHUNK;
  const B = { plain: new Batch(), bld: new Batch(), leaf: new Batch(), vine: new Batch(), grass: new Batch(), glow: new Batch(), lamp: new Batch(), puddle: new Batch(), web: new Batch(), net: new Batch() };
  const colData = { solids: [], trunks: [], pads: [], lamps: [], pits: [], waters: [], chimes: [], ferns: [], ladders: [], lifts: [],
    // Ambient-vignette anchors (Life pass): discovered at build time, driven at runtime by
    // pooled overlays in entities.js. All optional, all cheap; queried O(near) per frame.
    smokes: [], stallAnchors: [], bannerAnchors: [], swingAnchors: [], dripAnchors: [] };
  const mini = { rects: [], trees: [], type };
  const extraMeshes = [];   // non-batched meshes (e.g. reservoir water plane)
  let openRect = null; // area open to the sky at ground level
  let fallenLadder = null;  // Ladders: fallen-tower ladder anchor (built late, RNG-stable)

  /* ---- street trees along west (x=ox) and south (z=oz) borders ---- */
  // Regions: skip rate + spacing drive street-tree density. scorch kills ~75% (survivors are
  // dead snags or sun-stunted); deepgreen thickens ×1.6 and grows bigger with occasional giants;
  // canopy micro-drifts ±25% with verdancy.
  let skipP = 0.22, spaceMul = 1;
  if (biome === 'scorch') skipP = 0.75;
  else if (biome === 'deepgreen') { skipP = 0.12; spaceMul = 1 / 1.6; }
  else skipP = clamp(0.22 - vd * 0.14, 0.05, 0.4);
  const treeLine = (horiz) => {
    let t = 6 + rng() * 8;
    while (t < CHUNK - 6) {
      for (const off of [-6.5, 6.5]) {
        if (rng() < skipP) continue; // sun gaps
        const jx = (rng() - 0.5) * 2, jz = (rng() - 0.5) * 2;
        const px = horiz ? ox + t + jx : ox + off + jx;
        const pz = horiz ? oz + off + jz : oz + t + jz;
        if (biome === 'scorch') {   // survivors: half bleached dead snags, half sun-stunted (h 8–14, R 3–5)
          if (rng() < 0.5) addTree(B, colData, mini, rng, px, pz, 8 + rng() * 6, 3 + rng() * 2, { dead: true });
          else addTree(B, colData, mini, rng, px, pz, 8 + rng() * 6, 3 + rng() * 2);
          continue;
        }
        let h = 20 + rng() * 11, R = 8 + rng() * 5, topts;
        if (biome === 'deepgreen') {
          h *= 1.2; R *= 1.15;
          if (rng() < 0.15) { topts = { trunkR: 1.9 + rng() * 0.7, blobs: 7 }; h = 33 + rng() * 7; R = 13 + rng() * 4; }   // a giant in any chunk type
        }
        addTree(B, colData, mini, rng, px, pz, h, R, topts);
      }
      t += (12 + rng() * 6) * spaceMul;
    }
  };
  if (type !== 'plaza' || rng() < 0.6) { treeLine(true); treeLine(false); }

  /* ---- streets: asphalt, sidewalks, lamps, wires, cars ---- */
  const canalX = isCanalX(ix), canalZ = isCanalZ(iz);   // Waterways: this street line carries a canal
  addRoads(B, rng, ox, oz, canalX, canalZ);
  for (const axis of [0, 1]) {
    // power poles: side is constant per street line so wires run straight across chunks
    const pside = (axis === 0 ? hash2(ix, 0, 5) : hash2(0, iz, 6)) % 2 ? 7.4 : -7.4;
    const P = [4, 25, 46, 68].map(t => axis === 0 ? [ox + pside, oz + t] : [ox + t, oz + pside]);
    for (let k = 0; k < 3; k++) {
      addPowerPole(B, colData, rng, P[k][0], P[k][1], axis);
      wireSpan(B, P[k][0], 6.7, P[k][1], P[k + 1][0], 6.7, P[k + 1][1], 0.7 + rng() * 0.5, rng);
      wireSpan(B, P[k][0], 6.35, P[k][1], P[k + 1][0], 6.35, P[k + 1][1], 0.6 + rng() * 0.5);   // lower wire kept bare
    }
    // street lamps on the other side
    for (let k = 0; k < 3; k++) {
      if (rng() < 0.25) continue;
      const t = 10 + k * 22 + (rng() - 0.5) * 6;
      const side = -Math.sign(pside) * 5.9;
      if ((axis === 0 ? canalX : canalZ) && Math.abs(side) < CANAL.guard) continue;   // not in the channel strip
      if (axis === 0) addLamp(B, colData, rng, ox + side, oz + t, side > 0 ? Math.PI : 0);
      else addLamp(B, colData, rng, ox + t, oz + side, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  let carN = (type === 'city' || type === 'towers') ? 3 + (rng() * 4 | 0) : 1 + (rng() * 2 | 0);
  if (biome === 'scorch') carN = Math.round(carN * 0.5);   // Regions: fewer parked cars in the dead quarter

  for (let k = 0; k < carN; k++) {
    const axis = rng() < 0.5 ? 0 : 1;
    const t = 6 + rng() * (CHUNK - 12);
    const lane = rng() < 0.8 ? (rng() < 0.5 ? -1 : 1) * (2 + rng() * 2) : (rng() - 0.5) * 3;
    const skew = (rng() - 0.5) * (rng() < 0.15 ? 1.6 : 0.24);
    if ((axis === 0 ? canalX : canalZ) && Math.abs(lane) < CANAL.guard) continue;   // don't sink cars in the channel
    if (axis === 0) addCar(B, colData, rng, ox + lane, oz + t, (rng() < 0.5 ? 1 : -1) * Math.PI / 2 + skew);
    else addCar(B, colData, rng, ox + t, oz + lane, (rng() < 0.5 ? 0 : Math.PI) + skew);
  }
  if ((type === 'city' || type === 'towers') && rng() < 0.3) {
    const axis = rng() < 0.5 ? 0 : 1, t = 12 + rng() * 40, side = (rng() < 0.5 ? -1 : 1) * 6.6;
    if (!((axis === 0 ? canalX : canalZ) && Math.abs(side) < CANAL.guard)) {
      if (axis === 0) addStall(B, colData, rng, ox + side, oz + t, Math.PI / 2);
      else addStall(B, colData, rng, ox + t, oz + side, 0);
    }
  }

  /* ---- block interior ---- */
  const b0 = INSET, b1 = CHUNK - INSET;
  if (type === 'city') {
    // continuous rows of buildings around the block perimeter → street canyons
    const L = CHUNK - 2 * INSET;
    // Sides 0/1 run along x, sides 2/3 along z; every row starts at the same INSET line,
    // so at each corner a side-0/1 building and a side-2/3 building both put a street
    // facade on the exact same plane (x=INSET or z=INSET). Coincident coplanar walls
    // z-fight and flicker on every camera turn. Sides 0/1 are placed first and already
    // span the corners, so we skip any later building whose footprint overlaps one
    // already placed — corners stay covered, but no wall is ever drawn twice.
    const placed = [];
    const clashes = (bx, bz, bw, bd) => placed.some(p =>
      bx - bw / 2 < p.x1 - 0.5 && bx + bw / 2 > p.x0 + 0.5 &&
      bz - bd / 2 < p.z1 - 0.5 && bz + bd / 2 > p.z0 + 0.5);
    for (const side of [0, 1, 2, 3]) {
      let t = 0;
      while (t < L - 5) {
        // per-district footprint: garden leaves yard gaps between small detached houses
        const dm = bldDims(style, rng, rng() < 0.15);
        const gap = style === 'garden' ? 3 + rng() * 3 : 0.6 + rng() * 0.6;
        const along = Math.min(dm.w, L - t - 0.6);
        const w2 = along + gap;
        if (along < 5) break;
        const depth = dm.d;
        const center = INSET + t + along / 2;
        // Regions: ashen doubles the collapsed-lot rate (dead city under an intact roof).
        const baseBuildP = style === 'works' ? 0.9 : 0.84;
        const buildP = biome === 'ashen' ? Math.max(0, 1 - (1 - baseBuildP) * 2) : baseBuildP;
        if (rng() < buildP) {
          const h = dm.h;
          let bx, bz, bw, bd;
          if (side === 0) { bx = ox + center; bz = oz + INSET + depth / 2; bw = along; bd = depth; }
          else if (side === 1) { bx = ox + center; bz = oz + CHUNK - INSET - depth / 2; bw = along; bd = depth; }
          else if (side === 2) { bx = ox + INSET + depth / 2; bz = oz + center; bw = depth; bd = along; }
          else { bx = ox + CHUNK - INSET - depth / 2; bz = oz + center; bw = depth; bd = along; }
          if (clashes(bx, bz, bw, bd)) { t += w2; continue; }   // corner already built by a perpendicular row
          placed.push({ x0: bx - bw / 2, z0: bz - bd / 2, x1: bx + bw / 2, z1: bz + bd / 2 });
          addBuilding(B, colData, mini, rng, bx, bz, bw, bd, h);
          // garden yards: dress the gap beside the house with fence / shed / laundry
          if (style === 'garden' && gap > 2 && t + along + gap < L) {
            const g0 = INSET + t + along + 0.2, g1 = INSET + t + along + gap - 0.2;
            if (side === 0) addGardenYard(B, colData, rng, ox + g0, oz + INSET, ox + g1, oz + INSET + depth, [ox + INSET + t + along, oz + INSET + depth / 2]);
            else if (side === 1) addGardenYard(B, colData, rng, ox + g0, oz + CHUNK - INSET - depth, ox + g1, oz + CHUNK - INSET, [ox + INSET + t + along, oz + CHUNK - INSET - depth / 2]);
            else if (side === 2) addGardenYard(B, colData, rng, ox + INSET, oz + g0, ox + INSET + depth, oz + g1, [ox + INSET + depth / 2, oz + INSET + t + along]);
            else addGardenYard(B, colData, rng, ox + CHUNK - INSET - depth, oz + g0, ox + CHUNK - INSET, oz + g1, [ox + CHUNK - INSET - depth / 2, oz + INSET + t + along]);
          }
        } else {
          // collapsed lot: rubble, grass, a young tree
          let vx, vz;
          if (side === 0) { vx = ox + center; vz = oz + INSET + 6; }
          else if (side === 1) { vx = ox + center; vz = oz + CHUNK - INSET - 6; }
          else if (side === 2) { vx = ox + INSET + 6; vz = oz + center; }
          else { vx = ox + CHUNK - INSET - 6; vz = oz + center; }
          const rr = 1 + rng() * 1.6;
          B.plain.addGeo(tplRock, compose(vx, rr * 0.2, vz, rr, rr * 0.45, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
          addTree(B, colData, mini, rng, vx + (rng() - 0.5) * 4, vz + (rng() - 0.5) * 4, 9 + rng() * 6, 4 + rng() * 2);
          for (let g = 0; g < 7; g++) addGrassTuft(B, rng, vx + (rng() - 0.5) * 8, vz + (rng() - 0.5) * 8, 0.5 + rng() * 0.6);
        }
        t += w2;
      }
    }
    // green courtyard heart
    const ccx = ox + 32, ccz = oz + 32;
    addTree(B, colData, mini, rng, ccx + (rng() - 0.5) * 6, ccz + (rng() - 0.5) * 6, 14 + rng() * 9, 6 + rng() * 3);
    for (let k = 0; k < 10; k++) addGrassTuft(B, rng, ccx + (rng() - 0.5) * 14, ccz + (rng() - 0.5) * 14, 0.5 + rng() * 0.6);
  } else if (type === 'towers') {
    for (let gx = 0; gx < 2; gx++) for (let gz = 0; gz < 2; gz++) {
      const cellX = ox + b0 + (gx + 0.5) * (b1 - b0) / 2, cellZ = oz + b0 + (gz + 0.5) * (b1 - b0) / 2;
      if (rng() < 0.8) {
        const px = cellX + (rng() - 0.5) * 3, pz = cellZ + (rng() - 0.5) * 3;
        addBuilding(B, colData, mini, rng, px, pz, 18 + rng() * 4, 18 + rng() * 4, 5 + rng() * 3, { garden: true });
        const dm = bldDims(style, rng, true);
        addBuilding(B, colData, mini, rng, px, pz, dm.w, dm.d, dm.h);
      } else {
        addTree(B, colData, mini, rng, cellX, cellZ, 13 + rng() * 8, 5 + rng() * 3);
      }
    }
  } else if (type === 'park') {
    const nG = 2 + (rng() * 2 | 0);
    for (let k = 0; k < nG; k++)
      addTree(B, colData, mini, rng, ox + lerp(b0 + 8, b1 - 8, rng()), oz + lerp(b0 + 8, b1 - 8, rng()), 22 + rng() * 10, 10 + rng() * 5);
    for (let k = 0; k < 7; k++)
      addTree(B, colData, mini, rng, ox + lerp(b0, b1, rng()), oz + lerp(b0, b1, rng()), 7 + rng() * 6, 3 + rng() * 2.5);
  } else if (type === 'plaza') {
    openRect = { x0: ox + 14, z0: oz + 14, x1: ox + CHUNK - 14, z1: oz + CHUNK - 14 };
    // rubble
    for (let k = 0; k < 4 + rng() * 3; k++) {
      const rr = 1.2 + rng() * 2.4;
      const rx = ox + lerp(b0 + 4, b1 - 4, rng()), rz = oz + lerp(b0 + 4, b1 - 4, rng());
      B.plain.addGeo(tplRock, compose(rx, rr * 0.25, rz, rr, rr * 0.5, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
      colData.trunks.push({ x: rx, z: rz, r: rr * 0.7, h: rr * 0.7 });
    }
    // dead trees
    for (let k = 0; k < 2; k++)
      addTree(B, colData, mini, rng, ox + lerp(b0, b1, rng()), oz + lerp(b0, b1, rng()), 10 + rng() * 8, 4, { dead: true });
    // dry fountain
    if (rng() < 0.6) {
      const fx = ox + 32, fz = oz + 32;
      B.plain.addGeo(new THREE.CylinderGeometry(4.2, 4.6, 1, 14), compose(fx, 0.5, fz, 1, 1, 1), COL.rock, 0.1, rng);
      B.plain.addGeo(new THREE.CylinderGeometry(0.6, 0.9, 2.6, 8), compose(fx, 1.3, fz, 1, 1, 1), COL.rock, 0.1, rng);
      colData.trunks.push({ x: fx, z: fz, r: 4.4, h: 1 });
    }
    // street market around the old square
    const nStall = 2 + (rng() * 3 | 0);
    for (let k = 0; k < nStall; k++) {
      const a = rng() * Math.PI * 2, d2 = 9 + rng() * 8;
      addStall(B, colData, rng, ox + 32 + Math.cos(a) * d2, oz + 32 + Math.sin(a) * d2, (rng() * 4 | 0) * Math.PI / 2);
    }
  } else if (type === 'grove') {
    const nM = 4 + (rng() * 2 | 0);
    for (let k = 0; k < nM; k++) {
      addTree(B, colData, mini, rng,
        ox + lerp(b0 + 6, b1 - 6, rng()), oz + lerp(b0 + 6, b1 - 6, rng()),
        33 + rng() * 9, 13 + rng() * 5, { trunkR: 1.9 + rng() * 0.9, blobs: 7 });
    }
  } else if (type === 'spire') {
    addBuilding(B, colData, mini, rng, SPIRE.x, SPIRE.z, SPIRE.size, SPIRE.size, SPIRE.h,
      { vines: true, allSides: true, garden: false, style: 'blocks', noTier: true });   // keep the iconic single tower
    // ring of guardian trees
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + rng() * 0.4;
      addTree(B, colData, mini, rng, SPIRE.x + Math.cos(a) * 22, SPIRE.z + Math.sin(a) * 22, 18 + rng() * 8, 7 + rng() * 3);
    }
    // beacon garden + old broadcast mast on top
    for (let k = 0; k < 4; k++)
      B.glow.addGeo(tplBlob, compose(SPIRE.x + (rng() - 0.5) * 10, SPIRE.h + 0.5, SPIRE.z + (rng() - 0.5) * 10, 0.9, 0.7, 0.9, 0, rng() * 7, 0), COL.glowPlant, 0.3, rng);
    B.plain.addGeo(tplCyl, compose(SPIRE.x + 6, SPIRE.h, SPIRE.z + 6, 0.22, 10, 0.22), COL.rust, 0.1, rng);
    B.plain.addGeo(tplBox, compose(SPIRE.x + 6, SPIRE.h + 7.5, SPIRE.z + 6, 2.6, 0.12, 0.12), COL.rust, 0.1, rng);
    B.plain.addGeo(tplBox, compose(SPIRE.x + 6, SPIRE.h + 5.5, SPIRE.z + 6, 0.12, 0.12, 2.6), COL.rust, 0.1, rng);
    B.lamp.addGeo(tplBlob, compose(SPIRE.x + 6, SPIRE.h + 10, SPIRE.z + 6, 0.35, 0.35, 0.35), srgb(0xffe0b0), 0, rng);
    colData.trunks.push({ x: SPIRE.x + 6, z: SPIRE.z + 6, r: 0.3, h: SPIRE.h + 10 });
    // The Second Seed finale (Part 2, Ch7): the beacon relit — a constant-emissive head at
    // the mast tip that now exists permanently once the campaign is done. Extra mesh (matLampLit
    // is not a batch material) so it glows day and night against the sky like a lit beacon.
    if (typeof storyComplete === 'function' && storyComplete()) {
      const beacon = new THREE.Mesh(tplBlob, matLampLit); beacon.scale.setScalar(0.55);
      beacon.position.set(SPIRE.x + 6, SPIRE.h + 10, SPIRE.z + 6);
      extraMeshes.push(beacon);
    }
  } else if (type === 'colossus') {
    addColossus(B, colData, mini, rng, ox, oz);
  } else if (type === 'fallen') {
    fallenLadder = addFallen(B, colData, mini, rng, ox, oz);
  } else if (type === 'sinkhole') {
    addSinkhole(B, colData, mini, rng, ox, oz);
  } else if (type === 'reservoir') {
    addReservoir(B, colData, mini, rng, ox, oz, extraMeshes);
  } else if (type === 'hamlet') {
    addHamlet(B, colData, mini, rng, ix, iz, ox, oz);   // Hidden Hamlet — grove of giants + treehouse village + dense Weave
  }

  /* ---- hanging vine curtains across the streets ---- */
  if (type !== 'plaza') {
    const nC = 4 + (rng() * 3 | 0);
    for (let k = 0; k < nC; k++) {
      const y1 = 8 + rng() * 7, y2 = 8 + rng() * 7;
      const dbl = rng() < 0.3;                          // occasionally a second layer 1 m behind
      if (rng() < 0.5) {
        const z = oz + 8 + rng() * (CHUNK - 16);
        addCurtain(B, rng, ox - 7, y1, z, ox + 7, y2, z);
        if (dbl) addCurtain(B, rng, ox - 7, y1, z + 1, ox + 7, y2, z + 1);
      } else {
        const x = ox + 8 + rng() * (CHUNK - 16);
        addCurtain(B, rng, x, y1, oz - 7, x, y2, oz + 7);
        if (dbl) addCurtain(B, rng, x + 1, y1, oz - 7, x + 1, y2, oz + 7);
      }
    }
  }

  /* ---- grass (+~35% density; occasional tall clumps for a more overgrown floor) ---- */
  // Regions: scorch sparse straw (addGrassTuft tints it), deepgreen lush.
  let nGrass = type === 'park' ? 230 : type === 'grove' ? 162 : type === 'plaza' ? 80 : 135;
  if (biome === 'scorch') nGrass = Math.round(nGrass * 0.4);
  else if (biome === 'deepgreen') nGrass = Math.round(nGrass * 1.3);
  for (let k = 0; k < nGrass; k++) {
    // bias toward street edges and block border (sidewalks)
    let gx, gz;
    if (rng() < 0.5) { gx = ox + (rng() < 0.5 ? 2 + rng() * 9 : CHUNK - 2 - rng() * 9); gz = oz + rng() * CHUNK; }
    else { gz = oz + (rng() < 0.5 ? 2 + rng() * 9 : CHUNK - 2 - rng() * 9); gx = ox + rng() * CHUNK; }
    if (type === 'park' || type === 'grove') { gx = ox + rng() * CHUNK; gz = oz + rng() * CHUNK; }
    const tall = rng() < 0.09;
    addGrassTuft(B, rng, gx, gz, tall ? 1.2 + rng() * 0.6 : 0.45 + rng() * 0.75);
  }
  // root/ivy creep patches on the pavement
  const nIvy = type === 'plaza' ? 5 : 9 + (rng() * 6 | 0);
  for (let k = 0; k < nIvy; k++) {
    let ix2, iz2;
    if (rng() < 0.6) { ix2 = ox + (rng() < 0.5 ? 2 + rng() * 10 : CHUNK - 2 - rng() * 10); iz2 = oz + rng() * CHUNK; }
    else { iz2 = oz + (rng() < 0.5 ? 2 + rng() * 10 : CHUNK - 2 - rng() * 10); ix2 = ox + rng() * CHUNK; }
    addIvyPatch(B, rng, ix2, iz2, 0.8 + rng() * 1.6);
  }

  /* ---- glow plants (night bioluminescence) ---- */
  // Regions: deepgreen night should feel bioluminescent — glow plants ×1.8 (fireflies too, at runtime).
  let nGlow = 5 + (rng() * 6 | 0);
  if (biome === 'deepgreen') nGlow = Math.round(nGlow * 1.8);
  for (let k = 0; k < nGlow; k++) {
    if (mini.trees.length === 0) break;
    const t = mini.trees[(rng() * mini.trees.length) | 0];
    const a = rng() * Math.PI * 2, d = 1 + rng() * 2.5;
    addGlowPlant(B, rng, t[0] + Math.cos(a) * d, t[1] + Math.sin(a) * d, 0.25 + rng() * 0.3);
  }

  /* ---- Regions: biome ground dressing ---- */
  if (biome === 'deepgreen') {
    // grass breaking through the asphalt itself — ~8 tufts on the street surface near the borders
    for (let k = 0; k < 8; k++) {
      const onX = rng() < 0.5;
      const gx = onX ? ox + rng() * CHUNK : ox + (rng() < 0.5 ? 0 : CHUNK) + (rng() - 0.5) * 6;
      const gz = onX ? oz + (rng() < 0.5 ? 0 : CHUNK) + (rng() - 0.5) * 6 : oz + rng() * CHUNK;
      addGrassTuft(B, rng, gx, gz, 0.4 + rng() * 0.5);
    }
  } else if (biome === 'scorch') {
    // 2–4 bleached snag trunks (dead trees) standing in the open
    const nSnag = 2 + (rng() * 3 | 0);
    for (let k = 0; k < nSnag; k++)
      addTree(B, colData, mini, rng, ox + lerp(b0, b1, rng()), oz + lerp(b0, b1, rng()), 6 + rng() * 7, 3 + rng() * 2, { dead: true });
  } else if (biome === 'ashen') {
    // extra rubble rocks strewn along the street edges
    const nRub = 4 + (rng() * 4 | 0);
    for (let k = 0; k < nRub; k++) {
      const onX = rng() < 0.5, rr = 0.7 + rng() * 1.4;
      const rx = onX ? ox + rng() * CHUNK : ox + (rng() < 0.5 ? 6 : CHUNK - 6);
      const rz = onX ? oz + (rng() < 0.5 ? 6 : CHUNK - 6) : oz + rng() * CHUNK;
      B.plain.addGeo(tplRock, compose(rx, rr * 0.2, rz, rr, rr * 0.5, rr, rng(), rng() * 7, rng()), COL.rock, 0.2, rng);
    }
  }

  /* ---- multi-layered canopy (Phase 1): L1 bough roads + L2 weave ---- */
  // The Hidden Hamlet builds its own bridges + a dedicated dense Weave, and must stay clear
  // of viaducts/canals/oddities cutting through its clearing — so it skips the shared passes.
  if (type !== 'hamlet') {
    // Regions: scorch — the canopy failed here; no bough roads / weave / crown nests overhead
    // (exposure then follows from the real shadow rays, no heat hack needed).
    if (biome !== 'scorch') {
      addBoughRoads(B, colData, rng, ox, oz, type);
      addWeave(B, colData, rng, ix, iz, ox, oz, type);
    }

    /* ---- Anomalies (Phase A): the Elevated Line viaduct along rare grid lines ---- */
    addViaduct(B, colData, mini, rng, ix, iz, ox, oz);

    /* ---- Waterways: canals along rare street lines (water below any viaduct) ---- */
    addCanal(B, colData, rng, ix, iz, ox, oz, extraMeshes);

    /* ---- Anomalies (Phase B): Tier 3 oddities sprinkled at low rates ---- */
    addOddities(B, colData, rng, ix, iz, ox, oz, type);
  }

  /* ---- Little details (sprinkle pass): benches, mailboxes, laundry, puddles,
          mushrooms, cobwebs — small, deterministic, individually sparse ---- */
  addLittleDetails(B, colData, mini, rng, ix, iz, ox, oz, type, style);

  /* ---- The Second Seed sapling (Part 2, Ch7): a permanent oasis where the player
          planted it. Cheap guard (storyPlantedAt is a spire-relative compare); only the
          one planted chunk matches. Built here so it hot-swaps on plant AND regenerates
          on later loads/re-rolls. ---- */
  if (typeof storyPlantedAt === 'function' && storyPlantedAt(ix, iz)) {
    const sx = ox + 32, sz = oz + 32;
    const savedReg = CUR_REG; CUR_REG = null;   // vivid canopy leaves, not the scorch olive tint
    addTree(B, colData, mini, rng, sx, sz, 26, 13, { trunkR: 1.6, blobs: 7 });   // young giant
    CUR_REG = savedReg;
    for (let k = 0; k < 10; k++) {              // ring of glow plants
      const a = k / 10 * Math.PI * 2;
      addGlowPlant(B, rng, sx + Math.cos(a) * 4.5, sz + Math.sin(a) * 4.5, 0.3 + rng() * 0.2);
    }
    for (let k = 0; k < 26; k++) {              // grass breaking the dead asphalt
      const a = rng() * 7, d = rng() * 9;
      addGrassTuft(B, rng, sx + Math.cos(a) * d, sz + Math.sin(a) * d, 0.5 + rng() * 0.6);
    }
    mini.oasis = { x: sx, z: sz };              // minimap: an oasis dot in the tan (drawn like the hamlet hut)
  }

  /* ---- Ladders (Ladders feature): waytree lookouts + the two big structure climbs.
          Built LAST — after every other rng-consuming pass — so their rng draws can never
          shift any other chunk feature. Non-ladder chunks are byte-identical to before;
          a waytree/ladder chunk differs only by the added geometry at the tail. Waytree
          existence + position come straight from waytreeSpec so finders recompute them. ---- */
  if (type === 'spire') {
    // south-face run, ground to summit — stacked segments + rest platforms (addLadder, H=78)
    addLadder(B, colData, rng, SPIRE.x, SPIRE.z + SPIRE.size / 2 + 0.2, 0, SPIRE.h, 0, 1);
  } else if (type === 'fallen' && fallenLadder) {
    addLadder(B, colData, rng, fallenLadder.x, fallenLadder.z, 0, fallenLadder.y1, fallenLadder.nx, fallenLadder.nz);
  }
  const _wt = waytreeSpec(ix, iz);
  if (_wt) addWaytree(B, colData, mini, rng, _wt.x, _wt.z, _wt.deckY, extraMeshes);   // Lifts: extraMeshes carries the moving platform group

  /* ---- assemble ---- */
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const meshes = [
    B.plain.mesh(matPlain, true, true),
    B.bld.mesh(matBld, true, true),
    B.leaf.mesh(matLeaf, true, true, leafDepth),
    B.vine.mesh(matVine, false, true),
    B.grass.mesh(matGrass, false, true),
    B.glow.mesh(matGlow, false, true),
    B.lamp.mesh(matLamp, false, true),
    B.puddle.mesh(matPuddle, false, true),
    B.web.mesh(matWeb, false, false),
    B.net.mesh(matNet, false, true)               // sky nets (Feature B)
  ];
  for (const m of meshes) if (m) group.add(m);
  for (const m of extraMeshes) group.add(m);
  return { ix, iz, group, colData, mini, openRect, type, style, region: REG, name: districtName(ix, iz) };
}

