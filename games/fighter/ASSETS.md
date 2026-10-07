# Third-party assets

All assets below are **CC0 1.0 (public domain)**, so attribution is not required, but it is given here anyway.
They are committed under `public/assets/`. To re-download them, run `npm run fetch-assets` (`scripts/fetch-assets.sh`).
That step needs `curl` and `unzip`, plus `ffmpeg` for audio re-encoding and macOS `sips` for sprite resizing.

No Mortal Kombat (or other copyrighted franchise) names, models, textures or logos are used.

## Characters

| Name | Author | URL | License | Type | Used for |
|---|---|---|---|---|---|
| KayKit Character Pack: Adventurers 1.0, `Barbarian.glb` | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (also https://kaylousberg.itch.io/kaykit-adventurers) | CC0 | GLB, rigged, 76 clips, ~7k tris, 41-bone shared rig | Fighter 1, "Brakk" |
| same pack, `Rogue_Hooded.glb` | Kay Lousberg | same | CC0 | GLB, same rig, ~6.4k tris | Fighter 2, "Vesna" |

Embedded clips used by the game: `Unarmed_Idle`, `Walking_A`, `Walking_Backwards`, `Running_A`, `Jump_Start`, `Jump_Idle`, `Jump_Land`,
`Blocking`, `Block_Hit`, `Unarmed_Melee_Attack_Punch_A`, `Unarmed_Melee_Attack_Punch_B`, `Unarmed_Melee_Attack_Kick`,
`1H_Melee_Attack_Slice_Horizontal`, `2H_Melee_Attack_Chop`, `Hit_A`, `Hit_B`, `Death_A`, `Death_B`, `Lie_Down`, `Lie_StandUp`, `Dodge_Forward`, `Dodge_Backward`,
`Cheer`, `Sit_Floor_Down` (crouch fallback) and `Throw` (grab).

Known issues:
- The style is stylised and chibi-proportioned, not realistic.
- There is no dedicated crouch or grab clip, so the game uses fallbacks (see `src/characters/fighters/*.ts`).
- Weapons are baked into the GLB as hand-slot meshes. They are hidden for unarmed fighting.

## Environment

| Name | Author | URL | License | Type | Used for |
|---|---|---|---|---|---|
| KayKit Dungeon Remastered: `pillar_decorated`, `torch_mounted`, `torch_lit`, `column`, `barrel_large` | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | CC0 | GLB props | Arena props |
| Medieval Blocks 02 (1k, diffuse/normal/ARM) | Poly Haven | https://polyhaven.com/a/medieval_blocks_02 | CC0 | PBR JPG | Arena floor |
| Castle Brick 07 (1k, diffuse/normal/ARM) | Poly Haven | https://polyhaven.com/a/castle_brick_07 | CC0 | PBR JPG | Arena walls |
| Kloppenheim 02 (1k) | Poly Haven | https://polyhaven.com/a/kloppenheim_02 | CC0 | HDR | Night sky and environment lighting |

## VFX

| Name | Author | URL | License | Type | Used for |
|---|---|---|---|---|---|
| Particle Pack: `circle_05`, `star_09`, `smoke_04`, `fire_01`, `dirt_03`, `slash_02` | Kenney | https://kenney.nl/assets/particle-pack | CC0 | PNG sprites (resized to 128px) | Sparks, glow, embers, blood (`circle_05`), impact flash, smoke/dust, torch fire, debris, slashes |

## Audio

| Name | Author | URL | License | Type | Used for |
|---|---|---|---|---|---|
| Impact Sounds | Kenney | https://kenney.nl/assets/impact-sounds | CC0 | OGG, re-encoded to MP3 | Punch, kick, heavy hit, block, landing, KO, grab |
| Interface Sounds | Kenney | https://kenney.nl/assets/interface-sounds | CC0 | OGG, re-encoded to MP3 | Menu and round announcer stingers |
| RPG Audio (`cloth1`) | Kenney | https://kenney.nl/assets/rpg-audio | CC0 | OGG, re-encoded to MP3 | Jump |
| Swishes sound pack | artisticdude | https://opengameart.org/content/swishes-sound-pack | CC0 | WAV, re-encoded to MP3 | Attack whooshes |
| Battle Theme A | cynicmusic | https://opengameart.org/content/battle-theme-a | CC0 | MP3 | Fight music |

## Evaluated but not used

- **three.js example models** (`Xbot.glb`, `Michelle.glb`, `Soldier.glb`): these come from Mixamo, whose redistribution terms are unclear, and they have no combat clips. `RobotExpressive` is CC0 but has only one punch clip.
- **Quaternius Universal Animation Library 2 and Ultimate Modular Women/Men** (CC0, https://quaternius.com): better proportions, combat combos and a proper female fighter. They are download-only from itch.io and need retargeting. They are a good upgrade path: drop the GLB into `public/assets/characters/` and add a `FighterConfig` with a clip map.
- **KayKit Character Animations** (CC0, https://kaylousberg.itch.io/kaykit-character-animations): 161 clips on the same rig, including crouch. It is a manual itch.io download, and the game can pick up its clips through `clipOverrides` in the fighter config.
- **Mixamo**: needs an Adobe login and cannot be automated.
