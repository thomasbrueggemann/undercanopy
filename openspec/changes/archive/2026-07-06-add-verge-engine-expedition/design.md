# Design — add-verge-engine-expedition

## Context

Current missions (`main.js` `ARCH.*`) are four thin archetypes; the only "puzzle" content is
the post-Spire Ciphers expedition (`puzzles.js`), which proved out every pattern this change
needs: pure-hash session-init finders that degrade safely (`ringFrom` → widened → plaza
fallback), a shared prop pool drawn per-frame for the nearest active feature only
(`CIPH_POOL`, `poolBegin/poolBox/poolEnd`), crosshair-cone interaction (`aimPick`),
attempts-gated hint ladders (`ladder()`), AC-gated synth sfx (`sfxNote`), localStorage
persistence with recomputed positions as the sanctioned tradeoff, and a giver NPC synced like
the Archivist (`ciphSyncTinker`). The satchel (`inventory.js`) is a generic registry whose
examine `note` strings are explicitly load-bearing clue surfaces. The E-chain in `player.js`
(story → puzzles → inventory → ladders → trial-master/giver) has a documented insertion
protocol. Weather has a forced-event path (`_wxForced`, `_wxBeginWarn`) currently reachable
only via `?wx=`. Script order: `… main.js → inventory.js → puzzles.js → weather.js →
story.js`.

Design constraints inherited from the codebase:
- **No worldgen changes.** Sites are runtime prop-sets anchored to existing chunk content
  (the Ciphers precedent) — `buildChunk` and all rng streams stay untouched, so the world is
  bit-identical and the smoke test cannot regress from generation.
- **Determinism.** All puzzle content (valve combos, rope rigging, lock DAGs, masses, orders)
  derives from `hash2`/`mulberry32` on world-stable seeds, never from `Math.random`, so a
  returning player faces the same puzzle with the same answer.
- **SHOT mode inert.** Pools, sfx, HUD writes, weather trigger — all gated `!SHOT`.

## Goals / Non-Goals

**Goals:**
- Five mechanically distinct, adult-hard contraption puzzles with diegetic clues and animated
  diegetic failure; a finale that makes the collected pieces literally assemble and run.
- Mission givers route players into the hunt (LEAD archetype) so the "always the same"
  complaint dies at the source.
- Every quest item is a visible, animated world object and a satchel entry whose examine text
  matters.
- Provable solvability: no seed may generate an unsolvable or accidentally-trivial puzzle.

**Non-Goals:**
- No changes to trials, the story campaign, the Ciphers, or worldgen geometry/colData.
- No new art pipeline: props are pooled `tplBox`/`tplCyl`/`tplBlob` meshes + glow sprites,
  the house style.
- No save-format migration for existing saves (new `canopy.verge` key only; absent key =
  fresh expedition).
- The finale's rain does not create a persistent microclimate simulation — it fires one
  scripted Long Rain plus permanent cosmetic state (lit beacon, glow-moss line, epilogue).

## Decisions

### D1. One new file, `verge.js`, between `puzzles.js` and `weather.js`
All expedition state, finders, puzzles, props, the Edgewright, and the finale live in one
file mirroring `puzzles.js`'s internal layout (STATE → PURE LOGIC → FINDERS → LOCATE → ITEMS
→ NPC → PROPS → INTERACT → PER-FRAME). At load it only touches THREE/scene/templates + item
registration; everything else is typeof-guarded, matching the split-file discipline.
`weather.js` loads after it, so the finale calls `wxScripted` via typeof-guard at runtime
(it's an event handler, not load-time). Alternative — extending `puzzles.js` — rejected:
different fiction, different save, and the file is already 822 lines.

### D2. Site anchoring and the locate pass
`vergeLocate()` runs once at session init (after `ciphLocate`, same call site pattern):
- Pump House → nearest `reservoir` chunk (ring scan from SPIRE, radius 4–28).
- Belfry → nearest `grove` or `park` chunk with chimes (reuse the chime-pole finder logic).
- Signal Box → nearest viaduct line (reuse `viaductNear`/`viaductStandingSpans` helpers'
  approach; anchor at a standing span's base).
- Counterweight Yard → nearest `works`-style district cell or `sinkhole` rim (works-district
  lookup via the district grid salt; fallback sinkhole).
- Night Kiln → nearest `ashen`-biome chunk centre.
- Verge Gate → **the scorch boundary**: from the nearest scorch region seed (the
  `findScorchHeart` approach in `story.js`), walk the verdancy field back toward the canopy
  until the biome flips, and anchor in the last canopy-side chunk. The Gate faces the open
  scorch — the literal forest edge.
Every finder degrades (primary → widened ring → plaza-near-SPIRE fallback with a "the trail
is cold" line, verbatim Ciphers policy) so no site can soft-lock. Site positions are stored
on a session `verge.loc` object; `updateVerge` only ever reads it.

### D3. Puzzle state machines and generation (per site)
Seeds: `Sx = hash2(site.ix, site.iz, saltX)` per site — world-stable, position-derived.

1. **Pump House** — phases `flywheel → seat → valves → solved`.
   Flywheel prop at a deterministic offset in the same chunk (glinting, bob/spin). Seat with
   E at the socket. Valve model: a manifold with 4 legs (chamber, bypass, burst leg, drain);
   correct state = chamber leg OPEN + bypass OPEN + other two SHUT, but *which physical
   wheel* controls which leg is a per-seed permutation → 1 of 16 combos, not guessable as a
   pattern. Clues: color bands on the pipe boxes near each wheel (4 distinct tints); a brass
   schematic plate — E takes a **rubbing** (item) whose note renders an ASCII pipe diagram
   labelling legs by color word, rose-mark on the chamber leg, ring-mark on the bypass.
   Crank (hold E ~2 s) tests the state: wrong → gauge needle slams (prop rotates), a dust
   puff sprite + hiss at the offending leg, attempts++. Right → piston bobs continuously,
   gurgle, grate lifts, Governor floats up.
2. **Belfry** — state = 3 notch heights (0–4). Pull rope i (E, 0.6 s hold): `h[i]++` clamp 4,
   toll note i, counterweight prop steps up; cross-rig: per-seed choice of 2 directed pairs
   (from the 6, never forming a 2-cycle on the same pair) applies `h[j]--` clamp 0 with a
   clatter. Target triple: per-seed from the reachable set (see D6), shown as faded paint
   quads on the notch rails ("the weights hung here when the gate last opened" — one-time
   msg on approach). Reset chain (E): all to 0, crash sfx. Win: heights == target held 2 s →
   yoke tips, peal, cage descends with the Wind Rose.
3. **Signal Box** — state = 5 lever booleans. Interlock rules: per-seed DAG of 4 rules of
   two forms — "i free only when j set" and "i locked while j set" (generated until the
   target aspect is reachable AND ≥ 2 naive orders fail, see D6). Rules are stamped on brass
   plates, grimed over; E wipes a plate (grime prop shrinks), revealing works-speak text.
   Target aspect: torn timetable — half A on a spike in the box, half B at the buffer stop
   below (both glinting pickups); holding both merges into one satchel note naming the
   aspect ("UP EXPRESS: 1 and 4 stand; the rest at rest" — wording per-seed). Locked lever
   pulled: partial swing + spring-back + THUNK. Correct aspect: point-motor clunk, semaphore
   arms clack (props rotate), trolley prop rolls down the grade into the buffer, chest pops:
   Escapement.
4. **Counterweight Yard** — 4 weight castings with hidden masses = per-seed permutation of
   {2,3,5,7} assigned to 4 distinct silhouettes (bell/gear/ingot/anchor). Assay scale: place
   one weight per pan (E with weight in hand — the carry rig); pans tip to the heavier side
   (animated tilt, chain creak) → full ordering in ≤ 5 comparisons (adult logic exercise).
   Crane beam: hooks at arms 1..4 on the counter side, crate of stamped mass M at arm L on
   the load side (M, L per-seed such that exactly one assignment of the four weights to the
   four hooks balances — generator searches all 24, re-salts until unique, see D6). Hang/
   remove with E. Wrong full assignment: beam slams to the heavy side, dust burst, rattle.
   Balanced: pawl walks with ratchet ticks, crate lowers, Condenser Coil unlatches.
5. **Night Kiln** — gated to dusk/night (`nightF`/`isDusk`, the SALVAGE precedent; by day
   the firebox is cold and a line says to come back at dark). Phases `taper → stoke →
   vent×3 → solved`. Taper: E at any working street lamp within the site's ring ("borrow a
   flame"); taper is a carried prop with a visible flame sprite and a 90 s burn (generous;
   failure = relight, not restart). Pilot lit → stays lit (persisted). Stoke: E ×3 on the
   coal pile (thud + dust). Vent minigame: gauge needle prop sweeps at a rate modulated by a
   per-seed 3-segment rhythm that repeats each cycle (fast–slow–fast etc.), so the player
   *learns* the rhythm rather than reflex-twitching; hold E on the relief valve while the
   needle is inside the brass band → flywheel steps 1/3 with a satisfying chuff; vent
   outside the band → pressure dumps (needle falls, long hiss, no penalty beyond time); let
   it into the red → safety shriek, firebox blows out, restoke (pilot survives). Three
   good vents: flywheel at speed, screw-vault grinds open on the Cloud-Seed Censer.

### D4. The Verge Gate finale
Props: 5 socket pedestals in an arc, each collar stamped with a mark; the machine body
(flywheel, mast, glass rose, pipe ring); 3 startup handles (PRIME/SPIN/SEED) with marked
collars; a lintel plate showing 3 marks in order; the Edgewright (NPC synced via the
Archivist/Tinker idiom) with a hint-ladder dialogue. Mark language: 5 glyphs (reuse the
`CIPH_GLYPHS` pool but distinct salt/indices so no collision with the Ciphers' cipher).
Seating: E with a piece near a socket seats it only if marks match (mismatch: piece shivers
out, clunk — this *teaches* the mark language before the handle test). All 5 seated →
handles unlock. Handle order = the lintel's 3 marks mapped through the handle collars;
the pieces' satchel examine texts each carry their mark plus one foundry-motto fragment, and
the fragments concatenated in socket order restate the lintel reading (two independent
diegetic paths to the answer — satchel readers and lintel readers both win). Wrong pull
order: cough, soot gout, spin-down, reset (attempts++ feeds the Edgewright's hint ladder).
Correct: staged startup — flywheel spin-up (accelerating prop rotation + rising synth),
pipes knock, mast fires the seeding charge (glow sprite launched up + report), call
`wxScripted('storm')` (typeof-guarded, non-SHOT), permanent state flips: beacon lamp lit at
the Gate (a `colData.lamps`-style runtime lamp prop), glow-moss quad line along the boundary
chunk edge, epilogue msg, keepsake item **the Warden's Whistle** (examine lore), LEAD
archetype retires, `missionsDone` credit.

### D5. LEAD missions and the Edgewright
`pickArch()`: if the expedition is unfinished and ≥ 1 unsolved site exists in `verge.loc`,
push LEAD with weight (~3 entries vs 1 each classic) so leads dominate without extinguishing
variety. `acceptMission(LEAD)` targets the nearest unsolved site with a per-site rumor line
("My uncle kept the reservoir pumps — the shed still has its brass, if you can make the
water mind you."). The mission completes when that site's piece is taken (verge.js calls a
`vergeLeadSolved(siteId)` hook consumed by main.js), fails never (leads are patient — no
timer; abandoning via trial keeps the site's own progress). First LEAD accept introduces the
fiction with the Edgewright rumor; the Gate site is revealed on the minimap after the second
piece ("two movements in the satchel — someone at the forest's edge will want these").

### D6. Provable solvability — the scratch harness (Ciphers precedent)
A standalone Node harness (scratchpad, not shipped) imports the pure generators and asserts
across ≥ 500 seeds: **Belfry** — BFS over the (5^3 × pull-graph) state space: target
reachable in ≤ 12 pulls, unreachable-by-monotone (i.e., naive "pull each to target" order
fails for ≥ 60 % of seeds — the cross-rig must bite). **Signal Box** — search over throw
sequences: target reachable; ≥ 2 of the 5! naive orders blocked; no rule pair deadlocks the
frame from the all-clear state. **Yard** — exactly 1 of 24 assignments balances; the assay
ordering is derivable (all masses distinct). **Pump** — exactly 1 of 16 valve states floods
the chamber (true by construction; assert anyway). **Kiln** — band-crossing windows ≥ 450 ms
at 60 fps for every seed rhythm (hard but physically fair). Failures re-salt deterministically
(seed, attempt#) — the shipped generator embeds the same re-salt loop, so runtime never
depends on the harness. Only after the harness passes is the logic transcribed verbatim into
`verge.js` (the "tested scratch harness" discipline from puzzles.js).

### D7. carry-props — the shared collectible language
New small module (own section in `entities.js`, where NPC/prop rigs live):
- **World pickups**: `pickupProp(def)` pool (~8 slots) — mesh cluster (1–3 pooled meshes for
  a silhouette), bob + slow spin (PAGE_POOL idiom), plus a `texSoft` glow sprite pulsing at
  range so pieces read across a plaza. Pickup burst: 0.25 s scale-pop on a burst sprite +
  `sfxNote` chime arpeggio + the standard `invAdd` toast.
- **First-person carry rig**: one `THREE.Group` parented to `camera`, lower-right, with a
  small per-item mesh cluster (parcel, taper+flame sprite, weight casting, machine piece);
  idle sway from walk bob, heavier sway for heavy items. Light items (parcel, taper,
  rubbings) don't affect movement; heavy items (assay weights, machine pieces) set a
  `carryHeavy` flag read by `player.js` next to `storyCarrying` (no sprint). Machine pieces:
  carried visibly from solve site until seated at the Gate — the walk home with a big brass
  thing in your hands IS the reward lap. (Pieces persist as satchel items; on reload the
  carried prop re-mounts if unseated.)
- Errand parcels adopt the rig on accept and hand off to the existing receiver-take
  animation on delivery (entities.js already drops a parcel prop into her hand — the rig
  just makes the *player's* half of the handoff visible).

### D8. Persistence
`localStorage['canopy.verge'] = { v: 1, started, sitesSolved: {pump,belfry,signal,yard,kiln},
pieces: { held: [...], seated: [...] }, pilotLit, attempts: {...}, gateDone, whistle }`.
Positions and all puzzle content recompute per session from world-stable seeds (identical
puzzles every session; identical answers). Same tradeoff banner as `canopy.ciphers`: solved
husks may relocate between sessions if chunk residency differs — sanctioned.

### D9. Interaction plumbing
`player.js` E-chain gains one line: `vergeInteract` between `puzzleInteract` and
`inventoryInteract` (story > ciphers > verge > pages > ladders > trial/giver — verge props
are rarer and more positional than pages). All verge interactions use `aimPick` with reach
2.6–3.2 m so multi-prop sites (5 levers, 4 hooks, 3 ropes) disambiguate by crosshair, and
every interactable shows the standard `hint()` line when aimed. Hold-interactions (crank,
rope, vent) follow the winch-lift hold-E pattern.

## Risks / Trade-offs

- [Scope: five puzzles + finale + carry rig is the largest single change yet] → The file is
  additive and each site is an independent state machine behind one dispatcher; tasks are
  grouped per site so implementation (and review) proceeds site-by-site with the game
  playable after every group. LEAD integration degrades gracefully if a site is missing
  (finder fallback) or verge.js absent (typeof guards — the errand pool simply stays
  classic).
- [Adult-hard tips into frustrating] → Every puzzle has: unlimited attempts, no fail-state
  that destroys progress (kiln restoke is the harshest and preserves the pilot), animated
  feedback that localizes *what* went wrong (which leg hissed, which lever thunked, which
  side slammed), and the attempts-hint-ladder. The harness bounds solution length so no
  puzzle is a combinatorial slog.
- [Prop-pool exhaustion at dense sites (signal box ≈ 20 meshes)] → Dedicated `VERGE_POOL`
  sized for the worst site + carried/burst overlays (~28 boxes, 6 cylinders, 4 sprites);
  per-frame draw remains "nearest site only", so the budget is a constant, verified by an
  assert in the pool allocator during dev.
- [Timing puzzle (kiln) under variable frame rate] → Needle advances on simulation `dt`
  accumulation, not wall-clock frames; band-window widths asserted in the harness at the
  60 fps baseline and scale-independent because entry/exit are dt-integrated.
- [Scripted storm colliding with an already-active weather event] → `wxScripted` no-ops into
  a cosmetic-only local plume if `WX.phase !== 'clear'` (rare; the finale's other beats all
  still fire), and is `!SHOT`-gated like the `?wx=` hook.
- [LEAD dominance starves classic-errand variety long-term] → Weighting only while the
  Engine is unfinished; after `gateDone`, `pickArch` returns to the classic pool (plus the
  whistle keepsake as the expedition's permanent trace).
- [Cross-file load-order regressions] → verge.js placed after puzzles.js (needs invRegister,
  aimPick idioms available at runtime only), before weather.js/story.js; all cross-file
  reads typeof-guarded, matching the established split-file contract; `node --check` on
  every touched file plus the 5-shot smoke test gate every task group.
