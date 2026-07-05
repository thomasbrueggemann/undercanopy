# The Three Veils — multi-layered canopy design

The canopy stops being decoration and becomes a layered, intertwined green superstructure
above the city, with three playable sub-layers. All geometry is procedural, batched per
chunk (`Batch`), deterministic per chunk seed, and integrated into the existing collision
arrays (`colData.solids / trunks / pads`).

## Vertical zoning (keyed to CANOPY_Y = 24, the sun line)

| Layer | Height | Light | Role |
|---|---|---|---|
| L1 Bough Roads | 15–20 m | shaded (safe) | walkable limb highways connecting trees ↔ rooftops |
| L2 The Weave | 24–28 m | dappled (risky) | semi-continuous walkable leaf lattice with light wells |
| L3 Crown Nests | 32–40 m | full sun (exposed) | sparse emergent platforms, lookouts, glow gardens |

## L1 — Bough Roads (~15–20 m)
- Thick horizontal limbs (chained, slightly rotated cylinder segments → gentle curves,
  radius ~0.5–0.8 m, walkable top) growing from street trees at ~60–75% of trunk height.
- Spans: tree → neighboring tree, tree → rooftop (land on parapet height), occasional
  street crossings. 2–4 spans per chunk, more in `park`/`grove`.
- Collision: register each limb as a series of small `pads` (walkable) plus `trunks`
  for the side-block; keep pad radius ≈ limb radius so you can fall off.
- Dressing: moss tint on top, small leaf tufts, hanging vine fringes below.

## L2 — The Weave (~24–28 m)
- Dense interlocking leaf platters (flattened blobs, r 4–8) + woven limb lattice tying
  neighboring trees' crowns together. Coverage ~60–75% per chunk, ZERO over `plaza`
  chunks (they stay open sky) and thin over streets in `city`.
- Light wells: deliberate 4–8 m gaps; you can fall through them. They align with the
  existing openRect logic where present.
- Walkable: platters push `pads`; keep existing per-tree pads too.
- Cross-chunk continuity: border-spanning platters/limbs decided by `hash2(ix, iz, salt)`
  on the shared border (same trick as power-pole side selection) so both chunks generate
  the identical half.

## L3 — Crown Nests (~32–40 m)
- Only on `grove` giants (h 33–42) and `towers` roofs: woven basket platforms (r 2.5–4),
  railings of bent twigs, 1–2 leaf umbrellas overhead casting a small real shade patch.
- Night: glow plants + a lamp-material beacon blob on some nests.
- Reached by climbing the giant trunk or a vine rope from L2.

## Intertwining / vertical connection
- Vine ropes: climbable vertical vines hanging from Weave underside and limb forks down
  to Bough Roads / rooftops / ground. Implement as thin cylinders + register as
  `trunks` entries (r ~0.35) so the existing climb code (`CLIMB_SPEED`) works untouched.
- Spiral limbs: around 1-in-4 tall buildings, a limb wraps a corner as it rises
  (3–5 segments), doubling as a climb/walk route.

## Systems integration
- Shade logic: unchanged — L1 sits below CANOPY_Y (shaded), L2/L3 above (exposed).
  L3 leaf umbrellas rely on the real shadow map (`shadeRay`/exposure check) for shade.
- `sea` (canopy-sea ring) stays; raise its y to ~30 so L2 reads under it from above? No —
  keep 26.5 but hide it while player is between 24 and 32 to avoid clipping the Weave.
- Minimap: Weave platters optional; skip for now.
- Messages: new `once()` hints for first limb walk, first light well fall, first nest.
- Perf: everything through existing batches; aim < ~40% triangle increase per chunk;
  no new materials unless needed (moss tint via vertex colors).

## Implementation phases (sequential, single file game.js)
1. Core geometry + collision: limb builder, Bough Roads, Weave lattice + light wells,
   cross-chunk continuity.
2. Verticality: vine ropes (climbable), spiral limbs, Crown Nests, sea-ring visibility fix.
3. Polish: moss/height color gradient, hanging fringes, glow, messages, tuning, smoke test.

---

# Anomalies — unpredictable landmarks in the grid

Three tiers of rarity break the regular chunk rhythm. All deterministic (hash2), batched,
integrated with colData physics and the heat system.

## Tier 1 — landmark chunk types (override chunkType, mutually exclusive with spire)
- **colossus** (~1/40 chunks): mega-tree, trunk r≈6, h≈55, piercing all three veils.
  Root buttresses form crawl-through ground caves (solids with gaps). A limb staircase
  spirals up the trunk (walkable pads). Crown carries a nest hamlet: 3–4 linked basket
  platforms with limb bridges, glow gardens, a beacon. Visible far off = navigation.
- **fallen** (~1/25): a tall tower collapsed diagonally against a neighbor: tilted box
  facade as a walkable ramp (street → roof, sloped collision via a rising series of
  pads), rubble field, vine streamers. The standing neighbor keeps normal collision.
- **sinkhole** (~1/25): street block caved into a bowl: rock rim ring, pit floor at
  y≈-4 (a dark disc + pads so the player can descend/stand), hanging roots from rim,
  dense glow plants + fireflies bias; air is cooler at the bottom (small heat drain).
- **reservoir** (~1/25): one wide low building (h≈8) filled with still dark water
  (semi-transparent plane at parapet level, y≈7.8). Standing in it (feet near water y,
  inside rect) drains body heat fast. Dragonflies = reuse pollen-style drifters? No —
  keep it simple, skip particles. Ladders/vines to climb up.

## Tier 2 — the Elevated Line (cross-chunk linear ruin)
Ruined overpass along rare grid lines: chosen by hash2 of the street line index
(like power-pole side selection) so ~1 in 7 x-lines / z-lines carries one; deck at
y≈9 (below Bough Roads), 6 m wide, on concrete piers every ~16 m. Per-chunk deterministic
gaps where spans fell (jumpable 2.5–4 m, some too wide = dead ends), collapsed span
debris below, grass + saplings on deck, occasional stranded bus/train car (stretched
addCar or box shape), guard rails. Deck registers pads/solids for walking; piers = trunks.

## Tier 3 — small oddities (sprinkled by rng in normal chunks)
- greenhouse skeleton: arched rusty ribs + a few glinting glass shard quads (lamp
  material at low emissive), inside: dense glow plants.
- wind-chime pole: hanging bottles/shells on strings from a pole or wire; near it a
  soft procedural chime tinkle (reuse audio system patterns, gated by AC).
- shrine niche: small candle box at a building corner: lamp-material flame dot at
  night, dried flowers.
- fern circle: ring of tall fern fronds (grass quads scaled up) in parks/groves.

## Heat hooks
- sinkhole bottom (y < 0): air reads cooler (−6 °C) and heat drains ~2× shade rate.
- reservoir water: heat drains fast (~4×) while feet in water; brief msg once().

## Implementation phases
A. Tier 1 + Tier 2 (structures, collision, heat hooks, minimap dots optional).
B. Tier 3 oddities + messages + audio chime + tuning + headless smoke verification.

---

# Districts — architectural identity per neighborhood + building variance

## District grid
- District = 3×3-chunk region: `dix = Math.floor(ix/3)`, `diz = Math.floor(iz/3)`;
  style = hash2(dix, diz, salt) pick, weighted: oldtown 25%, blocks 25%, glass 15%,
  works 15%, garden 20%. Spire chunk keeps its build regardless.
- Style influences: palette, building shape/height ranges, roof type, ornament set,
  vine/moss weights, window rhythm. chunkType stays as-is (city/towers/park/... still
  set density/layout); the district style restyles what gets built.

## Styles
- **oldtown**: h 6–13, narrow (w 7–11), warm plasters (terracotta/ochre/rose/cream),
  pitched gable roofs (triangular prism, two sloped quads + gable ends), awnings over
  storefronts, shutters (dark slat quads beside windows), chimneys, denser vines.
- **blocks**: h 15–34, wide slabs (w 14–22), pale grey/beige, flat roofs, balcony grid
  (small protruding slabs + rail on facade), occasional big faded mural rectangle
  (2-tone painted quad), sparse ornaments, medium vines.
- **glass**: h 25–55 in towers-chunks / 12–25 otherwise, tiered: 2–3 stacked shrinking
  boxes with setbacks; facade tint cool blue-green, stronger night emissive (windows lit
  more — check matBld emissive mechanism / window atlas usage for a per-building boost
  via vertex color or second material — keep simple), roof antenna cluster, light vines.
- **works**: h 6–12 sheds (w 16–24), sawtooth roof (3–5 asymmetric prisms), rusted
  corrugated tint (rust/brown/dark red), brick chimney (tall thin box, darker), silo
  cylinders, pipes between buildings, heavy vines + rust streak tint.
- **garden**: h 4–7 small detached (w 6–9) with gaps between, hip-ish roof (pyramid),
  pastel palette, low fences (thin boxes) around yards, garden trees + extra grass,
  heavy greenery.

## Per-building micro-variance (all districts)
- 20% tiered (2–3 stacked boxes, shrinking 15–30% per tier, each tier gets parapet).
- 12% ruin variant: reduced height + exposed top floor: no roof slab, ragged parapet
  (broken segments), interior floor slab visible, heavy vines, rubble at base.
- 15% street arcade: ground floor inset with columns (city/oldtown only).
- balconies, corner chamfer (oldtown/glass), roofline clutter per style.

## Implementation phases
A. District grid + style plumbing through buildChunk→addBuilding; palettes; shapes:
   pitched/sawtooth/pyramid/tiered roofs; height/width ranges; per-style vine weights.
B. Ornaments (awnings, shutters, balconies, murals, chimneys, silos, fences, arcades,
   antennas), ruin variant, glass night-glow boost, district name → style coupling
   (optional: name pools per style), tuning + headless smoke verify + screenshots.

---

# Waterways, Animals, Hidden Hamlet, Details

## Waterways (canals)
- Line selection like the viaduct (hash2 of street-line index, own salt, ~1/8 lines);
  a canal replaces the road surface along that line: channel bed at y=-1.2, mossy
  stone embankment walls, water plane at y=-0.35 (reuse matWater + water descriptor →
  wading/heat relief works). Streets crossing a canal get an arched stone bridge
  (walkable, low parapets); mid-block occasional plank footbridge. Reeds + lily pads
  + drifting leaf quads. Canal chunks: reuse pit-style ground exception for the bed.
- Where canal meets viaduct line: both render (water below, rails above).

## Animals ("The Returned") — pooled, simple geometry, spawn near / despawn far
- Ground: cats (slink along building edges, sit), boars (root in parks), frogs (hop
  near canal/reservoir water, tiny). 
- Sky: day bird flocks (5–9 birds, flapping V drift), dusk bats (erratic), a raptor
  circling high above landmark chunks (colossus/spire).
- Canopy: monkeys/squirrels leaping tree-to-tree between canopy pads in arcs.
- Behavior: cheap state machines + sine animation; day/night rosters; no collision.

## Hidden Hamlet (treehouse district + discovery challenge)
- One deterministic chunk in ring 6–10 from spire (hash-picked, never on an anomaly):
  grove of giants carrying a treehouse village: plank platforms (walkable pads), rope
  bridges (limb-style with rails), stilt huts (small gable-roofed boxes on platforms),
  ladders/vine ropes, lanterns (lamp material), 2–3 resident NPCs, glow gardens.
- Hidden: no minimap presence until discovered (within ~25 m); dense Weave above.
- Trial "The Rumor": trial-master gives 3 sequential cryptic waypoint clues (each a
  real world feature: a viaduct broken span, a sinkhole, a fern circle...) — reaching
  each within a generous radius reveals the next; final clue leads to the hamlet.
  Completion: permanent minimap marker + unique resident errand + reward line.

## Little details (sprinkle pass)
Benches, rusted mailboxes, laundry lines between facing windows, puddle quads (dawn
hours, fade by noon), mushroom clusters on deadwood/rubble, cobweb corner quads in
arcades, birds' nests on lamp heads, market litter (crates, cloth scraps) near stalls.

---

# Regions — macro map variance

Chunk types and district styles are i.i.d., so beyond ~200 m the world reads the same
everywhere. Regions overlay a continent-scale field so some quarters are greener, deader,
or more ruined than others — bands and pockets hundreds of metres wide.

## The field (core.js)
- `valueNoise2(x, z, salt)` — bilinear interpolation of hashed lattice corners with a
  smoothstep fade. Allocation-free; deterministic on `hash2` (identical every session).
- `regionAt(ix, iz)` → `{ verdancy, ruin, biome }`. Two smooth scalars: `verdancy` and
  `ruin`, each `0.65×`(wavelength-12 octave) `+ 0.35×`(wavelength-5 octave for edge wobble).
  Thresholds (tuned to a 100×100 window: scorch≈15%, deepgreen≈14%, ashen≈8%):
  `verdancy < 0.32 → scorch`, `> 0.66 → deepgreen`, else `ruin > 0.66 → ashen`, else `canopy`.
- `regionBiome(ix, iz)` — the allocation-free biome-string hot path used by
  `baseChunkType`'s weight remap and by mission/trial ring scans (which call `chunkType`
  over hundreds of chunks). `regionAt` (returns an object) is called once per chunk build
  and by the minimap/HUD; it is globally accessible for the campaign's `nearestBiomeChunk`.
- **Exclusion:** the Spire and Hamlet chunks and their 8 neighbours each clamp to full
  canopy (`verdancy ≥ 0.45`, `ruin ≤ 0.5`) so the landmark and hidden village never spawn
  sun-blasted. (`_hamletCell` is wired up once `HAMLET` is computed.)

## Effects (all modulation — no new chunk types or materials)
`buildChunk` computes `REG = regionAt(ix, iz)` once into module-scoped `CUR_REG` (the same
pattern as `CUR_STYLE`); builders read it. Leaf tint is a vertex-colour lerp in
`leafTintByY`; grass in `addGrassTuft`; facades/heights/vines/nests in `addBuilding`.
- **scorch** ("the canopy failed here"): ~75% of street trees skipped, survivors dead snags
  or stunted; no bough/weave/crown-nest layers (exposure follows from real shadow rays);
  olive-tan leaves, straw grass, sun-bleached facades, vines ×0.15, plaza-heavy chunk mix
  (grove→city), fewer/rustier cars, 2–4 bleached snag trunks. Streets are lethal at noon.
- **deepgreen** ("the flora won"): tree density ×1.6, bigger, giants ~15% in any chunk type;
  Weave ≈90%, extra vine ropes, dark-green leaves, glow/fireflies ×1.8; buildings ×0.8
  height with a raised moss line; grove/park-heavy mix (towers→city); grass through the asphalt.
- **ashen** ("intact canopy, dead city"): building ruin variant 55%, heights ×0.75, collapsed
  lots ×2, extra street rubble, working lamps ×0.3, grey-dusted vegetation, ambient NPC target
  count ×0.5 (entities.js).
- **canopy** (baseline): micro-drifts with `verdancy` — tree density ±25%, building vine weight ±30%.

## Surface
- Minimap chunk background keys off biome (tan scorch, deep-green deepgreen, grey-brown ashen).
- HUD district line appends the biome for non-canopy quarters ("Kettle Rows — the Scorch" /
  "— the Deep Green" / "— the Ash Quarters").
- First ground-level entry into a non-canopy biome fires a one-shot mood line (`once('biome-…')`).
- Dev hook: `?px=&pz=` (SHOT mode only) drops the camera at chosen world coords for screenshots.

---

# The Second Seed — story campaign

A 7-chapter storyline (`story.js`, loaded last) that deliberately tours every kind of
landmark the world makes — spire, districts, plaza, reservoir, crown nest, fallen tower,
viaduct, canal, hamlet, sinkhole, and the Scorch — and whose missions are puzzle pieces,
not fetch quests: shards retrieved in Ch2 become the key to the Ch4 solar puzzle; a riddle
decodes into a real viaduct span-count; the finale permanently greens one place and relights
the Spire's beacon. Coexists with errands/Trials: it pauses its marker for them but never
loses progress. Unlocks after the player has summited the Spire once (`canopy.summited`).

## Architecture
- Mirrors the Trials house pattern: a `story` state object, a switch in `updateStory(dt, time)`
  over `story.ch`/`story.phase` (called from the main loop right after `updateTrials`), pure-hash
  ring-scan finders, a pooled marker set (`STORY_POOL`, ≤6 meshes, gold + green materials), and
  HUD writers reusing the mission/minimap elements (`✦ CH.3 — THE FLOODED ARCHIVE`).
- **Objective priority** is trial > errand > story > SPIRE, enforced inside `updateStory` (it
  writes `activeObjective`/HUD only when no trial or errand is live). Between chapters the ✦
  points at the Archivist, not the Spire — the campaign is the spine until it's done.
- **Persistence:** `canopy.story` = `{ v:1, ch, shards, haveKey, haveSeed, planted:{dx,dz}, … }`,
  bootstrapped **once in core.js** into a `STORY_SAVE` global so worldgen can read planted/complete
  state before `story.js` runs (chunks build first). `story.js` owns all writes. `planted` is stored
  spire-relative (offset in chunks) so the grown oasis survives the per-session `SPIRE` re-roll —
  the same tradeoff HAMLET makes.
- **The Archivist** (giver NPC, role `'archivist'` in entities.js — trial-master body, dusty-amber
  cloak, crates/papers): one deterministic anchor at `SPIRE.x+14, SPIRE.z+6`, spawned/culled in a
  3×3 window like the trial-masters.

## Chapters
1. **The Dead Broadcast** — climb the Spire; find the nearest oldtown records hall (E).
2. **Shards of Noon** — three sun-runs (plaza openRect · reservoir roof · crown-nest pad); shards
   only glint while `dayF > 0.5`. The shards are the Ch4 puzzle pieces.
3. **The Flooded Archive** — wade a reservoir · reach a fallen-tower ramp top · ride a viaduct
   deck (untimed checkpoints) to a broken span; sets `rangeBlocks = 4 + hash2(SPIRE.cx,cz,4444)%3`.
4. **The Heliograph** — set the three shards in sun-clock sockets at the summit; at noon
   (`dayT ∈ [0.47, 0.57]`) a scene-level emissive beam fires toward the Root Vault sinkhole (nearest
   sinkhole ring ≥ 5 from the spire); the bearing is derived from the found sinkhole, so the clue is
   always true. No minimap marker — walk the bearing.
5. **The Warden's Key** — the Hidden Hamlet (reuses the Rumor waypoints if undiscovered; the Rumor
   trial then completes with a nod, guarded via `STORY_SAVE.foundHamletViaStory`) · elders · a
   viaduct×canal crossing, then a canal chase to the key.
6. **The Root Vault** — return to the vault sinkhole at night; a three-knot order puzzle
   (dawn = easternmost, dusk = westernmost, water = the other); descend for the Second Seed. Carrying
   it disables sprint (`storyCarrying`, gated in player.js) and fouls the flashlight (Salvage mechanic).
7. **The Scorch Bloom** — carry the Seed to the heart of the nearest Scorch region (hill-descend
   verdancy to a local minimum); hold E to plant (3-second channel); the planted chunk hot-swaps to
   the **Sapling of the Second Seed** (young giant + glow ring + grass through asphalt, an oasis dot on
   the minimap). Epilogue: the summit beacon is relit permanently (`buildChunk` checks `storyComplete()`).
   Reward — **Seedbearer**: the minimap marks anomaly landmarks in loaded chunks.

## Rules & touch points
- Every finder has a widened-radius fallback; if a scan fails entirely (theoretical), the objective
  falls back to the Archivist with an apologetic line and retries on next accept — no chapter soft-locks.
- Ch4→5 and Ch6→7 chain in the field (Archivist lines arrive as an "old voice in your head"); all
  other transitions return to the Archivist hub.
- Markers use a separate pool (never fight Trial markers); the heliograph beam is one scene-level mesh,
  created once, hidden when idle. Finders run only at phase transitions (never per-frame `peekColData`).
- Touch points outside `story.js` (each marked in-code): index.html (script tag), player.js (E handler
  story-first + sprint gate), main.js (loop call, minimap oasis/Seedbearer/Archivist dots, `summited`
  persistence, Rumor-trial guard), entities.js (`'archivist'` role), worldgen (sapling + relit beacon
  behind cheap `storyPlantedAt`/`storyComplete` guards), core.js (`STORY_SAVE` bootstrap).
- Dev hook: `?story=N` jumps to chapter N with prerequisites granted (shards/key/seed), used by the
  smoke tests (`?shot=1&story=N` → READY).
