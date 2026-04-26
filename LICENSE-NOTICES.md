# License notices and attributions

This project (mage-modernUI) is a personal fork of the open-source XMage
rules engine ([magefree/mage](https://github.com/magefree/mage)) layered
with a JSON/WebSocket facade and a new web client. The MIT license in
[LICENSE.txt](LICENSE.txt) covers the source code in this repository.

The notices below cover trademarks, third-party assets, and external
data sources that the code touches but does not own. Read them before
distributing builds or screenshots.

## Magic: The Gathering trademark

> **Magic: The Gathering** (Magic, MTG, mana symbols, card frames, set
> symbols, planeswalker symbols, and related card names and artwork)
> is a trademark of [Wizards of the Coast LLC](https://company.wizards.com),
> a subsidiary of Hasbro, Inc. **This project is not produced, endorsed,
> supported by, or affiliated with Wizards of the Coast.**

This software is provided for the purpose of playing the game with
physical cards a user already owns or with cards that are in the public
domain. The card-text database compiled into the upstream engine is
used under the same fan-content understanding that has applied to XMage
since 2010 — see the upstream
[magefree/mage README](https://github.com/magefree/mage#readme) for
context.

## Card art

This client does **not** ship card art. Where the UI renders card art,
it does so by linking to user-supplied URLs or to public services like
[Scryfall](https://scryfall.com). The art remains the property of the
original artists and Wizards of the Coast.

## Scryfall attribution

When the client uses
[Scryfall](https://scryfall.com)'s public API to look up card images or
metadata, it does so under Scryfall's [API
guidelines](https://scryfall.com/docs/api). In particular:

- Scryfall data is provided under the
  [Open Database License](https://opendatacommons.org/licenses/odbl-1-0/).
- Card images on Scryfall remain the property of their copyright
  holders and are not redistributed by this project; we link to them
  rather than mirror them.

## Mana font

If a build of the web client renders mana symbols using the
[Mana font](https://github.com/andrewgioia/mana) (Andrew Gioia, SIL OFL
1.1), the font's license file must be included alongside the binary.
The font is **not** currently bundled in `webclient/`; if a future
slice does bundle it, this notice must be updated and the OFL license
text shipped under `webclient/public/fonts/`.

## Upstream XMage attribution

The Java engine in `Mage*/`, `Mage.Server*/`, and the card definitions
under `Mage.Sets/` are taken from
[magefree/mage](https://github.com/magefree/mage) and remain under the
upstream MIT license (see [LICENSE.txt](LICENSE.txt)). This fork does
not contribute changes back to upstream and is intended for personal
use only. The upstream pinned version is recorded in
`Mage.Server.WebApi/pom.xml` (`<upstream.version>`) and verified at
boot by
[`UpstreamVersionCheck`](Mage.Server.WebApi/src/main/java/mage/webapi/UpstreamVersionCheck.java).

## Other dependencies

Run `mvn dependency:tree` (server) or `npm ls` (webclient) for the full
list of third-party packages and their licenses. Notable runtime deps:

- [Javalin](https://javalin.io) — Apache 2.0
- [Jackson](https://github.com/FasterXML/jackson) — Apache 2.0
- [React](https://react.dev) — MIT
- [Tailwind CSS](https://tailwindcss.com) — MIT
- [Zod](https://zod.dev), [Zustand](https://github.com/pmndrs/zustand)
  — MIT
