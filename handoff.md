# Riffle: handoff

Notes for whoever picks this project up next, whether a person or an agent. `README.md` covers what Riffle is and how to play it. This file covers how it is built, where things live, what to watch out for, and how to check your work.

*As of 2026-10-21. Repo: https://github.com/groblox/riffle (public, `main`).*

---

## 1. State of play

- **Status:** feature-complete for the current scope. It builds cleanly and has no known bugs. Every change listed below was checked visually in a headless browser.
- **Stack:**
  - three.js r186 (`three@^0.186.1`) and Vite 8, plain ES modules.
  - No framework, no TypeScript, no tests, no 3D model files. All geometry, textures and sketches are procedural, and most of the sound is synthesized.
- **Size:** about 13k lines of JS/GLSL in `src/`, plus about 18 MB of audio in `public/audio/`.
- **Runs on:** desktop browsers with WebGL 2, and phones and tablets with touch controls. High quality targets a high-end GPU (it was tuned on roughly an RTX 4070 Ti); touch devices start on Low.
- **Hosting:** none. The project is not deployed anywhere public. See §8 before changing that.

### Recent work (newest first)

1. **Audio:**
   - separate Effects, River and Music sliders (music starts at 30%); a skip button for the music
   - the dipper call and chipmunk chip sounds removed
   - leftover folio sounds removed, leaving only the recorded open and shut
2. **Control dock:** rebuilt to be collapsible, with its settings remembered in localStorage.
3. **Folio:** picking an entry in the same category swaps the right page without turning a leaf; changing category turns one.
4. **Look:**
   - the trail made fainter and half-grassed
   - the tarn rewritten: deeper, with refraction, absorption, caustics and a planar mirror
   - sunrise and sunset split-toning
   - winter snow cover over the whole Colorado side
5. **Assets:** recorded sound effects and six music tracks added in `public/audio`. `Launch Riffle.bat` added.
6. **Earlier passes:**
   - granite waterfall rebuilt from scratch
   - mountain, trail and switchbacks, tarn, spruce variety
   - campsites with sitting and tent views
   - fossils and critters under stones
   - heron and dragonflies
   - field-guide folio
   - camera bounds
   - arid desert side

---

## 2. Running it

```bash
npm install
npm run dev          # http://localhost:5199, also on the LAN (vite.config.js: host: true)
npm run build        # static site → dist/
npm run preview
```

- **Windows:** `Launch Riffle.bat` checks for Node, installs dependencies on the first run, reuses a server that's already running, and opens the browser.
- **Network:** the owner's LAN address has been `http://192.168.1.202:5199/`.
- **Debug URL parameters** (parsed in `main.js` / `controls.js`):

  | Parameter | Effect |
  |---|---|
  | `play` | skip the intro |
  | `pause` | freeze time |
  | `t=17.5` | hour of the day |
  | `season=0\|1\|2` | summer, autumn or winter |
  | `rain` | start rain |
  | `q=0\|1\|2` | quality; also disables the auto-fallback to Low |
  | `x= z= d= yaw= p=` | camera position |

- **Debug handle:** `window.__riffle` is the whole `app` object: `controls`, `sky`, `water`, `lake`, `rocks`, `camp`, `interact`, `ui`, `pipeline`, `shape`, critters and more.

---

## 3. Architecture

### Boot (`src/main.js`)
1. Creates the renderer, scene, an `overlay` scene (for transparent things drawn after the water) and the camera.
2. Builds the UI and audio engine, then awaits `boot()`.
3. `boot()` builds the world in order (terrain grid, terrain, rocks, sky, water, waterfall, lake, vegetation, critters, camp, fossils), yielding to the browser between steps so the progress bar moves.

### Frame loop (`frame()` in `main.js`)
1. **Timing:** `dt` is clamped to 50 ms. An FPS check drops to Low once if the first seconds on High average under 32 fps; it is skipped when `q` is in the URL.
2. **Season and wind:** `U.uSeason` eases toward `app.seasonTarget` (0 to 2), and `U.uSnow = smoothstep(1.4, 2.0, season)`. Wind is a slowly rotating direction with gusts.
3. **Updates:** `sky`, `interact`, `water` (GPU sim), `rocks` (physics), `veg`, every critter system, `camp`, `fossils`, particles and leaves.
4. **Audio:** `audio.update(dt, {...})` gets camera, focus, zoom, wind, rain, night, season and creek turbulence.
5. **Render:**
   - one planar reflection per frame: the tarn's plane when `lake.wantsReflection(camera)`, otherwise the creek's
   - `water.bindFrame`
   - sun screen position for the light shafts
   - exposure, night tint and golden-hour split tone
   - `pipeline.render`

### Shared state (`src/core/env.js`)
- **`U`:** the global uniform bag (time, sun, sky ambient, wind, season, snow, rain, night, cloud, camera position, …). Every material shares these by reference.
- **`commonGLSL` / `fogGLSL` / `contactGLSL`:** GLSL chunks shared by most shaders. `snowCover()` is here (see §5).
- **`patchMaterial(mat, hooks, key)`:** injects GLSL into three.js built-in materials through `onBeforeCompile`. Most terrain, foliage and rock shading goes through it.

### World shape (`src/world/shape.js`)
This is the single source of truth for the land, and everything else samples it. It holds:
- the stream profile, sampled along z: `streamCenter`, `waterLevel`, `streamHalfW`, `streamSpeed`, `streamTurb` and friends. It is also uploaded as a texture (`getProfileTexture`, `profileGLSL`) so shaders get the same numbers.
- `terrainBase` / `terrainSample`, which combine biomes (canyon, forest, riparian, arid), the mountain (`PEAK`), the tarn cirque (`LAKE`, `CIRQUE`), the granite outcrop band at the falls and the erratic.
- `heightGrid` / `bioGrid`: a 400×400 cached grid that `groundAt`, `bioAt` and `normalAt` read from.
- `TRAIL`, `trailNear`, `trailDist`, `CAMPSITES`, `campsiteAt`, `ERRATIC`.
- Constants: `WORLD = 160`, `BOUNDS = 118`, `VIEW` (camera bounds), and `WF_Z = -38` / `WF_DROP` / `WF_LEN` (the waterfall).
- **Coordinates:** +y is up, z runs along the valley (−z is upstream and the falls), −x is the Colorado and mountain side, +x is the desert side.

### Rendering (`src/gfx/pipeline.js`)
1. MSAA scene target
2. fog composite
3. water pass: reads `tScene` and `tDepth` for refraction
4. bloom and god-rays
5. final grade (exposure, S-curve, `uTint`, `uShadowTint`/`uHighTint` split tone)

`QUALITY` presets are at the top of `main.js` (DPR, MSAA, shadow size, grass density and distance, reflection scale, SSAO).

### Systems

| Area | Files | Notes |
|---|---|---|
| Water | `world/water.js` | GPU ripple and foam sim, potential-flow field around emergent rocks, planar reflection (`renderReflection(scene, cam, focusZ, planeY)`), shading |
| Waterfall | `world/waterfall.js` | jet mesh, spray, mist, plunge pool; the granite step itself comes from `shape.js` and `rocks.js` |
| Tarn | `world/lake.js` | its own mesh and shader, but shares the creek's uniforms (`tScene`, `tDepth`, the reflection) |
| Terrain | `world/terrain.js` | terrain mesh and shading: rock strata, varnish, trail tread, snow, lake bed |
| Rocks | `world/rockgen.js`, `world/rocks.js` | fractured-boulder generator; layout; carry, stack, throw and flip physics |
| Vegetation | `world/vegetation.js` (the largest file) | aspens, spruce variants, shrubs, desert plants, about 190k grass tufts (instanced), flowers |
| Sky | `world/sky.js` | sun and moon, time-of-day key frames with separate morning and evening tints, clouds, rain, stars |
| Camp | `world/camp.js` | placement ghost and validity check (`camp.check`), tent, chairs, fire, lantern, sitting and tent views |
| Fossils | `world/fossils.js` | six fossil types under about 3% of liftable stones; collected via `riffle.fossils` |
| Critters | `critters/*.js` | `kit.js` has shared helpers; `under.js` is life under turned stones (about 50%) |
| Interaction | `core/interact.js` | picking, hover tooltips, clicks, drags, stone skipping, planting, leaf boats |
| Camera | `core/controls.js` | orbit and walk, Shift for fine movement, soft bounds (`VIEW`), `sit(eye, yaw, pitch)` / `stand()`, touch gestures (see §5), `setAspect` widens the FOV on portrait screens (`baseFov`) |
| Audio | `audio/audio.js` | see §4 |
| UI | `ui/ui.js`, `ui/folio.js`, `ui/guide.js`, `ui/sketches/*`, `style.css` | dock, toasts, tooltips, hints, the touch tray and context bar; the folio field guide; entry data; SVG ink-and-wash sketches |

### Persisted state (localStorage)

| Key | Holds |
|---|---|
| `riffle.found`, `riffle.foundMeta` | field-guide discoveries and when and how they were made |
| `riffle.fossils` | collected fossils |
| `riffle.vol`, `riffle.waterVol`, `riffle.musicVol` | the sound, creek (0–1.5) and music levels |
| `riffle.dockFolded` | whether the dock is folded |

---

## 4. Audio

- **Graph:** `sfx`, `ambBus`, `musicBus` and `reverb` feed `master` and a compressor.
  - The **Effects** slider sets the `sfx` and `ambBus` gains (one-shots, birds, wind, rain, fire).
  - The **River** slider sets `waterBus`, which feeds `master` directly, so it is independent of Effects: the bubble loops, the recorded bed, rumble/babble/sparkle and the falls all route through it.
  - The **Music** slider sets `musicBus` to `musicVolume × 1.8`.
  - **Mute** sets `master` to 0.
  - `skipTrack()` jumps to the next piece now (the skip button in the Music row).
- **Samples:** `public/audio/sfx/*.mp3` are decoded at start (the `files` map in `loadSamples()`). `onsets()` finds individual hits inside the rock recordings, and `knock()` plays a single onset pitched by the stone's size (large stones drop to 0.4×; only `large-rocks-1` is used).
- **Recorded calls and impacts** (added 10.22.26): thuds (`thudS`/`thudL`, from the Warner Bros. cartoon library), the stoke (`stoke`, a real wood-fire recording), raven (rook caws played at ~0.8×), frog, whistle, the five scheduled calls (wren, chickadee, woodpecker, owl, coyote). `voice()` plays a recording at a world position. Every one keeps its synthesized version as a fallback until the file loads. Sources: `G:\Music\Sounds of Nature` (frogs, owl, wolves, cardinal whistles, woodpecker-like drum), `D:\sfx` (rookery, wood fire), and the Warner Bros. library. Several are stand-ins (the collection has no canyon wren or chickadee, and the “coyote” is wolves); swap the files in `public/audio/sfx/` to improve them.
- **Creek bed:** two recorded creek takes play as an equal-power crossfade loop (`updateBed`), under the synthesized bubble model.
- **Music:**
  - Tracks stream through an `HTMLAudioElement` into `createMediaElementSource`. The list is `tracks` in `setupMusic()`.
  - The order is shuffled, with 25–55 s of quiet between tracks.
  - Turning music off fades it out and pauses the element after 4 s (`offT`).
  - The tracks were loudness-matched to about −20 LUFS with ffmpeg before being added.
- **Folio sounds:**
  - `bookOpen` and `page` are recorded, with synthesized fallbacks.
  - `bookShut` is the tail of the open recording (`from: 0.62`), timed 380 ms into the close.
  - There are deliberately no strap, clasp or set-down sounds.
- **Removed on request (don't bring them back):** the dipper call, the chipmunk chip and the old synthesized folio sounds.
- **Sound report** (`docs/sound-report.html`, untracked, local only):
  - Lists every sound in use: 23 recorded sfx and 8 music tracks with `<audio>` players, and all synthesized one-shots, songs and ambience layers with the source lines that fire them.
  - The synthesized rows have ▶ buttons that run the real `AudioEngine`, so it must be opened through the dev server (`http://localhost:5199/docs/sound-report.html`), not as a file. Its module script imports `/src/audio/audio.js` and `/src/world/shape.js`; without the dev server the buttons grey out and a notice shows.
  - One-shots call `play(name, opts)`. Songs call `canyonWren`, `chickadee`, `woodpecker`, `owl`, `coyotes` at a fixed spot near the listener. The cricket and raindrop-bubble rows loop `cricket()` and `bubble()` themselves.
  - Ambience buttons set a fake state (listener position, wind, rain) and call `update(0.05, st)` every 50 ms.
  - The report sets `musicOn = false` and pushes the `next` bird and thunder timers out, so only what you press is heard.
  - It is generated, not hand-edited. There's no generator in the repo (it lived in a session scratchpad), so edit the HTML directly or rebuild it from this description.
  - It stays local because it links the unlicensed music and sfx. Don't publish it.

---

## 5. Gotchas

**Version stamp**: `src/version.js` holds `VERSION` (`MM.DD.YY.HHMM`-style, e.g. `10.04.26.1823`) and the `NOTES` list. Bump `VERSION` and add a line to the top of `NOTES` with every change; the stamp shows faintly bottom-left and clicking it opens the notes.

These cost real time before. Read them before touching the related code.

**Shaders**
- `patch` is a reserved word in GLSL and makes the shader fail to compile. Don't use it as a variable name.
- Anything that decides "water or land" in a shader has to match `shape.js`. It reads the profile texture, so change both together.

**Snow and terrain**
- The winter floodplain sits only about 5 cm above `waterLevel` (the centreline level). To tell bank from channel, use distance from the edge, `|x − profileA.x| − profileA.z`, not height. `snowCover()` in `env.js` works this way.
- Desert snow uses three noise scales. A single scale gave a blotchy "cow print" look.

**Reflections**
- There is one planar reflection per frame, shared by the creek and the tarn.
- If the tarn looks unreflective, the mirror is probably fine: the cause last time was too bright a water body and too much cat's-paw sky mixed in.
- To inspect it, read `water.reflRT` with `renderer.readRenderTargetPixels` into a `Uint16Array` (the target is HalfFloat) and decode the values.

**Camera**
- Camera bounds come from `VIEW` in `shape.js`: focus |z| ≤ 98, lateral −60 to +62 from the creek, eye within ±126. Targets outside these get pulled back.
- When positioning the camera from code, set `yaw`, `dist` and `smoothTarget` directly, not only the `*T` targets.
- Cliffs: when the eye would end up inside terrain (a wall behind it), `rayBlocked()` / `occP` tip the camera up over it by the least pitch that clears, and `floorY` keeps the eye above the ground by a floor that climbs fast but sinks gently (and looks a little ahead), so riding off a ledge doesn't snap the view.
- `flyTo(x, z, dist)` glides the focus somewhere (the **V** key / campsite button, `app.visitCamp`); any steering of your own ends it. `sit(eye, yaw, pitch, wide)` takes a lens multiplier: the tent sits at the door with `wide = 1.7`.
- The creek's water mesh runs to z = ±340 (the stream is defined to ±340) and the far terrain's valley corridor is wide (`valley` in `farHeight`), so the ends of the world are lost in haze, not a visible edge or a slit.

**The trail**
- `TRAIL` is a list of control points that was routed offline once:
  - a Dijkstra search over 0.5 m cells × 32 headings
  - a hard 20% grade on each leg, teardrop switchbacks (≤ 32%, ≤ 1.3 m of cut and fill)
  - a 22% grade limiter applied to `TRAIL.y` at load
- If you change the mountain, re-route the trail and re-check it: grade, cross-slope, and distance to the other legs.
- Pitfalls hit last time:
  - a Float32 distance array compared against Float64 heap values silently drops states
  - 22.5° heading steps can't climb slopes steeper than about 0.5
  - judge U-turns by rise over arc length, not by the terrain slope along the arc

**Touch**
- Touch mode is `body.touch`, set from `(pointer: coarse)` at load and flipped by `Controls.setTouch` whenever the last input was a finger or a mouse. CSS shows `.for-touch` / `.for-mouse` copies of the hint text off it.
- Gestures live in `Controls.touchDown/Move/Up`: one finger pans by keeping the ground point under it (`planeHit` on the focus plane), two fingers pinch/orbit/tilt/twist, a still press of 0.32 s becomes a hold (`held`, `'hold'` event, wall-clock so slow frames don't stretch it). A tap emits the normal `click`.
- A finger has no hover: `Interaction.update` keeps the cursor live only while `held` or for `tapT` after a tap. Carrying a stone and the hand in the water need `held` on touch, so a quick drag always pans.
- The touch tray arms `Interaction.tool` (stone, flower, leaf); the next tap calls `useTool` there. While placing a camp, taps move `Interaction.pin` instead of pitching; the context bar (`syncContext` in `main.js`, `UI.setContext`) has the Rotate / Pitch here / Cancel / Get up / Sleep buttons.
- `touchText()` in `ui.js` rewrites toasts and tooltip hints for touch ("click" to "tap", key shortcuts dropped). New hint strings with key names should fit its patterns.
- **Folio layouts** (`style.css`, `folio.js`): wide screens get the two-page spread. Portrait screens up to 900 px (phones and tablets upright, `flat()` in `folio.js` mirrors the media query) get a flat stack: a short page with one heading row and a sideways-scrolling strip of thumbnails (`.index`, cells sized by `Folio.fit()` so a half cell always peeks out), the entry filling the page below, and the ribbons as a scrolling row under the book. Short landscape phones keep the spread but trim the left page (two-column index, no stamp). When flat, `setOpen` skips the cover choreography (ready in about 0.3 s) and `go()` swaps the page directly, because the `.flip` leaf is `display: none` there and would otherwise leave the old page up for 0.9 s. `body.guide-open` hides the game's touch buttons behind the book.
- Specificity trap: `.index { touch-action: pan-y }` is defined late in the file; the phone layout needs `.guide .index { touch-action: pan-x }` to beat it, or a sideways swipe on the strip turns the page instead of scrolling it.
- A finger fires `pointerleave` on every lift, so `app.pointerInside` ignores touch pointers.
- To test in headless Chrome, open a Playwright context with `hasTouch: true, isMobile: true` and send `Input.dispatchTouchEvent` through a CDP session (Playwright's `tap` only does single taps).

**Workflow**
- Headless Chrome runs requestAnimationFrame at about 1 fps. Animated critters barely move, and the auto-quality check can wrongly drop to Low, so always pass `q=1` when testing.
- The project lives in a synced folder, which has produced sync-conflict copies such as `src/critters/birds (# Edit conflict …).js`. `.gitignore` excludes `*# Edit conflict*`. Nothing imports those files; delete them locally if you like.
- Git on Windows warns about LF/CRLF on commit. It's harmless; there's no `.gitattributes`.

---

## 6. How to check changes visually

No automated tests exist. Every change so far has been checked visually with the Playwright MCP against the dev server:

1. Load `http://localhost:5199/?play&pause&t=10.5&season=0&q=1`.
2. Frame the camera from `page.evaluate`:
   ```js
   const r = __riffle, c = r.controls;
   r.ui.toggleHidden(true);
   for (const k of ['target', 'smoothTarget']) { c[k].x = 0.9; c[k].z = -36.3; }
   c.dist = c.distT = 8; c.yaw = c.yawT = 0; c.pitchOffset = c.pitchOffsetT = 0;
   ```
   `yaw = 0` looks toward −z (upstream). To hide the hover tooltip as well, inject the CSS `.tooltip{display:none!important}`.
3. Wait about 4 s, then screenshot. Playwright can only save inside the project root, so delete the screenshots and `.playwright-mcp/` afterwards.
4. For comparisons (times of day, before and after), take several shots and tile them with ffmpeg `hstack`/`vstack`. Use `vstack=inputs=3` for three rows. ffmpeg is at `/c/userscripts/ffmpeg/bin` on the owner's machine.

**Useful camera positions:**

| View | Settings |
|---|---|
| Waterfall front | x 0.9, z −36.3, d 8, yaw 0 |
| Falls and pool (README shot) | x 0.9, z −33, d 13, yaw 0.25, t 17.6 |
| Valley (README hero) | x −5, z 40, d 45, yaw 0.9, pitch offset −0.35, t 17.6 |
| Camp at night | `__riffle.camp.place(-18, -12, 0.6)`, then x −18, z −12, d 8, yaw 2.4, pitch offset 0.25, t 21.5 |
| World edge | x 0, z 98, d 14, yaw π |

**Other hooks:**
- Free camera: `controls.sit(eyeVec3, yaw, pitch)` then `controls.blend = 1`; `controls.stand()` returns to orbit.
- Camp spot validity: `camp.check({x, z, rot})` returns the reason a spot is invalid.
- Rocks: `__riffle.rocks.grab/holdAt/release/flip`, `__riffle.interact.clickRock(rk)`.
- Critters: to pose them, wrap `heron.update` / `dragonflies.update` in a freeze flag and step the original by hand (e.g. 1/30 s × N).
- Spruce variants: move instance `t.index` of each distinct `t.leafIM` (and the trunk instance that shares its `aShake`) into a row to compare them.

`npm run build` is the only automated check. Run it before pushing, then delete `dist/`.

---

## 7. Owner's taste and preferences

These are inferred from many rounds of feedback.

- **Art direction:** "Breath of the Wild, but 15% more realistic". Painterly, warm and readable, never photoreal-grim or cartoonish.
- **Calm over busy.** The owner has repeatedly turned things *down*:
  - fish jumps cut 60%, then removed entirely
  - fireflies cut 60%
  - less glint on the river, a quieter river, a fainter trail
  - small bird chirps removed

  When adding life or effects, start subtle.
- **Geology should look real:** the waterfall rocks should read as part of the bedrock, not props. Colorado granite on the west, Utah sandstone on the east. Desert stays arid, with snow only up high or in winter.
- **Requests come as dense lists,** often with exact percentages ("60% less", "50% brighter"). Treat the numbers literally, do every item, then report back item by item.
- **The owner likes seeing results:** screenshots of visual changes are welcome.

---

## 8. Constraints and open decisions

- **Music licensing:**
  - The six tracks in `public/audio/music/` come from a commercial CD (*Spiritual Songs, Traditional Chants & Flute Music of the American Indian*, The Gold Collection).
  - The owner chose to include them in the public repo, knowing the risk, and the README credits them as personal-use only.
  - **Do not deploy the site publicly (Netlify, GitHub Pages, …) without the owner's explicit go-ahead.** If a deploy happens, consider replacing the music with licensed or CC0 tracks first. Swapping music means dropping files into `public/audio/music/` and editing `tracks` in `audio.js`.
- **Sound-effect recordings** in `public/audio/sfx/` came from the owner's own sfx folder, and their source and licence aren't recorded. Ask before any public deploy.
- **No license:** the repo has none, so it is all-rights-reserved by default. Adding one (e.g. MIT for the code only) is the owner's call.
- **Commit identity:** commits are authored as Ben Heine <rbheine@gmail.com>, set repo-locally. The GitHub account is `groblox`, and the `gh` CLI is installed on the owner's Windows PC.

---

## 9. Ideas not yet done

None of these have been requested. They're simply the obvious next steps if the owner asks "what next?":

- a hosted, playable build (blocked on §8)
- a favicon: the browser currently logs a 404 for `/favicon.ico`, which is harmless
- a quick-look shortcut to the tarn and upper trail, since they're a long walk from the start
- a small `.gitattributes` to quiet the CRLF warnings
