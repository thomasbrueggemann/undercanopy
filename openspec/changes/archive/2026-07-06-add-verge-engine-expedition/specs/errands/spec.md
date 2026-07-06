# Delta — errands (add-verge-engine-expedition)

## MODIFIED Requirements

### Requirement: Archetype selection never offers the impossible

The archetype picker SHALL only offer archetypes that are feasible at pick time: SUNRUN
requires day (day factor > 0.4) and a reachable open square or vined rooftop at least 26 m
tall; VANTAGE requires a vined rooftop (≥ 26 m) or a giant trunk (height > 20, radius ≥
1.2); LAMP requires dusk (day phase between 0.72 and 0.87) and at least three broken lamps
in loaded chunks; ERRAND is always possible. LEAD requires the verge-engine expedition to be
unfinished with at least one unsolved contraption site located this session; while feasible,
LEAD SHALL be weighted to dominate the pick (about three entries against one per classic
archetype) so givers mostly route the player into the hunt, and after the Verge Gate is
completed LEAD SHALL never be offered again. Apart from LEAD's weighting, the pick SHALL be
uniform among the feasible options. If an accepted mission's target has since become
unavailable, mission construction SHALL fall back to an ERRAND rather than issuing an
impossible mission.

#### Scenario: Dusk-only lamplighter

- **WHEN** the day phase is outside 0.72–0.87 or fewer than three broken lamps are loaded
- **THEN** the LAMP archetype is not offered

#### Scenario: Fallback to errand at accept

- **WHEN** a VANTAGE, SUNRUN, or LAMP mission is accepted but its target scan now returns nothing usable
- **THEN** the mission is built as an ERRAND parcel delivery instead

#### Scenario: Leads dominate while the Engine sleeps

- **WHEN** the expedition is unfinished with unsolved sites located and a giver picks an archetype
- **THEN** LEAD is offered with dominant weight, pointing at the nearest unsolved contraption site with its rumor line

#### Scenario: Leads retire with the Engine

- **WHEN** the Verge Gate startup has completed
- **THEN** LEAD is never offered and the picker returns to the classic pool

### Requirement: ERRAND — carry the parcel to a neighbouring district

An ERRAND mission SHALL target the centre of a district about two chunks away in a random
cardinal or diagonal direction, naming the district in the title and progress text. On
accept the parcel SHALL appear in the first-person carry rig (carry-props capability) and
remain visible until the handoff. The receiver spawning (within 55 m of the target), her
facing behavior, the 4 m delivery handoff, and her departure are specified by the
`parcel-delivery` capability; the errand system SHALL complete the mission with its reward
line at that handoff — the carry rig hands off visually to the receiver's take animation —
and MUST null its receiver reference before completion so cleanup cannot remove the
departing NPC.

#### Scenario: A real walk to a named district

- **WHEN** an ERRAND is built
- **THEN** its target is a district centre roughly two chunks away and the HUD reads "Deliver in <district>"

#### Scenario: Delivery completes via parcel handoff

- **WHEN** the player reaches the waiting receiver within delivery range
- **THEN** the handoff specified by parcel-delivery occurs, the carry-rig parcel transfers visually, and the mission completes with its reward line

## ADDED Requirements

### Requirement: LEAD — a rumor pointing at a contraption site

A LEAD mission SHALL target the nearest unsolved verge-engine contraption site with a
per-site rumor-flavored intro line, set the minimap objective to the site, and show
site-appropriate progress text. The mission completes when that site's piece is collected
(the expedition notifies the errand system); LEAD missions SHALL have no timer and no fail
state — abandoning one (e.g., for a trial) never resets the site's own puzzle progress. The
first accepted LEAD SHALL introduce the expedition fiction (the Edgewright rumor).

#### Scenario: A lead walks you to the machine

- **WHEN** a LEAD is accepted
- **THEN** the minimap objective points at the nearest unsolved contraption site and the HUD names the lead

#### Scenario: Solving the site completes the lead

- **WHEN** the player collects the piece at the lead's site
- **THEN** the LEAD mission completes with its reward line and mission credit

#### Scenario: Leads are patient

- **WHEN** a LEAD is abandoned for a trial and the site is revisited later
- **THEN** all puzzle progress at the site (seated flywheel, wiped plates, lit pilot, etc.) is exactly as the player left it
