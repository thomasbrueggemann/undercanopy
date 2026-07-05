# CANOPY — the overgrown city

A first-person exploration game in a single HTML file + one script, built on **three.js** (r152).

**2087.** The Warming moved civilization into the shade. Engineered megaflora swallowed the
cities, and now people live in the cool green street-canyons beneath the leaves. Above the
canopy the sun burns at 54 °C — you can climb out any time you like, you just can't stay.

## Run it

Just open `index.html` in a browser (double-click works — everything is local and procedural,
no network needed). Chrome/Edge/Safari, a laptop from the last few years is plenty.

If your browser is strict about `file://` pages:

```sh
cd canopy
python3 -m http.server 8080   # then open http://localhost:8080
```

## Controls

| Input | Action |
|---|---|
| Click | capture the mouse / resume |
| Mouse | look |
| W A S D | move |
| Shift | sprint |
| Space | jump (or kick off a wall while climbing) |
| **W while facing vines** | climb — look up to ascend, down to descend |
| T (hold) | fast-forward time |
| **E** | talk to a citizen who hails you / take the errand they offer |
| F | flashlight on/off |
| M | sound on/off |
| R | return to your last shaded spot |
| Esc | pause |

## What's in the world

- **Infinite procedural city** — deterministic chunks: row-house blocks, tower districts,
  parks, ruined plazas, groves. Streets with faded lane markings, sidewalks, abandoned
  overgrown cars, street lamps (some still work), power poles with sagging wires, market
  stalls, rooftop water tanks and gardens.
- **The people** — cloaked citizens stroll the sidewalks, chat in pairs, sweep, tend the
  moss, kids run loops, and lantern-carriers wander after dark. They'll nod as you pass.
- **Climbing** — vine-covered facades and giant trunks are climbable. Mantle onto rooftops,
  or walk the springy roof of the forest itself.
- **Heat** — a day/night cycle drives temperature. Under the leaves you're safe; above the
  canopy (or in open plazas at noon) your body heat climbs. Overheat and you wake up back
  in the shade.
- **The Spire** — follow the ✦ marker on the minimap to the old broadcast tower and climb
  above the canopy for the reveal. It's also the first of your **vantages**.
- **Errands** — the under-dwellers hail you as you pass; a gold ✦ floats over anyone with
  something to ask. Press **E** to take the job, and the ✦ retargets to it:
  - **Vantages** — climb a tall rooftop or a giant trunk and summit it; the peaks you've
    topped stay pinned on the minimap.
  - **Sun-runs** — sprint out to a cache in the open and back under the leaves before your
    body heat fills the bar. The heat gauge *is* the timer.
  - **Lamplighter** — at dusk, wake the dead street-lamps down a row before true night.
  - **Deliveries** — carry a parcel to someone in a neighbouring named district.
- **The Second Seed** — a 7-chapter story campaign that unlocks once you've summited the
  Spire. An old under-dweller, **the Archivist**, keeps the fallen Botanic Authority's
  papers and needs young legs to walk a trail: recover scattered pieces, decode the route,
  open a sealed vault, and re-sow the cultivar bred for the ground where the first planting
  failed. It tours every kind of landmark the world makes, and the finale changes one place
  in the world for good. Press **E** at the Archivist (at the base of the Spire) to begin;
  the campaign runs alongside the errands and Trials without interrupting them.
- **Day & night** — dawn glow, blazing noon, fireflies, bioluminescent glow-moss, lit
  windows, stars, drifting clouds. After dark the working street lamps throw real pools
  of warm light, and you carry a **flashlight** (F) that lights wherever you look. All
  audio (wind, birds, crickets, footsteps) is synthesized live with WebAudio.

## Tech notes

- three.js r152 (UMD build, vendored as `three.min.js`); everything else is `game.js`.
- All textures are generated on canvas at boot; all geometry is procedural and batched
  per chunk (~6 draw calls per chunk) with vertex colors.
- Headless smoke test / screenshots:
  `chrome --headless=new --enable-unsafe-swiftshader --virtual-time-budget=6000 --screenshot "index.html?shot=1"`
  (`shot=1` street, `shot=2` above the canopy, `shot=3` night).
