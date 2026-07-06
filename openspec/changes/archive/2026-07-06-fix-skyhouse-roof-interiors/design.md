# Design — fix-skyhouse-roof-interiors

## Context

The rendering pipeline batches world geometry into per-chunk `Batch` streams
(`core.js` `class Batch`); `Batch.quad(a,b,c,d,uv,col,colB)` emits one single-sided quad
whose facing is set by winding order. `B.plain` renders with `matPlain`
(`core.js:580`), which has no `side:` override → `THREE.FrontSide` → back faces culled.

`addGableRoof(B, x0, z0, x1, z1, y, roofCol, gableCol)` (`worldgen-builders.js:642`)
emits 2 sloped quads + 2 gable-end triangles, all wound to face out/up. Every closed
building is fine (you can never be inside one), but the skyhouse
(`addWaytree`, `worldgen-builders.js:1455`) puts this roof on an **open pavilion**
— six posts at `roofY = deckY + 2.8` over a walkable deck — so the player's default
view of the roof is its culled underside. Symptom exactly as reported: "I can see the
supports, but it has no roof visible when inside."

The repo already has the sanctioned idiom for two-sided surfaces in `matPlain`:
market-stall awnings (`worldgen-builders.js:1555-1556`) and `wireSpan`
(`worldgen-builders.js:1520-1521`) emit a **second quad with reversed winding**, the
reverse face tinted darker. There is no precedent for flipping a shared material to
`DoubleSide`, and doing so on `matPlain` would double rasterization work for nearly
every triangle in the world.

RNG discipline constraint: `addWaytree` is called LAST in `buildChunk` so its `rng`
draws never shift other chunk content. New geometry inside `addWaytree` may consume
`rng` freely (it is at the stream tail), but `addGableRoof` itself must stay
rng-free (it is called mid-stream by building generation — any draw added there would
reflow every gabled district in the world).

## Goals / Non-Goals

**Goals:**
- The skyhouse roof is visibly present from the deck: dark wooden ceiling planes,
  gable-end undersides, and enough carpentry (rafters, ridge beam) to read "built".
- Zero change to any other structure's geometry or to the deterministic RNG streams
  of non-waytree content (verifiable: screenshots of city districts are bit-identical).
- Backward-compatible `addGableRoof` signature — existing call sites untouched.

**Non-Goals:**
- No `DoubleSide` on `matPlain` (global cost, shading artifacts on unlit backfaces).
- No interior faces for building/hut/`addPyramidRoof` roofs (nothing enterable uses them).
- No collision, shade-pad, heat, or sun-occlusion changes (`colData` untouched).
- No new HUD/audio/story surface.

## Decisions

1. **Opt-in `opts` parameter, not a new function.**
   `addGableRoof(B, x0, z0, x1, z1, y, roofCol, gableCol, opts)` with
   `opts = { interior: true }` emits, after the existing 4 faces, the same 4 faces with
   vertex order reversed and a ceiling tint. Rationale: keeps one source of truth for the
   roof shape (both windings derive from the same coordinates, so they can never drift
   apart), and JS default-arg semantics make every existing call site (`buildings`,
   `hamlet huts`, oldtown) compile-and-render identically with `opts` undefined.
   Alternative considered: a wrapper `addGableRoofInterior` duplicating the vertex math —
   rejected, two copies of the ridge/eave math is how the slopes and ceiling planes drift.

2. **Ceiling tint = `roofCol × ~0.55` (and `gableCol × ~0.55` for the end undersides).**
   Matches the stall-awning idiom (reverse face at `×0.7`) but darker, because a ceiling
   under a shade pad should sit in shadow; `matPlain` is vertex-lit Standard material, and
   an underside face's normal points down where scene light is weakest — the darker
   vertex tint keeps it from looking flat-grey when the sun terminator sweeps.

3. **Rafters live in `addWaytree`, not in `addGableRoof`.**
   3 rafter pairs (thin `tplBoxC` boxes, `COL.wood × 0.8`, laid parallel to the gable
   ends under each slope) + 1 ridge beam along the ridge line, all placed with the same
   `rh = clamp(min(w,d) * 0.45, 1.4, 4.5)` ridge math the roof uses
   (already mirrored at `worldgen-builders.js:1500` for the beacon mast — reuse that
   local). Rationale: rafters are a skyhouse dressing decision, not a property of every
   gabled roof; keeping `addGableRoof` rng-free and geometry-minimal protects the
   city-wide RNG streams (see Context). `addWaytree` is at the rng tail so its extra
   draws are safe.

4. **Verification is screenshot-driven.**
   The existing smoke-test recipe (5 shots, `CANOPY_STATUS READY … err=0`) proves no
   regression; a dedicated visual check (headless screenshot from a deck-height camera
   under the roof — shot mode already supports fixed shots) proves the fix itself.
   A before/after of a non-waytree district shot guards decision 1's "no drift" claim.

## Risks / Trade-offs

- [Z-fighting between the interior face and exterior face of the same plane] → None
  possible: reversed-winding duplicate occupies the exact same plane and is only visible
  when the front face is culled (and vice versa); coplanar same-geometry front/back pairs
  cannot z-fight each other visibly since exactly one is ever rasterized per pixel.
- [Rafter boxes poking through the roof planes on extreme aspect ratios] → The skyhouse
  roof is a fixed 6.6 × 6.6 m square (`roofR = 3.3`), so the geometry is effectively
  constant; clamp rafter length to the slope run at the placement's z-offset.
- [Vertex-count creep if `interior` gets adopted broadly later] → Documented in the
  function comment: "interior is for enterable/open structures only".
- [Hidden dependence of some third structure on `addGableRoof` arg count] → `grep -n
  "addGableRoof("` shows exactly 3 call sites (buildings, hamlet hut, skyhouse); trailing
  optional arg is invisible to the first two.
