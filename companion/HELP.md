## Merging Anubis

Controls a Merging Anubis in the **Music mission** through its web API:
mixer faders, mutes, solos and pan, bus master, mute, dim and mono, and
the preamps. Buttons show the Anubis's current state, whether a change
was made in Companion, on the unit, in its web UI or over OSC.

**This version can only mute strips.** It shows the whole state; the
other actions that change things come in later versions.

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

- `strip_<id>_name`, `_gain` (dB on MIXER, `-inf` when off), `_mute`,
  `_solo`, `_pan` (-100 left to 100 right)
- `bus_<id>_name`, `_gain` (master, dB), `_mute`, `_dim`, `_mono`
- `preamp_<id>_mode`, `_gain` (dB), `_48v`, `_pad`, `_lift` (where the
  preamp has them), `_phase`, `_lowcut`, `_cut`, `_lock`
- `device_name`, `firmware`

### Actions

- **Strip: mute**: mutes, unmutes or toggles a strip on a chosen bus,
  as the strip's mute button does. A linked pair shown as one strip is
  muted together. Like the Anubis's web UI, it won't mute a strip whose
  input isn't connected; the log says why when it refuses. A strip
  change on MIXER also changes MIXER-ALT and CUE1 (the Anubis does this
  itself).
- **Read the Anubis state again**: reads everything again. Sends nothing
  to the mixer.

### Notes

- Strips and buses are picked from the Anubis's own list and remembered
  by their ID, not their position, so moving or renaming strips on the
  Anubis doesn't change what a button shows.
- The module only sends what the Anubis's own web UI sends. It can't
  reboot, save, reset or delete anything.
