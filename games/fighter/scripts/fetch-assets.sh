#!/usr/bin/env bash
# Downloads all third-party CC0 assets into public/assets.
# See ASSETS.md for authors, licenses and usage.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
A="$ROOT/public/assets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$A"/{characters,props,textures,hdri,audio/sfx,audio/music,vfx}

fetch() { # url dest
  if [ -s "$2" ]; then return; fi
  echo "  -> $(basename "$2")"
  curl -fsSL --retry 3 "$1" -o "$2"
}

echo "Characters (KayKit Adventurers, CC0)"
KK_CHAR="https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf"
for c in Barbarian Rogue_Hooded; do
  fetch "$KK_CHAR/$c.glb" "$A/characters/$c.glb"
done

echo "Props (KayKit Dungeon Remastered, CC0)"
KK_DUN="https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0/main/addons/kaykit_dungeon_remastered/Assets/gltf"
for p in torch_lit torch_mounted pillar_decorated column barrel_large; do
  fetch "$KK_DUN/$p.gltf.glb" "$A/props/$p.glb"
done

echo "Textures (Poly Haven, CC0)"
PH="https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k"
for m in diff nor_gl arm; do
  fetch "$PH/medieval_blocks_02/medieval_blocks_02_${m}_1k.jpg" "$A/textures/floor_${m}.jpg"
  fetch "$PH/castle_brick_07/castle_brick_07_${m}_1k.jpg" "$A/textures/wall_${m}.jpg"
done

echo "HDRI (Poly Haven, CC0)"
fetch "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_02_1k.hdr" "$A/hdri/night.hdr"

echo "Music (cynicmusic, CC0)"
fetch "https://opengameart.org/sites/default/files/battleThemeA.mp3" "$A/audio/music/battle.mp3"

echo "SFX / VFX packs (Kenney, CC0) - raw packs extracted to $TMP"
fetch "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip" "$TMP/impact.zip"
fetch "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip" "$TMP/ui.zip"
fetch "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip" "$TMP/rpg.zip"
fetch "https://kenney.nl/media/pages/assets/particle-pack/f8fe0f8cb8-1677578741/kenney_particle-pack.zip" "$TMP/particles.zip"
fetch "https://opengameart.org/sites/default/files/swishes.zip" "$TMP/swishes.zip"
for z in impact ui rpg particles swishes; do
  mkdir -p "$TMP/$z" && unzip -qo "$TMP/$z.zip" -d "$TMP/$z"
done

if [ "${LIST_ONLY:-0}" = "1" ]; then
  find "$TMP" -type f \( -name '*.ogg' -o -name '*.wav' -o -name '*.png' \) | sed "s|$TMP/||" | sort
  trap - EXIT
  echo "Extracted packs kept in $TMP"
  exit 0
fi

pick() { # pack path-suffix dest
  local src
  src="$(find "$TMP/$1" -type f -path "*/$2" ! -path '*__MACOSX*' | head -n1)"
  if [ -z "$src" ]; then echo "  !! missing $2 in $1" >&2; return 1; fi
  cp "$src" "$3"
}

# Audio is re-encoded to mono MP3 (universally decodable, incl. Safari) when ffmpeg exists.
sfx() { # pack path-suffix name
  local tmpf="$TMP/sfx_$3.${2##*.}"
  pick "$1" "$2" "$tmpf"
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -loglevel error -y -i "$tmpf" -ac 1 -b:a 96k "$S/$3.mp3"
  else
    echo "  !! ffmpeg not found, skipping $3 (install ffmpeg and re-run)" >&2
  fi
}

S="$A/audio/sfx"
sfx impact "impactPunch_medium_000.ogg" punch
sfx impact "impactPunch_medium_002.ogg" punch2
sfx impact "impactPunch_heavy_000.ogg"  kick
sfx impact "impactPunch_heavy_003.ogg"  heavy
sfx impact "impactMetal_heavy_001.ogg"  block
sfx impact "impactSoft_heavy_000.ogg"   land
sfx impact "impactWood_heavy_004.ogg"   ko
sfx impact "impactPlate_heavy_002.ogg"  grab
sfx rpg    "cloth1.ogg"                 jump
sfx ui     "select_001.ogg"             ui_select
sfx ui     "confirmation_002.ogg"       ui_confirm
sfx ui     "bong_001.ogg"               ui_round
sfx swishes "swish-1.wav"               whoosh
sfx swishes "swish-7.wav"               whoosh_heavy

# Particle sprites: 512px originals downscaled to 128px.
V="$A/vfx"
for pair in circle_05:dot star_09:star smoke_04:smoke fire_01:flame dirt_03:debris slash_02:slash; do
  pick particles "PNG (Transparent)/${pair%%:*}.png" "$V/${pair##*:}.png"
  if command -v sips >/dev/null 2>&1; then sips -Z 128 "$V/${pair##*:}.png" >/dev/null; fi
done

echo "Done."
