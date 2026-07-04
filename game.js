/* ============================================================================
   UNDERCANOPY — a first-person walk through an endless, overgrown city.
   Single-file game logic on top of three.js (r152 UMD).
   Everything is procedural: geometry, textures, city layout, sound.
   ========================================================================= */
'use strict';

const statusEl = document.getElementById('status');
window.addEventListener('error', e => { statusEl.textContent = 'ERR ' + e.message; });

/* ---------------------------------------------------------------- utils -- */
const clamp = (x, a, b) => x < a ? a : (x > b ? b : x);
const lerp  = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iz, salt) {
  let h = (ix * 374761393 + iz * 668265263 + (salt || 0) * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0);
}
// Colors authored in sRGB, converted once to linear (r152 color management).
function srgb(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
const _c = new THREE.Color();

/* ------------------------------------------------------------- constants -- */
const CHUNK = 64;            // meters per city block (streets run on borders)
const VIEW_R = 3;            // chunk radius kept alive around the player
const INSET = 8;             // buildings are inset this far from chunk borders
const CANOPY_Y = 24;         // above this you are in the sun
const DAY_LEN = 600;         // seconds per full day
const GRAV = 16, JUMP = 6.2, WALK = 5.2, SPRINT = 1.75, EYE = 1.62, PR = 0.42;
const CLIMB_SPEED = 3.2;
const SPIRE = { cx: 2, cz: 1, x: 2 * CHUNK + 32, z: 1 * CHUNK + 32, size: 22, h: 78 };

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');   // screenshot/smoke-test mode

/* ------------------------------------------------------------- renderer -- */
const canvas = document.getElementById('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!SHOT });
} catch (e) {
  statusEl.textContent = 'ERR no webgl';
  document.getElementById('goLabel').textContent = 'WEBGL NOT AVAILABLE';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
else renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x88a37c, 18, 215);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 1200);
scene.add(camera);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ------------------------------------------------------------- lighting -- */
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 420;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.4;
scene.add(sun); scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0xbadfff, 0x1c2a16, 0.5);
scene.add(hemi);
const amb = new THREE.AmbientLight(0x405040, 0.16);
scene.add(amb);

/* ---------------------------------------------------- procedural textures -- */
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// Building facade + matching emissive (lit windows) atlas
function makeBuildingTextures() {
  const S = 512, cell = 64, r = mulberry32(1234);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const e = makeCanvas(S, S), y = e.getContext('2d');
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  // concrete base with vertical grime
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#8f8d82'); g.addColorStop(1, '#77756b');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(40,45,38,${0.03 + r() * 0.07})`;
    const w = 2 + r() * 8; x.fillRect(r() * S, 0, w, S);
  }
  for (let i = 0; i < 1800; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    x.fillRect(r() * S, r() * S, 2, 2);
  }
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) {
    const px = cx * cell, py = cy * cell;
    const wx = px + 14, wy = py + 9, ww = 36, wh = 44;
    const lit = r() < 0.16, broken = !lit && r() < 0.10;
    // frame
    x.fillStyle = '#4c4a42'; x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    if (lit) {
      const lg = x.createLinearGradient(0, wy, 0, wy + wh);
      lg.addColorStop(0, '#b7a684'); lg.addColorStop(1, '#7d6a45');
      x.fillStyle = lg; x.fillRect(wx, wy, ww, wh);
      y.fillStyle = '#ffb35e'; y.fillRect(wx, wy, ww, wh);
      // mullions on the emissive too
      y.fillStyle = '#241505'; y.fillRect(wx + ww / 2 - 1, wy, 2, wh); y.fillRect(wx, wy + wh / 2 - 1, ww, 2);
    } else if (broken) {
      x.fillStyle = '#0c0f10'; x.fillRect(wx, wy, ww, wh);
      x.fillStyle = 'rgba(90,120,60,0.5)';
      for (let k = 0; k < 5; k++) x.fillRect(wx + r() * ww, wy + r() * wh, 4, 4);
    } else {
      const dg = x.createLinearGradient(0, wy, 0, wy + wh);
      dg.addColorStop(0, '#39505c'); dg.addColorStop(1, '#1c262c');
      x.fillStyle = dg; x.fillRect(wx, wy, ww, wh);
      x.fillStyle = 'rgba(255,255,255,0.08)';
      x.beginPath(); x.moveTo(wx, wy + wh); x.lineTo(wx + ww * 0.5, wy); x.lineTo(wx + ww * 0.7, wy); x.lineTo(wx + ww * 0.2, wy + wh); x.fill();
    }
    // mullions
    x.fillStyle = '#3c3a33';
    x.fillRect(wx + ww / 2 - 1, wy, 2, wh); x.fillRect(wx, wy + wh / 2 - 1, ww, 2);
    // sill
    x.fillStyle = 'rgba(30,30,26,0.5)'; x.fillRect(wx - 4, wy + wh + 3, ww + 8, 3);
    // creeping moss at some cell bottoms
    if (r() < 0.4) {
      for (let k = 0; k < 14; k++) {
        x.fillStyle = `rgba(${60 + r() * 30},${95 + r() * 40},${40 + r() * 20},${0.25 + r() * 0.3})`;
        const mr = 3 + r() * 9;
        x.beginPath(); x.arc(px + r() * cell, py + cell - r() * 14, mr, 0, 7); x.fill();
      }
    }
  }
  return { map: canvasTex(c), emissive: canvasTex(e) };
}

function makeGroundTexture() {
  const S = 512, r = mulberry32(77);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#4e4d46'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
    x.fillRect(r() * S, r() * S, 2, 2);
  }
  // cracks
  x.strokeStyle = 'rgba(25,26,22,0.55)'; x.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    let px = r() * S, py = r() * S;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 90; py += (r() - 0.5) * 90; x.lineTo(px, py); }
    x.stroke();
  }
  // moss blotches
  for (let i = 0; i < 90; i++) {
    const mr = 8 + r() * 42, mx = r() * S, my = r() * S;
    const gg = x.createRadialGradient(mx, my, 1, mx, my, mr);
    const gcol = `${55 + r() * 30 | 0},${85 + r() * 45 | 0},${35 + r() * 20 | 0}`;
    gg.addColorStop(0, `rgba(${gcol},${0.30 + r() * 0.25})`);
    gg.addColorStop(1, `rgba(${gcol},0)`);
    x.fillStyle = gg; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  }
  // leaf litter
  for (let i = 0; i < 260; i++) {
    x.fillStyle = r() < 0.5 ? `rgba(120,90,40,${0.2 + r() * 0.3})` : `rgba(80,110,45,${0.2 + r() * 0.3})`;
    x.save(); x.translate(r() * S, r() * S); x.rotate(r() * 7);
    x.fillRect(0, 0, 3 + r() * 4, 2 + r() * 2); x.restore();
  }
  const t = canvasTex(c); t.repeat.set(1, 1);
  return t;
}

function makeLeafTexture() {
  const S = 256, r = mulberry32(5150);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  for (let i = 0; i < 210; i++) {
    const hpx = 78 + (r() - 0.5) * 40, s = 40 + r() * 25, l = 42 + r() * 22;
    x.fillStyle = `hsl(${hpx},${s}%,${l}%)`;
    x.save(); x.translate(r() * S, r() * S); x.rotate(r() * 7);
    x.beginPath(); x.ellipse(0, 0, 8 + r() * 13, 4 + r() * 6, 0, 0, 7); x.fill();
    x.restore();
  }
  return canvasTex(c);
}

function makeVineTexture() {
  const W = 256, H = 512, r = mulberry32(909);
  const c = makeCanvas(W, H), x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  for (let s = 0; s < 8; s++) {
    const bx = 14 + s * 32 + r() * 8, amp = 6 + r() * 12, ph = r() * 7;
    x.strokeStyle = `rgba(${38 + r() * 20 | 0},${64 + r() * 25 | 0},${30 + r() * 15 | 0},0.95)`;
    x.lineWidth = 4 + r() * 4;
    x.beginPath();
    for (let yy = 0; yy <= H; yy += 8) x.lineTo(bx + Math.sin(yy * 0.03 + ph) * amp, yy);
    x.stroke();
    for (let yy = 6; yy < H; yy += 12 + r() * 14) {
      const lx = bx + Math.sin(yy * 0.03 + ph) * amp;
      x.fillStyle = `hsl(${85 + (r() - 0.5) * 35},${40 + r() * 25}%,${40 + r() * 24}%)`;
      x.save(); x.translate(lx, yy); x.rotate(r() * 7);
      x.beginPath(); x.ellipse(0, 0, 7 + r() * 8, 4 + r() * 4, 0, 0, 7); x.fill();
      x.restore();
    }
  }
  return canvasTex(c);
}

function makeGrassTexture() {
  const S = 256, r = mulberry32(303);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const bx = r() * S, h = 90 + r() * 150, bend = (r() - 0.5) * 70, w = 5 + r() * 7;
    x.fillStyle = `hsl(${80 + (r() - 0.5) * 30},${42 + r() * 25}%,${36 + r() * 24}%)`;
    x.beginPath();
    x.moveTo(bx - w / 2, S);
    x.quadraticCurveTo(bx + bend * 0.3, S - h * 0.6, bx + bend, S - h);
    x.quadraticCurveTo(bx + bend * 0.3 + w * 0.4, S - h * 0.6, bx + w / 2, S);
    x.fill();
  }
  return canvasTex(c);
}

function makeGlowSprite(inner, outer) {
  const S = 128, c = makeCanvas(S, S), x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner); g.addColorStop(0.35, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding;
  return t;
}

const texB = makeBuildingTextures();
const texGround = makeGroundTexture();
const texLeaf = makeLeafTexture();
const texVine = makeVineTexture();
const texGrass = makeGrassTexture();
const texSun = makeGlowSprite('rgba(255,255,255,1)', 'rgba(255,220,160,0.55)');
const texSoft = makeGlowSprite('rgba(255,255,255,0.9)', 'rgba(255,255,255,0.25)');

/* ------------------------------------------------------------- materials -- */
const matPlain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
const matBld = new THREE.MeshStandardMaterial({
  vertexColors: true, map: texB.map, emissiveMap: texB.emissive,
  emissive: srgb(0xffc27a), emissiveIntensity: 0, roughness: 0.85, metalness: 0
});
const matLeaf = new THREE.MeshStandardMaterial({
  map: texLeaf, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0
});
const matVine = new THREE.MeshStandardMaterial({
  map: texVine, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, metalness: 0
});
const matGrass = new THREE.MeshStandardMaterial({
  map: texGrass, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, metalness: 0
});
const matGlow = new THREE.MeshStandardMaterial({
  vertexColors: true, emissive: srgb(0x5fe8b0), emissiveIntensity: 0, roughness: 0.7, metalness: 0
});
const matLamp = new THREE.MeshStandardMaterial({
  vertexColors: true, emissive: srgb(0xffd9a0), emissiveIntensity: 0, roughness: 0.6, metalness: 0
});
const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texLeaf, alphaTest: 0.45 });

/* ------------------------------------------------------- geometry batching -- */
class Batch {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; }
  quad(a, b, c2, d, uv, col, colB) {
    // a,b,c2,d: [x,y,z] counter-clockwise; uv: [u0,v0,u1,v1]; col/colB: THREE.Color (colB = color at a,b edge)
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const cA = col, cB = colB || col;
    const verts = [a, b, c2, d];
    const uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    const cols = [cB, cB, cA, cA];
    for (let k = 0; k < 4; k++) {
      this.p.push(verts[k][0], verts[k][1], verts[k][2]);
      this.n.push(nx, ny, nz);
      this.u.push(uvs[k][0], uvs[k][1]);
      this.c.push(cols[k].r, cols[k].g, cols[k].b);
    }
    this.i.push(this.v, this.v + 1, this.v + 2, this.v, this.v + 2, this.v + 3);
    this.v += 4;
  }
  addGeo(geo, mat4, color, jitter, rng) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(mat4);
    const v3 = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) {
      v3.fromBufferAttribute(pos, k).applyMatrix4(mat4);
      this.p.push(v3.x, v3.y, v3.z);
      v3.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize();
      this.n.push(v3.x, v3.y, v3.z);
      if (uv) this.u.push(uv.getX(k), uv.getY(k)); else this.u.push(0, 0);
      const j = jitter ? (1 - jitter + rng() * jitter * 2) : 1;
      this.c.push(color.r * j, color.g * j, color.b * j);
    }
    const idx = geo.index;
    if (idx) for (let k = 0; k < idx.count; k++) this.i.push(idx.getX(k) + this.v);
    else for (let k = 0; k < pos.count; k++) this.i.push(k + this.v);
    this.v += pos.count;
  }
  mesh(material, cast, receive, depthMat) {
    if (this.v === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    const m = new THREE.Mesh(g, material);
    m.castShadow = !!cast; m.receiveShadow = !!receive;
    if (depthMat) m.customDepthMaterial = depthMat;
    m.matrixAutoUpdate = false;
    return m;
  }
}

/* ------------------------------------------------------ geometry templates -- */
const tplTrunk = new THREE.CylinderGeometry(0.62, 1, 1, 9, 1, true); tplTrunk.translate(0, 0.5, 0);
const tplRoot = new THREE.CylinderGeometry(0.35, 1, 1, 6, 1, true); tplRoot.translate(0, 0.5, 0);
const tplBlob = new THREE.IcosahedronGeometry(1, 1);
const tplRock = new THREE.IcosahedronGeometry(1, 0);
const tplBox = new THREE.BoxGeometry(1, 1, 1); tplBox.translate(0, 0.5, 0);
const tplCyl = new THREE.CylinderGeometry(1, 1, 1, 8); tplCyl.translate(0, 0.5, 0);
const tplWheel = new THREE.CylinderGeometry(1, 1, 1, 8); tplWheel.rotateX(Math.PI / 2);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _pv = new THREE.Vector3(), _e = new THREE.Euler();
function compose(x, y, z, sx, sy, sz, rx, ry, rz) {
  _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
  _pv.set(x, y, z); _s.set(sx, sy, sz);
  return _m4.compose(_pv, _q, _s);
}

/* ------------------------------------------------------------- palettes -- */
const COL = {
  bark: srgb(0x5d4a38), barkDark: srgb(0x4a3a2c),
  leafA: srgb(0x5a8f3c), leafB: srgb(0x7aa348), leafC: srgb(0x44702e), leafDry: srgb(0x9a8f45),
  moss: srgb(0x54683c),
  roof: srgb(0x5c5b52), roofGarden: srgb(0x4e6337),
  rock: srgb(0x6b675e),
  grassA: srgb(0x6f9440), grassB: srgb(0x8fae4e),
  vine: srgb(0x74975a),
  glowPlant: srgb(0x1f4436),
  deadwood: srgb(0x4f463c),
  road: srgb(0x33343a), sidewalk: srgb(0x74736a), dash: srgb(0xc4c1a6),
  lampPole: srgb(0x3d443c), wire: srgb(0x17171a), rust: srgb(0x6a4a35),
  wood: srgb(0x4a3b2e), tire: srgb(0x151517)
};
const CAR_COLS = [0x7a6f63, 0x5c6e7a, 0x6e5a50, 0x4a5a4a, 0x8a8578, 0x6b4a3f, 0x51586b, 0x746a4a].map(srgb);
const SIGN_COLS = [0x7a3b32, 0x35526b, 0x8a6b2f, 0x4e6242, 0x6b4a6e, 0x2f5a55].map(srgb);

/* ----------------------------------------------------------- city naming -- */
const NAME_A = ['Moss', 'Fern', 'Ivy', 'Bramble', 'Kudzu', 'Willow', 'Cedar', 'Banyan', 'Lichen', 'Sorrel', 'Alder', 'Rowan', 'Verdan', 'Hollow', 'Arbor', 'Tendril'];
const NAME_B = [' Row', ' Gate', ' Yards', ' Hollow', ' Cross', ' Terrace', ' Quarter', ' Reach', ' Steps', ' Court', 'field', ' Rise'];
function districtName(ix, iz) {
  if (ix === SPIRE.cx && iz === SPIRE.cz) return 'The Spire';
  return NAME_A[hash2(ix, iz, 7) % NAME_A.length] + NAME_B[hash2(ix, iz, 13) % NAME_B.length];
}

/* ======================================================================== */
/*  CHUNK GENERATION                                                        */
/* ======================================================================== */
function chunkType(ix, iz) {
  if (ix === SPIRE.cx && iz === SPIRE.cz) return 'spire';
  const r = hash2(ix, iz, 1) / 4294967296;
  if (r < 0.55) return 'city';
  if (r < 0.67) return 'park';
  if (r < 0.76) return 'plaza';
  if (r < 0.92) return 'towers';
  return 'grove';
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
    B.leaf.addGeo(tplBlob, compose(bx, by, bz, br, br * 0.72, br, 0, rng() * 7, 0), leafCol, 0.22, rng);
    padTop = Math.max(padTop, by + br * 0.5);
  }
  // low hanging blob for silhouettes
  if (rng() < 0.5) {
    const br = R * 0.36, a = rng() * 7;
    B.leaf.addGeo(tplBlob, compose(x + Math.cos(a) * R * 0.5, cy - R * 0.55, z + Math.sin(a) * R * 0.5, br, br * 0.6, br, 0, rng() * 7, 0), COL.leafC, 0.2, rng);
  }
  colData.trunks.push({ x, z, r: tr, h });
  colData.pads.push({ x, z, r: R * 0.8, y: padTop - R * 0.18 });
  mini.trees.push([x, z, R, 0]);
}

function addGrassTuft(B, rng, x, z, s) {
  const col = rng() < 0.5 ? COL.grassA : COL.grassB;
  const dark = _c.copy(col).multiplyScalar(0.55).clone();
  for (let k = 0; k < 2; k++) {
    const a = rng() * Math.PI + k * Math.PI / 2;
    const dx = Math.cos(a) * s * 0.5, dz = Math.sin(a) * s * 0.5;
    B.grass.quad([x - dx, 0, z - dz], [x + dx, 0, z + dz], [x + dx, s, z + dz], [x - dx, s, z - dz],
      [0, 0, 1, 1], col, dark);
  }
}

function addWallVines(B, rng, x0, z0, x1, z1, h, side) {
  // side: 0:+x face 1:-x 2:+z 3:-z ; strips hang on that face
  const n = 3 + (rng() * 5 | 0);
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

function addBuilding(B, colData, mini, rng, cx, cz, w, d, h, opts) {
  opts = opts || {};
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const shade = 0.72 + rng() * 0.3;
  const warm = 0.96 + rng() * 0.08;
  const tint = new THREE.Color(shade * warm, shade, shade * (0.92 + rng() * 0.1));
  const mossy = _c.copy(tint).lerp(COL.moss, 0.6).multiplyScalar(0.75).clone();
  const uc = Math.max(1, Math.round(w / 3.2)), ucd = Math.max(1, Math.round(d / 3.2));
  const vc = Math.max(1, Math.round(h / 3.4));
  const uo = (rng() * 8) | 0, vo = (rng() * 8) | 0;
  // 4 window walls (CCW seen from outside)
  B.bld.quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [uo, vo, uo + ucd, vo + vc], tint, mossy);
  B.bld.quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [uo, vo, uo + ucd, vo + vc], tint, mossy);
  B.bld.quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [uo, vo, uo + uc, vo + vc], tint, mossy);
  B.bld.quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [uo, vo, uo + uc, vo + vc], tint, mossy);
  // roof
  const roofCol = _c.copy(COL.roof).multiplyScalar(0.85 + rng() * 0.3).clone();
  B.plain.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 0, 1, 1], roofCol);
  // vines on some faces
  const hasVines = opts.vines !== undefined ? opts.vines : rng() < 0.78;
  if (hasVines) {
    const sides = opts.allSides ? [0, 1, 2, 3] : [0, 1, 2, 3].filter(() => rng() < 0.7);
    if (sides.length === 0) sides.push((rng() * 4) | 0);
    for (const s of sides) addWallVines(B, rng, x0, z0, x1, z1, h, s);
  }
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
  if (opts.garden !== false && rng() < 0.55 && h < 40) {
    const nG = 1 + (rng() * 3 | 0);
    for (let k = 0; k < nG; k++) {
      const gr = 1.4 + rng() * 2.4;
      const gx = lerp(x0 + gr, x1 - gr, rng()), gz = lerp(z0 + gr, z1 - gr, rng());
      B.leaf.addGeo(tplBlob, compose(gx, h + gr * 0.4, gz, gr, gr * 0.6, gr, 0, rng() * 7, 0), rng() < 0.4 ? COL.leafDry : COL.leafB, 0.2, rng);
    }
  }
  colData.solids.push({ x0, z0, x1, z1, h, vine: hasVines });
  mini.rects.push([x0, z0, w, d, h]);
}

function addCurtain(B, rng, ax, ay, az, bx, by, bz) {
  const segs = 7, sag = 2 + rng() * 3;
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const px = lerp(ax, bx, t), pz = lerp(az, bz, t);
    const py = lerp(ay, by, t) - Math.sin(t * Math.PI) * sag;
    if (rng() < 0.25) continue;
    const len = 1.6 + rng() * 3.2, w = 1.1 + rng() * 0.9;
    const a = rng() * Math.PI;
    const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    const col = _c.copy(COL.vine).multiplyScalar(0.75 + rng() * 0.45).clone();
    B.vine.quad([px - dx, py - len, pz - dz], [px + dx, py - len, pz + dz], [px + dx, py, pz + dz], [px - dx, py, pz - dz],
      [0, 0, 1, Math.max(1, Math.round(len / 5))], col);
  }
}

function addGlowPlant(B, rng, x, z, s) {
  B.glow.addGeo(tplBlob, compose(x, s * 0.4, z, s, s * 0.7, s, 0, rng() * 7, 0), COL.glowPlant, 0.3, rng);
}

/* ---- streets: asphalt, markings, sidewalks ---- */
function hquad(B, x0, z0, x1, z1, y, col, colB) {
  B.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 0, 1, 1], col, colB);
}
function addRoads(B, rng, ox, oz) {
  const RW = 5.5, SW = 8;
  for (const axis of [0, 1]) {   // 0: street along z at x=ox · 1: street along x at z=oz
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
        hquad(B.plain, ox - RW, oz + s, ox + RW, oz + s + 8, yA, rcc);
        hquad(B.plain, ox - SW, oz + s, ox - RW, oz + s + 8, yS, sc1);
        hquad(B.plain, ox + RW, oz + s, ox + SW, oz + s + 8, yS, sc2);
      } else {
        hquad(B.plain, ox + s, oz - RW, ox + s + 8, oz + RW, yA, rcc);
        hquad(B.plain, ox + s, oz - SW, ox + s + 8, oz - RW, yS, sc1);
        hquad(B.plain, ox + s, oz + RW, ox + s + 8, oz + SW, yS, sc2);
      }
    }
    // faded center dashes
    for (let s = 3; s < CHUNK; s += 6.5) {
      if (rng() < 0.4) continue;
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
  const hw = Math.abs(Math.cos(ang)) * 2.15 + Math.abs(Math.sin(ang)) * 0.95;
  const hd = Math.abs(Math.sin(ang)) * 2.15 + Math.abs(Math.cos(ang)) * 0.95;
  colData.solids.push({ x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd, h: 1.35, vine: false });
}

/* ---- street lamps (some still alive) ---- */
function addLamp(B, colData, rng, x, z, armAng) {
  const pole = _c.copy(COL.lampPole).multiplyScalar(0.8 + rng() * 0.3).clone();
  B.plain.addGeo(tplCyl, compose(x, 0, z, 0.09, 4.6, 0.09), pole, 0, rng);
  const dx = Math.cos(armAng), dz = Math.sin(armAng);
  B.plain.addGeo(tplBox, compose(x + dx * 0.75, 4.42, z + dz * 0.75, 1.6, 0.12, 0.12, 0, -armAng, 0), pole, 0, rng);
  const head = compose(x + dx * 1.45, 4.18, z + dz * 1.45, 0.55, 0.2, 0.32, 0, -armAng, 0);
  if (rng() < 0.55) B.lamp.addGeo(tplBox, head, srgb(0xfff1cf), 0, rng);
  else B.plain.addGeo(tplBox, head, COL.wire, 0, rng);
  colData.trunks.push({ x, z, r: 0.14, h: 4.6 });
}

/* ---- power poles & sagging wires ---- */
function wireSpan(B, ax, ay, az, bx, by, bz, sag) {
  const segs = 5, w = 0.05;
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
  colData.solids.push({ x0: x - 1.6, z0: z - 1.3, x1: x + 1.6, z1: z + 1.3, h: 0.9, vine: false });
}

function buildChunk(ix, iz) {
  const rng = mulberry32(hash2(ix, iz, 999));
  const type = chunkType(ix, iz);
  const ox = ix * CHUNK, oz = iz * CHUNK;
  const B = { plain: new Batch(), bld: new Batch(), leaf: new Batch(), vine: new Batch(), grass: new Batch(), glow: new Batch(), lamp: new Batch() };
  const colData = { solids: [], trunks: [], pads: [] };
  const mini = { rects: [], trees: [], type };
  let openRect = null; // area open to the sky at ground level

  /* ---- street trees along west (x=ox) and south (z=oz) borders ---- */
  const treeLine = (horiz) => {
    let t = 6 + rng() * 8;
    while (t < CHUNK - 6) {
      for (const off of [-6.5, 6.5]) {
        if (rng() < 0.22) continue; // sun gaps
        const jx = (rng() - 0.5) * 2, jz = (rng() - 0.5) * 2;
        const px = horiz ? ox + t + jx : ox + off + jx;
        const pz = horiz ? oz + off + jz : oz + t + jz;
        const h = 20 + rng() * 11, R = 8 + rng() * 5;
        addTree(B, colData, mini, rng, px, pz, h, R);
      }
      t += 12 + rng() * 6;
    }
  };
  if (type !== 'plaza' || rng() < 0.6) { treeLine(true); treeLine(false); }

  /* ---- streets: asphalt, sidewalks, lamps, wires, cars ---- */
  addRoads(B, rng, ox, oz);
  for (const axis of [0, 1]) {
    // power poles: side is constant per street line so wires run straight across chunks
    const pside = (axis === 0 ? hash2(ix, 0, 5) : hash2(0, iz, 6)) % 2 ? 7.4 : -7.4;
    const P = [4, 25, 46, 68].map(t => axis === 0 ? [ox + pside, oz + t] : [ox + t, oz + pside]);
    for (let k = 0; k < 3; k++) {
      addPowerPole(B, colData, rng, P[k][0], P[k][1], axis);
      wireSpan(B, P[k][0], 6.7, P[k][1], P[k + 1][0], 6.7, P[k + 1][1], 0.7 + rng() * 0.5);
      wireSpan(B, P[k][0], 6.35, P[k][1], P[k + 1][0], 6.35, P[k + 1][1], 0.6 + rng() * 0.5);
    }
    // street lamps on the other side
    for (let k = 0; k < 3; k++) {
      if (rng() < 0.25) continue;
      const t = 10 + k * 22 + (rng() - 0.5) * 6;
      const side = -Math.sign(pside) * 5.9;
      if (axis === 0) addLamp(B, colData, rng, ox + side, oz + t, side > 0 ? Math.PI : 0);
      else addLamp(B, colData, rng, ox + t, oz + side, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }
  const carN = (type === 'city' || type === 'towers') ? 3 + (rng() * 4 | 0) : 1 + (rng() * 2 | 0);
  for (let k = 0; k < carN; k++) {
    const axis = rng() < 0.5 ? 0 : 1;
    const t = 6 + rng() * (CHUNK - 12);
    const lane = rng() < 0.8 ? (rng() < 0.5 ? -1 : 1) * (2 + rng() * 2) : (rng() - 0.5) * 3;
    const skew = (rng() - 0.5) * (rng() < 0.15 ? 1.6 : 0.24);
    if (axis === 0) addCar(B, colData, rng, ox + lane, oz + t, (rng() < 0.5 ? 1 : -1) * Math.PI / 2 + skew);
    else addCar(B, colData, rng, ox + t, oz + lane, (rng() < 0.5 ? 0 : Math.PI) + skew);
  }
  if ((type === 'city' || type === 'towers') && rng() < 0.3) {
    const axis = rng() < 0.5 ? 0 : 1, t = 12 + rng() * 40, side = (rng() < 0.5 ? -1 : 1) * 6.6;
    if (axis === 0) addStall(B, colData, rng, ox + side, oz + t, Math.PI / 2);
    else addStall(B, colData, rng, ox + t, oz + side, 0);
  }

  /* ---- block interior ---- */
  const b0 = INSET, b1 = CHUNK - INSET;
  if (type === 'city') {
    // continuous rows of buildings around the block perimeter → street canyons
    const L = CHUNK - 2 * INSET;
    for (const side of [0, 1, 2, 3]) {
      let t = 0;
      while (t < L - 7) {
        const w2 = Math.min(11 + rng() * 7, L - t);
        if (w2 < 7) break;
        const depth = 10 + rng() * 5;
        const center = INSET + t + w2 / 2;
        if (rng() < 0.84) {
          const h = rng() < 0.15 ? 20 + rng() * 10 : 8 + rng() * 11;
          let bx, bz, bw, bd;
          if (side === 0) { bx = ox + center; bz = oz + INSET + depth / 2; bw = w2 - 1.4; bd = depth; }
          else if (side === 1) { bx = ox + center; bz = oz + CHUNK - INSET - depth / 2; bw = w2 - 1.4; bd = depth; }
          else if (side === 2) { bx = ox + INSET + depth / 2; bz = oz + center; bw = depth; bd = w2 - 1.4; }
          else { bx = ox + CHUNK - INSET - depth / 2; bz = oz + center; bw = depth; bd = w2 - 1.4; }
          addBuilding(B, colData, mini, rng, bx, bz, bw, bd, h);
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
        addBuilding(B, colData, mini, rng, px, pz, 12 + rng() * 4, 12 + rng() * 4, 28 + rng() * 26);
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
      { vines: true, allSides: true, garden: false });
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
  }

  /* ---- hanging vine curtains across the streets ---- */
  if (type !== 'plaza') {
    const nC = 2 + (rng() * 3 | 0);
    for (let k = 0; k < nC; k++) {
      const y1 = 8 + rng() * 7, y2 = 8 + rng() * 7;
      if (rng() < 0.5) { const z = oz + 8 + rng() * (CHUNK - 16); addCurtain(B, rng, ox - 7, y1, z, ox + 7, y2, z); }
      else { const x = ox + 8 + rng() * (CHUNK - 16); addCurtain(B, rng, x, y1, oz - 7, x, y2, oz + 7); }
    }
  }

  /* ---- grass ---- */
  const nGrass = type === 'park' ? 170 : type === 'grove' ? 120 : type === 'plaza' ? 60 : 100;
  for (let k = 0; k < nGrass; k++) {
    // bias toward street edges and block border (sidewalks)
    let gx, gz;
    if (rng() < 0.5) { gx = ox + (rng() < 0.5 ? 2 + rng() * 9 : CHUNK - 2 - rng() * 9); gz = oz + rng() * CHUNK; }
    else { gz = oz + (rng() < 0.5 ? 2 + rng() * 9 : CHUNK - 2 - rng() * 9); gx = ox + rng() * CHUNK; }
    if (type === 'park' || type === 'grove') { gx = ox + rng() * CHUNK; gz = oz + rng() * CHUNK; }
    addGrassTuft(B, rng, gx, gz, 0.45 + rng() * 0.75);
  }

  /* ---- glow plants (night bioluminescence) ---- */
  const nGlow = 5 + (rng() * 6 | 0);
  for (let k = 0; k < nGlow; k++) {
    if (mini.trees.length === 0) break;
    const t = mini.trees[(rng() * mini.trees.length) | 0];
    const a = rng() * Math.PI * 2, d = 1 + rng() * 2.5;
    addGlowPlant(B, rng, t[0] + Math.cos(a) * d, t[1] + Math.sin(a) * d, 0.25 + rng() * 0.3);
  }

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
    B.lamp.mesh(matLamp, false, true)
  ];
  for (const m of meshes) if (m) group.add(m);
  return { ix, iz, group, colData, mini, openRect, type, name: districtName(ix, iz) };
}

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
  // immediate ring: never let the player reach an unbuilt chunk
  let budget = syncAll ? 999 : 2;
  while (buildQueue.length && budget > 0) {
    const q = buildQueue.shift();
    if (chunks.has(q.key)) continue;
    const c = buildChunk(q.ix, q.iz);
    chunks.set(q.key, c);
    scene.add(c.group);
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
    }
  }
}
function chunkAt(x, z) { return chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK))); }

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

// stars
{
  const n = 700, pos = new Float32Array(n * 3), rs = mulberry32(42);
  for (let i = 0; i < n; i++) {
    const a = rs() * Math.PI * 2, e = Math.asin(rs());
    pos[i * 3] = Math.cos(a) * Math.cos(e) * 720;
    pos[i * 3 + 1] = Math.sin(e) * 720 + 20;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 720;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var stars = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0xcfe0ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false
  }));
  stars.renderOrder = -9; stars.frustumCulled = false;
  skyGroup.add(stars);
}
// sun & moon sprites
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSun, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
sunSprite.scale.set(150, 150, 1); sunSprite.renderOrder = -8;
skyGroup.add(sunSprite);
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSoft, color: 0xb8c8e0, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true }));
moonSprite.scale.set(55, 55, 1); moonSprite.renderOrder = -8;
skyGroup.add(moonSprite);

// drifting high clouds
const clouds = [];
{
  const rs = mulberry32(31337);
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texSoft, transparent: true, opacity: 0.1, fog: false, depthWrite: false }));
    const d = 250 + rs() * 350;
    const a = rs() * Math.PI * 2;
    s.position.set(Math.cos(a) * d, 130 + rs() * 160, Math.sin(a) * d);
    s.scale.set(180 + rs() * 260, 60 + rs() * 60, 1);
    s.userData.va = 0.4 + rs() * 0.8;
    skyGroup.add(s); clouds.push(s);
  }
}

// palette keyframes (sRGB hex, converted)
const SKY = {
  nightTop: srgb(0x050d16), nightHor: srgb(0x0d1a20), nightSun: srgb(0x0),
  dawnTop: srgb(0x2b4a74), dawnHor: srgb(0xff9a55),
  dayTop: srgb(0x6fa8dc), dayHor: srgb(0xd7e6cc),
  sunLow: srgb(0xff7f36), sunHigh: srgb(0xfff3e0),
  moon: srgb(0x93aecd)
};
const _top = new THREE.Color(), _hor = new THREE.Color(), _sunC = new THREE.Color(), _fogC = new THREE.Color();
const sunDir = new THREE.Vector3();
let dayF = 1, nightF = 0, sunElev = 1;

function updateSky(t) {
  const ang = (t - 0.25) * Math.PI * 2;
  sunElev = Math.sin(ang);
  sunDir.set(Math.cos(ang), Math.sin(ang), 0.32).normalize();
  dayF = smooth(-0.06, 0.14, sunElev);
  nightF = 1 - smooth(-0.14, 0.0, sunElev);
  const duskF = Math.exp(-Math.pow(sunElev * 4.4, 2)); // glow band around horizon crossings

  _top.copy(SKY.nightTop).lerp(SKY.dayTop, dayF).lerp(SKY.dawnTop, duskF * 0.7 * (1 - nightF));
  _hor.copy(SKY.nightHor).lerp(SKY.dayHor, dayF).lerp(SKY.dawnHor, duskF * (1 - nightF * 0.85));
  _sunC.copy(SKY.sunLow).lerp(SKY.sunHigh, smooth(0.05, 0.5, sunElev));

  // dome vertex colors
  const pos = domeGeo.attributes.position, colA = domeGeo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const ny = pos.getY(i) / 760;
    const k = Math.pow(clamp(ny * 1.15 + 0.12, 0, 1), 0.58);
    _c.copy(_hor).lerp(_top, k);
    colA.setXYZ(i, _c.r, _c.g, _c.b);
  }
  colA.needsUpdate = true;

  // fog tinted toward the leaves during the day
  _fogC.copy(_hor).lerp(COL.moss, 0.34 * dayF);
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
    sun.intensity = 0.32;
    sun.position.copy(sun.target.position).addScaledVector(sunDir, -170);
  } else {
    sun.intensity = 0.08;
  }
  hemi.intensity = 0.3 + dayF * 0.75;
  hemi.color.copy(_top).lerp(_hor, 0.6);
  amb.intensity = 0.2 + dayF * 0.24;
  seaMat.color.copy(COL.leafB).multiplyScalar(0.16 + dayF * 0.95);

  // sky objects
  sunSprite.position.copy(sunDir).multiplyScalar(700);
  sunSprite.material.color.copy(_sunC);
  sunSprite.material.opacity = smooth(-0.09, 0.02, sunElev);
  moonSprite.position.copy(sunDir).multiplyScalar(-690);
  moonSprite.material.opacity = nightF * 0.9;
  stars.material.opacity = nightF * 0.9;
  for (const cl of clouds) cl.material.opacity = 0.05 + dayF * 0.09;

  // emissives
  matBld.emissiveIntensity = nightF * 0.9 + duskF * 0.15;
  matGlow.emissiveIntensity = nightF * 2.4;
  matLamp.emissiveIntensity = nightF * 2.6 + duskF * 0.4;
}

/* ======================================================================== */
/*  CANOPY SEA — the endless roof of leaves, seen from above                */
/* ======================================================================== */
function makeSeaTexture() {
  const S = 512, r = mulberry32(2024);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#4a7431'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const rr = 6 + r() * 22;
    x.fillStyle = `hsl(${82 + (r() - 0.5) * 30},${38 + r() * 28}%,${26 + r() * 26}%)`;
    x.beginPath(); x.arc(r() * S, r() * S, rr, 0, 7); x.fill();
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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(640, 640), new THREE.MeshStandardMaterial({ map: texGround, roughness: 1, metalness: 0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/* ======================================================================== */
/*  PARTICLES — pollen & fireflies                                          */
/* ======================================================================== */
function makeDrifters(n, boxR, boxH, size, color, additive) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), rs = mulberry32(n * 7 + 3);
  const seed = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rs() - 0.5) * boxR * 2; pos[i * 3 + 1] = rs() * boxH; pos[i * 3 + 2] = (rs() - 0.5) * boxR * 2;
    col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b;
    seed[i * 2] = rs() * 7; seed[i * 2 + 1] = 0.5 + rs() * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({
    size, map: texSoft, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: 0.55
  }));
  m.frustumCulled = false;
  return { mesh: m, pos, col, seed, n, boxR, boxH, base: color };
}
const pollen = makeDrifters(340, 26, 22, 0.14, srgb(0xfff3c9), false);
scene.add(pollen.mesh);
const flies = makeDrifters(150, 30, 4, 0.35, srgb(0x9dffb0), true);
scene.add(flies.mesh);

function updateDrifters(time, px, py, pz) {
  // pollen drifts; both wrap around the player
  for (const D of [pollen, flies]) {
    const isFly = D === flies;
    for (let i = 0; i < D.n; i++) {
      let x = D.pos[i * 3], y = D.pos[i * 3 + 1], z = D.pos[i * 3 + 2];
      const s0 = D.seed[i * 2], s1 = D.seed[i * 2 + 1];
      if (isFly) {
        x += Math.sin(time * 0.7 * s1 + s0) * 0.02; z += Math.cos(time * 0.6 * s1 + s0 * 2) * 0.02;
        y += Math.sin(time * 0.9 * s1 + s0 * 3) * 0.008;
        const blink = Math.max(0, Math.sin(time * 2.2 * s1 + s0 * 5));
        const b = blink * blink * nightF;
        D.col[i * 3] = D.base.r * b; D.col[i * 3 + 1] = D.base.g * b; D.col[i * 3 + 2] = D.base.b * b;
      } else {
        x += Math.sin(time * 0.22 + s0) * 0.012 + 0.006; y -= 0.004 * s1; z += Math.cos(time * 0.18 + s0) * 0.012;
      }
      // wrap into box around player
      const R = D.boxR;
      if (x - px > R) x -= R * 2; else if (px - x > R) x += R * 2;
      if (z - pz > R) z -= R * 2; else if (pz - z > R) z += R * 2;
      const yb = isFly ? 0.3 : py - 6, yt = isFly ? D.boxH : py + D.boxH;
      if (y < yb) y = yt; else if (y > yt) y = yb;
      D.pos[i * 3] = x; D.pos[i * 3 + 1] = y; D.pos[i * 3 + 2] = z;
    }
    D.mesh.geometry.attributes.position.needsUpdate = true;
    if (isFly) D.mesh.geometry.attributes.color.needsUpdate = true;
  }
  pollen.mesh.material.opacity = 0.24 + dayF * 0.3;
  flies.mesh.visible = nightF > 0.05;
}

/* ======================================================================== */
/*  PEOPLE — cloaked citizens of the undercanopy                            */
/* ======================================================================== */
const npcGeoCloak = new THREE.CylinderGeometry(0.17, 0.37, 1.16, 7); npcGeoCloak.translate(0, 0.58, 0);
const npcGeoHood = new THREE.SphereGeometry(0.23, 8, 6); npcGeoHood.scale(1, 0.78, 1);
const npcGeoHead = new THREE.SphereGeometry(0.135, 8, 6);
const NPC_CLOAKS = [0x7a7261, 0x5d6657, 0x6b5d6e, 0x836f54, 0x596672, 0x74584a, 0x86795f, 0x4f5c50]
  .map(h => new THREE.MeshStandardMaterial({ color: h, roughness: 1 }));
const NPC_SKINS = [0x8a6a52, 0x6b4b38, 0xa3826a, 0x5a4335, 0x96755d]
  .map(h => new THREE.MeshStandardMaterial({ color: h, roughness: 0.9 }));
const npcWoodMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 1 });
const npcLanternMat = new THREE.MeshStandardMaterial({ color: 0x2a2a22, emissive: srgb(0xffd9a0), emissiveIntensity: 0, roughness: 0.6 });

const npcs = [];
function makeNPCGroup(kid, role) {
  const g = new THREE.Group();
  const cloak = new THREE.Mesh(npcGeoCloak, NPC_CLOAKS[(Math.random() * NPC_CLOAKS.length) | 0]);
  cloak.castShadow = true;
  const hood = new THREE.Mesh(npcGeoHood, cloak.material); hood.position.y = 1.17; hood.castShadow = true;
  const head = new THREE.Mesh(npcGeoHead, NPC_SKINS[(Math.random() * NPC_SKINS.length) | 0]); head.position.y = 1.3; head.position.z = 0.05;
  g.add(cloak, hood, head);
  let anim = null;
  if (role === 'sweep') {
    const broom = new THREE.Group();
    const handle = new THREE.Mesh(tplCyl, npcWoodMat); handle.scale.set(0.025, 1.5, 0.025); handle.rotation.x = 0.9;
    const bhead = new THREE.Mesh(tplBox, npcWoodMat); bhead.scale.set(0.34, 0.06, 0.1); bhead.position.set(0, 0.06, 1.18);
    broom.add(handle, bhead); broom.position.set(0.28, 0.35, 0.1);
    g.add(broom); anim = broom;
  } else if (role === 'lantern') {
    const stick = new THREE.Mesh(tplCyl, npcWoodMat); stick.scale.set(0.025, 0.8, 0.025); stick.rotation.z = -0.9; stick.position.set(0.25, 0.75, 0.1);
    const glow = new THREE.Mesh(tplBlob, npcLanternMat); glow.scale.setScalar(0.09); glow.position.set(0.62, 0.98, 0.1);
    g.add(stick, glow); anim = glow;
  } else if (Math.random() < 0.5 && role === 'walk') {
    const basket = new THREE.Mesh(tplBox, npcWoodMat); basket.scale.set(0.36, 0.26, 0.28); basket.position.set(0.34, 0.5, 0);
    g.add(basket);
  }
  g.scale.setScalar(kid ? 0.62 + Math.random() * 0.08 : 1.0 + Math.random() * 0.16);
  return { g, anim };
}

function spawnNPC(forceRole) {
  const day = dayF > 0.35;
  let role = forceRole;
  if (!role) {
    if (!day) role = 'lantern';
    else { const r = Math.random(); role = r < 0.48 ? 'walk' : r < 0.66 ? 'chat' : r < 0.78 ? 'sweep' : 'tend'; }
  }
  // find a street point 22–75 m away
  for (let tries = 0; tries < 12; tries++) {
    const axis = Math.random() < 0.5 ? 0 : 1;
    const line = 64 * Math.round(((axis === 0 ? player.pos.x : player.pos.z) + (Math.random() - 0.5) * 170) / 64);
    const along = (axis === 0 ? player.pos.z : player.pos.x) + (Math.random() - 0.5) * 150;
    const off = Math.random() < 0.75 ? (Math.random() < 0.5 ? -1 : 1) * (5.6 + Math.random() * 1.7) : (Math.random() - 0.5) * 4;
    const x = axis === 0 ? line + off : along;
    const z = axis === 0 ? along : line + off;
    const d = Math.hypot(x - player.pos.x, z - player.pos.z);
    if (d < 22 || d > 75) continue;
    const kid = day && role === 'walk' && Math.random() < 0.28;
    const { g, anim } = makeNPCGroup(kid, role);
    g.position.set(x, 0, z);
    scene.add(g);
    const npc = {
      g, anim, role, axis, line, off, kid,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: (role === 'walk' || role === 'lantern') ? (kid ? 2.3 + Math.random() : 1.1 + Math.random() * 0.5) : 0.25,
      phase: Math.random() * 7, turnCd: 2, stateT: 12 + Math.random() * 30,
      greetCd: 0, faceYaw: Math.random() * 7, partner: null
    };
    npcs.push(npc);
    if (role === 'chat') { // spawn a partner facing them
      const { g: g2, anim: a2 } = makeNPCGroup(false, 'chat');
      const a = Math.random() * Math.PI * 2;
      g2.position.set(x + Math.cos(a) * 0.85, 0, z + Math.sin(a) * 0.85);
      scene.add(g2);
      const p2 = { g: g2, anim: a2, role: 'chat', axis, line, off, kid: false, dir: 1, speed: 0.25, phase: Math.random() * 7, turnCd: 2, stateT: npc.stateT, greetCd: 0, faceYaw: 0, partner: npc };
      npc.partner = p2; npcs.push(p2);
    }
    return true;
  }
  return false;
}

function removeNPC(npc) {
  scene.remove(npc.g);
  const i = npcs.indexOf(npc); if (i >= 0) npcs.splice(i, 1);
  if (npc.partner) npc.partner.partner = null;
}

function updateNPCs(dt, time) {
  npcLanternMat.emissiveIntensity = matLamp.emissiveIntensity + 0.25;
  const want = Math.round(lerp(5, 17, dayF));
  if (npcs.length < want && Math.random() < 0.12) spawnNPC();
  let farthest = null, fd = 0;
  for (let i = npcs.length - 1; i >= 0; i--) {
    const n = npcs[i];
    const dx = n.g.position.x - player.pos.x, dz = n.g.position.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 88) { removeNPC(n); continue; }
    if (d > fd) { fd = d; farthest = n; }
    n.turnCd -= dt; n.greetCd -= dt;

    let moving = false;
    if (n.role === 'walk' || n.role === 'lantern') {
      // pause & face the player when close
      if (d < 2.6 && n.greetCd <= -2) n.greetCd = 1.6;
      if (n.greetCd > 0) {
        n.faceYaw = Math.atan2(player.pos.x - n.g.position.x, player.pos.z - n.g.position.z);
      } else {
        moving = true;
        const p = n.g.position;
        if (n.axis === 0) { p.z += n.dir * n.speed * dt; p.x += (n.line + n.off - p.x) * Math.min(1, 2 * dt); }
        else { p.x += n.dir * n.speed * dt; p.z += (n.line + n.off - p.z) * Math.min(1, 2 * dt); }
        // turn at intersections
        const along = n.axis === 0 ? p.z : p.x;
        const grid = Math.round(along / CHUNK) * CHUNK;
        if (Math.abs(along - grid) < 0.7 && n.turnCd <= 0) {
          n.turnCd = 4 + Math.random() * 4;
          if (Math.random() < 0.55) {
            n.axis = 1 - n.axis; n.line = grid;
            n.off = Math.random() < 0.75 ? (Math.random() < 0.5 ? -1 : 1) * (5.6 + Math.random() * 1.7) : (Math.random() - 0.5) * 4;
            n.dir = Math.random() < 0.5 ? 1 : -1;
          }
        }
        n.faceYaw = n.axis === 0 ? (n.dir > 0 ? 0 : Math.PI) : (n.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        if (n.anim && n.role === 'lantern') n.anim.position.y = 0.98 + Math.sin(time * 2 + n.phase) * 0.04;
      }
    } else if (n.role === 'chat') {
      if (n.partner) n.faceYaw = Math.atan2(n.partner.g.position.x - n.g.position.x, n.partner.g.position.z - n.g.position.z);
      n.g.position.y = Math.abs(Math.sin(time * 1.4 + n.phase)) * 0.02;
      n.stateT -= dt;
      if (n.stateT <= 0) { n.role = 'walk'; n.speed = 1.1 + Math.random() * 0.5; if (n.partner) { n.partner.role = 'walk'; n.partner.speed = 1.3; } }
    } else if (n.role === 'sweep') {
      const p = n.g.position;
      if (n.axis === 0) p.z += Math.sin(time * 0.35 + n.phase) * 0.15 * dt * 4;
      else p.x += Math.sin(time * 0.35 + n.phase) * 0.15 * dt * 4;
      if (n.anim) n.anim.rotation.y = Math.sin(time * 2.1 + n.phase) * 0.55;
      n.faceYaw += Math.sin(time * 0.2 + n.phase) * 0.002;
    } else if (n.role === 'tend') {
      n.g.scale.y = n.g.scale.x * (0.86 + Math.sin(time * 0.9 + n.phase) * 0.1);
      n.faceYaw += Math.sin(time * 0.15 + n.phase) * 0.003;
    }

    // keep them out of cars, trunks, buildings
    const c = chunkAt(n.g.position.x, n.g.position.z);
    if (c) {
      const p = n.g.position;
      for (const t of c.colData.trunks) {
        const ddx = p.x - t.x, ddz = p.z - t.z, dd = Math.hypot(ddx, ddz), rr = t.r + 0.3;
        if (dd < rr && dd > 1e-4) { p.x += ddx / dd * (rr - dd); p.z += ddz / dd * (rr - dd); }
      }
      for (const s of c.colData.solids) {
        if (s.h < 0.5) continue;
        const cxp = clamp(p.x, s.x0, s.x1), czp = clamp(p.z, s.z0, s.z1);
        let ddx = p.x - cxp, ddz = p.z - czp; const dd = Math.hypot(ddx, ddz);
        if (dd < 0.3 && dd > 1e-4) { p.x += ddx / dd * (0.3 - dd); p.z += ddz / dd * (0.3 - dd); }
      }
    }

    // walk bob & waddle
    if (moving) {
      n.phase += dt * n.speed * 3.4;
      n.g.position.y = Math.abs(Math.sin(n.phase)) * 0.05;
      n.g.rotation.z = Math.sin(n.phase) * 0.045;
    } else n.g.rotation.z *= 0.9;
    // smooth facing
    let dy = n.faceYaw - n.g.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    n.g.rotation.y += dy * Math.min(1, 6 * dt);
  }
  // thin the crowd toward night
  if (npcs.length > want + 2 && farthest && fd > 45) removeNPC(farthest);
}

/* ======================================================================== */
/*  PLAYER                                                                  */
/* ======================================================================== */
const player = {
  pos: new THREE.Vector3(2.2, 0, 2.2),
  vel: new THREE.Vector3(),
  yaw: Math.atan2(-(SPIRE.x - 2.2), -(SPIRE.z - 2.2)),  // face the spire
  pitch: 0,
  grounded: false, climbing: false, onCanopy: false,
  heat: 0, exposed: false,
  bob: 0, stride: 0
};
let lastShade = player.pos.clone();
const keys = {};
let locked = false, started = false;

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyM') toggleAudio();
  if (e.code === 'KeyR' && started) { player.pos.copy(lastShade); player.vel.set(0, 0, 0); player.heat = Math.min(player.heat, 40); }
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousemove', e => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch = clamp(player.pitch - e.movementY * 0.0021, -1.45, 1.45);
});

const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => {
  initAudio();
  canvas.requestPointerLock && canvas.requestPointerLock();
  if (SHOT) hideOverlay();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) hideOverlay(); else if (!SHOT) showOverlay(true);
});
function hideOverlay() {
  overlay.style.display = 'none';
  document.getElementById('hud').style.display = 'block';
  started = true;
}
function showOverlay(paused) {
  overlay.style.display = 'flex';
  if (paused) document.getElementById('goLabel').textContent = 'CLICK TO RESUME';
}

/* ---- collision helpers ---- */
function collectColliders(px, pz, out) {
  out.solids.length = 0; out.trunks.length = 0; out.pads.length = 0;
  const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const c = chunks.get(chunkKey(cx + dx, cz + dz));
    if (!c) continue;
    for (const s of c.colData.solids) out.solids.push(s);
    for (const t of c.colData.trunks) out.trunks.push(t);
    for (const p of c.colData.pads) out.pads.push(p);
  }
}
const nearby = { solids: [], trunks: [], pads: [] };

function stepPlayer(dt) {
  const p = player;
  const feet = () => p.pos.y;

  // input direction
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) { mx += fx; mz += fz; }
  if (keys.KeyS || keys.ArrowDown) { mx -= fx; mz -= fz; }
  if (keys.KeyD || keys.ArrowRight) { mx += rx; mz += rz; }
  if (keys.KeyA || keys.ArrowLeft) { mx -= rx; mz -= rz; }
  const ml = Math.hypot(mx, mz);
  if (ml > 0) { mx /= ml; mz /= ml; }
  const speed = WALK * ((keys.ShiftLeft || keys.ShiftRight) ? SPRINT : 1);
  const accel = p.grounded ? 11 : 3;
  p.vel.x += (mx * speed - p.vel.x) * Math.min(1, accel * dt);
  p.vel.z += (mz * speed - p.vel.z) * Math.min(1, accel * dt);

  // gravity
  if (!p.climbing) p.vel.y -= GRAV * dt;

  if (p.grounded && keys.Space) { p.vel.y = JUMP; p.grounded = false; }

  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  p.pos.y += p.vel.y * dt;

  collectColliders(p.pos.x, p.pos.z, nearby);

  // --- horizontal resolve: walls & trunks ---
  let climbNormal = null, climbSolid = null;
  for (const s of nearby.solids) {
    if (feet() > s.h - 0.35) continue;               // above the roofline: no wall
    const cxp = clamp(p.pos.x, s.x0, s.x1), czp = clamp(p.pos.z, s.z0, s.z1);
    let dx = p.pos.x - cxp, dz = p.pos.z - czp;
    let d = Math.hypot(dx, dz);
    if (d >= PR) continue;
    if (d < 1e-5) { dx = 1; dz = 0; d = 1; } // inside: push +x
    const push = (PR - d);
    p.pos.x += dx / d * push; p.pos.z += dz / d * push;
    if (s.vine) { climbNormal = { x: dx / d, z: dz / d }; climbSolid = s; }
  }
  for (const t of nearby.trunks) {
    if (feet() > t.h) continue;
    let dx = p.pos.x - t.x, dz = p.pos.z - t.z;
    let d = Math.hypot(dx, dz);
    const rr = t.r + PR * 0.9;
    if (d >= rr || d < 1e-5) continue;
    p.pos.x += dx / d * (rr - d); p.pos.z += dz / d * (rr - d);
    if (t.h > 14) { climbNormal = { x: dx / d, z: dz / d }; climbSolid = t; } // big trunks climbable
  }

  // --- climbing ---
  p.climbing = false;
  if (climbNormal && (keys.KeyW || keys.ArrowUp)) {
    const facing = -(fx * climbNormal.x + fz * climbNormal.z); // 1 = looking straight at wall
    if (facing > 0.25) {
      p.climbing = true;
      p.vel.y = p.pitch < -0.4 ? -CLIMB_SPEED : CLIMB_SPEED;
      // mantle over the top edge
      const topY = climbSolid.h !== undefined ? climbSolid.h : 0;
      if (topY && feet() > topY - 1.1 && p.pitch >= -0.4) {
        p.vel.y = 4.2;
        p.vel.x -= climbNormal.x * 2.4; p.vel.z -= climbNormal.z * 2.4;
        p.climbing = false;
      }
      if (keys.Space) { // kick off the wall
        p.vel.y = 3.5; p.vel.x += climbNormal.x * 5; p.vel.z += climbNormal.z * 5;
        p.climbing = false;
      }
    }
  }

  // --- vertical support ---
  let support = 0; p.onCanopy = false;
  let supportIsCanopy = false;
  for (const s of nearby.solids) {
    if (p.pos.x < s.x0 - 0.2 || p.pos.x > s.x1 + 0.2 || p.pos.z < s.z0 - 0.2 || p.pos.z > s.z1 + 0.2) continue;
    if (feet() >= s.h - 1.0 && feet() <= s.h + 0.6 && s.h > support) { support = s.h; supportIsCanopy = false; }
  }
  for (const pad of nearby.pads) {
    const dx = p.pos.x - pad.x, dz = p.pos.z - pad.z;
    if (dx * dx + dz * dz > pad.r * pad.r) continue;
    if (feet() >= pad.y - 1.3 && feet() <= pad.y + 0.6 && pad.y > support) { support = pad.y; supportIsCanopy = true; }
  }
  p.grounded = false;
  if (p.vel.y <= 0.01 && feet() <= support + 0.02) {
    p.pos.y = support; p.vel.y = 0; p.grounded = true; p.onCanopy = supportIsCanopy;
  }
  if (p.pos.y < 0) { p.pos.y = 0; p.vel.y = 0; p.grounded = true; }

  // --- head bob & footsteps ---
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  if (p.grounded && hSpeed > 0.6) {
    p.bob += dt * hSpeed * 1.7;
    const strideNow = Math.floor(p.bob / Math.PI);
    if (strideNow !== p.stride) { p.stride = strideNow; sfxStep(); }
  }
  const bobY = (p.grounded ? Math.sin(p.bob * 2) * 0.042 * Math.min(1, hSpeed / 4) : 0);

  camera.position.set(p.pos.x, p.pos.y + EYE + bobY, p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

  return climbNormal;
}

/* ======================================================================== */
/*  HEAT                                                                    */
/* ======================================================================== */
function isExposed() {
  if (player.pos.y > CANOPY_Y) return true;
  const c = chunkAt(player.pos.x, player.pos.z);
  if (c && c.openRect) {
    const o = c.openRect;
    if (player.pos.x > o.x0 && player.pos.x < o.x1 && player.pos.z > o.z0 && player.pos.z < o.z1) return true;
  }
  return false;
}
let shadeTimer = 0;
function stepHeat(dt) {
  const p = player;
  p.exposed = isExposed();
  const airBase = lerp(27, 46, dayF);
  const air = airBase + (p.exposed ? 11 : 0) - clamp((p.pos.y - 40) * 0.04, 0, 3);
  if (p.exposed && dayF > 0.05) p.heat += dayF * dt * 2.6;   // ~40 s to overheat at high noon
  else p.heat -= dt * 7;
  p.heat = clamp(p.heat, 0, 100);

  shadeTimer += dt;
  if (!p.exposed && p.grounded && p.pos.y < CANOPY_Y && shadeTimer > 1) { lastShade.copy(p.pos); shadeTimer = 0; }

  if (p.heat >= 100) {
    // heatstroke: stagger back to the last shade
    fadeEl.style.opacity = 1;
    setTimeout(() => {
      p.pos.copy(lastShade); p.vel.set(0, 0, 0); p.heat = 55;
      msg('The sun took you. You wake in the shade, head pounding.', 6);
      fadeEl.style.opacity = 0;
    }, 850);
    p.heat = 99; // don't retrigger while fading
  }
  return air;
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
  const bgFor = { city: '#1a2114', towers: '#1c1f18', park: '#16290f', plaza: '#262319', grove: '#122408', spire: '#20240f' };
  for (const c of chunks.values()) {
    const dx = c.ix * CHUNK - px, dz = c.iz * CHUNK - pz;
    if (Math.abs(dx) > 190 || Math.abs(dz) > 190) continue;
    mmx.fillStyle = bgFor[c.type] || '#1a2114';
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
  // spire marker
  const sdx = SPIRE.x - px, sdz = SPIRE.z - pz;
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
let nextBird = 0;
function stepAudio(time) {
  if (!AC || muted) return;
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
let summited = false;

// initial world
ensureChunks(player.pos.x, player.pos.z, true);
updateSky(dayT);

/* screenshot / smoke-test presets */
if (SHOT) {
  hideOverlay();
  if (SHOT === '2') { player.pos.set(SPIRE.x - 9.5, SPIRE.h, SPIRE.z); player.yaw = Math.PI / 2; player.pitch = -0.3; dayT = 0.42; }
  else if (SHOT === '3') { dayT = 0.93; player.pos.set(0, 0, 30); player.yaw = Math.PI; }
  else { dayT = 0.42; player.pos.set(0, 0, 30); player.yaw = Math.PI; player.pitch = 0.04; }
  ensureChunks(player.pos.x, player.pos.z, true);
  if (SHOT !== '2') { // a few citizens in frame
    const spots = [[-6.1, 44, 0.3], [2.5, 52, 2.8], [6.3, 60, -0.4], [-1.5, 68, 1.6], [-6.4, 74, 2.2]];
    for (let k = 0; k < spots.length; k++) {
      const { g } = makeNPCGroup(k === 3, k === 2 ? 'sweep' : 'walk');
      g.position.set(spots[k][0], 0, spots[k][1]);
      g.rotation.y = spots[k][2];
      scene.add(g);
    }
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
  updateSky(dayT);

  skyGroup.position.set(camera.position.x, 0, camera.position.z);
  ground.position.set(Math.round(player.pos.x / 8) * 8, 0, Math.round(player.pos.z / 8) * 8);

  // above the leaves: the horizon opens up and the canopy sea appears
  const high = smooth(22, 44, player.pos.y);
  sea.visible = high > 0.02;
  seaMat.opacity = high;
  sea.position.set(player.pos.x, 26.5, player.pos.z);
  scene.fog.far = lerp(215, 580, high);
  scene.fog.near = lerp(18, 90, high);

  updateDrifters(time, player.pos.x, player.pos.y, player.pos.z);
  if (active) updateNPCs(dt, time);

  let air = 30;
  if (active) air = stepHeat(dt);

  /* --- story beats & hints --- */
  if (active) {
    once('start', () => { msg('Morning under the leaves. The streets are cool and green.', 7); hint('Follow ✦ on the minimap to reach the Spire', 8); });
    if (climbTouch && player.pos.y < 3) once('vinehint', () => hint('Hold W while facing the vines to climb · look down + W to descend', 6));
    if (player.climbing) once('climbing', () => msg('The vines hold your weight. Up you go.', 5));
    if (player.pos.y > CANOPY_Y + 2) once('above', () => msg('You break through the canopy — raw sun. Your body heat is climbing.', 7));
    if (player.onCanopy) once('canopywalk', () => msg('You are walking on the roof of the forest.', 6));
    if (nightF > 0.6) once('night', () => msg('Night. The glow-moss wakes, and the fireflies with it.', 7));
    for (const n of npcs) {
      if (Math.hypot(n.g.position.x - player.pos.x, n.g.position.z - player.pos.z) < 7) {
        once('people', () => msg('The under-dwellers nod as you pass. Life goes on, just… lower.', 7));
        break;
      }
    }
    if (player.heat > 70) once('hot', () => hint('TOO HOT — get under the leaves or wait for dusk', 5));
    if (!summited && Math.abs(player.pos.x - SPIRE.x) < SPIRE.size / 2 + 1 && Math.abs(player.pos.z - SPIRE.z) < SPIRE.size / 2 + 1 && player.pos.y > SPIRE.h - 1) {
      summited = true;
      msg('The Spire. From here the green goes to every horizon — the city is a forest, and the forest is the world now.', 10, true);
      setTimeout(() => msg('Outside the canopy it is 54 °C. There is nowhere to escape to. Head back down — home is under the leaves.', 9, true), 10500);
    }
    if (!seen.spirenear && Math.hypot(player.pos.x - SPIRE.x, player.pos.z - SPIRE.z) < 26 && player.pos.y < 4)
      once('spirenear', () => hint('The old broadcast Spire — vines cover every wall. Climb.', 6));
  }

  /* --- HUD --- */
  hudT += dt;
  if (hudT > 0.2 && active) {
    hudT = 0;
    const hrs = dayT * 24, hh = Math.floor(hrs), mmn = Math.floor((hrs - hh) * 60);
    clockEl.textContent = String(hh).padStart(2, '0') + ':' + String(mmn).padStart(2, '0');
    const c = chunkAt(player.pos.x, player.pos.z);
    districtEl.textContent = c ? c.name : '—';
    airEl.textContent = Math.round(air);
    altEl.textContent = Math.round(player.pos.y);
    coverEl.textContent = player.exposed ? 'IN THE SUN' : 'shaded';
    coverEl.className = player.exposed ? 'exposed' : '';
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
    }
  }
}
loop();
