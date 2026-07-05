# The Second Seed — story campaign & Regions — macro map variance

Two systems, designed together. The **Regions** pass breaks the world's uniformity with
continent-scale biome variance; the **campaign** is a 7-chapter storyline whose chapters
deliberately tour every kind of landmark the world generates — spire, districts, plaza,
reservoir, crown nests, fallen tower, viaduct, canal, hamlet, sinkhole, colossus, and the
new Scorch biome — and whose missions are puzzle pieces, not just fetch quests: artifacts
retrieved early become the key to a solar puzzle later; riddles decode into real world
features; the finale permanently changes the world.

Everything below respects the engine's invariants: deterministic per-chunk generation from
`hash2`, batched geometry, `colData` collision registration, anchors recomputed per session
from `SPIRE` (which is randomized each load — the HAMLET IIFE is the precedent), progress
persisted in `localStorage`, no new textures/materials unless stated.

---

# PART 1 — REGIONS: macro-scale map variance

## Problem
Chunk types are i.i.d. per chunk and district styles are i.i.d. per 3×3 block, so at any
scale beyond ~200 m the world is statistically identical everywhere. There is no "over
there" — nowhere is greener, deader, wilder, or more ruined than anywhere else.

## The region field
Two continuous scalar fields over chunk coordinates, built from hash-based value noise
(bilinear interpolation of `hash2` lattice values at wavelength **12 chunks**, plus a
half-amplitude octave at wavelength 5 for edge wobble):

```js
// core.js — next to hash2
function valueNoise2(x, z, salt) { /* bilinear hash2 lattice interp, smoothstep t */ }
function regionAt(ix, iz) {
  const verdancy = 0.65*valueNoise2(ix/12, iz/12, 4201) + 0.35*valueNoise2(ix/5, iz/5, 4202);
  const ruin     = 0.65*valueNoise2(ix/12, iz/12, 4301) + 0.35*valueNoise2(ix/5, iz/5, 4302);
  let biome = 'canopy';                          // the familiar baseline city-forest
  if (verdancy < 0.30) biome = 'scorch';         // canopy failed here — open sun, bleached
  else if (verdancy > 0.72) biome = 'deepgreen'; // engineered flora won completely
  if (biome === 'canopy' && ruin > 0.72) biome = 'ashen';  // intact canopy, dead city
  return { verdancy, ruin, biome };
}
```

Target coverage (verify by sampling ~10k chunks in the smoke test): scorch ≈ 12–18 %,
deepgreen ≈ 12–18 %, ashen ≈ 8–12 %, canopy the rest. Regions must read as *bands and
pockets hundreds of meters wide*, not per-chunk noise. `regionAt` must be cheap (called
in loops) and exported for the campaign (Part 2 needs `nearestBiomeChunk`).

**Exclusions:** the SPIRE chunk and the HAMLET chunk keep full `canopy` treatment
regardless of field values (clamp verdancy ≥ 0.45, ruin ≤ 0.5 for those two chunks and
their 8 neighbors each) so the tutorial landmark and the hidden village never spawn
sun-blasted.

## Biome effects in buildChunk (all modulation, no new chunk types)

`buildChunk` computes `const REG = regionAt(ix, iz)` once and threads it (module-scoped
`CUR_REG` alongside the existing `CUR_STYLE` is acceptable — same pattern).

### scorch — "the canopy failed here"
The one place the game's core threat rules the ground during the day. Streets are
dangerous at noon; crossing a scorch band is a route-planning decision.
- Street trees: ~75 % skipped; survivors are `dead: true` or short (h 8–14, R 3–5).
- Bough/Weave/Nest layers: skip entirely (no `addLimb` spans, no weave platters, no
  crown nests). Exposure then follows automatically from the real shadow rays — no
  special heat hook needed, DO NOT hack stepHeat.
- Leaf tint for surviving foliage: shift toward olive/tan (lerp leaf colors toward
  0x8a7a3a by ~0.55). Grass tufts sparse and straw-colored.
- Buildings: intact but sun-bleached — facade tints lerped toward pale bone (+15 %
  lightness, −40 % saturation); vine probability × 0.15 (vines need shade). Fewer
  parked cars rusted brighter.
- chunkType weighting: within scorch, remap the common-type roll so plaza/city dominate
  (plaza ×2.5 weight, grove → city). Anomaly rolls unchanged (a scorch sinkhole —
  shade at the bottom of a dead zone — is a gift, and Ch7 uses scorch reservoirs).
- Ground dressing: 2–4 bleached snag trunks (dead trees), heat-shimmer is out of scope.
- Minimap chunk background: sand/tan family (e.g. `#2a2412` range).
- Mood line (once per biome, same mechanism as DISTRICT_MOOD):
  "The leaves thin, then fail. Open sky over dead streets — the sun owns this quarter.
  Cross it fast, or cross it at night."

### deepgreen — "the flora won"
- Street trees: density ×1.6, h +20 %, R +15 %; giants (trunkR ≥ 1.9) roll in ANY
  deepgreen chunk type at ~15 % per tree line, not just groves.
- Weave coverage toward 90 %; extra vine ropes (×1.5); crown nest chance ×1.3.
- Leaf tint: deepen toward saturated dark green (lerp toward 0x1e4412 by ~0.4); glow
  plants and fireflies ×1.8 (night in deepgreen should feel bioluminescent).
- Buildings: shorter (h ×0.8, the flora crushes them), vine probability ×1.6, moss
  creep line rises (mossy tint applies up to y≈3 not just ground).
- chunkType weighting: grove ×3, park ×1.5, towers → city.
- Streets: grass tufts through the asphalt (~8 per chunk on the road surface itself).
- Minimap background: deep green family.
- Mood line: "Under the deep green the day never quite arrives. Trunks like towers,
  towers like trunks — the city is only a rumor down here."

### ashen — "intact canopy, dead city"
- Buildings: ruin variant probability → 55 % (from 12 %); heights ×0.75; collapsed-lot
  probability ×2; extra rubble rocks along street edges.
- Fewer NPCs feel: no worldgen hook needed — entities.js spawns near the player; add a
  0.5 multiplier on ambient NPC target count when the player's chunk is ashen (one-line
  hook in entities.js where the roster size is decided).
- Lamps: `working` probability ×0.3 (dark streets at night).
- Vegetation normal (canopy intact) but tinted slightly grey-dusted.
- Minimap background: grey-brown family.
- Mood line: "Whole blocks gone to rubble under a healthy roof of leaves. Whatever
  emptied these streets, the forest never noticed."

### canopy (baseline)
Unchanged, EXCEPT: verdancy within [0.30, 0.72] should still micro-modulate tree density
(±25 %) and building vine weight (±30 %) so even the baseline drifts instead of being flat.

## Integration checklist (Part 1)
- `regionAt` in core.js; used by `baseChunkType` (weight remap — keep the function
  deterministic and cheap; the campaign and trials call `chunkType` in ring scans).
  IMPORTANT: `nearestChunkOfType`, HAMLET selection, and trial feasibility all call
  `chunkType` in loops over hundreds of chunks — `regionAt` must stay allocation-free.
- buildChunk modulation per the tables above (worldgen-anomalies.js buildChunk +
  worldgen-builders.js helpers; prefer passing REG through existing opts).
- Minimap: `bgFor` becomes a function of (type, biome).
- HUD: the district line appends the biome for non-canopy biomes: "Kettle Rows — the
  Scorch" / "— the Deep Green" / "— the Ash Quarters".
- Mood lines: `once('biome-'+biome, ...)` on first ground-level entry.
- The canopy *sea* ring (the distant leaf roof seen from above) is a single global
  texture — leave it; distance fog forgives it.
- Verify: `?shot=1..5` all still READY; add sampling stats (biome percentages over a
  40×40 chunk window) logged in shot mode; screenshots of a scorch edge and a deepgreen
  street (pick coordinates by scanning regionAt for a boundary near spawn).

---

# PART 2 — THE SECOND SEED: a 7-chapter campaign

## Premise (fits existing lore)
2087. The megaflora that saved the cities was engineered by the old **Botanic
Authority** — and it was shipped with a fail-safe nobody ever used: a **Second Seed**,
a dormant cultivar bred to take root where the first planting failed. The Authority
fell before the scorch quarters could be re-sown; its records scattered, its vault
sealed. **The Archivist** — an old under-dweller who keeps the Authority's surviving
papers — has spent a lifetime assembling the trail, and needs young legs to walk it.

The campaign is the trail: recover the pieces, decode the route, open the Root Vault,
and plant the Second Seed in the heart of the Scorch. The finale permanently greens one
place in the world and lights the Spire's beacon again.

## Architecture
- New file **story.js** loaded after main.js (add `<script src="story.js">` to
  index.html). Exposes `updateStory(dt, time)` called from the main loop right after
  `updateTrials`, and `storyInteract()` tried from the E handler in player.js
  (priority: story NPC > trial-master > errand giver — story interactions are rarer
  and positional, so they win ties).
- State: `story = { ch, phase, ...perChapterFields }`; persisted:
  `canopy.story = { ch, shards, haveKey, haveSeed, planted: {dx,dz} }` (planted stores
  the offset from SPIRE in chunks, so the grown tree survives the per-session spire
  re-roll the same way HAMLET does).
- The campaign COEXISTS with errands/trials: accepting a trial or errand pauses the
  story objective marker but never loses chapter progress (story state only advances at
  its own checks). While a story chapter is active, `activeObjective` priority is:
  trial > errand > story > SPIRE.
- The minimap label/mission panel reuse the existing elements; when only the story is
  active: `✦ CH.3 — THE FLOODED ARCHIVE` style labels.
- All chapter target-finding uses the established patterns: pure-hash ring scans
  (`nearestChunkOfType`, `nearestViaduct`, `isCanalX/Z`) and `peekColData` for exact
  in-chunk feature positions. Every finder MUST have a deterministic fallback within a
  wider radius so no chapter can dead-end (the Rumor's finders are the template).
- Markers: extend TRIAL_POOL usage or mirror it with a small STORY_POOL (≤ 6 meshes,
  one gold `matRelic`-style material + one green). Never leak meshes.

## The Archivist (giver NPC)
- Spawns exactly like trial-masters (sync/cull in a 3×3 chunk window) but at ONE
  deterministic anchor: the base of the Spire, at `SPIRE.x + 14, SPIRE.z + 6` (offset
  keeps them off the spire footprint), facing the tower. Role `'archivist'` in
  makeNPCGroup — reuse the trialmaster body with a distinct cloak tint (dusty amber)
  and give them a small stack of crates/papers (two thin boxes) at their feet, built
  as part of the spire chunk or as scene-added props with the NPC.
- Between chapters the ✦ objective (when no mission/trial/story objective is live and
  `story.ch < 8`) points at the Archivist, not the SPIRE — the campaign is the game's
  spine now. After Ch7 it reverts to SPIRE behavior.
- Talk radius/hints identical to trial-masters ("Press E — the Archivist has a thread
  to pull").

## Story gating
The campaign unlocks after the player has summited the Spire once (`summited` flag or
persisted equivalent — persist it: `canopy.summited`). Until then the Archivist says
only: "Climb it first. The trail starts where the whole green world is visible at once."

## Chapters

Chapter data lives in one table (id, title, objective text, per-phase logic hooks) so
the update loop is a switch over `story.ch` / `story.phase` — mirror updateTrials' shape.

### Ch1 — THE DEAD BROADCAST  *(Spire interior · oldtown district)*
Teaches: the campaign loop, districts as places.
1. Archivist, at accept: "The Spire was a mouth once — the Authority spoke to every
   quarter through it. In the beacon room there is a sun-clock with an empty socket.
   Go up and read what is missing." Objective: the spire top (existing summit check
   region, y > SPIRE.h − 3, marker at beacon).
2. At the top, auto-fires: "The sun-clock's focusing glass is gone — pried out and cut
   into pieces when the Authority fell, the story goes. Three shards, three thieves,
   three hiding places." Phase 2 objective: the nearest **oldtown** district center
   (scan `districtStyle` over a ring for the nearest 3×3 district whose style is
   oldtown; target its central chunk's plaza-most point — use `peekColData` to find
   any openRect or fall back to chunk center). "The Authority kept a records hall in
   the old quarter. Find the door with the moss-eaten seal." E-interact at the marker
   (radius 3) → Ch1 complete: the ledger fragment names WHERE the shards went (sets up
   Ch2's three targets, quoted in-fiction):
   - "one went up where only the sun still visits" (crown nest)
   - "one drowned in the roof-lake" (reservoir)
   - "one lies in the open square, in plain sight of noon" (plaza)

### Ch2 — SHARDS OF NOON  *(three sun-runs across three biomes)*
Teaches: heat as a puzzle timer; long-range navigation. The shards are the puzzle
pieces the Heliograph (Ch4) needs — retrieval now, meaning later.
- Three targets, computed at chapter start, each ≥ 2 chunks from the player and from
  each other, biased into DIFFERENT compass thirds so the player fans out across the
  map: (a) nearest plaza `openRect` center, (b) nearest reservoir roof (water plane
  chunk; target y = parapet), (c) nearest crown-nest pad (`layer === 'nest'`, scanning
  loaded chunks first, then ring-peek).
- Each shard: gold marker, grab radius 2.5. The catch: a shard only GLINTS (marker
  visible + collectible) while `dayF > 0.5` — "you will never find them except when
  the sun is on them." At night the HUD objective says "wait for (or T toward) full
  day". Each grab in the open is a self-imposed sun-run: heat pressure while standing
  in exposure, retreat to shade between.
- Any order; HUD "Shards 1/3". Each pickup: a gold line about the shard's etched
  fragment — each names one third of a bearing riddle used in Ch4 (foreshadow, not
  yet actionable).
- Complete on 3/3: "Three cuts of one glass. The Heliograph can speak again — but it
  only speaks at noon." Shards persist in `canopy.story.shards`.

### Ch3 — THE FLOODED ARCHIVE  *(reservoir wade · fallen tower climb · viaduct run)*
Teaches: anomaly literacy. Pure exploration chapter between the two puzzle chapters.
1. Archivist: the sun-clock needs its ALIGNMENT TABLE, which sank with the survey
   office. Target: nearest **reservoir** (not the Ch2 one if distinguishable — pass an
   exclusion). Wade the roof-lake (must be in water: `player.inWater` && inside that
   chunk) at the marked point → "The ledger is pulp. One page survives: 'Fixed survey
   plate no. 9 — installed on the LEANING TOWER, the one that fell against its
   brother.'"
2. Target: nearest **fallen** chunk; player must reach the TOP of the tilted ramp
   (marker at the high end of the fallen slab, the existing walkable ramp; check
   y > rampTop − 2 within radius 6). Fires: "The survey plate, bolted to dead
   concrete: 'ALIGNMENT: from the mouth of the Spire at high noon. RANGE: ride the
   iron line and count what the years have eaten.'"
3. Range riddle resolves immediately into a viaduct leg: target the nearest viaduct,
   then walk/run its deck for 3 SPANS (reuse the Track-Runner checkpoint mechanics,
   64 m spacing, but UNTIMED — this is a sightseeing traversal, checkpoints only),
   ending at a **broken span edge**(findRumorClue1-style). At the edge: "Four spans
   stood, two fell. Remember the count: the light will ask for it." → sets
   `story.rangeBlocks` = 4 + (hash2(SPIRE.cx, SPIRE.cz, 4444) % 3) (i.e. 4–6; the
   fiction always phrases the counting rhyme to match the number chosen). Ch3 done.

### Ch4 — THE HELIOGRAPH  *(solar alignment puzzle at the Spire top)*
The puzzle chapter the shards were for. Teaches: time of day as a mechanic (T key).
1. Objective: spire top with all three shards. Three sockets (small E-interactions at
   three marked points around the summit platform, radius 2 each — place one shard per
   socket, any order; each placement = a click of glass, a line).
2. All three placed → "Now the sun must strike it. High noon. Wait, or push the hours
   (hold T)." When `dayT ∈ [0.47, 0.57]` AND the player is at the top: the Heliograph
   FIRES — a visible light beam (one long thin emissive box or a THREE.Line from the
   summit angled down-range — cheap, added to scene, removed after) pointing the
   TRUE BEARING toward the Root Vault sinkhole, plus the gold line: "The beam runs
   {bearingPhrase}. {N} blocks by the old count — where the street swallowed itself,
   the door is the floor."
3. The TARGET is computed like everything else: the nearest **sinkhole** chunk at
   ring ≥ 5 from the spire in the beam's compass eighth (scan rings 5–14; fallback:
   nearest sinkhole anywhere ring ≤ 14; the bearing text is derived FROM the found
   sinkhole, never the other way round, so the clue is always true).
4. NO minimap marker for the vault (Rumor rule: the words must be enough). The player
   walks the bearing counting blocks. Reaching the sinkhole rim (dist < 20 from pit
   center) completes Ch4: "A street that fell into the dark, {N} blocks down the
   beam-line. The Authority's door — and it is locked, of course."
   (Objective HUD during the walk: "Follow the beam — {bearing}, {N} blocks".)

### Ch5 — THE WARDEN'S KEY  *(hamlet elders · canal chase · viaduct-canal crossing)*
Teaches: the water network; ties the Hamlet into the main story.
1. Archivist: "Vault doors answer to a warden's key. The last warden went into the
   trees and never came out — the tree-people would remember." Objective: the Hidden
   Hamlet.
   - If `hamletFound`: go talk (E at the fire pit, radius 4).
   - If NOT found: the chapter runs the Rumor-style discovery — reuse the actual
     Rumor waypoints if the trial hasn't been done (start it silently as story
     phases): broken span → sinkhole/fern/chime → bearing-only hamlet walk. If the
     Rumor trial WAS completed, hamletFound is already true. (Never run trial and
     story copies simultaneously; if the player later takes the Rumor trial after
     Ch5 did the discovery, the trial completes instantly with a nod — guard it.)
2. Elder at the fire pit: "The warden's key? It went down the water the night he died
   — dropped from the high line where the rails cross the canal. Iron sinks; strings
   catch. Follow the water and look under the crossings."
3. The chase: find the nearest point where a **viaduct line crosses a canal line**
   (pure hash intersection scan: for each viaduct x-line within ±10 chunks, test canal
   z-lines within ±10, and vice versa; nearest crossing wins; guaranteed fallback =
   widen to ±16). From that crossing, 3 checkpoint markers DOWN the canal (64 m
   spacing along the canal line — "follow the water"), ending under a plank
   footbridge (`peekColData` of the end chunk for the canal's bridge anchor, else the
   canal centerline point): the key hangs on a chime-string. Grab (radius 2.5, must
   be at water level y < 1) → `story.haveKey = true`. Gold line + Ch5 done.

### Ch6 — THE ROOT VAULT  *(sinkhole · night · an order puzzle)*
The lock puzzle. Teaches: reading the world as a compass.
1. Objective: return to the Ch4 sinkhole (marker allowed now — you've earned the
   address), at NIGHT (`nightF > 0.5`): "Vault doors are Authority doors — they only
   wake when the glow-moss does."
2. Around the pit rim, three **root-knots** (three small story markers at hash-picked
   rim positions ~120° apart, E-interact each). The verse (given by the Archivist at
   chapter start AND repeated in the HUD objective): "Dawn's knot first, then dusk's,
   then the knot the water feeds." Mapping, computed from real geometry: dawn = the
   easternmost knot, dusk = the westernmost, water = the remaining one (phrase it
   third regardless — its identity is 'the other one'; if the sinkhole chunk happens
   to border a canal, the fiction lands extra true).
   - Correct order: each knot clunks ("Old iron turns somewhere under the street.").
   - Wrong knot: full reset with feedback ("The knots stiffen. Begin again — dawn
     first.") — soft, infinitely retryable.
3. Order complete → the pit floor "opens" (no geometry change needed: a story marker
   descends to the pit floor y ≈ −4 + glow burst message) — descend and take the
   **Second Seed** (E at pit floor): `story.haveSeed = true`. Carrying it: sprint
   disabled and flashlight fouled (exact Salvage mechanics — reuse) until planted.
   The Archivist line closes the chapter: "Now the hard mile. The Seed wants the
   worst ground in the world — the heart of the Scorch. Walk it at night if you love
   your skin."

### Ch7 — THE SCORCH BLOOM  *(finale: cross the Scorch, plant, ignite the Spire)*
The payoff; the biome system and campaign meet.
1. Target: the **heart of the nearest Scorch region** — scan rings from the player
   for the chunk minimizing verdancy within the nearest scorch-connected area (take
   nearest scorch chunk, then hill-descend verdancy over its 11×11 neighborhood to a
   local minimum — deterministic). Marker allowed but the JOURNEY is the challenge:
   no sprint (carrying), scorch daytime = lethal exposure en route; the smart play is
   the night crossing the Archivist recommended (or shade-hopping dawn).
2. At the target: plant (E, hold to a 3-second channel via repeated frames): the
   sunken message beat — a slow gold sequence:
   "You press the Second Seed into ground that has not felt shade in sixty years."
   → 3 s → "Nothing. Then — under your palms — the street CRACKS."
   Then the permanent world change (all persisted via `canopy.story.planted`):
   - The planted chunk (rebuilt on next load/regen via a `plantedAt(ix,iz)` check in
     buildChunk, and hot-swapped immediately: dispose + rebuild that one chunk) gains
     **the Sapling of the Second Seed**: a young giant (h ≈ 26, trunkR 1.6, vivid
     leaf tint), a ring of glow plants, grass breaking the asphalt — an oasis dot in
     the tan on the minimap (special marker like the hamlet hut).
   - Note: `planted` is stored spire-relative and the spire moves per session, so the
     oasis lands somewhere fresh each load — document in code that this is accepted
     (same tradeoff HAMLET made).
3. Epilogue objective: "Climb the Spire. See what you did." At the summit: the beacon
   — a `matLamp` emissive lamp head at the spire tip that now exists permanently
   (worldgen checks `story.ch > 7`) and glows at night — plus the closing lines:
   "Far off, in the dead quarter: one green point in all that bone-colored ground."
   / "The Archivist, when you tell them: 'Sixty years of paper, one seed, one pair of
   young legs. The Authority is dead. Long live the gardeners.'"
4. Permanent reward — **Seedbearer**: the minimap now marks anomaly landmarks
   (colossus/sinkhole/reservoir/fallen) in loaded chunks with faint icons ("you have
   learned to read the city the way the Authority did"), persisted flag.

## Chapter flow & UX rules
- One chapter active at a time; `story.ch` = next chapter to offer (1-based; 8 =
  campaign done). Chapters are STARTED at the Archivist (E), except Ch4→Ch5 and
  Ch6→Ch7 transitions which may chain directly in the field (the Archivist lines
  arrive as "you can hear the old voice in your head" gold messages) — reduce
  back-tracking on the two occasions the player is deep in the world; ch2→3 and
  ch5→6 return to the Archivist (spire base is central, revisiting the hub paces the
  arc and the walk itself crosses fresh regions).
- Every finder has a fallback; NO chapter may soft-lock. If a target can't resolve at
  all (theoretical), the chapter objective falls back to the Archivist with an
  apologetic line and retries the scan on next accept.
- `once()` keys for every story beat; all long msgs gold; durations 8–11 s.
- Story markers never fight trial markers (separate pool).
- Persistence surface: `canopy.story` JSON — version it (`v:1`) for future saves.
- Dev/test hook: `?story=N` URL param jumps state to chapter N with prerequisites
  granted (shards/key/seed as needed) — required for the smoke tests.

## Tour coverage matrix (why these chapters explore "the whole map")
| World feature | Chapter |
|---|---|
| Spire (climb, interior fiction, beacon) | 1, 4, 7 |
| Districts (oldtown hall; all biomes crossed en route) | 1 |
| Plaza openRect / sun-run | 2 |
| Crown nest (canopy L3) | 2 |
| Reservoir ×2 (roof-lake) | 2, 3 |
| Fallen tower ramp | 3 |
| Viaduct deck + broken span | 3, 5 |
| Sinkhole ×2 (incl. the Vault) | 4, 6 |
| Canal + footbridges + viaduct crossing | 5 |
| Hidden Hamlet + elders | 5 |
| Deep Green / Ashen (crossed; mood beats) | en route 2–6 |
| The Scorch (destination, night-crossing challenge) | 7 |
| Colossus | optional Ascent trial (unchanged) — and Ch7's sapling is its echo |

## Implementation notes for the agent
- Mirror the trial system's code shape (state object + switch in update + finders +
  markers + HUD writers). Read main.js:250–745 first; it is the house style.
- Touch points outside story.js (keep them minimal, comment each):
  index.html (script tag + nothing else), player.js E handler (story first),
  main.js loop (call updateStory; objective priority line), main.js drawMinimap
  (oasis dot + Seedbearer landmark icons), worldgen (sapling build in buildChunk when
  planted matches; spire beacon head when campaign done; both behind cheap checks),
  entities.js makeNPCGroup ('archivist' role tint).
- The heliograph beam: one scene-level mesh (thin stretched emissive box, ~200 m),
  visible only during the Ch4 noon-fire moment (~20 s) — do not add it to chunks.
- Never call peekColData in a per-frame path; finders run at phase transitions only.
