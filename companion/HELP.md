## Merging Anubis

Controls a Merging Anubis in the **Music mission** through its web API:
mixer faders, mutes, solos and pan, bus master, mute, dim and mono, and
the preamps. Buttons show the Anubis's current state, whether a change
was made in Companion, on the unit, in its web UI or over OSC.

Strips, buses and preamps can all be changed from buttons, but only where
the Anubis's own web UI would let you change them.

### Configuration

- **IP address or hostname** of the Anubis. Companion must be able to
  reach its web UI (port 80).

### Feedbacks

- **Strip: muted / solo**: a strip on a chosen bus. A linked pair shown
  as one strip on the Anubis (e.g. "Stream-L + Stream-R") is one choice.
- **Bus: muted / dimmed / mono / a strip is soloed**. The MIXER bus mute
  is the main mute in the Anubis's web UI.
- **Preamp: setting is on**: 48 V, pad, lift, phase invert, low cut, cut
  or locked.
- **Preamp: input type**: mic, line or instrument.

### Variables

Numbers in the names are the Anubis's own ids (MIC 1 is 1000, MIC 2 is
1001, the MIXER bus is 0); the variables list shows which is which.

- `strip_<id>_name`, `_gain` (fader on MIXER in dB, `-inf` when off; a
  linked pair shows its shared fader, as the Anubis does), `_mute`,
  `_solo`, `_pan` (-100 left to 100 right)
- `bus_<id>_name`, `_gain` (master, dB), `_mute`, `_dim`, `_mono`
- `preamp_<id>_mode`, `_gain` (dB), `_48v`, `_pad`, `_lift` (where the
  preamp has them), `_phase`, `_lowcut`, `_cut`, `_lock`
- `device_name`, `firmware`

### Actions

- **Strip: mute** and **Strip: solo**: on, off or toggle, for a strip on
  a chosen bus, as the strip's own button does. A linked pair shown as
  one strip changes together. They work only where the Anubis's web UI
  shows that button and lets you press it: not on talk or cue return
  strips, not on a bus the strip isn't shown on or where its group is
  collapsed, and not while the strip's input is disconnected. When one
  is refused, the log says why. A strip change on MIXER also changes
  MIXER-ALT and CUE1 (the Anubis does this itself).
- **Strip: fader level**: sets a strip's fader on a bus to a level in dB,
  from -144.5 (-inf) to +6. Like the Anubis's own level entry, it keeps
  whole tenths of a dB and anything outside the range goes to the end.
- **Strip: fader up or down**: moves a strip's fader by a number of dB
  (negative moves it down), stopping at -inf and +6 dB. From -inf, +1 dB
  goes to -143.5 dB, the bottom of the scale.
- The fader actions work on music, DAW and effect return strips (the
  others have no fader on the Anubis), on any bus the strip is shown on.
  A linked pair moves together, as its shared fader does. Several moves
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
- **Preamp: pad / lift**: lift, off or pad, on mic preamps that have it,
  while set to Mic.
- **Preamp: phase invert**, **Preamp: cut** and **Preamp: low cut**: on,
  off or toggle. Low cut uses the frequency the preamp offers.
- **Preamp: lock**: as the preamp's lock button. While a preamp is
  locked, every other preamp action on it is refused; unlock it first.
  A preamp the Anubis reports as off line can't be changed at all.
- **Read the Anubis state again**: reads everything again. Sends nothing
  to the mixer.

### Notes

- Strips and buses are picked from the Anubis's own list and remembered
  by their ID, not their position, so moving or renaming strips on the
  Anubis doesn't change what a button shows.
- The module only sends what the Anubis's own web UI sends. It can't
  reboot, save, reset or delete anything.
