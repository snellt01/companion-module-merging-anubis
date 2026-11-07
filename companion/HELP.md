## Merging Anubis

Controls a Merging Anubis in the **Music mission** through its web API:
mixer faders, mutes, solos and pan, bus master, mute, dim and mono, and
the preamps. Buttons show the Anubis's current state, whether a change
was made in Companion, on the unit or in its web UI.

**This module is in development and doesn't control anything yet.**

### Configuration

- **IP address** of the Anubis. Companion must be able to reach its web
  UI (port 80).

### Notes

- Strips and buses are picked from the Anubis's own list and remembered
  by their ID, not their position, so moving or renaming strips on the
  Anubis doesn't change what a button controls.
- The module only sends what the Anubis's own web UI sends. It can't
  reboot, save, reset or delete anything.
