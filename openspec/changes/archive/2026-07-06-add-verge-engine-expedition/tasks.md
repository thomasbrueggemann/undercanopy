# Tasks — add-verge-engine-expedition

Discipline for every group: `node --check` each touched file; the 5-shot headless smoke test
(serve on an ad-hoc port 8123+, NEVER 8080; all shots print `CANOPY_STATUS READY … err=0`;
screenshots to the scratchpad, never the repo) must pass before the group is checked off.
All puzzle math ships only after the harness in group 1 passes (design D6).

## 1. Numeric harness — pure puzzle generators, proven before wiring

- [x] 1.1 Write a standalone Node harness in the scratchpad (`verge-harness.js`) containing the pure generators (no THREE, only `hash2`/`mulberry32` copies): pump manifold (wheel→leg permutation + unique 4-bit solution), belfry rigging (2 directed cross-pairs, no 2-cycle, target triple), signal-box lock DAG (4 rules of the two forms) + target aspect, yard masses ({2,3,5,7} permutation) + crate (M, L), kiln rhythm (3-segment repeating needle-rate pattern). Each generator embeds a deterministic re-salt loop `(seed, attempt#)` used when constraints fail.
- [x] 1.2 Assert across ≥ 500 seeds: pump — exactly 1 of 16 states floods the chamber; belfry — BFS proves target reachable in ≤ 12 pulls AND the naive "pull each rope straight to its mark" order fails on ≥ 60% of seeds; signal box — target reachable from all-clear, ≥ 2 of the 120 naive orders blocked, no deadlock from all-clear; yard — exactly 1 of 24 hook assignments balances `Σ w_i·arm_i = M·L`; kiln — every band-crossing window ≥ 450 ms at the 60 fps baseline.
- [x] 1.3 Record the harness output (pass counts, max pulls, mean re-salt depth) in a scratchpad log; fix generators until green. The harness file stays in the scratchpad — never committed.

## 2. carry-props — pickup language and first-person rig (entities.js, player.js)

- [x] 2.1 In `entities.js`, add the shared pickup-prop pool (~8 slots of 1–3 mesh clusters from `tplBox`/`tplCyl`/`tplBlob` + one `texSoft` glow sprite each): bob + slow-spin idle (PAGE_POOL idiom, inventory.js:231-237), range-pulsing glint, and `pickupBurst(x,y,z)` (0.25 s scale-pop sprite + `sfxNote` chime arpeggio, AC-gated, `!SHOT`).
- [x] 2.2 In `entities.js`, add the first-person carry rig: one `THREE.Group` parented to `camera` (lower-right), API `carryShow(kind)` / `carryHide()` with per-kind mesh clusters (parcel, taper+flame sprite, casting, and the five machine-piece silhouettes — Governor/Wind Rose/Escapement/Coil/Censer as distinct 2-3-mesh brass clusters); walk-bob sway, deeper sway for heavy kinds; hidden in SHOT and while `satchelOpen`.
- [x] 2.3 In `player.js`, add a `carryHeavy` global (var, cross-file like `storyCarrying`) gating sprint alongside the existing carrying check (player.js:236); set/cleared only by the rig API.
- [x] 2.4 Adopt the rig for errand parcels: `acceptMission` ERRAND branch shows the parcel; the delivery handoff (main.js:268-273) hides it as `departReceiver` runs so the prop visually transfers to her existing take animation.
- [x] 2.5 `node --check entities.js player.js main.js` + smoke test.

## 3. verge.js skeleton — state, finders, items, pool, wiring

- [x] 3.1 Create `verge.js` (layout mirroring puzzles.js: STATE → PURE LOGIC → FINDERS → LOCATE → ITEMS → NPC → PROPS → INTERACT → DRIVER). Add `<script src="verge.js">` to index.html between puzzles.js and weather.js. Persistence: `localStorage['canopy.verge']` v1 per design D8, try/catch idiom, this file owns all writes.
- [x] 3.2 Transcribe the group-1 generators verbatim from the passed harness (comment: "transcribed verbatim from the tested scratch harness", the puzzles.js precedent).
- [x] 3.3 Finders + `vergeLocate()` per design D2 (reservoir / grove-with-chimes / viaduct standing span / works-cell-or-sinkhole / ashen / scorch-boundary walk), each degrading primary → widened → plaza-near-SPIRE with the "trail is cold" line; call `vergeLocate` at session init after `ciphLocate`.
- [x] 3.4 Register items via `invRegister`: 5 machine pieces (distinct icons, examine texts carrying the socket mark + foundry-motto fragment per design D4), plate rubbing, timetable halves (merging note when both held), taper, keepsake Warden's Whistle. Examine notes are the clue surfaces — write them with care and the Gardener-adjacent voice.
- [x] 3.5 `VERGE_POOL` (~28 boxes, 6 cylinders, 4 sprites) with `poolBegin/poolBox/poolEnd`-style helpers + a dev assert on overflow; per-frame draw of the nearest site only. `vergeInteract()` E-hook using `aimPick` (reach 2.6–3.2 m) and `hint()` lines when aimed; wire into player.js between `puzzleInteract` and `inventoryInteract` (player.js:58-60). `updateVerge(dt, time)` called from the main loop next to `updatePuzzles`, `!SHOT`-gated.
- [x] 3.6 Edgewright NPC at the Gate (ciphSyncTinker idiom), per-site attempts hint ladder (2 stages: ~3 and ~7 attempts, never the raw answer); Gate minimap reveal after the second piece.
- [x] 3.7 `node --check verge.js player.js main.js index.html`(html via the browser smoke) + smoke test.

## 4. Site — Pump House

- [x] 4.1 Props: shed frame, pump body + piston, crank, flywheel socket, 4 valve wheels with color-band pipe stubs, gauge with needle, manifold legs (chamber grate + float, bypass, burst leg, drain), schematic plate. Flywheel pickup at its deterministic offset using the group-2 pickup language.
- [x] 4.2 State machine `flywheel → seat → valves → solved` per spec: free-spinning crank + rattle before seat; E-toggle valves (quarter-turn + clank); plate rubbing item on E; hold-E crank test — wrong: needle slam + hiss/dust at the offending leg + attempts++; right: continuous piston bob + gurgle (AC-gated), grate lift, Governor floats up as a heavy carry piece; solved husk persists.
- [x] 4.3 Verify by hand: solve it from the rubbing alone (no code peeking) on two different world seeds (`?seed=` if available, else two hash offsets); smoke test.

## 5. Site — Bell-Crank Belfry

- [x] 5.1 Props: yoke, 3 ropes (thin boxes that stretch/snap-taut on pull), 3 counterweights riding notch rails with faded paint marks at target heights, reset chain, cage with the Wind Rose visible inside.
- [x] 5.2 Logic per spec: pull = hold-E 0.6 s, `h[i]++` + toll (distinct `sfxNote` pitch per rope) + cross-rig drops with clatter; reset chain crashes all to 0; target held 2 s → yoke tips, peal, cage descends, Wind Rose collectible. Approach-once msg for the paint marks.
- [x] 5.3 Verify: naive order fails on a seed the harness flagged; the derived order succeeds; smoke test.

## 6. Site — Signal Box

- [x] 6.1 Props: 5-lever frame (levers swing on throw; strain + spring-back on locked), 5 grimed brass plates (grime shrinks on wipe), semaphore gantry with rotating arms, point rail, trolley + buffer + chest, timetable half pickups (box spike + buffer stop).
- [x] 6.2 Logic per spec: lock DAG evaluation on each throw; plate wipe reveals its rule text (works-speak, generated from the DAG); halves merge into the aspect note; target aspect → point clunk, arms clack, trolley rolls (animated along the grade), chest pops the Escapement.
- [x] 6.3 Verify: throw a locked lever (thunk, no state change), wipe all plates, derive and set the aspect from the merged note only; smoke test.

## 7. Site — Counterweight Yard

- [x] 7.1 Props: assay scale (2 pans, animated tilt + chain creak), 4 castings (bell/gear/ingot/anchor silhouettes) as heavy carry-rig objects, crane with 4-hook beam (arm notches stamped), stamped crate over the pit, pawl + ratchet.
- [x] 7.2 Logic per spec: pan placement + strict-heavier tilt; hook hang/remove with E; wrong full assignment slams the beam (dust + rattle); the unique assignment held 3 s walks the pawl (ticks), lowers the crate, unlatches the Condenser Coil.
- [x] 7.3 Verify: deduce the mass order via ≤ 5 assay comparisons and balance on the first informed try; confirm a deliberately wrong hang slams; smoke test.

## 8. Site — Night Kiln

- [x] 8.1 Props: kiln body, firebox door, coal pile, pilot, gauge with brass band + red zone + needle, relief valve, flywheel, screw-vault. Taper as a carried prop with flame sprite + visible burn-down.
- [x] 8.2 Logic per spec: day-gate bounce line; borrow-a-flame E at working street lamps; 90 s taper (expiry = relight only); pilot persists once lit; stoke ×3; dt-accumulated needle with the seed rhythm; hold-E vent — in-band: flywheel steps 1/3 + chuff; out-of-band: harmless dump; red: shriek + blowout (restoke, pilot survives); three vents → vault opens on the Cloud-Seed Censer.
- [x] 8.3 Verify: full run at dusk including one deliberate red-line blowout; confirm the rhythm is learnable (solve within ~6 vent attempts); smoke test.

## 9. The Verge Gate finale + weather trigger

- [x] 9.1 In `weather.js`: add `wxScripted(kind)` — reuses the forced path (`_wxForced`, `_wxBeginWarn`); returns false without side effects when `WX.phase !== 'clear'` or in SHOT; console-logs activation like the `?wx=` hook.
- [x] 9.2 Gate props: 5 mark-stamped socket pedestals in an arc, machine body (flywheel, mast, glass rose, pipe ring), 3 marked startup handles, stamped lintel, Edgewright position. Mark glyph set: 5 glyphs salted independently of the Ciphers' cipher.
- [x] 9.3 Seating logic (mark match; mismatch shivers out with a clunk), handle unlock at 5/5, wrong order = cough + soot gout + spin-down + attempts++, correct order = staged startup: flywheel spin-up with rising synth, mast seeding charge (launched glow sprite + report), `wxScripted('storm')` (typeof-guarded; on false fall back to a local plume sprite), permanent beacon lamp at the Gate, glow-moss quad line along the boundary edge, epilogue msg, Warden's Whistle via invAdd, `gateDone` persisted.
- [x] 9.4 Verify: full assembly with pieces in the satchel, one wrong-order attempt, then the derived order from the lintel AND cross-checked against the satchel motto fragments; storm fires (test also the decline path with `?wx=storm` already active); smoke test confirms SHOT stays inert.

## 10. LEAD missions — routing givers into the hunt (main.js)

- [x] 10.1 Add `ARCH.LEAD`: `pickArch` offers it (weight ~3 entries) iff verge unfinished and ≥ 1 unsolved located site (typeof-guarded so main.js works without verge.js); never after `gateDone`.
- [x] 10.2 `acceptMission(LEAD)`: target = nearest unsolved site, per-site rumor line, HUD title/progress text, minimap objective; first LEAD introduces the Edgewright rumor. Completion: verge.js calls `vergeLeadSolved(siteId)` on piece collection → `completeMission` with a reward line + `missionsDone` credit; no timer, no fail; abandoning preserves all site progress (verify).
- [x] 10.3 `node --check main.js verge.js` + smoke test.

## 11. Full verification pass

- [x] 11.1 `node --check` on every touched file (`verge.js entities.js player.js main.js weather.js index.html` html excepted) — all clean.
- [x] 11.2 5-shot smoke test per the repo recipe — all `READY … err=0`; diff-eyeball one city shot against a pre-change screenshot (no worldgen drift — this change adds zero buildChunk geometry).
- [x] 11.3 End-to-end playthrough: accept a LEAD → solve all five sites in any order (using only diegetic clues; note anywhere a clue felt unreadable and fix the clue text, not the difficulty) → carry pieces visibly → assemble and start the Engine → storm + beacon + whistle. Confirm persistence at three points (mid-site, pieces-held, post-gate) via reloads.
- [x] 11.4 Regression sweep: classic errands still offer and complete (post-gate pick pool), Ciphers untouched (solve one cache), trials untouched (run one trial), satchel navigation with ~12 item types, heat/weather behavior unchanged outside the scripted trigger.
