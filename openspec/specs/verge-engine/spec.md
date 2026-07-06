# verge-engine Specification

## Purpose
TBD - created by archiving change add-verge-engine-expedition. Update Purpose after archive.
## Requirements
### Requirement: Deterministic site placement with safe degradation

The expedition SHALL locate its six sites once per session at init (after the Ciphers locate
pass): Pump House at the nearest reservoir chunk; Bell-Crank Belfry at the nearest grove/park
chunk with chime poles; Signal Box at a standing span of the nearest viaduct line;
Counterweight Yard at the nearest works-style district cell (fallback: sinkhole rim); Night
Kiln at the nearest ashen-biome chunk; the Verge Gate at the scorch boundary — found by
walking the verdancy field from the nearest scorch region seed back toward the canopy and
anchoring in the last canopy-side chunk. All finders SHALL be pure-hash ring scans that never
force chunk builds, and each SHALL degrade primary → widened ring → plaza-near-SPIRE fallback
(with a "trail is cold" flavor line) so no site can soft-lock. Site positions live on a
session locate object; the per-frame driver SHALL only read it.

#### Scenario: Sites are stable within a session

- **WHEN** the locate pass runs at session init
- **THEN** every site resolves to a deterministic position derived from world hashes, unchanged for the rest of the session

#### Scenario: Missing anchor degrades instead of soft-locking

- **WHEN** no reservoir chunk exists within the primary and widened scan rings
- **THEN** the Pump House anchors at the plaza-near-SPIRE fallback and its intro line notes the cold trail

### Requirement: Pump House — repair and valve routing

The Pump House SHALL be a multi-step contraption: (1) a missing flywheel lies as a glinting
animated pickup at a deterministic offset in the same chunk and MUST be found and seated at
the pump socket; (2) four valve wheels toggle open/shut (quarter-turn animation + clank per
toggle) controlling a four-leg manifold (chamber, bypass, burst leg, drain) where exactly one
of the 16 valve states floods the piece chamber — the wheel→leg mapping is a per-seed
permutation; (3) cranking the primer (hold-E) tests the state. Clues SHALL be diegetic: color
bands on the pipe props near each wheel, and a stamped brass schematic plate the player takes
a rubbing of (a satchel item whose examine note renders the manifold diagram, marking the
chamber leg with a rose and the bypass with a ring). A wrong crank SHALL answer with animated
localized failure — gauge needle slam, hiss and dust puff at the offending leg — and bump the
attempts counter. The correct crank SHALL start a continuous piston animation with water
audio, lift the chamber grate, and float the Governor piece up for collection.

#### Scenario: Flywheel before valves

- **WHEN** the player cranks the primer before the flywheel is seated
- **THEN** the crank spins free with a rattle and a line notes the empty socket, and no valve test occurs

#### Scenario: Wrong routing localizes the failure

- **WHEN** the player cranks with an incorrect valve state
- **THEN** the gauge needle slams, the offending open leg hisses with a dust puff, and attempts increment

#### Scenario: Correct routing raises the Governor

- **WHEN** the player cranks with the unique correct valve state
- **THEN** the piston animates, the grate lifts, and the Governor rises on the float as a collectible piece

### Requirement: Bell-Crank Belfry — cross-rigged rope pulls

The Belfry SHALL present three bell-ropes that each ratchet a counterweight up one notch
(0–4) on a visible notch rail, with a distinct bell tone per rope; per-seed cross-rigging
SHALL couple two directed rope pairs so pulling one rope drops another's counterweight one
notch (with a clatter), making naive pull orders fail. The target heights SHALL be shown
diegetically as faded paint marks on the rails. A reset chain SHALL drop all counterweights
to zero with a crash. Holding the target heights for 2 seconds SHALL tip the yoke, ring a
peal, and lower the cage holding the Wind Rose piece. Generated rigging and targets MUST be
verified reachable (≤ 12 pulls) by the pure generator's re-salt loop.

#### Scenario: Cross-rig defeats the naive order

- **WHEN** the player pulls each rope straight to its painted mark in a naive order on a seed whose rigging crosses that order
- **THEN** at least one earlier counterweight has been dragged below its mark by the cross-rig and the yoke does not tip

#### Scenario: Correct sequence lowers the cage

- **WHEN** all three counterweights sit at their painted marks for 2 seconds
- **THEN** the yoke tips, a peal rings, and the cage descends with the Wind Rose

### Requirement: Signal Box — interlocked lever frame

The Signal Box SHALL present a five-lever frame with railway interlocking: a per-seed set of
four lock rules ("free only when j set" / "locked while j set") that MUST leave the target
aspect reachable from all-clear while blocking at least two naive throw orders, with no
deadlock from the all-clear state. Each rule SHALL be stamped on a grimed brass plate that
the player wipes clean with E (revealing works-speak text). The target aspect SHALL come
from a torn timetable in two halves placed as glinting pickups (one in the box, one at the
buffer stop); holding both halves SHALL merge them into a single satchel note naming the
aspect. Throwing a locked lever SHALL strain, spring back, and thunk without changing state.
Setting the target aspect SHALL clunk the point-motor, clack the semaphore arms into
position, and roll the inspection trolley down the grade into the buffer, popping its chest
open on the Escapement piece.

#### Scenario: Locked lever refuses diegetically

- **WHEN** the player throws a lever whose lock rule is unsatisfied
- **THEN** the lever part-swings, springs back with a thunk, and the frame state is unchanged

#### Scenario: Timetable halves merge into the aspect

- **WHEN** the player holds both timetable halves
- **THEN** the satchel shows one merged note naming the target aspect

#### Scenario: Target aspect releases the trolley

- **WHEN** the frame matches the timetable aspect
- **THEN** the point-motor clunks, semaphores clack, and the trolley delivers the Escapement

### Requirement: Counterweight Yard — assay and balance

The Yard SHALL hide a per-seed permutation of four distinct masses (2, 3, 5, 7 units) inside
four visually distinct castings, provide a two-pan assay scale that tips toward the heavier
of any two placed castings (animated tilt with chain creak), and require hanging the four
castings on a four-hook crane beam (arms 1–4) to balance a crate of stamped mass at a stamped
arm — with per-seed parameters chosen so exactly one of the 24 assignments balances. Wrong
assignments SHALL slam the beam toward the heavy side with a dust burst and rattle. The
balanced beam held 3 seconds SHALL walk the pawl with ratchet ticks, lower the crate, and
unlatch the Condenser Coil piece. Castings SHALL be carried one at a time via the visible
carry rig (heavy carry).

#### Scenario: Assay comparison reads true

- **WHEN** two castings sit one per pan
- **THEN** the scale visibly tips toward the strictly heavier casting

#### Scenario: Unique assignment balances

- **WHEN** the four castings hang in the unique balancing assignment
- **THEN** the beam levels, the pawl walks, and the crate lowers to release the Condenser Coil

### Requirement: Night Kiln — fire, stoke, and steam timing

The Kiln SHALL be dusk/night-gated (cold by day, with a return-at-dark line). Its phases:
borrow a flame from a working street lamp onto a taper (a carried prop with a visible flame
and ~90 s burn; expiry means relighting, never lost progress), light the pilot (persisted lit
once lit), stoke the firebox with three E-presses, then vent the boiler while the gauge
needle is inside the brass band — three successful vents stepping the flywheel by thirds.
The needle SHALL advance on accumulated simulation time with a per-seed repeating rhythm
(so the pattern is learnable), and the band-crossing window MUST be at least 450 ms per
pass. Venting outside the band SHALL dump pressure harmlessly (needle falls, hiss); letting
the needle into the red SHALL shriek the safety valve and blow out the firebox (restoke
required; the pilot survives). Three good vents SHALL bring the flywheel to speed and
screw-open the vault on the Cloud-Seed Censer piece.

#### Scenario: Day visit bounces politely

- **WHEN** the player interacts with the kiln during full day
- **THEN** a line notes the cold firebox and the contraption stays inert until dusk

#### Scenario: Red-line consequence preserves the pilot

- **WHEN** the needle enters the red zone before a vent
- **THEN** the safety valve shrieks, the firebox blows out and needs restoking, and the pilot remains lit

#### Scenario: Three timed vents open the vault

- **WHEN** the player completes three in-band vents
- **THEN** the flywheel reaches speed and the vault screws open on the Cloud-Seed Censer

### Requirement: The Verge Gate — marked assembly and derived startup

The Verge Gate at the scorch boundary SHALL accept the five pieces in five mark-stamped
socket pedestals: a piece seats only in the socket whose collar mark matches its own
(mismatch: the piece shivers out with a clunk), teaching the mark language. With all five
seated, three startup handles (marked collars) unlock; the correct pull order SHALL be
derivable two independent diegetic ways — from the lintel's three ordered marks, and from
the pieces' satchel examine texts (each piece carries its mark and a foundry-motto fragment
that restates the order when read in socket order). A wrong pull order SHALL cough, gout
soot, and spin down for another try. The correct order SHALL run the staged startup:
flywheel spin-up with rising audio, the mast firing a seeding charge, a scripted Long Rain
(via the weather scripted trigger, non-SHOT), a permanently lit beacon at the Gate, a
glow-moss line along the boundary, an epilogue message, and the Warden's Whistle keepsake.

#### Scenario: Mismatched socket teaches the marks

- **WHEN** the player offers a piece to a socket with a different collar mark
- **THEN** the piece shivers out with a clunk and no seating occurs

#### Scenario: Wrong startup order fails soft

- **WHEN** the handles are pulled in any order other than the lintel order
- **THEN** the machine coughs, gouts soot, spins down, and the handles reset for another attempt

#### Scenario: The Engine wakes at the forest's edge

- **WHEN** the handles are pulled in the derived correct order with all pieces seated
- **THEN** the startup sequence runs, a scripted Long Rain begins, the beacon lights permanently, and the Warden's Whistle is granted

### Requirement: The Edgewright and the attempts hint ladder

An Edgewright NPC SHALL stand at the Verge Gate (synced via the Archivist/Tinker idiom),
carrying the expedition's fiction and a per-site hint ladder keyed to persisted attempt
counts: hints escalate in at least two stages (nudge at ~3 attempts, plainer steer at ~7)
and MUST never state a raw answer outright. The Gate site SHALL be revealed on the minimap
after the second piece is collected.

#### Scenario: Hints escalate with failure, never spoil

- **WHEN** the player has failed a site at least three times and asks the Edgewright
- **THEN** they receive a stage-one nudge for that site, and even at the deepest stage the literal solution is never stated

### Requirement: Expedition persistence and session recomputation

The expedition SHALL persist its state — started flag, per-site solved flags, pieces held
and seated, pilot lit, attempt counts, gate completion, keepsake — under the localStorage
key `canopy.verge` (v1, try/catch idiom, verge.js owns all writes). Site positions and all
puzzle content (combos, rigging, lock rules, masses, rhythms, orders) SHALL be recomputed
each session from world-stable hashes so answers never change between sessions; solved
husks relocating when chunk residency differs is the sanctioned tradeoff, as with the
Ciphers.

#### Scenario: The answer survives a reload

- **WHEN** the player derives a site's solution, reloads the page, and returns to the site
- **THEN** the same puzzle with the same solution is present, with prior solved/held state intact

### Requirement: Verge content is inert in screenshot mode

In SHOT mode the expedition SHALL be fully inert: no prop pools drawn, no audio, no HUD or
minimap writes, no weather trigger, no interactions.

#### Scenario: Smoke shots unaffected

- **WHEN** the game runs any shot-mode screenshot
- **THEN** no verge prop, sound, HUD element, or scripted weather event appears
