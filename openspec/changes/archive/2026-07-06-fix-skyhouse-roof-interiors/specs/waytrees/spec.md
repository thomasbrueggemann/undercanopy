# Delta — waytrees (fix-skyhouse-roof-interiors)

## MODIFIED Requirements

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
