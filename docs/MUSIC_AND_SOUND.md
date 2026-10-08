# Music and sound

Everything you hear in the game is generated live with the Web Audio API, so the game works without any audio files. You can add a recorded soundtrack whenever you have one.

## What plays when

| Situation | Music | Cue |
|---|---|---|
| Title screen | `menu` tracks (or the city score) | — |
| Exploring by day | `city` | — |
| Exploring quietly for about 15 s (no Agents, no mission, not rushing) | `calm` tracks; the score drops to 45% so nature comes forward | — |
| Night | `night` | — |
| Agents hunting you, manhunts, Runners vs Agents | `chase` | "danger" sting when a manhunt starts |
| Boss fight nearby | `boss` | — |
| Checkpoint cleared | — | rising "cleared" arpeggio |
| New island discovered | — | "discover" chime |
| Standing on a summit or tower top for the first time | — | "reach" open-fifth swell |
| Mission complete / failed | — | "victory" fanfare / "fail" phrase |
| Secret found | — | "secret" sparkle |

## Soundscape

All of this is synthesised in `src/audio/Soundscape.ts`:

| Sound | What drives it |
|---|---|
| **Birds** | Songbirds and warblers by day, pigeons near the city and seagulls near the shore. More birds on green islands; none in the rain. |
| **Night** | Crickets, frogs near water, and the odd owl. |
| **Wind** | Gusts that grow with height and speed (rooftops, gliding, fast cars). |
| **Rain** | Hiss and drips while it rains; distant thunder in heavy storms. |
| **Water** | Waves near the island edges. Waterfalls, fountains and pools sound from where they are. |
| **City** | A low traffic hum around the hub and city islands. |
| **Footsteps** | A different sound for stone, grass, sand, wood, metal, glass, wet ink, goo and gravel. Walking is soft; running is heavier, with a shoe scuff. |
| **Vehicles** | Each type has its own engine, which climbs through the gears. Tuk-tuks and motorbikes rattle. The hoverboard, skiff and glider have a turbine whine. Tyres squeal when you drift. Each vehicle has its own horn, and nitro makes a whoosh. |

Volumes are under **Settings → Audio**: Master, Music, Effects, Ambience and Voices.

## Adding a recorded soundtrack

1. Put your audio files (`.mp3`, `.ogg` or `.m4a`) in `public/music/`.
2. List them in `public/music/manifest.json` by mood:

   ```json
   {
     "menu":  ["title-theme.mp3"],
     "city":  ["ink-city-1.mp3", "ink-city-2.mp3"],
     "calm":  ["tea-hills.mp3"],
     "night": ["neon-night.mp3"],
     "chase": ["manhunt.mp3"],
     "boss":  ["warden.mp3"]
   }
   ```

3. Build as usual. Tracks crossfade when the mood changes, and the next track in the list starts when one ends. A mood with an empty list keeps the procedural score. Players can turn recorded music off with **Settings → Audio → Recorded soundtrack**.

### Where to get music you may ship on Steam

- **Commission it.** Composers on Fiverr, r/gameDevClassifieds or VGMdb forums write a 6–8 track indie score for roughly $300–2,000. Ask for a **perpetual, worldwide licence to use it in the game and its trailers**, and for loopable stems.
- **Buy royalty-free packs** whose licence allows games and commercial use: the Humble or Unity Asset Store music bundles, Soundimage.org (credit needed), Tallbeard Studios, or Kevin MacLeod / incompetech (CC-BY: credit him in the credits page).
- **Make it yourself** with free tools: LMMS, BandLab or Bosca Ceoil.

Don't use music from YouTube, Spotify or other games. Steam takes down games over copyright claims, and content ID will also flag your trailers.

Put the composer and the licence on the in-game **Credits** page (you can edit it in the owner panel).
