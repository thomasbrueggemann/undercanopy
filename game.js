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
const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: texLeaf, alphaTest: 0.45 });
// Still, dark reservoir water — one extra plane mesh per reservoir chunk (Anomalies).
const matWater = new THREE.MeshStandardMaterial({ color: srgb(0x123a34), transparent: true, opacity: 0.78, roughness: 0.18, metalness: 0.15, side: THREE.DoubleSide, depthWrite: false });

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

/* ======================================================================== */
/*  CHUNK GENERATION                                                        */
/* ======================================================================== */
function chunkType(ix, iz) {
  if (ix === SPIRE.cx && iz === SPIRE.cz) return 'spire';
  // Anomalies — rare landmark chunk types decided on their own salt so they override the
  // common types (never the spire) at fixed rates while leaving city/park/etc. dominant.
  const rr = hash2(ix, iz, 5150) / 4294967296;
  if (rr < 0.025) return 'colossus';        // ~1/40
  if (rr < 0.065) return 'fallen';          // ~1/25
  if (rr < 0.105) return 'sinkhole';        // ~1/25
  if (rr < 0.145) return 'reservoir';       // ~1/25
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
  // Crown Nest on grove giants — reached by climbing the full-height trunk (h)
  if ((opts.trunkR || 0) >= 1.9 && h >= 32 && rng() < 0.75)
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
  const placed = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const gx = ix * N + i, gz = iz * N + j;
    const h = hash2(gx, gz, 4242);
    const edge = (i === 0 || j === 0 || i === N - 1 || j === N - 1);   // over the street borders
    if (norm(h) > (edge ? 0.30 : 0.60)) continue;        // else: a light well — dappled, sky through
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
  // thin lattice limbs weaving between nearby platters — visual intertwining, no pads
  for (let k = 0; k < placed.length; k++) {
    if (rng() < 0.55) continue;
    let best = null, bd = 1e9;
    for (let m = 0; m < placed.length; m++) {
      if (m === k) continue;
      const d = Math.hypot(placed[m].x - placed[k].x, placed[m].z - placed[k].z);
      if (d > 6 && d < bd) { bd = d; best = placed[m]; }
    }
    if (best && bd < 18)
      addLimb(B, colData, rng, placed[k].x, placed[k].y - 0.4, placed[k].z, best.x, best.y - 0.4, best.z, 0.18, { noPads: true, segs: 3, sag: 0.5 });
  }
  // Vine ropes: 2–4 climbable verticals hanging from platter undersides straight down
  // to whatever rooftop lies beneath (else the ground). Placed at platter centres so a
  // climber topping out lands cleanly on the platter's walkable pad.
  let ropes = 0;
  const maxRopes = 2 + (rng() * 3 | 0);                  // 2..4
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
  const col = rng() < 0.5 ? COL.grassA : COL.grassB;
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
  const low = (y0 <= 0.02) ? mossy : tint;         // moss creep only at true ground level
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
    const ax = houseWall[0], az = houseWall[1];
    B.plain.addGeo(tplCyl, segMat(ax, ly, az, px, ly, pz, 0.02), COL.wire, 0, rng);
    const nCloth = 2 + (rng() * 2 | 0);
    for (let k = 0; k < nCloth; k++) {
      const t = 0.25 + rng() * 0.5, hx = lerp(ax, px, t), hz = lerp(az, pz, t);
      const cw = 0.4 + rng() * 0.3, ch = 0.5 + rng() * 0.4;
      const col = _c.copy(AWNING_COLS[(rng() * AWNING_COLS.length) | 0]).lerp(srgb(0xffffff), 0.4).clone();
      B.plain.quad([hx - cw / 2, ly - ch, hz], [hx + cw / 2, ly - ch, hz], [hx + cw / 2, ly, hz], [hx - cw / 2, ly, hz], [0, 0, 1, 1], col);
    }
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
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const pool = STYLE_TINTS[style] || FACADE_TINTS;
  const tint = pool[(rng() * pool.length) | 0].clone().multiplyScalar(0.82 + rng() * 0.26);
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
  if (!opts.noTier && !opts.noRuin && !tiered && style !== 'glass' && rng() < 0.12) {
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
    if (roofType === 'gable') { addGableRoof(B, x0, z0, x1, z1, h, roofCol, tint); }
    else if (roofType === 'hip') { addPyramidRoof(B, x0, z0, x1, z1, h, roofCol); }
    else if (roofType === 'saw') { B.plain.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 0, 1, 1], roofCol); addSawtoothRoof(B, x0, z0, x1, z1, h, roofCol, rng); }
    else { B.plain.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 0, 1, 1], roofCol); }
  }
  // vines on some faces (weighted per district: heavy oldtown/works/garden, light glass/blocks)
  const hasVines = opts.vines !== undefined ? opts.vines : rng() < clamp(0.92 * cfg.vine, 0, 0.98);
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
  if (h > 20 && rng() < 0.25) addSpiralLimb(B, colData, rng, cx, cz, w, d, h);
  if (h >= 30 && h <= 46 && rng() < 0.3) addCrownNest(B, colData, rng, cx, cz, h, 2.5 + rng() * 1.3);
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
  const working = rng() < 0.55;                       // rng-neutral: same single draw from the stream
  if (working) B.lamp.addGeo(tplBox, head, srgb(0xfff1cf), 0, rng);
  else B.plain.addGeo(tplBox, head, COL.wire, 0, rng);
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
  colData.solids.push({ x0: x - 1.6, z0: z - 1.3, x1: x + 1.6, z1: z + 1.3, h: 0.9, vine: false });
}

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
  addBuilding(B, colData, mini, rng, sx, sz, w, d, h, { vines: true, allSides: true, garden: false, style: 'blocks', noTier: true });
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
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(2 * half - wt, 2 * half - wt), matWater);
  wm.rotation.x = -Math.PI / 2; wm.position.set(cx, waterY, cz); wm.matrixAutoUpdate = false; wm.updateMatrix();
  extra.push(wm);
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

function buildChunk(ix, iz) {
  const rng = mulberry32(hash2(ix, iz, 999));
  const type = chunkType(ix, iz);
  const style = districtStyle(ix, iz);        // Districts (Phase A): architectural identity
  CUR_STYLE = style;                          // addBuilding reads this unless opts.style given
  const ox = ix * CHUNK, oz = iz * CHUNK;
  const B = { plain: new Batch(), bld: new Batch(), leaf: new Batch(), vine: new Batch(), grass: new Batch(), glow: new Batch(), lamp: new Batch() };
  const colData = { solids: [], trunks: [], pads: [], lamps: [], pits: [], waters: [], chimes: [], ferns: [] };
  const mini = { rects: [], trees: [], type };
  const extraMeshes = [];   // non-batched meshes (e.g. reservoir water plane)
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
      wireSpan(B, P[k][0], 6.7, P[k][1], P[k + 1][0], 6.7, P[k + 1][1], 0.7 + rng() * 0.5, rng);
      wireSpan(B, P[k][0], 6.35, P[k][1], P[k + 1][0], 6.35, P[k + 1][1], 0.6 + rng() * 0.5);   // lower wire kept bare
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
      while (t < L - 5) {
        // per-district footprint: garden leaves yard gaps between small detached houses
        const dm = bldDims(style, rng, rng() < 0.15);
        const gap = style === 'garden' ? 3 + rng() * 3 : 0.6 + rng() * 0.6;
        const along = Math.min(dm.w, L - t - 0.6);
        const w2 = along + gap;
        if (along < 5) break;
        const depth = dm.d;
        const center = INSET + t + along / 2;
        if (rng() < (style === 'works' ? 0.9 : 0.84)) {
          const h = dm.h;
          let bx, bz, bw, bd;
          if (side === 0) { bx = ox + center; bz = oz + INSET + depth / 2; bw = along; bd = depth; }
          else if (side === 1) { bx = ox + center; bz = oz + CHUNK - INSET - depth / 2; bw = along; bd = depth; }
          else if (side === 2) { bx = ox + INSET + depth / 2; bz = oz + center; bw = depth; bd = along; }
          else { bx = ox + CHUNK - INSET - depth / 2; bz = oz + center; bw = depth; bd = along; }
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
  } else if (type === 'colossus') {
    addColossus(B, colData, mini, rng, ox, oz);
  } else if (type === 'fallen') {
    addFallen(B, colData, mini, rng, ox, oz);
  } else if (type === 'sinkhole') {
    addSinkhole(B, colData, mini, rng, ox, oz);
  } else if (type === 'reservoir') {
    addReservoir(B, colData, mini, rng, ox, oz, extraMeshes);
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
  const nGrass = type === 'park' ? 230 : type === 'grove' ? 162 : type === 'plaza' ? 80 : 135;
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
  const nGlow = 5 + (rng() * 6 | 0);
  for (let k = 0; k < nGlow; k++) {
    if (mini.trees.length === 0) break;
    const t = mini.trees[(rng() * mini.trees.length) | 0];
    const a = rng() * Math.PI * 2, d = 1 + rng() * 2.5;
    addGlowPlant(B, rng, t[0] + Math.cos(a) * d, t[1] + Math.sin(a) * d, 0.25 + rng() * 0.3);
  }

  /* ---- multi-layered canopy (Phase 1): L1 bough roads + L2 weave ---- */
  addBoughRoads(B, colData, rng, ox, oz, type);
  addWeave(B, colData, rng, ix, iz, ox, oz, type);

  /* ---- Anomalies (Phase A): the Elevated Line viaduct along rare grid lines ---- */
  addViaduct(B, colData, mini, rng, ix, iz, ox, oz);

  /* ---- Anomalies (Phase B): Tier 3 oddities sprinkled at low rates ---- */
  addOddities(B, colData, rng, ix, iz, ox, oz, type);

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
  for (const m of extraMeshes) group.add(m);
  return { ix, iz, group, colData, mini, openRect, type, style, name: districtName(ix, iz) };
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
/*  PEOPLE — cloaked citizens of the canopy                            */
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
  } else if (role === 'trialmaster') {
    // a tall carved staff held upright, topped with a glowing crystal orb — a distinct silhouette
    const staff = new THREE.Mesh(tplCyl, npcWoodMat); staff.scale.set(0.035, 2.0, 0.035); staff.position.set(0.34, 0, 0.06);
    const orb = new THREE.Mesh(tplBlob, npcLanternMat); orb.scale.setScalar(0.13); orb.position.set(0.34, 2.05, 0.06);
    g.add(staff, orb); anim = orb;
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
  if (npc === giver) giver = null;   // a giver culled at range: drop it, redesignate later
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
    if (n === giver) {
      // a mission-giver stands its ground and faces you until you accept or leave
      n.faceYaw = Math.atan2(player.pos.x - n.g.position.x, player.pos.z - n.g.position.z);
    } else if (n.role === 'walk' || n.role === 'lantern') {
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
  grounded: false, climbing: false, onCanopy: false, supportLayer: null,
  heat: 0, exposed: false, inPit: false, inWater: false,
  bob: 0, stride: 0,
  airPeakY: 0, stagger: 0, shake: 0, blackout: false, blackouts: 0
};
let lastShade = player.pos.clone();
// Permanent sprint boost, awarded after golding all five Trials (persisted).
let sprintBoost = false;
try { sprintBoost = localStorage.getItem('canopy.sprintboost') === '1'; } catch (e) { }
const keys = {};
let locked = false, started = false;

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyM') toggleAudio();
  if (e.code === 'KeyF' && started) { flashOn = !flashOn; hint(flashOn ? 'flashlight on' : 'flashlight off', 1.2); }
  if (e.code === 'KeyR' && started) { player.pos.copy(lastShade); player.vel.set(0, 0, 0); player.heat = Math.min(player.heat, 40); }
  if (e.code === 'KeyE' && started) {
    const tm = (typeof nearestTrialMaster === 'function') ? nearestTrialMaster(3.4) : null;
    if (tm && !trial) { offerTrial(tm); }
    else if (giver && !activeMission && !trial &&
        Math.hypot(giver.g.position.x - player.pos.x, giver.g.position.z - player.pos.z) < 3.4) acceptMission(giver.giverArch);
  }
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
  out.solids.length = 0; out.trunks.length = 0; out.pads.length = 0; out.pits.length = 0; out.waters.length = 0;
  const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const c = chunks.get(chunkKey(cx + dx, cz + dz));
    if (!c) continue;
    for (const s of c.colData.solids) out.solids.push(s);
    for (const t of c.colData.trunks) out.trunks.push(t);
    for (const p of c.colData.pads) out.pads.push(p);
    for (const pit of c.colData.pits) out.pits.push(pit);
    for (const w of c.colData.waters) out.waters.push(w);
  }
}
const nearby = { solids: [], trunks: [], pads: [], pits: [], waters: [] };

function stepPlayer(dt) {
  const p = player;
  const feet = () => p.pos.y;
  const wasGrounded = p.grounded, wasClimbing = p.climbing;

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
  const sprintF = (keys.ShiftLeft || keys.ShiftRight) ? SPRINT * (sprintBoost ? 1.1 : 1) : 1;   // Trials reward: +10% sprint
  const speed = WALK * sprintF * (p.inWater ? 0.35 : 1) * (p.stagger > 0 ? 0.45 : 1);   // wading is slow; a hard landing staggers
  if (p.stagger > 0) p.stagger = Math.max(0, p.stagger - dt);
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
  // Sinkhole: inside a pit radius the ground drops to the pit floor (below y=0), so the
  // base support and the hard floor clamp both follow the pit depth instead of 0.
  let groundY = 0; p.inPit = false;
  for (const pit of nearby.pits) {
    const dx = p.pos.x - pit.x, dz = p.pos.z - pit.z;
    if (dx * dx + dz * dz < pit.r * pit.r) { groundY = Math.min(groundY, -pit.depth); p.inPit = true; }
  }
  let support = groundY; p.onCanopy = false;
  let supportIsCanopy = false, supportLayer = null;
  for (const s of nearby.solids) {
    if (p.pos.x < s.x0 - 0.2 || p.pos.x > s.x1 + 0.2 || p.pos.z < s.z0 - 0.2 || p.pos.z > s.z1 + 0.2) continue;
    if (feet() >= s.h - 1.0 && feet() <= s.h + 0.6 && s.h > support) { support = s.h; supportIsCanopy = false; supportLayer = null; }
  }
  for (const pad of nearby.pads) {
    const dx = p.pos.x - pad.x, dz = p.pos.z - pad.z;
    if (dx * dx + dz * dz > pad.r * pad.r) continue;
    if (feet() >= pad.y - 1.3 && feet() <= pad.y + 0.6 && pad.y > support) { support = pad.y; supportIsCanopy = true; supportLayer = pad.layer || null; }
  }
  p.grounded = false;
  if (p.vel.y <= 0.01 && feet() <= support + 0.02) {
    p.pos.y = support; p.vel.y = 0; p.grounded = true; p.onCanopy = supportIsCanopy; p.supportLayer = supportLayer;
  }
  if (p.pos.y < groundY) { p.pos.y = groundY; p.vel.y = 0; p.grounded = true; }

  // --- reservoir water: feet inside a water rect and near the surface ---
  p.inWater = false;
  for (const w of nearby.waters) {
    if (p.pos.x > w.x0 && p.pos.x < w.x1 && p.pos.z > w.z0 && p.pos.z < w.z1 && feet() >= w.y - 1 && feet() <= w.y + 0.3) { p.inWater = true; break; }
  }

  // --- fall damage: track the apex since leaving the ground, resolve the drop on landing ---
  if (p.grounded || p.climbing) {
    p.airPeakY = p.pos.y;                       // on the ground / on a vine → no accumulating fall
  } else {
    if (p.pos.y > p.airPeakY) p.airPeakY = p.pos.y;
  }
  if (p.grounded && !wasGrounded && !wasClimbing) {   // the frame we touch down after being airborne
    handleLanding(p.airPeakY - p.pos.y);
    p.airPeakY = p.pos.y;
  }

  // --- head bob & footsteps ---
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  if (p.grounded && hSpeed > 0.6) {
    p.bob += dt * hSpeed * 1.7;
    const strideNow = Math.floor(p.bob / Math.PI);
    if (strideNow !== p.stride) { p.stride = strideNow; sfxStep(); }
  }
  const bobY = (p.grounded ? Math.sin(p.bob * 2) * 0.042 * Math.min(1, hSpeed / 4) : 0);

  camera.position.set(p.pos.x, p.pos.y + EYE + bobY, p.pos.z);
  if (p.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * p.shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * p.shake * 0.4;
    camera.position.z += (Math.random() - 0.5) * p.shake * 0.4;
    p.shake = Math.max(0, p.shake - dt * 2.6);
  }
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');

  return climbNormal;
}

/* ---- fall consequences -----------------------------------------------------
   Leaf layers (the Weave, crown nests, boughs, tree-canopy pads) and water always
   catch you. Hard ground / roofs / the viaduct deck / streets hurt: a 7–10 m drop
   staggers; over 10 m blacks you out — you wake in the last shade, hotter, and any
   Trial or errand in progress is lost. Normal jumps (a 3 m wall ≈ 4 m drop) are free. */
const SAFE_LEAF = { weave: 1, nest: 1, bough: 1 };   // + tree-canopy pads (onCanopy, no layer tag)
function handleLanding(drop) {
  const p = player;
  if (drop < 7) return;                                          // ordinary hop — nothing happens
  const soft = p.inWater || (p.onCanopy && (p.supportLayer === null || SAFE_LEAF[p.supportLayer]));
  if (soft) {
    if (p.inWater) msg('You crash down into the water — it swallows the fall.', 4);
    else { msg('Leaves burst and give — the forest catches you.', 4); p.shake = Math.min(0.5, drop * 0.03); }
    return;
  }
  if (drop <= 10) {                                              // hard but survivable
    p.stagger = 1.1; p.shake = 0.55;
    msg('You hit hard and stagger, legs jarred by the landing.', 4);
    return;
  }
  blackout('The ground came up fast. Everything went dark.');   // > 10 m onto something hard
}
function blackout(line) {
  const p = player;
  if (p.blackout) return;                                        // already fading — don't stack
  p.blackout = true; p.blackouts++;
  fadeEl.style.opacity = 1;
  if (trial) failTrial('fell', 'You fell. The trial is lost.');
  else if (activeMission) failMission('You fell hard, and the errand with it.');
  setTimeout(() => {
    p.pos.copy(lastShade); p.vel.set(0, 0, 0);
    p.heat = clamp(p.heat + 25, 0, 100);
    p.airPeakY = p.pos.y; p.grounded = true; p.shake = 0; p.stagger = 0;
    if (line) msg(line + ' You wake in the shade, aching.', 6);
    fadeEl.style.opacity = 0;
    p.blackout = false;
  }, 850);
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
  const deepPit = p.inPit && p.pos.y < -1;                   // down in the sinkhole bowl = deep shade
  if (deepPit) p.exposed = false;
  const airBase = lerp(27, 46, dayF);
  let air = airBase + (p.exposed ? 11 : 0) - clamp((p.pos.y - 40) * 0.04, 0, 3);
  if (deepPit) air -= 6;                                     // cooler at the bottom
  if (p.exposed && dayF > 0.05) p.heat += dayF * dt * 2.6;   // ~40 s to overheat at high noon
  else {
    let drain = 7;                                           // base shade drain
    if (deepPit) drain = 14;                                 // ~2× in the pit
    if (p.inWater) drain = 28;                               // ~4× wading in cool water
    p.heat -= dt * drain;
  }
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
/*  MISSIONS — small errands the under-dwellers ask of you                  */
/* ======================================================================== */
const ARCH = { VANTAGE: 'vantage', SUNRUN: 'sun-run', LAMP: 'lamplighter', ERRAND: 'errand' };
let activeMission = null;         // the one accepted mission, or null
let activeObjective = SPIRE;      // where the minimap ✦ points (the Spire until a mission overrides)
let giver = null;                 // an NPC promoted to mission-giver (pre-accept only), or null
const doneVantages = new Set();   // "rx,rz" of summited peaks — stay pinned on the minimap
let missionsDone = 0;
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
const TRIAL = { COURIER: 'courier', TRACK: 'track', ASCENT: 'ascent', SALVAGE: 'salvage', FREEFALL: 'freefall' };
const TRIAL_ORDER = [TRIAL.COURIER, TRIAL.TRACK, TRIAL.ASCENT, TRIAL.SALVAGE, TRIAL.FREEFALL];
const TRIAL_NAME = { courier: 'Sun Courier', track: 'Track Runner', ascent: 'The Ascent', salvage: 'Night Salvage', freefall: 'Freefall Faith' };
const TIERS = ['bronze', 'silver', 'gold'];
const TIER_MULT = { bronze: 1.35, silver: 1.15, gold: 1.0 };   // timer multipliers — bronze is generous
const SPRINT_EFF = () => WALK * SPRINT * (sprintBoost ? 1.1 : 1);   // top ground speed, m/s

let trial = null;                                 // the one active trial, or null
let trialProgress = {};                           // { trialId: bestTierIndex }
try { trialProgress = JSON.parse(localStorage.getItem('canopy.trials') || '{}') || {}; } catch (e) { trialProgress = {}; }
function saveTrials() { try { localStorage.setItem('canopy.trials', JSON.stringify(trialProgress)); } catch (e) { } }
function tierIndexDone(id) { return (id in trialProgress) ? trialProgress[id] : -1; }
function nextTierIndex(id) { return Math.min(2, tierIndexDone(id) + 1); }   // bronze→silver→gold, then repeat gold
function trialUnlocked(i) { return i === 0 || tierIndexDone(TRIAL_ORDER[i - 1]) >= 0; }   // ordered gating

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

/* ---- which trials can start right now? ---- */
function trialFeasible(id) {
  if (id === TRIAL.COURIER) return true;                          // a far rooftop can always be computed
  if (id === TRIAL.TRACK) return !!nearestViaduct(2);
  if (id === TRIAL.ASCENT) return true;                           // colossus, else the Spire
  if (id === TRIAL.SALVAGE) return dayF < 0.35 && !!nearestChunkOfType('sinkhole', 8);
  if (id === TRIAL.FREEFALL) return !!highCanopyStart();
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
  if (p.heat >= 98 && p.exposed) { failTrial('heat', 'The sun took you mid-trial — you fold and stagger for the shade.'); return; }

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
let summited = false;
let gHold = 0;

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
      doneVantages.add(Math.round(SPIRE.x) + ',' + Math.round(SPIRE.z));
      msg('The Spire. From here the green goes to every horizon — the city is a forest, and the forest is the world now.', 10, true);
      setTimeout(() => msg('Outside the canopy it is 54 °C. There is nowhere to escape to. Head back down — home is under the leaves.', 9, true), 10500);
      if (activeMission && activeMission.arch === ARCH.VANTAGE && Math.round(activeMission.target.x) === Math.round(SPIRE.x)) completeMission();
    }
    if (!seen.spirenear && Math.hypot(player.pos.x - SPIRE.x, player.pos.z - SPIRE.z) < 26 && player.pos.y < 4)
      once('spirenear', () => hint('The old broadcast Spire — vines cover every wall. Climb.', 6));

    if (!SHOT) updateMissions(dt, time);   // give / advance the current errand (never in screenshot mode)
    if (!SHOT) updateTrials(dt, time);     // trial-masters, active trial timing & markers

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
    districtEl.textContent = c ? c.name : '—';
    airEl.textContent = Math.round(air);
    altEl.textContent = Math.round(player.pos.y);
    coverEl.textContent = player.inWater ? 'in water' : player.exposed ? 'IN THE SUN' : (player.inPit && player.pos.y < -1) ? 'deep shade' : 'shaded';
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
