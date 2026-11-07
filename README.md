# companion-module-merging-anubis

A [Bitfocus Companion](https://bitfocus.io/companion) module for the
Merging Anubis in the Music mission: mixer faders, mutes, solos, pan, bus
master, dim, mono and the preamps, with buttons that show the Anubis's
current state.

It talks to the Anubis the way the Anubis's own web UI does: over CometD
(Bayeux) on `http://<anubis>/cometd`, sending only the messages the web UI
itself sends. Unlike OSC, every change comes back on that connection,
including changes made on the unit, in the web UI or over OSC, so button
states stay correct.

**Status:** reads the Anubis and shows its state as variables and button
feedbacks, controls the mixer's strips (mute, solo, fader, pan), buses
(master, mute, dim, mono, ref, SoundID profile), talkback (talk to a cue
bus, talk to all, source) and preamps (input type, gain, 48 V,
pad/boost, phase, low cut, cut, lock), and offers presets. Every action
has been tested on a real Anubis (firmware `2.0.0-RL-26Q2-20260605.2`,
Music mission), from the module and from Companion buttons. Started from
Bitfocus's `companion-module-template-ts` (commit `e0d42b7`).

See [HELP.md](./companion/HELP.md) for users and [LICENSE](./LICENSE)
(MIT).

## How it works

| File                                                                       | Does                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/bayeux.ts`                                                            | CometD client over long-polling. Sends the protocol's join, poll and leave messages, and publishes writes on `/service/ravenna/settings` only if they pass `writes.ts`'s allowlist, one at a time beside the long poll                                                                             |
| `src/writes.ts`                                                            | The fixed list of writes, each built as the web UI builds it after checking the target exists and the web UI would allow it; plus the allowlist of paths and fields checked before publishing                                                                                                      |
| `src/anubis.ts`                                                            | Joins the feed, reads the whole state with one `GET /API/get_device_status:$`, then applies each `{path, value}` change pushed on `/ravenna/settings`. Starts again after 5 s if anything fails. Sends writes (one per control every 50 ms, latest wins) and waits up to 2 s for them to come back |
| `src/tree.ts`                                                              | Applies a change to the stored state: the three path forms the Anubis uses. Lists kept by id (strips, sends, inputs, buses) merge by id, as the Anubis sends only the items that changed; when such a list adds or leaves out items, `anubis.ts` reads the whole state again a second later        |
| `src/model.ts`                                                             | Strips (in on-screen order, linked pairs), buses and preamps, by the Anubis's own ids                                                                                                                                                                                                              |
| `src/talkback.ts`                                                          | What a TALK key sends on press and release: a tap latches, a hold talks only while held                                                                                                                                                                                                            |
| `src/variables.ts`, `src/feedbacks.ts`, `src/actions.ts`, `src/presets.ts` | What Companion shows and offers: variables, feedbacks, actions (each built through `writes.ts`) and ready-made buttons                                                                                                                                                                             |
| `src/__tests__/`                                                           | Tests, with a pretend Anubis (`fake-anubis.ts`) serving a trimmed, anonymised copy of the real state                                                                                                                                                                                               |

Variables and feedbacks address strips by id, so moving strips on the
Anubis doesn't change what a button shows. `strip_<id>_*` variables are
for the MIXER bus, `strip_<id>_bus<B>_*` for the others; the feedbacks
take any bus.

## Safety

Nothing this module sends may corrupt the Anubis or make it work in a way
it isn't designed to. So the module:

- Sends only messages the Anubis's web UI sends, built the same way, from
  a fixed list. There is no "set any value" action.
- Never sends reboot, save, shutdown, factory reset, delete or clear
  commands, or anything under `/commands/`.
- Sends nothing when it connects, not even the UI's request for the full
  state; it reads the state with GET requests instead.
- Refuses any strip, bus, preamp or setting that isn't in the Anubis's
  current state, and keeps values inside the ranges the Anubis reports.
- Sends continuous controls (faders, pan, gain) at most every 50 ms, like
  the web UI, and checks each change against what the Anubis reports back.
- Respects the preamp lock, and offers 48 V and other preamp settings only
  where the Anubis says the preamp has them.
- Logs a warning when the Anubis's firmware differs from the one it was
  tested on (`2.0.0-RL-26Q2-20260605.2`).

## Development

Node 26 and Yarn 4 (through corepack):

```bash
corepack yarn install   # also sets up the pre-commit hook
corepack yarn build     # compile to dist/
corepack yarn dev       # compile on every change
corepack yarn lint
corepack yarn test      # vitest, against the pretend Anubis
corepack yarn package   # build the .tgz Companion imports
```

The connection tests fail if the module sends the pretend Anubis anything
but the protocol's own messages.

`.yarnrc.yml` turns off dependency install scripts and only installs
package versions at least three days old.

## To do

- [x] Watch linking, unlinking, expanding and collapsing a pair on a real
      unit: the module followed each change (replayed through its code),
      and the tests use the messages the unit sent.
- [x] Test the talkback actions on a real unit (talk to a cue bus, talk
      to all, source): all worked; several publishes at once made the
      unit close a connection, so publishes now go one at a time.
- [ ] Check what the unit's own talk button reports.
- [x] Test SoundID on a real unit (on, switch profile, off): each came
      back, with the EQ count taking and freeing 10.
- [ ] An "input disconnected" feedback (mute, solo and pan are refused
      while an input is disconnected).
- [ ] An identify action.
- [ ] Strip groups: group fader, mute and solo.
- [ ] Level meters (`/ravenna/meter`, not subscribed yet).
- [ ] Decide whether recalling the Anubis's mixer presets
      (`load_from_preset`) belongs in the module: it changes the whole
      mixer at once.
- [ ] Optional: submit to Bitfocus so it's listed in Companion.
