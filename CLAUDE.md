# companion-module-merging-anubis

Bitfocus Companion module for the Merging Anubis (Music mission), writing
through the web UI's CometD API. Started from
`bitfocus/companion-module-template-ts`. Docs and to-dos: `README.md`
(checkboxes); user help: `companion/HELP.md`.

**Keep site-specific details out of tracked files**: addresses,
hostnames, a unit's strip names, test logs, how and where Companion is
installed, local paths. They go in `CLAUDE.local.md` (gitignored), which
also says where the decoded API notes and test records are kept. Test
data uses neutral names.

## The rule that comes first

Nothing the module does may corrupt the Anubis or make it work in a way
it isn't designed to. In practice:

- Write only with messages the Anubis's web UI sends, built exactly as it
  builds them, from a fixed list in the code. No generic path or value
  setter, ever, not even behind an option.
- Never send `/service/ravenna/commands` (`update`, `save`, `restart`,
  `reboot`, `shutdown`, `reset_to_factory`), anything under
  `/commands/`, `$.actions.*` other than any the user approves later,
  `delete_*` / `clear_*`, or network, PTP, NMOS, session or identity
  settings (except `identify`).
- Send nothing on connect. Subscribe, then read the state with
  `GET /API/get_device_status:<JSONPath>`.
- Before a write, check the strip, bus or preamp exists in the current
  state and the value is in range (strip and bus levels −1445…60 tenths
  of a dB; preamp ranges and available controls from the module's
  `custom.ins.capabilities.channel`, including `*_ro`; honour `lock`).
  After it, check what comes back on `/ravenna/settings`.
- At most one publish per control every 50 ms (latest value wins), like
  the web UI.
- Address strips and buses by tree id, never on-screen position.

## Decisions

- **48 V phantom power is included**, with no opt-in setting; only on
  preamps whose capabilities list 48 V, and not while `lock` is on.
- **No read-only mode on untested firmware**: log a warning instead.
  Tested firmware: `2.0.0-RL-26Q2-20260605.2+9abce1f5`.
- **Faders go to +6 dB** (60), the Anubis's own maximum.
- **No level metering**: don't subscribe to `/ravenna/meter` or add
  meter variables or feedbacks.

## The Anubis's API

Decoded from the Anubis's web UI and from what a unit sends back; the
notes are kept outside this repo (see `CLAUDE.local.md`). **Never copy
Merging's UI code, or close paraphrases of it, into this repo**: write
from the decoded description. Key behaviour: a strip change on MIXER or
MIXER-ALT also changes the other and any cue bus following the mix;
`link_gain` moves both sides of a pair, keeping their offset; one pan
change applies to every bus (though stored values can differ per bus);
a collapsed linked pair is written once to its left strip with
`link_*`; OSC changes come back with `osc: true`. The Anubis sends
partial lists kept by id (e.g. a few strips, one send each): merge them
by id, never by position, and read the state again when one adds or
leaves out items. Publish one message at a time beside the long poll, as
CometD's own client does: several at once made a unit close a
connection.

## Code and tests

Layout is in the README ("How it works"). `yarn test` runs vitest against
the pretend Anubis (`src/__tests__/fake-anubis.ts`), which serves
`fixtures/anubis-state.json` (trimmed and anonymised from a real unit;
keep serial numbers and local names out). Its `forbidden` list records
any message that isn't `/meta/*`; the connection tests require it to
stay empty. When writes are added, give the fake an allowlist of
expected publishes and keep that check for everything else. Develop
against the pretend Anubis, not a real one.

## Testing on a real unit

Only when the user asks, one control at a time, on a strip or bus not in
use, each change undone straight away; save a restore point first (a
state dump plus the device configuration file, `GET
/commands/get_device_configuration`, what the web UI's DOWNLOAD SNAPSHOT
opens: a one-off backup, never from the module). The unit, and where
restore points and results go, are in `CLAUDE.local.md`.

## Build and run

Node 26 (`engines`) and Yarn 4 via corepack: `corepack yarn install`,
`build`, `lint`, `test`, `package`. `.yarnrc.yml` blocks dependency
install scripts and packages newer than 3 days. The pre-commit hook
(husky, lint-staged) calls `yarn` by name; where it isn't on the PATH,
put a corepack shim there (`corepack enable --install-directory <dir>
yarn`). Module API `@companion-module/base` 2.1, runtime `node26`.

CI: Node CI (build, lint, tests) runs on every push. Bitfocus's module
check is skipped while the repo is private (its checkout token can't
clone a private repo) and runs once it's public.

Release (only if the user decides to): Bitfocus creates
`bitfocus/companion-module-merging-anubis` on request, tag `vX.Y.Z`,
submit the version at developer.bitfocus.io for review.
