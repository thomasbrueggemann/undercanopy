# Tasks — fix-skyhouse-roof-interiors

## 1. Interior faces in addGableRoof

- [x] 1.1 Add optional trailing `opts` parameter to `addGableRoof(B, x0, z0, x1, z1, y, roofCol, gableCol, opts)` (worldgen-builders.js:642). When `opts && opts.interior`, after the existing 4 exterior faces emit the same 4 faces with reversed vertex order (swap the winding so normals point inward/down) using ceiling tints `roofCol × 0.55` and `gableCol × 0.55` (clone via the `_c.copy(...).multiplyScalar(...).clone()` idiom). Both `w >= d` and `w < d` branches. NO rng draws inside `addGableRoof` (RNG discipline — it is called mid-stream by building generation). Add a function comment noting `interior` is for enterable/open structures only.
- [x] 1.2 Verify the other `addGableRoof` call sites (building roofs worldgen-builders.js:~1114, hamlet hut worldgen-anomalies.js:~755) pass no `opts` and are unchanged. `node --check worldgen-builders.js`.

## 2. Skyhouse opts in + carpentry

- [x] 2.1 In `addWaytree` (worldgen-builders.js:~1497), call `addGableRoof(..., { interior: true })`.
- [x] 2.2 Still in `addWaytree`, after the roof: add a ridge beam (thin `tplBoxC` box along the ridge line at `roofY + rh`, using the existing `rh` local at line ~1500, color `COL.wood × 0.85`) and 3 rafter pairs — for each of 3 positions along the ridge axis, two thin boxes running from eave (`roofY`, at the rim) up to the ridge (`roofY + rh`, at the centre line), one per slope, placed just under the roof plane (offset ~0.06 m down, the anti-z-fight idiom), color `COL.wood × 0.8`, small rng jitter is fine (addWaytree is at the rng stream tail). Use `segMat` for the sloped rafter transforms (same idiom as the deck struts at line ~1477).
- [x] 2.3 `node --check worldgen-builders.js` passes.

## 3. Verification

- [x] 3.1 Run the 5-shot headless smoke test per the repo recipe (serve on an ad-hoc port 8123+, NEVER 8080; Chrome `--headless=new --enable-unsafe-swiftshader --virtual-time-budget=8000 --screenshot=<scratchpad>/shotN.png "http://localhost:<port>/index.html?shot=N"`); all shots N=1..5 must print `CANOPY_STATUS READY … err=0`. Screenshots go to the scratchpad, never the repo.
- [x] 3.2 Visual check of the fix: take a screenshot positioned at a skyhouse deck looking up (use the existing shot-mode camera nearest a waytree, or temporarily point one shot at deck height under the roof via the shot-mode config) and confirm ceiling planes + rafters are visible where sky was visible before. Save before/after to the scratchpad and report.
- [x] 3.3 No-drift guard: re-run one non-waytree city shot and eyeball-compare against a pre-change screenshot — building roofs, stalls, huts unchanged (decision 1 in design.md: exterior geometry byte-identical since no rng draws were added mid-stream).
