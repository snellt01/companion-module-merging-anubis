## Merging Anubis

Controls a Merging Anubis in the **Music mission** through its web API:
mixer faders, mutes, solos and pan, bus master, mute, dim and mono,
talkback, and the preamps. Buttons show the Anubis's current state, whether a change
was made in Companion, on the unit, in its web UI or over OSC.

Strips, buses and preamps can all be changed from buttons, but only where
the Anubis's own web UI would let you change them.

### Configuration

- **IP address or hostname** of the Anubis. Companion must be able to
  reach its web UI (port 80).

### Feedbacks

- **Strip: muted / solo**: a strip on a chosen bus. A linked pair shown
  as one strip on the Anubis (e.g. "Stream-L + Stream-R") is one choice.
- **Strip: fader level**: a strip's fader on a chosen bus is at or
  above, or below, a level in dB (to a tenth; -144.5 is -inf). A linked
  pair shown as one strip uses its shared fader.
- **Bus: muted / dimmed / mono / a strip is soloed**. The MIXER bus mute
  is the main mute in the Anubis's web UI.
- **Preamp: setting is on**: 48 V, pad, boost, phase invert, low cut, cut
  or locked.
- **Preamp: input type**: mic, line or instrument.
- **Talkback: talking to a cue bus / to any cue bus**, and **Talkback:
  source** (a strip is the talkback's input).

### Variables

Numbers in the names are the Anubis's own ids (MIC 1 is 1000, MIC 2 is
1001, the MIXER bus is 0); the variables list shows which is which.

- `strip_<id>_name`, `_gain` (fader on MIXER in dB, `-inf` when off; a
  linked pair shows its shared fader, as the Anubis does), `_mute`,
  `_solo`, `_pan` (-100 left to 100 right), all on MIXER
- `strip_<id>_bus<bus id>_gain` and `_pan`: the same on each other bus
  the strip is shown on (e.g. `strip_1000_bus3_gain`, MIC 1 on CUE2).
  Pan can differ from bus to bus; on buses where the Anubis links pan
  to the mix, it's the value the web UI shows greyed out. Mute and solo
  on other buses are in the feedbacks.
- `bus_<id>_name`, `_gain` (master, dB), `_mute`, `_dim`, `_mono`, and
  `_talk` on cue buses with a TALK button
- `talk_input` (the talkback source's strip name) and `talk_input_id`
  (its ID; 998 is the built-in talk mic)
- `preamp_<id>_mode`, `_gain` (dB), `_phase`, `_lowcut`, `_cut`, `_lock`,
  and where the preamp has them `_48v`, `_pad` and `_lift` (boost, which
  the Anubis stores as `lift`)
- `device_name`, `firmware`

### Actions

- **Strip: mute** and **Strip: solo**: on, off or toggle, for a strip on
  a chosen bus, as the strip's own button does. A linked pair shown as
  one strip changes together. They work only where the Anubis's web UI
  shows that button and lets you press it: not on talk or cue return
  strips, not on a bus the strip isn't shown on or where its group is
  collapsed, and not while the strip's input is disconnected. When one
  is refused, the log says why. A strip change on MIXER or MIXER-ALT
  also changes the other, and any cue bus following the mix (the
  Anubis does this itself).
- **Strip: fader level**: sets a strip's fader on a bus to a level in dB,
  from -144.5 (-inf) to +6. Like the Anubis's own level entry, it keeps
  whole tenths of a dB and anything outside the range goes to the end.
- **Strip: fader up or down**: moves a strip's fader by a number of dB
  (negative moves it down), stopping at -inf and +6 dB. From -inf, +1 dB
  goes to -143.5 dB, the bottom of the scale.
- The fader actions work on music, DAW and effect return strips (the
  others have no fader on the Anubis), on any bus the strip is shown on.
  A linked pair moves together, as its shared fader does, keeping any
  difference between its two sides' own levels. Several moves
  within 50 ms send only the last.
- **Strip: pan** (to a position, -100 left to 100 right) and **Strip: pan
  left or right** (by a step, negative is left). As on the Anubis, pan
  can only be changed on MIXER, MIXER-ALT and a cue bus following the
  mix: on the other buses it is linked to the mix's pan, and
  the Anubis applies one pan change to all of them. A linked pair shown
  as one strip has no pan, and pan is off while the input is
  disconnected.
- **Bus: master level** and **Bus: master up or down**: a bus's master
  fader, in dB, like the strip fader actions.
- **Bus: mute**: on, off or toggle, on any bus. The MIXER bus mute is the
  main mute in the Anubis's web UI.
- **Bus: dim** and **Bus: mono**: on, off or toggle, on MIXER, MIXER-ALT
  and a cue bus following the mix, the buses the Anubis gives these
  buttons.
- **Bus: reference level**: puts a bus's master at the mixer's reference
  level (set in the Anubis's mixer settings), as double-clicking the master fader on the Anubis
  does.
- **Preamp: input type**: mic, line or instrument, where the preamp has
  that input (the combo inputs: mic and line; the jacks: line and
  instrument).
- **Preamp: gain** (a level in dB, rounded to 0.5 dB like the Anubis's
  gain entry) and **Preamp: gain up or down** (by a step): the gain for
  the preamp's current input type, kept in the range the preamp
  reports.
- **Preamp: 48 V**: phantom power on or off, only on preamps that have
  it and only while set to Mic. Check what's plugged in before using it.
- **Preamp: pad / boost**: boost, off or pad, on mic preamps that have it,
  while set to Mic.
- **Preamp: phase invert**, **Preamp: cut** and **Preamp: low cut**: on,
  off or toggle. Low cut uses the frequency the preamp offers.
- **Preamp: lock**: as the preamp's lock button. While a preamp is
  locked, every other preamp action on it is refused; unlock it first.
  A preamp the Anubis reports as off line can't be changed at all.
- **Talkback: talk to a cue bus**: on, off or toggle, as the bus's TALK
  button. Only cue buses with their own mix have one (not a cue bus
  following the mix). For a button that talks while held, use On when
  pressed and Off when released, as the presets do; On and Off are
  always sent, so a quick tap can't leave talkback on.
- **Talkback: TALK key for a cue bus (tap or hold)** and **Talkback:
  TALK ALL key (tap or hold)**: put one on the key's press with Key set to
  Pressed and one on its release with Key set to Released, as the presets
  do. A tap turns talkback on and leaves it on; a tap while it's on turns
  it off. Held for at least the set time (500 ms by default), it talks
  only until the key is let go.
- **Talkback: talk to all cue buses**: TALK ALL, to every cue bus with
  its own mix. Toggle turns them all off if talkback to any cue bus is
  on, otherwise all on, as on the Anubis.
- **Talkback: source**: the input the talkback uses, as TALK INPUT in a
  strip's menu: a music input or talk mic strip shown on MIXER or
  MIXER-ALT. TALK is the built-in talk mic.
- **Read the Anubis state again**: reads everything again. Sends nothing
  to the mixer.

### Presets

Ready-made buttons, listed once the Anubis has been read, from its own
strips, buses and preamps:

- **Strips (MIXER)**: mute and solo (where the strip has them) and fader
  up / down 1 dB showing the level, for each strip.
- **Buses**: mute for each bus; dim and mono for MIXER, MIXER-ALT and a
  cue bus following the mix.
- **Preamps**: 48 V, phase, low cut, cut and lock (where the preamp has
  them) and gain up / down 1 dB showing the gain.
- **Talkback**: TALK for each cue bus with a TALK button and TALK ALL
  (tap to latch, hold to talk while held); and a source button for each
  strip that can be the talkback's input.

Each lights up with the state, whatever changed it. After placing one,
its strip or bus can be changed in the button's action and feedback.

### Linking and unlinking strips

Buttons keep addressing a strip by its ID, so changing links on the
Anubis changes what some buttons do:

- **Unlinking a pair**: a button set up for the pair (e.g. "Stream-L +
  Stream-R") now controls only the left strip, as the Anubis's own strip
  buttons do. Set up a second button for the right strip if needed.
- **Linking two strips**: buttons for the first (left) strip now control
  the pair. Buttons for the second strip are refused, with a line in
  the log, until they're pointed at the pair; their feedback still
  shows that strip's own state.
- **Expanding a pair** (still linked, shown as two strips): each side is
  controlled on its own, as on the Anubis.
- A linked pair shown as one strip has no pan, as on the Anubis.

### Notes

- Strips and buses are picked from the Anubis's own list and remembered
  by their ID, not their position, so moving or renaming strips on the
  Anubis doesn't change what a button shows.
- The module only sends what the Anubis's own web UI sends. It can't
  reboot, save, reset or delete anything.
