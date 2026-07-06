# weather-events Specification

## Purpose
TBD - created by archiving change add-weather-events. Update Purpose after archive.
## Requirements
### Requirement: Occasional, fair, telegraphed scheduling

The system SHALL schedule weather events by an in-game dawn roll that is occasional and
fair. While no event is running, each time the day clock crosses dawn the system SHALL
roll a 35% chance of scheduling one event that day, subject to a session grace period
(no rolls in the first 4 real minutes), a cooldown of at least one full clear in-game
day between events, and the condition that no trial or story-carry is active. The event
kind SHALL be chosen uniformly, except the heat wave SHALL only be eligible when the day
is still young (morning). Weather SHALL be random per session (atmosphere, not
hash-seeded worldgen).

#### Scenario: Dawn roll can schedule an event
- **WHEN** the game is clear, past the grace period and the inter-event cooldown, and the day clock crosses dawn while no trial or story-carry is active
- **THEN** the system rolls a 35% chance and, on success, schedules exactly one event of a randomly chosen eligible kind for later that day

#### Scenario: Grace period suppresses early events
- **WHEN** less than 4 real minutes have elapsed in the session
- **THEN** no weather event is scheduled at dawn regardless of the roll

#### Scenario: Cooldown enforces a clear day between events
- **WHEN** an event ended earlier and fewer than the required number of dawns have passed since
- **THEN** no new event is scheduled, guaranteeing at least one full clear in-game day between events

#### Scenario: Heat wave only rolls in the morning
- **WHEN** the scheduling roll fires and the day is no longer young
- **THEN** the heat wave is excluded from the eligible kinds and only the dust storm or thunderstorm can be chosen

### Requirement: Bounded, smoothly-enveloped event lifecycle

Every event SHALL progress through `clear → warn → active → clearing → clear`. The warn
phase SHALL last about 90 real seconds and present unmistakable telegraphs plus a message
before the hazard turns on. Active durations SHALL be bounded (dust 150–210 s, storm
180–260 s, heat until dusk but at most ~240 s), followed by a ~30 s clearing ramp-out.
All intensity SHALL ride a smooth 0..1 envelope so effects fade in and out with no pops.
Weather SHALL NOT persist (no new saved state) and SHALL NOT run in SHOT mode.

#### Scenario: Warn precedes the hazard
- **WHEN** a scheduled event reaches its start time and no trial or story-carry is active
- **THEN** it enters the warn phase, shows its telegraph message and a dimmed HUD glyph, and does not apply its hazard until ~90 s later when it becomes active

#### Scenario: Active is time-bounded and ramps out
- **WHEN** an active event reaches its bounded duration
- **THEN** it enters the clearing phase and its intensity envelope ramps back to zero over ~30 s, returning the world to clear

#### Scenario: SHOT mode and persistence
- **WHEN** the game runs in SHOT mode or a new session begins
- **THEN** weather never runs (the mixer stays neutral) and no prior weather state is restored, so `?shot=1..5` output is pixel-stable

### Requirement: WX mixer contract

The system SHALL expose a single global mixer, recomputed every frame, that the rest of
the game reads at a handful of guarded touch points. Its neutral defaults SHALL make all
readers no-ops when no event runs. The mixer SHALL carry, at minimum: fog near/far
multipliers, a sun/hemi multiplier applied after the sky is set, a heat-rate multiplier,
an air-temperature addition, a shade-safe exposure threshold, a wind shove vector, a
flood walk-speed multiplier, and a dust-storm strain rate. Every reader SHALL be
safe-defaulted so a missing or neutral mixer changes nothing.

#### Scenario: Neutral mixer is inert
- **WHEN** no event is active
- **THEN** the mixer holds its neutral defaults (fog multipliers 1, sun multiplier 1, heat multiplier 1, zero wind, flood multiplier 1, zero strain) and none of the game's fog, lighting, heat, or movement is altered

#### Scenario: Active event paints the mixer
- **WHEN** an event is active
- **THEN** the mixer is reset to neutral each frame and then the active event's values are written on top, so exactly one event's effects apply at a time

### Requirement: Shelter detection

The system SHALL determine whether the player is sheltered from weather. The player SHALL
count as sheltered when a solid overhead is directly above them, or they are down a deep
pit, or they are in water, or they are beneath at least two stacked leaf pads (a lone
canopy platter SHALL NOT count). The test SHALL be throttled (about 5 Hz) and its cached
verdict SHALL drive both the dust-storm strain and the rain-cooling and lightning rules.

#### Scenario: Roof, pit, or water shelters
- **WHEN** a solid roof is overhead, or the player is deep in a pit, or the player is in water during an active event
- **THEN** the player is considered sheltered

#### Scenario: Deep canopy shelters, a lone pad does not
- **WHEN** the player stands under at least two stacked leaf pads
- **THEN** the player is sheltered; under only a single overhead pad they are exposed

### Requirement: The Grey Wind — dust storm

The dust storm SHALL telegraph with a paper-colored horizon, swelling wind audio, and a
message to get under a roof. When active it SHALL collapse visibility (fog near/far
multipliers drop to roughly 0.12/0.10 and the sun dims), stream grey motes around the
camera, and apply a slowly-wandering gust. While active and unsheltered the player SHALL
accrue body-strain fast enough to threaten a faint within about 30 s, and the HUD heat
bar SHALL relabel to `STRAIN`. While sheltered the strain SHALL be zero and body heat
SHALL drain at the normal shade rate so recovery is real.

#### Scenario: Unsheltered in the Grey Wind
- **WHEN** the dust storm is active and the player is out in the open
- **THEN** visibility collapses, grey motes stream past, the heat bar reads `STRAIN`, and strain accrues fast enough to faint in roughly 30 s of continuous exposure

#### Scenario: Reaching shelter halts and reverses strain
- **WHEN** the player gets under a roof, into a pit or water, or under deep canopy during the dust storm
- **THEN** strain stops accruing and body heat drains at the normal shade rate, giving a real recovery

### Requirement: The Long Rain — thunderstorm flood, gusts, and cooling

The thunderstorm SHALL telegraph with a dimming sky, distant thunder, and a message.
When active it SHALL fall fast rain around the camera, darken the street ground to a wet
gloss, and raise a flood that slows street-level walking to a floor of about 0.65 (ramped
in over ~60 s, drained over the ~30 s clearing) applied only when grounded at street
level and not already in water or a pit. Intermittent gusts SHALL shove the player,
stronger above the canopy line. The rain SHALL cool: while out in it the player gains no
body heat and drains it faster than normal shade — a risk-reward gift to a hot player.
After the storm the streets SHALL steam with a first-time aftermath message.

#### Scenario: Flood slows street-level walking
- **WHEN** the storm is active and the player walks at street level, not in water or a pit
- **THEN** walk speed is reduced toward the flood floor (~0.65), never enough to lock the player in place

#### Scenario: Rain cools a hot player
- **WHEN** the player stays out in the active rain rather than under cover
- **THEN** body heat stops rising and drains faster than in ordinary shade

#### Scenario: Aftermath message
- **WHEN** the storm reaches the end of its clearing phase
- **THEN** the flood drains, the rain stops, and a first-time "the streets steam" aftermath message is shown

### Requirement: The Long Rain — lightning strike hazard

During an active thunderstorm the system SHALL flash lightning every 8–20 s with a brief
hemi-light spike and distance-delayed thunder. If the player is silhouetted above the
canopy line and exposed, the system SHALL begin a 4-second strike tell (a warning hint
and a crackle). If the player is still aloft and exposed when the tell expires it SHALL
trigger a blackout that wakes them in their last shade (a failed trial/errand, harsh but
telegraphed). Descending about 3 m below the canopy line or getting under cover before
the tell expires SHALL cancel the strike. Lightning SHALL never strike at street level,
and tells SHALL have a cooldown of about 25 s.

#### Scenario: Silhouetted above the canopy draws a strike tell
- **WHEN** lightning flashes while the player is above the canopy line and exposed, and no tell is on cooldown
- **THEN** a 4-second warning hint and crackle begin

#### Scenario: Descending cancels the strike
- **WHEN** the player descends below the canopy line or reaches cover before the 4-second tell expires
- **THEN** the strike is cancelled and no blackout occurs

#### Scenario: Staying aloft triggers a blackout
- **WHEN** the player remains above the canopy line and exposed until the tell expires
- **THEN** a blackout fires and the player wakes in their last shade with the errand/trial failed

### Requirement: The White Hour — heat wave

The heat wave SHALL only begin in the morning and its active window SHALL always end at
dusk. It SHALL telegraph with a whitening flat sky, silenced wildlife, and a message to
find deep shadow, water, or the underground. When active it SHALL more than double the
heat-gain rate and lower the shade-safe exposure threshold so that dappled light now
burns at a real rate; only deep shade, water, deep pits, and night remain fully safe, and
shade-drain recovery SHALL still work there. The R-key shade recall and water/pit drains
SHALL be untouched — the event squeezes the margin, not the escape hatches.

#### Scenario: Dappled light no longer holds
- **WHEN** the heat wave is active and the player stands in dappled (partial) light
- **THEN** body heat rises at a real rate rather than a trickle, because the shade-safe exposure threshold has been lowered and the heat-gain rate raised

#### Scenario: Deep shade and water remain safe
- **WHEN** the player is in deep shade, water, a deep pit, or night during the heat wave
- **THEN** they remain fully safe and body heat drains, so recovery is always available

#### Scenario: Ends at dusk
- **WHEN** the day clock reaches dusk while the heat wave is active
- **THEN** the event enters its clearing phase and ends, regardless of remaining duration

### Requirement: Difficulty and fairness guarantees

The system SHALL guarantee every event remains survivable. Wind shove SHALL be hard-capped
below walk speed (about 2.5 m/s on the ground, 3 m/s in the air) so the player can always
make headway and can never be shoved off a ledge while standing still. Only one event SHALL
run at a time, so boosted heat and dust strain never stack. Every faint or blackout from
weather SHALL use the existing heatstroke/blackout paths that wake the player in their last
shade, which is by definition sheltered — never a death spiral. Each event's danger SHALL
have a zero-cost counter the game already teaches.

#### Scenario: Wind can never pin or eject the player
- **WHEN** any event applies a wind shove
- **THEN** the shove magnitude stays capped below walk speed, so the player keeps the ability to move against it and is never blown off a ledge while standing still

#### Scenario: Weather faints wake in safe shade
- **WHEN** a player faints from dust strain or heat, or is struck by lightning
- **THEN** they wake at their last shade location, which is sheltered, so recovery is guaranteed

### Requirement: Weather developer hook

The system SHALL provide a `?wx=dust|storm|heat` URL parameter that forces the named event
for testing: it skips the grace period, drops immediately into a short warn at session
start, and logs a console line on activation. The hook SHALL be disabled in SHOT mode.

#### Scenario: Forcing an event for verification
- **WHEN** the page is loaded with `?wx=dust`, `?wx=storm`, or `?wx=heat` outside SHOT mode
- **THEN** the named event skips grace, enters a short warn immediately, and logs its activation to the console

#### Scenario: Hook is inert in SHOT mode
- **WHEN** the page is loaded in SHOT mode with a `?wx=` parameter
- **THEN** the hook does nothing and weather stays inert

### Requirement: Scripted event trigger

The weather system SHALL expose a runtime scripted trigger (`wxScripted(kind)`) that starts
the named event through the existing forced-event path (short warn, then active), for use by
scripted moments such as the Verge Gate startup. The trigger SHALL be inert in SHOT mode. If
an event is already pending or active (phase not clear), the trigger SHALL decline and
return false so the caller can fall back to local-only effects; it SHALL never interrupt or
corrupt an in-flight event's lifecycle.

#### Scenario: The finale summons the Long Rain

- **WHEN** the Verge Gate startup calls the scripted trigger for a storm outside SHOT mode with no event in flight
- **THEN** the storm enters its short forced warn and proceeds through the normal event lifecycle

#### Scenario: An in-flight event is never corrupted

- **WHEN** the scripted trigger is called while another event is pending or active
- **THEN** it returns false, the in-flight event continues untouched, and the caller falls back to local effects

#### Scenario: Inert in screenshot mode

- **WHEN** the scripted trigger is called in SHOT mode
- **THEN** nothing happens and weather stays inert

