/* CANOPY split file  worldgen: chunk manager, sky / day-night, canopy sea, ground (was game.js lines 2445-2687). Header/error-handler in core.js. */
'use strict';
/* ======================================================================== */
/*  CHUNK MANAGER                                                           */
/* ======================================================================== */
const chunks = new Map();
const buildQueue = [];
function chunkKey(ix, iz) { return ix + ',' + iz; }

function ensureChunks(px, pz, syncAll) {
  const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
  const wanted = new Set();
  for (let dx = -VIEW_R; dx <= VIEW_R; dx++) for (let dz = -VIEW_R; dz <= VIEW_R; dz++) {
    const ix = cx + dx, iz = cz + dz, key = chunkKey(ix, iz);
    wanted.add(key);
    if (!chunks.has(key) && !buildQueue.some(q => q.key === key)) {
      const d = dx * dx + dz * dz;
      buildQueue.push({ ix, iz, key, d });
    }
  }
  buildQueue.sort((a, b) => a.d - b.d);
  let changed = false;   // ground-hole registry only rebuilds when the loaded pit set could shift
  // immediate ring: never let the player reach an unbuilt chunk
  let budget = syncAll ? 999 : 2;
  while (buildQueue.length && budget > 0) {
    const q = buildQueue.shift();
    if (chunks.has(q.key)) continue;
    const c = buildChunk(q.ix, q.iz);
    chunks.set(q.key, c);
    scene.add(c.group);
    changed = true;
    if (q.d > 2) budget--;
  }
  // retire distant chunks
  for (const [key, c] of chunks) {
    if (wanted.has(key)) continue;
    const dx = c.ix - cx, dz = c.iz - cz;
    if (Math.max(Math.abs(dx), Math.abs(dz)) > VIEW_R + 1) {
      scene.remove(c.group);
      c.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      chunks.delete(key);
      changed = true;
    }
  }
  // Sinkhole ground-holes: resync the shader's world-space hole circles from live chunks'
  // round pits whenever a chunk was built or retired (a bowl may have entered/left range).
  if (changed) syncGroundHoles(px, pz);
}
function chunkAt(x, z) { return chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK))); }

// Drive the pool of streetlamp point lights: at night, park each one on one of the
// nearest still-burning lamp heads around the player and fade it by distance so lamps
// entering or leaving the pool never pop. During the day every pool light idles at 0.
const _lampCand = [];
function updateLampLights() {
  _lampCand.length = 0;
  if (nightF > 0.015) {
    const cx = Math.floor(player.pos.x / CHUNK), cz = Math.floor(player.pos.z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = chunks.get(chunkKey(cx + dx, cz + dz));
      if (!c) continue;
      for (const L of c.colData.lamps) {
        if (!L.working) continue;                       // only lamps that still burn
        const ddx = L.hx - player.pos.x, ddz = L.hz - player.pos.z;
        _lampCand.push({ L, d2: ddx * ddx + ddz * ddz });
      }
    }
    _lampCand.sort((a, b) => a.d2 - b.d2);
  }
  const base = 12 * nightF;
  for (let i = 0; i < LAMP_LIGHTS; i++) {
    const light = lampLights[i];
    if (i < _lampCand.length) {
      const { L, d2 } = _lampCand[i];
      light.position.set(L.hx, L.hy - 0.1, L.hz);       // just under the head glass
      light.intensity = base * (1 - smooth(LAMP_REACH * 0.72, LAMP_REACH, Math.sqrt(d2)));
    } else {
      light.intensity = 0;
    }
  }
}

/* ======================================================================== */
/*  SKY / DAY-NIGHT                                                         */
/* ======================================================================== */
const skyGroup = new THREE.Group();
scene.add(skyGroup);

const domeGeo = new THREE.SphereGeometry(760, 28, 14);
const domeCols = new THREE.Float32BufferAttribute(new Float32Array(domeGeo.attributes.position.count * 3), 3);
domeGeo.setAttribute('color', domeCols);
const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: true }));
dome.renderOrder = -10; dome.frustumCulled = false;
skyGroup.add(dome);

// stars — two size tiers: real night skies read as a few bright points over a dust of
// faint ones; a single uniform layer is what makes a game sky look like a decal
function makeStarField(n, seed, size, color) {
  const pos = new Float32Array(n * 3), rs = mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const a = rs() * Math.PI * 2, e = Math.asin(rs());
    pos[i * 3] = Math.cos(a) * Math.cos(e) * 720;
    pos[i * 3 + 1] = Math.sin(e) * 720 + 20;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 720;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({
    color, size, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false
  }));
  p.renderOrder = -9; p.frustumCulled = false;
  skyGroup.add(p);
  return p;
}
const stars = makeStarField(700, 42, 1.7, 0xcfe0ff);
const starsDim = makeStarField(1100, 43, 0.9, 0xb8c8dd);
// sun & moon sprites
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSun, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
sunSprite.scale.set(150, 150, 1); sunSprite.renderOrder = -8;
skyGroup.add(sunSprite);
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texMoon, color: 0xdce6f2, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
moonSprite.scale.set(46, 46, 1); moonSprite.renderOrder = -8;   // texMoon disc fills ~40% of the sprite → apparent moon ≈ 18 units
skyGroup.add(moonSprite);

// Sky-probe scene (core.js): clones share the live dome geometry/material and the sprite
// materials, so every updateSky recolour propagates for free; only positions need copying
// at refresh time.
const domeEnv = new THREE.Mesh(domeGeo, dome.material);
domeEnv.frustumCulled = false;
envScene.add(domeEnv);
const sunEnv = new THREE.Sprite(sunSprite.material);  sunEnv.scale.copy(sunSprite.scale);
const moonEnv = new THREE.Sprite(moonSprite.material); moonEnv.scale.copy(moonSprite.scale);
envScene.add(sunEnv); envScene.add(moonEnv);

// Real multi-puff cloud textures (3 seeded variants): 7-12 soft white radial puffs biased
// to the upper canvas so the base reads flat, plus a few darker puffs along the bottom for
// a shaded underside. Own mulberry32 per seed — separate from the cloud-spawn rng below.
function makeCloudTexture(seed) {
  const W = 256, H = 128, r = mulberry32(seed);
  const cc = makeCanvas(W, H), xc = cc.getContext('2d');
  xc.clearRect(0, 0, W, H);
  const nPuff = 7 + (r() * 6 | 0);
  for (let i = 0; i < nPuff; i++) {
    const px = 30 + r() * (W - 60), py = H * (0.12 + r() * 0.48), rr = 26 + r() * 40, a = 0.30 + r() * 0.45;
    const g = xc.createRadialGradient(px, py, 1, px, py, rr);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    xc.fillStyle = g; xc.beginPath(); xc.arc(px, py, rr, 0, 7); xc.fill();
  }
  const nShade = 3 + (r() * 3 | 0);
  for (let i = 0; i < nShade; i++) {
    const px = 40 + r() * (W - 80), py = H * (0.66 + r() * 0.3), rr = 20 + r() * 30;
    const g = xc.createRadialGradient(px, py, 1, px, py, rr);
    g.addColorStop(0, `rgba(150,160,175,${0.18 + r() * 0.14})`); g.addColorStop(1, 'rgba(150,160,175,0)');
    xc.fillStyle = g; xc.beginPath(); xc.arc(px, py, rr, 0, 7); xc.fill();
  }
  return canvasTex(cc);
}
const texClouds = [makeCloudTexture(11), makeCloudTexture(12), makeCloudTexture(13)];

// drifting high clouds
const clouds = [];
{
  const rs = mulberry32(31337);
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texClouds[i % 3], transparent: true, opacity: 0.1, fog: false, depthWrite: false }));
    const d = 250 + rs() * 350;
    const a = rs() * Math.PI * 2;
    s.position.set(Math.cos(a) * d, 130 + rs() * 160, Math.sin(a) * d);
    s.scale.set(220 + rs() * 300, 70 + rs() * 70, 1);
    s.userData.va = 0.4 + rs() * 0.8;
    skyGroup.add(s); clouds.push(s);
  }
}

// palette keyframes (sRGB hex, converted)
const SKY = {
  nightTop: srgb(0x0b1826), nightHor: srgb(0x182b36), nightSun: srgb(0x0),
  dawnTop: srgb(0x2b4a74), dawnHor: srgb(0xff9a55),
  dayTop: srgb(0x6fa8dc), dayHor: srgb(0xd7e6cc),
  sunLow: srgb(0xff7f36), sunHigh: srgb(0xfff3e0),
  moon: srgb(0x93aecd)
};
const _top = new THREE.Color(), _hor = new THREE.Color(), _sunC = new THREE.Color(), _fogC = new THREE.Color();
const sunDir = new THREE.Vector3();
let dayF = 1, nightF = 0, sunElev = 1, dewF = 0;
let _envAccum = 0, _envDone = false;   // sky-probe refresh throttle (core.js refreshEnvProbe)

// Unit direction per dome vertex, precomputed once: the per-frame recolour below adds a
// forward-scatter term (sky brightens toward the sun — tight and warm at dusk, broad and
// faint by day; a cool patch around the moon at night) so the dome reads as a lit volume
// instead of the same gradient at every azimuth.
const domeDirs = (() => {
  const p = domeGeo.attributes.position, a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const l = Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) || 1;
    a[i * 3] = p.getX(i) / l; a[i * 3 + 1] = p.getY(i) / l; a[i * 3 + 2] = p.getZ(i) / l;
  }
  return a;
})();

function updateSky(t, dt) {
  const ang = (t - 0.25) * Math.PI * 2;
  sunElev = Math.sin(ang);
  sunDir.set(Math.cos(ang), Math.sin(ang), 0.32).normalize();
  dayF = smooth(-0.06, 0.14, sunElev);
  nightF = 1 - smooth(-0.14, 0.0, sunElev);
  const duskF = Math.exp(-Math.pow(sunElev * 4.4, 2)); // glow band around horizon crossings

  _top.copy(SKY.nightTop).lerp(SKY.dayTop, dayF).lerp(SKY.dawnTop, duskF * 0.7 * (1 - nightF));
  _hor.copy(SKY.nightHor).lerp(SKY.dayHor, dayF).lerp(SKY.dawnHor, duskF * (1 - nightF * 0.85));
  _sunC.copy(SKY.sunLow).lerp(SKY.sunHigh, smooth(0.05, 0.5, sunElev));

  // dome vertex colors: base vertical gradient + directional scatter toward sun/moon.
  // The dusk term keeps glowing on the sun side just after set (duskF stays high while
  // nightF ramps), which is what an actual twilight afterglow does.
  const pos = domeGeo.attributes.position, colA = domeGeo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const ny = pos.getY(i) / 760;
    const k = Math.pow(clamp(ny * 1.15 + 0.12, 0, 1), 0.58);
    _c.copy(_hor).lerp(_top, k);
    const dot = domeDirs[i * 3] * sunDir.x + domeDirs[i * 3 + 1] * sunDir.y + domeDirs[i * 3 + 2] * sunDir.z;
    if (dot > 0) {
      const glow = Math.pow(dot, 6) * (0.38 * duskF * (1 - nightF) + 0.10 * dayF) + dot * dot * 0.06 * dayF;
      if (glow > 0.004) _c.lerp(_sunC, Math.min(0.5, glow));
    } else if (nightF > 0.02) {
      const mg = Math.pow(-dot, 8) * nightF * 0.12;
      if (mg > 0.004) _c.lerp(SKY.moon, mg);
    }
    colA.setXYZ(i, _c.r, _c.g, _c.b);
  }
  colA.needsUpdate = true;

  // fog tinted toward the leaves during the day (lighter tint keeps the far street tunnels open, not murky)
  _fogC.copy(_hor).lerp(COL.moss, 0.26 * dayF);
  scene.fog.color.copy(_fogC);
  renderer.setClearColor(_fogC);

  // lights
  const moonUp = -sunElev > 0.02;
  if (sunElev > -0.04) {
    sun.color.copy(_sunC);
    sun.intensity = 0.15 + dayF * 1.6;
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 170);
  } else if (moonUp) {
    sun.color.copy(SKY.moon);
    sun.intensity = 0.5;
    sun.position.copy(sun.target.position).addScaledVector(sunDir, -170);
  } else {
    sun.intensity = 0.14;
  }
  hemi.intensity = 0.37 + dayF * 1.14;   // higher daytime sky-fill lifts the shaded understory (night = 0.37, unchanged)
  // raw night-sky colors are near-black, so lerp toward moonlight or the night floor does nothing
  hemi.color.copy(_top).lerp(_hor, 0.6).lerp(SKY.moon, nightF * 0.55);
  amb.intensity = 0.26 + dayF * 0.50 + nightF * 0.2;   // brighter daytime ambient floor for deep-shade streets
  seaMat.color.copy(COL.leafB).multiplyScalar(0.16 + dayF * 0.95);

  // sky objects
  sunSprite.position.copy(sunDir).multiplyScalar(700);
  sunSprite.material.color.copy(_sunC);
  sunSprite.material.opacity = smooth(-0.09, 0.02, sunElev);
  moonSprite.position.copy(sunDir).multiplyScalar(-690);
  moonSprite.material.opacity = nightF * 0.9;
  stars.material.opacity = nightF * 0.9;
  starsDim.material.opacity = nightF * 0.55;
  for (const cl of clouds) {
    cl.material.opacity = 0.06 + dayF * 0.16;
    cl.material.color.copy(SKY.sunHigh).lerp(_sunC, duskF * 0.75);   // white by day, ember at dusk
  }

  // emissives
  matBld.emissiveIntensity = nightF * 0.9 + duskF * 0.15;
  matGlow.emissiveIntensity = nightF * 2.4;
  matLamp.emissiveIntensity = nightF * 2.6 + duskF * 0.4;
  // Little details: dawn puddles. "dew" rises after sunrise (~t 0.20) and dries by noon
  // (~t 0.52); puddle discs are batched per chunk but share matPuddle, so one opacity drive
  // fades them all together (invisible at night and afternoon).
  const dew = smooth(0.19, 0.30, t) * (1 - smooth(0.42, 0.54, t));
  dewF = dew;   // Life pass: drips under bridges/viaducts read this (entities.js)
  matPuddle.opacity = 0.62 * dew;

  // Living water (Feature A): drift the two ripple layers in opposite directions so the
  // canals read as slow flow, the counter-motion beating into a faint shimmer. And drive
  // matWater's emissive sparkle by day — a sky-blue glint at noon that dies at night, on
  // top of the material's blue body so daylight water stays clearly blue.
  const wdt = dt || 0;
  texWater.offset.x += wdt * 0.008; texWater.offset.y += wdt * 0.003;
  texWater2.offset.x -= wdt * 0.005; texWater2.offset.y -= wdt * 0.003;
  matWater.emissiveIntensity = dayF * 0.10;

  // Sky probe refresh: ~1 s cadence (sun moves <1% of the cycle between refreshes).
  // dt is undefined on the initial synchronous call — force that first refresh.
  _envAccum += (dt || 0);
  if (_envAccum >= 1 || !_envDone) {
    _envAccum = 0; _envDone = true;
    sunEnv.position.copy(sunSprite.position);
    moonEnv.position.copy(moonSprite.position);
    refreshEnvProbe();
  }
}

/* ======================================================================== */
/*  CANOPY SEA — the endless roof of leaves, seen from above                */
/* ======================================================================== */
function makeSeaTexture() {
  const S = 512, r = mulberry32(2024);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#2c4a1e'; x.fillRect(0, 0, S, S);
  // deep shadow pits between crowns
  for (let i = 0; i < 160; i++) {
    const rr = 8 + r() * 26;
    x.fillStyle = `rgba(14,26,10,${0.3 + r() * 0.4})`;
    x.beginPath(); x.arc(r() * S, r() * S, rr, 0, 7); x.fill();
  }
  // each crown = shadowed base disc + sun-lit lobe offset toward the light,
  // so from above the canopy reads as rounded masses instead of flat felt
  for (let i = 0; i < 520; i++) {
    const rr = 7 + r() * 22, cx2 = r() * S, cy2 = r() * S;
    const hpx = 84 + (r() - 0.5) * 28, sat = 36 + r() * 26, lig = 20 + r() * 14;
    x.fillStyle = `hsl(${hpx},${sat}%,${lig}%)`;
    x.beginPath(); x.arc(cx2, cy2, rr, 0, 7); x.fill();
    x.fillStyle = `hsl(${hpx},${sat}%,${lig + 12 + r() * 10}%)`;
    x.beginPath(); x.arc(cx2 - rr * 0.22, cy2 - rr * 0.22, rr * 0.7, 0, 7); x.fill();
    x.fillStyle = `hsl(${hpx},${sat - 6}%,${lig + 24 + r() * 12}%)`;
    x.beginPath(); x.arc(cx2 - rr * 0.34, cy2 - rr * 0.34, rr * 0.32, 0, 7); x.fill();
  }
  // large-scale hue drift washed over the crowns: real forest roofs vary warm/cool in
  // hundred-metre patches (species stands, moisture), and without it the 7×7 tiling
  // reads as one repeating green felt from altitude
  for (let i = 0; i < 12; i++) {
    const mr = 60 + r() * 150, mx = r() * S, my = r() * S;
    const gg = x.createRadialGradient(mx, my, 1, mx, my, mr);
    const warm = r() < 0.5;
    gg.addColorStop(0, warm ? `rgba(150,158,58,${0.07 + r() * 0.07})` : `rgba(26,74,86,${0.07 + r() * 0.07})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gg; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  }
  const t = canvasTex(c); t.repeat.set(7, 7);
  return t;
}
const seaMat = new THREE.MeshBasicMaterial({ map: makeSeaTexture(), transparent: true, opacity: 0, depthWrite: true });
const sea = new THREE.Mesh(new THREE.RingGeometry(110, 950, 56, 3), seaMat);
sea.rotation.x = -Math.PI / 2;
sea.position.y = 26.5;
sea.visible = false;
scene.add(sea);

/* ======================================================================== */
/*  GROUND                                                                  */
/* ======================================================================== */
texGround.repeat.set(80, 80);
texGroundBump.repeat.set(80, 80);
texGroundRough.repeat.set(80, 80);
// Sinkhole mouths: the plane opacity-covers anything sunk below y=0 (see the canal fix in
// worldgen-anomalies.js — canals raise their water above y=0 instead; a sinkhole bowl can't
// be raised), so the material discards fragments inside up to MAX_GROUND_HOLES world-space
// circles via onBeforeCompile. Depth is discarded too, so the bowl renders through the hole.
// syncGroundHoles() rebuilds the uniform set from live chunks' round pits whenever the chunk
// set changes; _groundShader is captured at compile time so per-frame count updates land.
const MAX_GROUND_HOLES = 6;
const _holeVecs = Array.from({ length: MAX_GROUND_HOLES }, () => new THREE.Vector3());
let _groundShader = null;
const groundMat = new THREE.MeshStandardMaterial({
  map: texGround, bumpMap: texGroundBump, bumpScale: 0.35,
  roughnessMap: texGroundRough, roughness: 1, metalness: 0,
  envMap: envRT.texture, envMapIntensity: 0.3
});
groundMat.onBeforeCompile = (shader) => {
  shader.uniforms.uHoles = { value: _holeVecs };
  // holes registered before this (lazy) first compile must survive — replay the pending count
  shader.uniforms.uHoleCount = { value: groundMat.userData.pendingHoleCount || 0 };
  // The plane is translated to the player every frame, so the hole test must run in world
  // XZ, not the plane's static UVs. r152 anchors verified below (throw-on-no-op guard).
  const VANCHOR = '#include <begin_vertex>';
  if (shader.vertexShader.indexOf(VANCHOR) === -1)
    console.error('CANOPY ground hole-punch: vertex anchor "' + VANCHOR + '" not found in r152 shader — hole punch is a no-op');
  shader.vertexShader = 'varying vec2 vGroundW;\n' + shader.vertexShader.replace(
    VANCHOR,
    VANCHOR + '\n  vGroundW = (modelMatrix * vec4(position, 1.0)).xz;');
  const FANCHOR = '#include <clipping_planes_fragment>';
  if (shader.fragmentShader.indexOf(FANCHOR) === -1)
    console.error('CANOPY ground hole-punch: fragment anchor "' + FANCHOR + '" not found in r152 shader — hole punch is a no-op');
  shader.fragmentShader = ('varying vec2 vGroundW;\nuniform vec3 uHoles[' + MAX_GROUND_HOLES + '];\nuniform int uHoleCount;\n')
    + shader.fragmentShader.replace(
    FANCHOR,
    'for (int i = 0; i < ' + MAX_GROUND_HOLES + '; i++) {\n'
    + '  if (i >= uHoleCount) break;\n'
    + '  vec2 d = vGroundW - uHoles[i].xy;\n'        // uHoles[i].xy = pit world XZ, .z = radius
    + '  if (dot(d, d) < uHoles[i].z * uHoles[i].z) discard;\n'
    + '}\n' + FANCHOR);
  _groundShader = shader;
};
groundMat.customProgramCacheKey = () => 'canopy-ground-holes';

const ground = new THREE.Mesh(new THREE.PlaneGeometry(640, 640), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Rebuild the hole uniform set from every live chunk's round pits (sinkhole bowls; rect pits
// are canals, handled by the raised waterline instead). Called from ensureChunks ONLY when
// the chunk set changed. Radius pit.r - 0.4 is deliberately SMALLER than the funnel's top
// ring (Part 2) so the plane edge always overlaps the funnel lip — no see-through sliver.
function syncGroundHoles(px, pz) {
  const found = [];
  for (const [, c] of chunks)
    for (const p of c.colData.pits)
      if (p.r) found.push(p);            // round pits = sinkhole bowls (rect pits are canals)
  if (found.length > MAX_GROUND_HOLES)   // keep the nearest MAX when more bowls are loaded than slots
    found.sort((a, b) => ((a.x - px) ** 2 + (a.z - pz) ** 2) - ((b.x - px) ** 2 + (b.z - pz) ** 2));
  const n = Math.min(found.length, MAX_GROUND_HOLES);
  for (let i = 0; i < n; i++) _holeVecs[i].set(found[i].x, found[i].z, found[i].r - 0.4);
  if (_groundShader) _groundShader.uniforms.uHoleCount.value = n;
  else groundMat.userData.pendingHoleCount = n;   // shader compiles lazily; count re-applied in onBeforeCompile
}

