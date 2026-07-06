# Delta — weather-events (add-verge-engine-expedition)

## ADDED Requirements

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
