# Fix: skyhouse roof invisible from inside

## Why

Standing on a waytree skyhouse deck and looking up, the pitched roof is invisible — you see
the six posts and the sky between them, which reads as a roofless frame even though the roof
exists (it casts shade and renders fine from outside/above). Root cause: `addGableRoof`
emits only outward/upward-facing quads into `B.plain`, and `matPlain` is FrontSide-only, so
the roof's undersides are backface-culled from every viewpoint below the eaves. The skyhouse
is an open pavilion (posts, no walls), so the player is *always* below the eaves when on the
deck — the one structure in the game where the underside is the primary view of the roof.

## What Changes

- `addGableRoof` gains an opt-in `interior` mode that additionally emits the underside faces
  of both roof slopes and both gable ends — reversed winding, darker "ceiling" tint —
  following the existing two-sided idiom used by market-stall awnings and wire spans
  (a second reversed quad, never a global material change to `matPlain`).
- The skyhouse builder (`addWaytree`) requests interior faces and adds a small set of
  rafters/purlins under the slopes plus a ridge beam, so from the deck the roof reads as a
  built, carpentered ceiling rather than two bare dark planes.
- Closed structures keep the cheap single-sided roofs: buildings and hamlet stilt huts have
  no enterable interior, so they do not opt in (no vertex-count increase across the city).
- No collision, shade-pad, or sun-occlusion changes: the roof's shade pad and beacon mast
  are untouched; the fix is purely visual geometry.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `waytrees`: the "Waytree lookout structure" requirement gains an interior-visibility
  clause — the pitched roof SHALL be visible from below/inside (underside faces + rafters),
  not only from outside.

## Impact

- `worldgen-builders.js`: `addGableRoof` (new optional `opts` parameter, backward-compatible
  — all existing call sites unchanged), `addWaytree` (interior opt-in + rafter geometry).
- Small vertex-count increase per skyhouse only (≈4 extra quads + a handful of rafter
  boxes); city buildings, stalls, and huts are unaffected.
- No changes to `colData` (pads/solids/trunks), heat/shade math, or the smoke-test contract.
