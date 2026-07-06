# Delta — carry-props (add-verge-engine-expedition)

## ADDED Requirements

### Requirement: Animated world pickup language

Quest and expedition pickups SHALL share one animated prop language: a pooled mesh cluster
(1–3 low-poly meshes forming a readable silhouette) with the bob-and-slow-spin idle idiom,
plus a soft glow sprite pulsing so the pickup reads at plaza range. Collecting SHALL fire a
pickup burst — a brief scale-pop on a burst sprite, a chime arpeggio (AC-gated), and the
standard inventory toast. The pool SHALL be sized for the worst concurrent case and drawn
per-frame for nearby candidates only, never added in buildChunk.

#### Scenario: A piece reads across the square

- **WHEN** an uncollected machine piece or quest pickup is within visible range
- **THEN** it bobs, spins, and pulses its glint so it is findable without HUD help

#### Scenario: Collection celebrates

- **WHEN** the player collects such a pickup
- **THEN** a scale-pop burst, a chime, and the inventory toast fire together

### Requirement: First-person visible carry rig

A camera-attached carry rig SHALL make carried quest objects visible in first person
(lower screen, swaying with walk bob): errand parcels, the kiln taper (with live flame
sprite and burn-down), assay castings, and unseated machine pieces. Exactly one rig prop
shows at a time (the most recent pickup that is designated carry-visible); the rig SHALL be
hidden in SHOT mode and while the satchel panel is open.

#### Scenario: The parcel is in your hands

- **WHEN** an ERRAND mission is accepted
- **THEN** a parcel prop appears in the first-person carry rig and remains until the delivery handoff

#### Scenario: The piece rides home visibly

- **WHEN** the player collects a machine piece and walks toward the Verge Gate
- **THEN** the piece is visible in the carry rig until seated in its socket

### Requirement: Heavy carry affects movement

Objects designated heavy (assay castings, machine pieces) SHALL set a heavy-carry flag while
carried: sprint is disabled (the `storyCarrying` precedent) and the rig sway deepens. Light
objects (parcel, taper, paper items) SHALL NOT affect movement.

#### Scenario: No sprinting with a casting

- **WHEN** the player carries an assay casting
- **THEN** sprint is unavailable until the casting is placed on a pan, a hook, or set down

### Requirement: Carry state is consistent with inventory and handoffs

The rig SHALL stay consistent with game state: delivering the parcel hands visually off to
the receiver's existing take animation; seating a piece removes it from the rig and the
satchel's held list; reloading a session re-mounts the rig for any persisted unseated piece.

#### Scenario: Reload keeps the piece in hand

- **WHEN** the player reloads while holding an unseated machine piece
- **THEN** the piece is still in the satchel and visibly back in the carry rig
