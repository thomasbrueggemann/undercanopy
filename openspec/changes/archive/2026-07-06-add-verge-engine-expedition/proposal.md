# The Verge Engine — an escape-room expedition to the edge of the forest

## Why

The mission loop has gone samey: every giver hands you a parcel walk or a sun-cache dash, and
neither asks the player to *think*. There is no through-line — missions are disposable chores,
the collected items are invisible abstractions, and nothing ever "comes together". This change
turns the mission system into a hunt for the five scattered movements of a dead Authority
machine — the Verge Engine, the rain-shepherd that once kept the forest's edge from burning —
each movement locked behind a genuinely tricky mechanical contraption (an escape-room room, in
game form: machines to repair, ropes to pull, levers to throw, weights to balance, steam to
time), and all of it assembling into a thundering finale at the scorch boundary, the literal
edge of the forest. Alongside it, the whole collectible language gets an upgrade: mission items
become big, animated, glinting props you can see across a plaza, carry visibly in first person,
and read in the satchel — where their examine texts are themselves clues.

## What Changes

- **Five contraption sites**, each anchored to an existing anomaly/district type by
  deterministic pure-hash finders (the Ciphers idiom), each a distinct mechanical puzzle with
  its own verb, its own diegetic clue surfaces, and its own animated failure feedback:
  1. **The Pump House** (reservoir) — repair the machine: find and seat the missing flywheel,
     then solve a 4-valve routing puzzle read from flaked pipe paint and a stamped schematic
     plate you take a rubbing of. Solved: the piston pumps, the chamber floods, and the
     **Governor** rises on a float.
  2. **The Bell-Crank Belfry** (grove/park with chimes) — pull ropes: three bell-ropes ratchet
     counterweights up visible notch-rails, but two ropes are cross-rigged (pulling one drops
     another). Reach the faded paint-mark heights — an order-of-operations puzzle. Solved: the
     yoke tips and a cage descends with the **Wind Rose**.
  3. **The Signal Box** (viaduct) — throw levers: a 5-lever frame with real railway
     interlocking (levers lock and free each other per stamped brass plates you wipe the grime
     from), target aspect read from a torn timetable whose two halves you must find and join.
     Solved: the point-motor clunks and a runaway inspection trolley delivers the
     **Escapement**.
  4. **The Counterweight Yard** (works district) — balance weights: four castings of hidden,
     unequal mass, a two-pan assay scale to deduce their order by comparison, then hang them
     on a 4-hook crane beam so the stamped crate mass balances — one correct assignment.
     Solved: the pawl walks, the crate lowers, the **Condenser Coil** unlatches.
  5. **The Night Kiln** (ashen quarter, dusk/night) — manage fire and steam: borrow a flame
     from a street lamp on a burning taper, stoke the firebox, then vent the boiler exactly
     inside the brass gauge band, three times, learning the needle's rhythm. Solved: the
     flywheel comes to speed and the screw-vault opens on the **Cloud-Seed Censer**.
- **The Verge Gate finale** at the scorch boundary: a dead machine with five marked sockets
  and the Edgewright, its last keeper, waiting beside it. Each piece seats only in its marked
  socket (taught by the mark language stamped on pieces and collars), and the three startup
  handles must be pulled in an order derived from the lintel's maker's marks — the pieces'
  satchel examine texts carry the marks, so the satchel is the codebook. Startup: flywheel
  spin-up, a fired seeding charge, a scripted Long Rain rolling in over the burnt ground, and
  a permanent lit beacon at the edge of the world.
- **Missions point at the hunt**: a new LEAD archetype — givers now mostly offer leads to the
  nearest unsolved contraption site with rumor-flavored intro lines; solving the site
  completes the lead. Classic errands remain as filler, weighted down while the Engine is
  unfinished. Trials are untouched.
- **Collectible/carry upgrade (cross-cutting)**: a shared animated-prop language — pickup
  glints visible at range, bob/spin idle, a pickup burst (pop + chime + toast) — plus a
  first-person carry rig: parcels, the taper, assay weights, and machine pieces are visibly
  in your hands, with heavy items swaying and slowing sprint (the `storyCarrying` precedent).
  All expedition items live in the satchel with icons and clue-bearing examine text.
- **Difficulty stance**: tuned to be genuinely chewy for an adult — the interlocking, the
  cross-rigged ropes, the balance deduction, and the derived startup order each demand
  observation and reasoning; hints escalate only through the attempts-ladder (the Ciphers
  idiom), never handing out the answer.

## Capabilities

### New Capabilities

- `verge-engine`: the expedition — deterministic site finders, the five contraption puzzles
  (state machines, clue generation, unique-solution guarantees), the Verge Gate assembly and
  startup finale, the Edgewright, LEAD mission integration, persistence, and audio/visual
  feedback.
- `carry-props`: the shared collectible language — animated world pickups (glint, bob, burst)
  and the first-person carry rig with light/heavy carry behavior, adopted by errand parcels
  and all verge items.

### Modified Capabilities

- `errands`: archetype selection gains LEAD (offered when an unsolved verge site is in
  finder range, weighted to dominate while the Engine is unfinished; never offered when
  impossible); the ERRAND parcel becomes a visible first-person carried prop.
- `weather-events`: gains a scripted trigger requirement — the Verge Gate startup SHALL be
  able to force a Long Rain through the existing forced-event path at runtime (not just via
  the `?wx=` URL hook).

## Impact

- **New file** `verge.js` (loaded between `puzzles.js` and `weather.js` in `index.html`):
  all site logic, props, puzzles, finale, Edgewright, save (`localStorage['canopy.verge']`).
- **New file or entities.js section** for the carry-props rig and pickup language (shared
  helpers; camera-attached carry group).
- `main.js`: `ARCH.LEAD` in `pickArch`/`acceptMission`/`missionProgText`; main loop calls
  `updateVerge(dt, time)`; minimap glyphs for known sites and the Gate.
- `player.js`: one line in the E-interact chain (`vergeInteract` between `puzzleInteract`
  and `inventoryInteract`); heavy-carry sprint gate alongside `storyCarrying`.
- `weather.js`: small public `wxScripted(kind)` wrapper over the existing forced path.
- `inventory.js`: no structural change — verge items use the existing `invRegister`/`invAdd`
  note API (examine texts as clue surfaces are an existing satchel design principle).
- `puzzles.js`, `story.js`, trials: untouched. SHOT mode: all verge props/audio/updates
  gated inert, preserving the 5-shot smoke-test contract.
- Puzzle logic (belfry reachability, interlock reachability + naive-order failure, yard
  uniqueness, kiln band rhythm) is developed and verified in a scratch numeric harness across
  hundreds of seeds before transcription — the Ciphers precedent.
