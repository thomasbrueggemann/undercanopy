# waytrees Specification

## Purpose
TBD - created by archiving change add-waytree-ladders. Update Purpose after archive.
## Requirements
### Requirement: Waytree placement is deterministic and recomputable

A waytree's existence and its exact `(x, z, deckY)` SHALL be a pure function of the chunk
coordinates via `hash2`, exposed as a shared `waytreeSpec(ix, iz)` returning `null` or
`{ x, z, deckY }`. Waytrees SHALL appear in every third `grove` chunk (`hash2(ix,iz,7301) % 3
=== 0`) and every fourth `park` chunk (`hash2(ix,iz,7302) % 4 === 0`), with `deckY` computed as
`42 + hash2(ix,iz,7304) % 8`, i.e. in the skyhouse-height range [42, 50) — clear above the
crowns, higher than the hamlet giants (32–40) but below the colossus (56.5) and the Spire (78).
Only the `deckY` base changes from the canopy-height design; the salts and placement hashes are
unchanged, so every finder updates automatically. Finders SHALL be able to recompute a
waytree's deck position without building or peeking at the chunk, and a `nearestWaytree` ring
scan SHALL return the closest waytree deck to a chunk.

#### Scenario: Same waytree derived without building the chunk

- **WHEN** a finder calls `waytreeSpec(ix, iz)` for a qualifying grove chunk
- **THEN** it returns the same `(x, z, deckY)` that the builder uses to place the waytree
- **AND** `deckY` lies in [42, 50)

#### Scenario: Non-qualifying chunk has no waytree

- **WHEN** `waytreeSpec` is called for a chunk that is neither a qualifying grove nor park
- **THEN** it returns `null`

#### Scenario: Nearest waytree ring scan

- **WHEN** `nearestWaytree` scans outward from a chunk
- **THEN** it returns the closest waytree deck `{x, z, y}` found, or `null` if none in range

### Requirement: Waytree lookout structure

A waytree SHALL be built as a mast-carried skyhouse standing clear above the forest crowns. The
tree's own crown SHALL top out several metres BELOW the deck, and a bare freeclimbable mast
trunk (radius ~1.5, registered in `colData.trunks` with height `deckY`, so purists can climb it
to skip the lift) SHALL continue up through the crown to carry the house at `deckY`. The
skyhouse SHALL comprise: a plank floor registering a walkable pad (layer `lookout`, radius ~3.0)
at `deckY`; 4–6 diagonal support struts from the mast out to the deck rim so the house reads
built, not floating; a parapet of railing posts and caps around the rim with a gap on the +x
lift-dock side; a full pitched roof above the deck that registers a real shade pad (~0.75 sun
attenuation, no solid) so the house shades its occupants; and a tall beacon mast rising above
the ridge with a glowing lamp head (registered in `colData.lamps`) that reads across the whole
night map. This replaces the earlier partial roof and rim lamp. The deck SHALL remain a valid
vantage point (the VANTAGE summit check still covers the r 3.0 deck).

The roof SHALL be visible from the deck as well as from outside: because the skyhouse is an
open pavilion (roof on posts, no walls), the roof SHALL carry interior underside faces for both
slopes and both gable ends (reversed-winding duplicates of the exterior faces, tinted darker as
a ceiling, per the two-sided stall-awning idiom — the shared `matPlain` material stays
FrontSide). Under the slopes the skyhouse SHALL add visible carpentry — rafters and a ridge
beam — so the ceiling reads as built structure, not bare planes. Interior faces are opt-in per
call site (`addGableRoof` option); closed structures (city buildings, hamlet stilt huts) SHALL
keep single-sided roofs, and non-waytree world geometry SHALL be unchanged by this feature.

#### Scenario: Skyhouse rides above the crown on a mast

- **WHEN** a waytree is generated
- **THEN** the tree crown tops out below `deckY` and a freeclimbable mast trunk carries the deck at `deckY`

#### Scenario: Deck is a walkable lookout with roof shade

- **WHEN** the skyhouse is built
- **THEN** it registers a `lookout` floor pad (radius ~3.0) at `deckY` and a roof shade pad above it

#### Scenario: Beacon mast glows at night

- **WHEN** night falls at a waytree
- **THEN** the beacon-mast lamp above the ridge glows as a registered working lamp

#### Scenario: Purist climbs the mast

- **WHEN** the player freeclimbs the bare mast trunk instead of riding the lift
- **THEN** the mast (height `deckY`, above the 14 m climb threshold) carries the player up to the deck

#### Scenario: Roof is visible from the deck

- **WHEN** the player stands on the skyhouse deck and looks up
- **THEN** the undersides of both roof slopes and both gable ends render (darker ceiling tint), with rafters and a ridge beam visible beneath the slopes

#### Scenario: Closed structures keep single-sided roofs

- **WHEN** a city building or hamlet stilt hut is generated with a gable roof
- **THEN** its roof emits only the original exterior faces and its geometry is byte-identical to before this change

### Requirement: Waytree ground-to-deck ascent

A waytree SHALL provide a forgiving, active ascent from the ground up to the lookout deck at
`deckY`, distinct from freeclimbing, so any mission that routes a player to a waytree lookout is
climbable without freeclimb mastery. The ascent SHALL be a hand-cranked counterweight winch
lift mounted on the +x face of the trunk (the deck railing's dock gap); the earlier ground-to-
deck rung ladder is removed. The player steps onto the lift platform and pumps to crank it up
until it docks level with the deck.

#### Scenario: Riding the lift to the deck

- **WHEN** the player boards the waytree lift and cranks it up
- **THEN** the platform rises and docks level with the lookout deck at `deckY`

#### Scenario: No rung ladder on the waytree

- **WHEN** a waytree is generated
- **THEN** it carries a winch lift and no ground-to-deck rung ladder

### Requirement: Lookout decks and rest platforms catch falls

Falling onto a waytree lookout deck SHALL be a caught landing (`SAFE_LEAF` includes `lookout`),
so the friendly route is also forgiving of a missed step. The deck SHALL slightly shade the
ground beneath it as an ordinary canopy pad.

#### Scenario: Falling onto a lookout deck

- **WHEN** the player falls onto a `lookout` pad from a height that would otherwise injure
- **THEN** the landing is caught with no fall damage or blackout

### Requirement: Mission finders prefer waytree lookouts

The mission finders that pick "somewhere high" SHALL prefer the nearest recomputable waytree
lookout, each retaining its previous behavior as a fallback when no waytree is in range:
the crown-nest story chapter (`findNestPad`), the Ascent trial target, and the VANTAGE errand
vantage point. The finders SHALL locate the waytree via the recomputable spec, not by building
the chunk.

#### Scenario: VANTAGE errand targets a waytree

- **WHEN** a VANTAGE errand is offered and a waytree lookout is within range
- **THEN** the errand vantage point is the waytree deck rather than a rooftop

#### Scenario: Fallback when no waytree

- **WHEN** a "somewhere high" finder runs and no waytree is in range
- **THEN** it falls back to its previous target (nest pad, rooftop, or giant trunk)

### Requirement: Waytree minimap glyph after first lookout

Resident-chunk waytrees SHALL show a small rung glyph on the minimap once the player has stood
on any lookout deck during the session, recomputed from `waytreeSpec`. Before the player has
stood on a lookout, no such glyph SHALL appear.

#### Scenario: Glyph unlocks on first lookout

- **WHEN** the player first stands on a lookout deck
- **THEN** resident waytrees begin showing a rung glyph on the minimap

