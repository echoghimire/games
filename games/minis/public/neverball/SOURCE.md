# Neverball (Tronix Arena build)

Neverball is free software by the Neverball team, released under the GNU GPL
version 2 or later (see `legal/license-GPL-2.0.txt`). Game data is under the
licences listed in `legal/`.

- Upstream source: https://github.com/Neverball/neverball
- Commit: a1ed09911dca262d80049c12a2824d683af494d6
- Our changes: `tronix-arena.patch` (level packages served from `packages/`,
  Challenge-run score reporting to the arena leaderboard, Tronix skin, no
  service worker, MP3-only music). The Octocat ball is not included.
- Built with Emscripten 3.1.65 and gl4es c9895df using `emscripten/ball.mk`
  (`make sols`, `make -f emscripten/ball.mk BUILD=release`,
  `make -f emscripten/ball.mk packages`), then `bgm/*.ogg` removed from the
  base data.
