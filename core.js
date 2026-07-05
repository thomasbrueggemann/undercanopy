/* ============================================================================
   CANOPY — a first-person walk through an endless, overgrown city.
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
function randomizeSPIRE() {
  const cx = Math.floor(Math.random() * 16);
  const cz = Math.floor(Math.random() * 16);
  return { cx, cz, x: cx * CHUNK + 32, z: cz * CHUNK + 32, size: 22, h: 78 };
}
const SPIRE = randomizeSPIRE();

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
// near/far ratio drives depth-buffer precision. The old 0.1/1200 (12000:1) starved
// city-distance facades of resolution, so flush ornaments (signs at 0.08 m, vines at
// 0.14 m) z-fought the wall behind them and flickered on every camera turn. Player
// collision keeps the first-person eye >= PR (0.42 m) off any wall, so a 0.3 m near
// clips nothing; far drops to 700 (well past the 580 m high-altitude fog cutoff).
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.3, 700);
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

// Night street lighting: a small pool of real point lights that hop to the nearest
// still-burning lamp heads around the player, so the dark streets actually pool with
// warm light instead of only the lamp glass glowing. They read straight from each
// chunk's colData.lamps (working ones). Kept always-visible with intensity driven to
// 0 when unused, so the light count — and thus the shaders — never change.
const LAMP_LIGHTS = 6;
const LAMP_REACH = 30;
const lampLights = [];
for (let i = 0; i < LAMP_LIGHTS; i++) {
  const L = new THREE.PointLight(0xffb267, 0, LAMP_REACH, 2);
  L.castShadow = false;
  scene.add(L);
  lampLights.push(L);
}

// The player's flashlight — a spot cone parented to the camera so it always throws
// where you look. Toggled with F; its intensity ramps on/off smoothly in the loop.
const flashlight = new THREE.SpotLight(0xfff2d0, 0, 46, 0.46, 0.5, 1.3);
flashlight.position.set(0.3, -0.22, 0.1);    // held a touch to the right, below the eye
const flashTarget = new THREE.Object3D();
flashTarget.position.set(0, -0.14, -1);        // aimed slightly down the street
camera.add(flashlight);
camera.add(flashTarget);
flashlight.target = flashTarget;
let flashOn = false;

/* ---------------------------------------------------- procedural textures -- */
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace; else t.encoding = THREE.sRGBEncoding;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// Building facade + matching emissive (lit windows) atlas.
// An 8×8 grid of window cells; the map/emissive repeat is set to 1/BLD_CELLS so that
// one atlas cell maps to exactly one facade bay — addBuilding then asks for ~3.2 m per
// bay, which is what reads correctly against the ~1.7 m citizens (before this the whole
// 8×8 atlas was crammed into a single bay, giving the "dollhouse micro-grid" look).
// Window geometry is constant DOWN each column and the floor band is constant ACROSS
// each row, so tiling always keeps windows aligned in columns and floors; the per-column
// style variety means a building that starts at a different phase (uo/vo) reads as a
// genuinely different facade.
const BLD_CELLS = 8;
function makeBuildingTextures() {
  // 1024px atlas → 128px per bay: windows read as glass with reveals and streaks
  // instead of 64px blobs. Realism comes from four things real weathered concrete
  // has: storey slab bands, recessed window reveals, rain streaks running DOWN from
  // sills, and large-scale tonal mottling — not from more speckle noise.
  const S = 1024, cell = S / BLD_CELLS, r = mulberry32(1234);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const e = makeCanvas(S, S), y = e.getContext('2d');
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  // concrete base: vertical gradient + large soft mottling (patchy discoloration)
  const g = x.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, '#918f84'); g.addColorStop(1, '#787468');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {
    const mx = r() * S, my = r() * S, mr = 60 + r() * 190;
    const gg = x.createRadialGradient(mx, my, 1, mx, my, mr);
    const dark = r() < 0.6;
    gg.addColorStop(0, dark ? `rgba(52,54,46,${0.05 + r() * 0.08})` : `rgba(210,206,190,${0.04 + r() * 0.06})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gg; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  }
  // long vertical grime runs from the top of the facade
  for (let i = 0; i < 70; i++) {
    const gx = r() * S, gw = 3 + r() * 12, gl = S * (0.3 + r() * 0.7);
    const gg = x.createLinearGradient(0, 0, 0, gl);
    gg.addColorStop(0, `rgba(42,46,38,${0.05 + r() * 0.09})`); gg.addColorStop(1, 'rgba(42,46,38,0)');
    x.fillStyle = gg; x.fillRect(gx, 0, gw, gl);
  }
  // fine grain
  for (let i = 0; i < 5200; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    x.fillRect(r() * S, r() * S, 2, 2);
  }
  // spalled patches: plaster fallen off, lighter core with a darker rim
  for (let i = 0; i < 14; i++) {
    const sx = r() * S, sy = r() * S, sr = 9 + r() * 26;
    x.fillStyle = 'rgba(48,46,40,0.35)';
    x.beginPath();
    for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI * 2, rr = sr * (0.7 + r() * 0.5); x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
    x.fill();
    x.fillStyle = `rgba(${168 + r() * 26 | 0},${160 + r() * 22 | 0},${142 + r() * 18 | 0},0.8)`;
    x.beginPath();
    for (let k = 0; k <= 8; k++) { const a = k / 8 * Math.PI * 2, rr = sr * 0.72 * (0.7 + r() * 0.5); x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); }
    x.fill();
  }
  // hairline cracks wandering mostly downward
  x.strokeStyle = 'rgba(38,38,32,0.35)'; x.lineWidth = 1.5;
  for (let i = 0; i < 22; i++) {
    let px = r() * S, py = r() * S * 0.7;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 7; k++) { px += (r() - 0.5) * 26; py += 10 + r() * 34; x.lineTo(px, py); }
    x.stroke();
  }
  // per-column window style (held constant down the column so windows stack vertically)
  const cols = [];
  for (let i = 0; i < BLD_CELLS; i++) {
    const t = r();
    if (t < 0.12)      cols.push({ pier: true });                                 // solid pier / party wall
    else if (t < 0.30) cols.push({ ww: 36 + r() * 12, panes: 1 });                // narrow window
    else if (t < 0.50) cols.push({ ww: 88 + r() * 16, panes: 1 });                // picture window
    else if (t < 0.68) cols.push({ ww: 84, panes: 2 });                           // twin panes
    else               cols.push({ ww: 64 + r() * 12, panes: 1, bal: r() < 0.35 }); // standard, maybe balcony
  }
  const WY = 22, WH = 80;               // floor band (constant across rows → aligned storeys)
  // glass tone families — real streets mix dead-dark glass, greenish reflection,
  // pale sky bounce; one gradient everywhere is what reads "video-gamey"
  const GLASS = [
    ['#38444c', '#161c20'], ['#2c3a36', '#121a16'], ['#1a2024', '#0b0e10'],
    ['#546a76', '#26343c'], ['#4a5a50', '#1e2822'], ['#243038', '#101418']
  ];
  // one glazed pane, drawn to both the albedo (x) and emissive (y) canvases
  function pane(wx, wy, ww, wh, state) {
    // recessed reveal: dark surround, deepest at the top (glass sits back from the wall)
    x.fillStyle = 'rgba(30,30,26,0.55)'; x.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);
    x.fillStyle = '#4c4a42'; x.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);          // frame
    if (state === 'lit') {
      const lg = x.createLinearGradient(0, wy, 0, wy + wh);
      lg.addColorStop(0, '#b7a684'); lg.addColorStop(1, '#7d6a45');
      x.fillStyle = lg; x.fillRect(wx, wy, ww, wh);
      y.fillStyle = '#ffb35e'; y.fillRect(wx, wy, ww, wh);
      y.fillStyle = '#241505'; y.fillRect(wx + ww / 2 - 2, wy, 3, wh); y.fillRect(wx, wy + wh / 2 - 2, ww, 3);
    } else if (state === 'broken') {
      x.fillStyle = '#0c0f10'; x.fillRect(wx, wy, ww, wh);
      x.fillStyle = 'rgba(150,160,170,0.35)';                                    // clinging shards
      for (let k = 0; k < 4; k++) {
        const bx2 = wx + r() * ww, by2 = wy + (r() < 0.5 ? 0 : wh);
        x.beginPath(); x.moveTo(bx2, by2); x.lineTo(bx2 - 6 - r() * 8, by2 + (by2 > wy ? -1 : 1) * (8 + r() * 14)); x.lineTo(bx2 + 6 + r() * 8, by2); x.fill();
      }
      x.fillStyle = 'rgba(90,120,60,0.5)';                                       // moss creeping inside
      for (let k = 0; k < 6; k++) { const mr2 = 3 + r() * 6; x.beginPath(); x.arc(wx + r() * ww, wy + wh - r() * 12, mr2, 0, 7); x.fill(); }
    } else {
      const tone = GLASS[(r() * GLASS.length) | 0];
      const dg = x.createLinearGradient(0, wy, 0, wy + wh);
      dg.addColorStop(0, tone[0]); dg.addColorStop(1, tone[1]);
      x.fillStyle = dg; x.fillRect(wx, wy, ww, wh);
      // interior shadow under the head of the reveal
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(wx, wy, ww, 6);
      // diagonal sky reflection, varying slope and strength
      if (r() < 0.8) {
        const sl = 0.3 + r() * 0.4, o = r() * 0.5;
        x.fillStyle = `rgba(200,215,220,${0.05 + r() * 0.1})`;
        x.beginPath();
        x.moveTo(wx + ww * o, wy + wh); x.lineTo(wx + ww * (o + sl), wy);
        x.lineTo(wx + ww * (o + sl + 0.18), wy); x.lineTo(wx + ww * (o + 0.18), wy + wh); x.fill();
      }
      // some windows keep curtains / blinds: pale inner band at a random height
      if (r() < 0.3) {
        x.fillStyle = 'rgba(190,180,150,0.18)';
        const ch = wh * (0.25 + r() * 0.4);
        x.fillRect(wx + 2, wy + (r() < 0.6 ? 6 : wh - ch), ww - 4, ch);
      }
    }
    x.fillStyle = '#3c3a33';                                                     // mullions
    x.fillRect(wx + ww / 2 - 2, wy, 3, wh); x.fillRect(wx, wy + wh / 2 - 2, ww, 3);
    // sill with a bright top edge, then rain streaks running down from its ends
    x.fillStyle = 'rgba(200,196,180,0.5)'; x.fillRect(wx - 8, wy + wh + 6, ww + 16, 2);
    x.fillStyle = 'rgba(30,30,26,0.6)'; x.fillRect(wx - 8, wy + wh + 8, ww + 16, 4);
    const nStreak = 1 + (r() * 3 | 0);
    for (let k = 0; k < nStreak; k++) {
      const sx2 = wx - 6 + r() * (ww + 12), sw2 = 2 + r() * 4, sl2 = 14 + r() * 40;
      const sg = x.createLinearGradient(0, wy + wh + 12, 0, wy + wh + 12 + sl2);
      sg.addColorStop(0, `rgba(44,48,40,${0.18 + r() * 0.2})`); sg.addColorStop(1, 'rgba(44,48,40,0)');
      x.fillStyle = sg; x.fillRect(sx2, wy + wh + 12, sw2, sl2);
    }
    // occasional rust bleed from a window-corner fixing
    if (r() < 0.18) {
      const rx2 = r() < 0.5 ? wx - 5 : wx + ww + 2, rl2 = 10 + r() * 26;
      const rg = x.createLinearGradient(0, wy + wh, 0, wy + wh + rl2);
      rg.addColorStop(0, 'rgba(122,72,40,0.4)'); rg.addColorStop(1, 'rgba(122,72,40,0)');
      x.fillStyle = rg; x.fillRect(rx2, wy + wh, 3, rl2);
    }
  }
  for (let cy = 0; cy < BLD_CELLS; cy++) for (let cx = 0; cx < BLD_CELLS; cx++) {
    const px = cx * cell, py = cy * cell, col = cols[cx];
    const lit = r() < 0.16, broken = !lit && r() < 0.10;
    const state = lit ? 'lit' : broken ? 'broken' : 'normal';
    if (col.pier) {
      x.fillStyle = 'rgba(0,0,0,0.06)'; x.fillRect(px + 12, py, cell - 24, cell); // faint pilaster shadow
      if (r() < 0.25) {                                                           // occasional vent grille
        x.fillStyle = '#3f3d36'; x.fillRect(px + cell / 2 - 16, py + 44, 32, 24);
        x.fillStyle = 'rgba(0,0,0,0.4)'; for (let v = 0; v < 5; v++) x.fillRect(px + cell / 2 - 16, py + 48 + v * 5, 32, 2);
        // grime shadow under the grille
        const vg = x.createLinearGradient(0, py + 68, 0, py + 108);
        vg.addColorStop(0, 'rgba(40,42,36,0.28)'); vg.addColorStop(1, 'rgba(40,42,36,0)');
        x.fillStyle = vg; x.fillRect(px + cell / 2 - 14, py + 68, 28, 40);
      }
    } else if (col.panes === 2) {
      const gap = 16, pw = (col.ww - gap) / 2, x0w = px + (cell - col.ww) / 2;
      pane(x0w, py + WY, pw, WH, state); pane(x0w + pw + gap, py + WY, pw, WH, state);
    } else {
      pane(px + (cell - col.ww) / 2, py + WY, col.ww, WH, state);
      if (col.bal) {                                                              // balcony rail across the bay
        x.fillStyle = 'rgba(35,38,32,0.8)'; x.fillRect(px + 8, py + WY + WH + 12, cell - 16, 5);
        for (let b = 0; b < 7; b++) x.fillRect(px + 12 + b * (cell - 24) / 6, py + WY + WH + 12, 2, 13);
      }
    }
    // creeping moss at some cell bottoms
    if (r() < 0.4) {
      for (let k = 0; k < 16; k++) {
        x.fillStyle = `rgba(${60 + r() * 30},${95 + r() * 40},${40 + r() * 20},${0.22 + r() * 0.28})`;
        const mr = 5 + r() * 16;
        x.beginPath(); x.arc(px + r() * cell, py + cell - r() * 24, mr, 0, 7); x.fill();
      }
    }
  }
  // storey slab bands across every floor line: light worn top edge + shadow below.
  // Drawn LAST so they sit over grime/streaks like a real projecting slab edge.
  for (let cy = 0; cy <= BLD_CELLS; cy++) {
    const by = (cy * cell) % S;
    x.fillStyle = 'rgba(205,200,184,0.34)'; x.fillRect(0, by, S, 3);
    x.fillStyle = 'rgba(28,28,24,0.4)'; x.fillRect(0, by + 3, S, 5);
    x.fillStyle = 'rgba(28,28,24,0.14)'; x.fillRect(0, by + 8, S, 5);
  }
  // faint panel joints between bays
  for (let cx2 = 0; cx2 < BLD_CELLS; cx2++) {
    x.fillStyle = 'rgba(30,30,26,0.16)'; x.fillRect(cx2 * cell, 0, 2, S);
  }
  const map = canvasTex(c), emissive = canvasTex(e);
  map.repeat.set(1 / BLD_CELLS, 1 / BLD_CELLS);
  emissive.repeat.set(1 / BLD_CELLS, 1 / BLD_CELLS);
  return { map, emissive };
}

function makeGroundTexture() {
  const S = 512, r = mulberry32(77);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#4e4d46'; x.fillRect(0, 0, S, S);
  // large-scale tonal patches first — worn ground is blotchy before it is grainy
  for (let i = 0; i < 40; i++) {
    const mx = r() * S, my = r() * S, mr = 40 + r() * 140;
    const gg = x.createRadialGradient(mx, my, 1, mx, my, mr);
    const dark = r() < 0.55;
    gg.addColorStop(0, dark ? `rgba(30,31,26,${0.06 + r() * 0.1})` : `rgba(140,136,120,${0.05 + r() * 0.08})`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gg; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  }
  for (let i = 0; i < 5000; i++) {
    x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
    x.fillRect(r() * S, r() * S, 2, 2);
  }
  // old oil / damp stains
  for (let i = 0; i < 8; i++) {
    x.fillStyle = `rgba(18,18,20,${0.1 + r() * 0.12})`;
    x.save(); x.translate(r() * S, r() * S); x.rotate(r() * 7);
    x.beginPath(); x.ellipse(0, 0, 10 + r() * 26, 6 + r() * 14, 0, 0, 7); x.fill(); x.restore();
  }
  // cracks: a pale worn edge beside each dark line makes them read as depth
  for (let i = 0; i < 26; i++) {
    let px = r() * S, py = r() * S;
    const pts = [[px, py]];
    for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 90; py += (r() - 0.5) * 90; pts.push([px, py]); }
    x.strokeStyle = 'rgba(150,146,130,0.3)'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(pts[0][0] + 1, pts[0][1] + 1);
    for (const p of pts) x.lineTo(p[0] + 1, p[1] + 1); x.stroke();
    x.strokeStyle = 'rgba(25,26,22,0.6)'; x.lineWidth = 1.6;
    x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) x.lineTo(p[0], p[1]); x.stroke();
    // grass sprouting from some cracks
    if (r() < 0.5) for (const p of pts) {
      if (r() < 0.4) continue;
      x.fillStyle = `rgba(${70 + r() * 30 | 0},${100 + r() * 40 | 0},${45 + r() * 20 | 0},${0.3 + r() * 0.3})`;
      x.beginPath(); x.arc(p[0], p[1], 2 + r() * 4, 0, 7); x.fill();
    }
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
  // dark under-layer leaves first, lit leaves on top — foliage depth comes from
  // shadowed leaves showing between the bright ones, not from a flat confetti layer
  for (let layer = 0; layer < 2; layer++) {
    const n = layer === 0 ? 130 : 150, shade = layer === 0;
    for (let i = 0; i < n; i++) {
      const hpx = 82 + (r() - 0.5) * 38, s = 38 + r() * 26;
      const l = shade ? 16 + r() * 14 : 40 + r() * 24;
      const rw = 8 + r() * 13, rh = 4 + r() * 6;
      x.save(); x.translate(r() * S, r() * S); x.rotate(r() * 7);
      x.fillStyle = `hsl(${hpx},${s}%,${l}%)`;
      x.beginPath(); x.ellipse(0, 0, rw, rh, 0, 0, 7); x.fill();
      if (!shade) {
        // lit upper half + darker midrib give each leaf a fold
        x.fillStyle = `hsl(${hpx},${s}%,${Math.min(72, l + 12)}%)`;
        x.beginPath(); x.ellipse(0, -rh * 0.3, rw * 0.85, rh * 0.55, 0, 0, 7); x.fill();
        x.strokeStyle = `hsl(${hpx},${s + 8}%,${Math.max(10, l - 18)}%)`; x.lineWidth = 1;
        x.beginPath(); x.moveTo(-rw * 0.8, 0); x.lineTo(rw * 0.8, 0); x.stroke();
      }
      x.restore();
    }
  }
  return canvasTex(c);
}

function makeVineTexture() {
  const W = 256, H = 512, r = mulberry32(909);
  const c = makeCanvas(W, H), x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  for (let s = 0; s < 8; s++) {
    const bx = 14 + s * 32 + r() * 8, amp = 6 + r() * 12, ph = r() * 7;
    // woody stem with a darker shadow line beside it
    x.strokeStyle = 'rgba(24,28,18,0.6)'; x.lineWidth = 6 + r() * 4;
    x.beginPath();
    for (let yy = 0; yy <= H; yy += 8) x.lineTo(bx + 1.5 + Math.sin(yy * 0.03 + ph) * amp, yy);
    x.stroke();
    x.strokeStyle = `rgba(${48 + r() * 22 | 0},${70 + r() * 25 | 0},${34 + r() * 15 | 0},0.95)`;
    x.lineWidth = 3.5 + r() * 3;
    x.beginPath();
    for (let yy = 0; yy <= H; yy += 8) x.lineTo(bx + Math.sin(yy * 0.03 + ph) * amp, yy);
    x.stroke();
    // fine side tendrils curling off the stem
    for (let t = 0; t < 4; t++) {
      const ty = r() * H, dir = r() < 0.5 ? -1 : 1, tl = 10 + r() * 22;
      const tx0 = bx + Math.sin(ty * 0.03 + ph) * amp;
      x.strokeStyle = `rgba(${60 + r() * 25 | 0},${90 + r() * 30 | 0},${45 + r() * 18 | 0},0.8)`;
      x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(tx0, ty);
      x.quadraticCurveTo(tx0 + dir * tl * 0.7, ty + 4, tx0 + dir * tl, ty + 10 + r() * 8);
      x.stroke();
    }
    for (let yy = 6; yy < H; yy += 12 + r() * 14) {
      const lx = bx + Math.sin(yy * 0.03 + ph) * amp;
      const hpx = 85 + (r() - 0.5) * 35, sat = 40 + r() * 25, lig = 34 + r() * 24;
      const rw = 7 + r() * 8, rh = 4 + r() * 4;
      x.save(); x.translate(lx, yy); x.rotate(r() * 7);
      x.fillStyle = `hsl(${hpx},${sat}%,${lig}%)`;
      x.beginPath(); x.ellipse(0, 0, rw, rh, 0, 0, 7); x.fill();
      x.fillStyle = `hsl(${hpx},${sat}%,${Math.min(70, lig + 11)}%)`;   // lit half
      x.beginPath(); x.ellipse(0, -rh * 0.3, rw * 0.8, rh * 0.5, 0, 0, 7); x.fill();
      x.strokeStyle = `hsl(${hpx},${sat}%,${Math.max(12, lig - 16)}%)`; x.lineWidth = 1;
      x.beginPath(); x.moveTo(-rw * 0.75, 0); x.lineTo(rw * 0.75, 0); x.stroke();
      x.restore();
    }
  }
  return canvasTex(c);
}

function makeGrassTexture() {
  const S = 256, r = mulberry32(303);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  for (let i = 0; i < 100; i++) {
    const bx = r() * S, h = 90 + r() * 150, bend = (r() - 0.5) * 70, w = 5 + r() * 7;
    // ~1 in 6 blades dried out; the rest green with a brighter edge stroke
    const dry = r() < 0.16;
    const hpx = dry ? 52 + r() * 12 : 80 + (r() - 0.5) * 30;
    const sat = dry ? 38 + r() * 15 : 42 + r() * 25;
    const lig = dry ? 38 + r() * 18 : 30 + r() * 22;
    x.fillStyle = `hsl(${hpx},${sat}%,${lig}%)`;
    x.beginPath();
    x.moveTo(bx - w / 2, S);
    x.quadraticCurveTo(bx + bend * 0.3, S - h * 0.6, bx + bend, S - h);
    x.quadraticCurveTo(bx + bend * 0.3 + w * 0.4, S - h * 0.6, bx + w / 2, S);
    x.fill();
    // lit edge along one side of the blade
    x.strokeStyle = `hsl(${hpx},${sat}%,${Math.min(72, lig + 16)}%)`; x.lineWidth = 1.4;
    x.beginPath();
    x.moveTo(bx - w / 2, S);
    x.quadraticCurveTo(bx + bend * 0.3, S - h * 0.6, bx + bend, S - h);
    x.stroke();
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
// Morning puddles (Little details): a dark, wet-looking material shared across all chunks.
// Its opacity is driven by the "dew" factor in updateSky (high at dawn, gone by noon), so the
// batched puddle discs simply fade in and out with the time of day — like matGlow's emissive.
const matPuddle = new THREE.MeshStandardMaterial({
  vertexColors: true, transparent: true, opacity: 0, roughness: 0.12, metalness: 0.35,
  depthWrite: false, side: THREE.DoubleSide
});
// Cobwebs (Little details): one shared pale, faintly translucent material for corner webs.
const matWeb = new THREE.MeshBasicMaterial({
  vertexColors: true, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide
});
const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texLeaf, alphaTest: 0.45 });
// Still, dark reservoir water — one extra plane mesh per reservoir chunk (Anomalies).
// Water: blue with a procedural ripple texture. UVs on each water plane are scaled
// so one texture tile ≈ 4 m regardless of the plane's size (see scaleWaterUVs).
function makeWaterTexture(seed) {
  const S = 256, r = mulberry32(seed || 4242);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, '#2b6f8e'); g.addColorStop(0.5, '#1f5a78'); g.addColorStop(1, '#2b6f8e');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // deeper patches
  for (let i = 0; i < 22; i++) {
    const mx = r() * S, my = r() * S, mr = 20 + r() * 60;
    const gg = x.createRadialGradient(mx, my, 1, mx, my, mr);
    gg.addColorStop(0, `rgba(10,42,64,${0.15 + r() * 0.2})`); gg.addColorStop(1, 'rgba(10,42,64,0)');
    x.fillStyle = gg; x.beginPath(); x.arc(mx, my, mr, 0, 7); x.fill();
  }
  // ripple crests: wandering near-horizontal pale strokes with a dark shadow twin
  for (let i = 0; i < 60; i++) {
    const yy = r() * S, ph = r() * 7, amp = 2 + r() * 4, len = 60 + r() * 160, x0 = r() * S;
    for (const [dy, col, lw] of [[1.6, `rgba(8,34,50,${0.2 + r() * 0.2})`, 2.2], [0, `rgba(170,215,235,${0.16 + r() * 0.22})`, 1.4]]) {
      x.strokeStyle = col; x.lineWidth = lw;
      x.beginPath();
      for (let t = 0; t <= len; t += 8) x.lineTo(x0 + t, yy + dy + Math.sin(t * 0.05 + ph) * amp);
      x.stroke();
    }
  }
  // sun glints
  for (let i = 0; i < 130; i++) {
    x.fillStyle = `rgba(210,235,245,${0.1 + r() * 0.25})`;
    x.fillRect(r() * S, r() * S, 1 + r() * 3, 1);
  }
  return canvasTex(c);
}
// Living water (Feature A): two counter-drifting ripple layers give the canals an
// interference shimmer that reads as slow flow. Layer 1 (texWater) is the opaque-ish
// blue body carried by matWater; layer 2 (texWater2) is a fainter transparent sheet
// 0.02 m above it, tiled a little coarser so the two grids beat against each other.
// updateSky (worldgen-chunks.js) drifts both offsets and drives matWater's noon
// emissive sparkle; the texture consts below are read from there.
const texWater = makeWaterTexture(4242);
const texWater2 = makeWaterTexture(1379);
const matWater = new THREE.MeshStandardMaterial({
  map: texWater, color: srgb(0x9fc8d8), transparent: true, opacity: 0.82,
  roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
  emissive: srgb(0xbfe0f2), emissiveIntensity: 0                              // sky-blue noon sparkle, driven per frame
});
const matWater2 = new THREE.MeshStandardMaterial({
  map: texWater2, color: srgb(0xa8cfe0), transparent: true, opacity: 0.35,
  roughness: 0.14, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
  blending: THREE.NormalBlending
});
// Scale a water plane's UVs so the ripple texture tiles at ~`tile` m (default 4, RepeatWrapping).
function scaleWaterUVs(geo, worldW, worldH, tile) {
  tile = tile || 4;
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * worldW / tile, uv.getY(k) * worldH / tile);
  uv.needsUpdate = true;
}

// Sky nets (Feature B): a woven rope grid on a transparent ground — the aerial jungle
// strung between crowns. Dark hemp-brown double strands running both diagonals at ~14 px
// spacing, lighter highlight along each rope, a few snapped strands and caught leaves.
// alphaTest so the holes read as open sky; DoubleSide, rough, no shine.
function makeNetTexture() {
  const S = 256, sp = 14, r = mulberry32(6161);
  const c = makeCanvas(S, S), x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  // draw one rope as a dark strand with a thin lighter highlight offset along it
  function rope(x0, y0, x1, y1, broken) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    const cut = broken ? 0.3 + r() * 0.4 : 1;              // snapped strands stop partway
    const ex = x0 + dx * cut, ey = y0 + dy * cut;
    x.strokeStyle = `rgba(${44 + r() * 16 | 0},${32 + r() * 14 | 0},${20 + r() * 10 | 0},0.95)`;
    x.lineWidth = 3.2; x.beginPath(); x.moveTo(x0, y0); x.lineTo(ex, ey); x.stroke();
    x.strokeStyle = `rgba(${120 + r() * 30 | 0},${96 + r() * 24 | 0},${64 + r() * 18 | 0},0.7)`;
    x.lineWidth = 1.1; x.beginPath(); x.moveTo(x0 + nx, y0 + ny); x.lineTo(ex + nx, ey + ny); x.stroke();
  }
  // two diagonal families across a wrapped field (so tiling stays seamless)
  for (let d = -S; d < S * 2; d += sp) {
    rope(d, 0, d + S, S, r() < 0.06);          // ╲ strands
    rope(d + S, 0, d, S, r() < 0.06);          // ╱ strands
  }
  // a handful of caught leaves snagged in the mesh
  for (let i = 0; i < 22; i++) {
    const lx = r() * S, ly = r() * S, rw = 5 + r() * 7, rh = 3 + r() * 4;
    const hpx = 80 + (r() - 0.5) * 40, sat = 34 + r() * 24, lig = 26 + r() * 20;
    x.save(); x.translate(lx, ly); x.rotate(r() * 7);
    x.fillStyle = `hsl(${hpx},${sat}%,${lig}%)`;
    x.beginPath(); x.ellipse(0, 0, rw, rh, 0, 0, 7); x.fill();
    x.strokeStyle = `hsl(${hpx},${sat}%,${Math.max(10, lig - 14)}%)`; x.lineWidth = 1;
    x.beginPath(); x.moveTo(-rw * 0.8, 0); x.lineTo(rw * 0.8, 0); x.stroke();
    x.restore();
  }
  return canvasTex(c);
}
const texNet = makeNetTexture();
const matNet = new THREE.MeshStandardMaterial({
  map: texNet, vertexColors: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 1, metalness: 0
});

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
const tplBoxC = new THREE.BoxGeometry(1, 1, 1);   // centered (for tilted slabs / decks)
const tplCyl = new THREE.CylinderGeometry(1, 1, 1, 8); tplCyl.translate(0, 0.5, 0);
const tplWheel = new THREE.CylinderGeometry(1, 1, 1, 8); tplWheel.rotateX(Math.PI / 2);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _pv = new THREE.Vector3(), _e = new THREE.Euler();
function compose(x, y, z, sx, sy, sz, rx, ry, rz) {
  _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
  _pv.set(x, y, z); _s.set(sx, sy, sz);
  return _m4.compose(_pv, _q, _s);
}

/* ---- lit-lamp overlays (lamplighter mission) --------------------------------
   matLamp's emissiveIntensity is driven by the sky every frame (~0 at dusk), so
   a re-lit lamp needs its own constant glow. A small pool of hidden blobs is
   parked at lamp heads on demand — batched geometry can't be toggled in place. */
const matLampLit = new THREE.MeshStandardMaterial({ emissive: srgb(0xffe0b0), emissiveIntensity: 2.4, color: 0x1a1a14, roughness: 0.6, metalness: 0 });
const LAMP_POOL = Array.from({ length: 8 }, () => {
  const m = new THREE.Mesh(tplBlob, matLampLit); m.scale.setScalar(0.4); m.visible = false; scene.add(m); return m;
});

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

// Height-graded foliage tint (Phase 3): the same base leaf colour reads deeper/darker
// green down in the shaded lower canopy and sun-bleached (brighter, a touch yellower)
// up in the crowns — so the strata separate when you look straight up from the street.
// Cheap: a per-blob vertex-colour lerp picked at emission time by the blob's world y.
// Returns a fresh Color (safe to hand to addGeo, which reads r/g/b).
function leafTintByY(base, y) {
  const t = smooth(8, 38, y);                               // 0 street canopy · 1 emergent crowns
  return _c.copy(base).multiplyScalar(0.80 + 0.42 * t)      // darker low → brighter high
    .lerp(COL.leafDry, t * 0.14).clone();                  // faint sun-bleach up top
}

/* ----------------------------------------------------------- city naming -- */
const NAME_A = ['Moss', 'Fern', 'Ivy', 'Bramble', 'Kudzu', 'Willow', 'Cedar', 'Banyan', 'Lichen', 'Sorrel', 'Alder', 'Rowan', 'Verdan', 'Hollow', 'Arbor', 'Tendril'];
const NAME_B = [' Row', ' Gate', ' Yards', ' Hollow', ' Cross', ' Terrace', ' Quarter', ' Reach', ' Steps', ' Court', 'field', ' Rise'];
// Districts (Phase B): per-style suffix flavour, biased in ~55% of chunks so a
// neighbourhood's name hints at its architecture. Deterministic on its own salt.
const NAME_STYLE = {
  works: [' Foundry', ' Mill', ' Yards', ' Works'],
  garden: [' Gardens', ' Lanes', ' Green', ' Orchard'],
  glass: [' Heights', ' Crown', ' Spires', ' Vista'],
  oldtown: [' Old Quarter', ' Steps', ' Lane', ' Wynd'],
  blocks: [' Estates', ' Blocks', ' Court', ' Terrace'],
};
function districtName(ix, iz) {
  if (ix === SPIRE.cx && iz === SPIRE.cz) return 'The Spire';
  const a = NAME_A[hash2(ix, iz, 7) % NAME_A.length];
  const pool = NAME_STYLE[districtStyle(ix, iz)];
  if (pool && hash2(ix, iz, 21) % 100 < 55) return a + pool[hash2(ix, iz, 23) % pool.length];
  return a + NAME_B[hash2(ix, iz, 13) % NAME_B.length];
}

