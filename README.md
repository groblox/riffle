# Riffle — a canyon creek nature toy

A small, hand-built world where Colorado aspen country meets Utah sandstone, with a creek running through it. Wander, listen, and poke at things.

## Run

```bash
npm install
npm run dev        # http://localhost:5199
```

`npm run build` writes a static site to `dist/`, which you can host anywhere. It needs WebGL 2. Headphones are recommended.

## Controls

| Input | Action |
|---|---|
| **WASD** / arrows | wander (hold **Shift** for slow, fine movement: walking, orbiting and zooming) |
| **Scroll** / **+ −** | zoom (the camera flattens out as you get closer) |
| **Right-drag** / **Q E** | orbit and tilt |
| **Click** | interact with creatures, trees, flowers, rocks, water and grass |
| **Drag in water** | trail your hand through the creek |
| **Drag a small stone** | carry it: stack a cairn, set it in the creek, or flick it to throw it |
| **Click a stone** | turn a small one over to see what lives underneath (about one in thirty hides a fossil: click it to collect it); nudge or knock the big ones |
| **F** | skip a stone toward the cursor |
| **G** | plant a wildflower |
| **B** | float a leaf boat downstream |
| **C** (or the tent button in the dock) | pitch a camp: a ghost follows the cursor, green where the ground is flat and dry, and snaps onto the marked campsites; click to pitch, **R** rotates, **Esc** cancels, **C** again moves it, **X** packs it up |
| **Click a camp chair / the tent** | sit down (or crawl in): you stay put and drag or **A D Q E W S** to look around, scroll to look closer, **Z** in the tent at night sleeps till dawn, **Esc** gets up |
| **Space** | whistle (the birds sometimes answer) |
| **T** / **P** | advance an hour / pause time |
| **J** | field guide · **H** hide the UI · **M** mute · **N** music · **?** hints |
| **A** / **D** (in the field guide) | turn the pages · **W** / **S** jump between sections · **J** or **Esc** closes it |

The panel in the lower right controls time of day, weather (clear, cloudy, rain), season (summer, autumn, winter), wind, separate sound and music levels (music starts at 30%) and quality. Its arrow folds it down to just the time of day; the levels and the folded state are remembered. High (the default) is tuned to keep a current high-end GPU busy: 8K shadow map, full-resolution reflections, screen-space ambient occlusion and denser, further grass. If it runs below about 32 fps on first load it steps down to Low automatically.

## What's in it

- **Water:** the surface rides on a GPU ripple and foam simulation. A flow field built from potential flow around every emergent rock carries it downstream, so foam streams off the boulders and ripples drift with the current. The shading adds planar reflections, depth-aware refraction with emerald absorption, flow-mapped detail normals, sun glints that respect shadows, caustics on the streambed, wind cat's-paws, and a waterfall modelled on Colorado mountain cascades such as Boulder Falls and Castlewood Canyon. The creek drops over the broken edge of a band of jointed granite bedrock that crosses the valley floor and runs on into both banks as bare, ice-smoothed slabs. The water squeezes through the joints between the lip blocks as one main jet, with thin strands slipping past their shoulders. The jet is glassy at the brink and roped and white by the time it hits the plunge pool, with spray, mist and boils where it lands. Above the step is bouldery pocket water. Around it are spray-darkened rock with moss only in the damp joints, ferns, spruce, and a flood-washed spruce log (silvered wood, torn root wad, snapped limbs) lying into the pool with a couple of smaller limbs jammed against it. Stones you set in the creek become part of the flow field and pick up their own foam wakes.
- **Land:** procedural terrain with terraced, cross-bedded sandstone mesas that carry desert varnish. Pale caprock appears only up high. In winter, snow blankets the Colorado side from the creek banks up (thinner and patchy right by the water, with the meadow grass poking through), while the desert side gets ragged drifts with red ground showing low down, whitening with height. The east side is an arid floor of red sand, crusted soil and slickrock. The west side rises from an aspen meadow, past a house-sized granite erratic, to a granite mountain whose summit stands about 170 m above the creek. Spruce forest on its lower slopes thins and shrinks to stunted krummholz at a ragged timberline; above it is tawny alpine turf and scree, then buttressed rock with snow lying in the gullies all year, joining into snowfields near the top. High on the east face a cirque holds a small, clear tarn under its headwall: a shelf of shallows over pale gravel, with caustics, drops off to a deep blue-green middle that mirrors the headwall and sky. A faint, half-grassed footpath leaves the stepping stones and climbs to the tarn in long traverses and switchbacks (laid out by a grade-limited path search, so no stretch is steeper than about 22%), with level campsites along the way (Boulder Meadow, Gravel Bar, Aspen Flat, Spruce Shelf, High Camp, Tarn Camp). There are gravel bars, and distant Rockies and plateaus. The camera is held inside the valley (and along the trail) by a soft bumper, so you never reach the edge of the world.
- **Rocks:** fractured boulders with flat joint faces and worn edges: cross-bedded sandstone blocks and slabs with varnish streaks, speckled granite with quartz veins, cracks, lichen and moss. They sit bedded in the ground with debris at their feet, and the creek polishes and wets the ones in and beside it. Small stones can be carried, stacked, thrown and turned over.
- **Life:**
  - Fish: rainbow, brown and cutthroat trout, which hold in the current and rise to sip insects.
  - Birds: American dippers that bob and dive, a great blue heron (which flies the creek with its neck folded into an S, legs trailing and slow, bowed wingbeats), and soaring ravens.
  - Insects: butterflies; meadowhawk and darner dragonflies (big compound eyes, banded abdomens, veined wings with dark wing-spots) that patrol the shallows and settle on dry reed stalks; grasshoppers, fireflies and midges.
  - Small animals: chipmunks, push-up lizards and chorus frogs.
- **Plants:** quaking aspens with fluttering leaves that drop gold leaves when shaken, Engelmann spruce in several forms (fine spire leaders, bent and forked double tops, blunt tops, dead spike-tops, narrow high-slope columns), red-osier dogwood, reeds, about 190k grass tufts, and wildflowers that bloom when clicked. The desert side has juniper, big sagebrush, rabbitbrush, narrow-leaf yucca, prickly pear, Mormon tea, and sparse straw-coloured bunchgrass.
- **Sound:** mostly synthesized, with a few recordings (`public/audio`) layered in:
  - Water: a recorded mountain creek (two takes crossfaded end to end) under a synthesized one built from thousands of modelled air bubbles (gurgling pockets in the brook, glassy chatter over the riffles, a deep boil under the falls) over a soft rush, and you can hear the waterfall from its direction.
  - Weather: wind, rain and thunder.
  - Wildlife: canyon wren, chickadee, sapsucker, owl, coyotes, crickets and frogs.
  - Effects: stones knock with single hits cut from recordings of river rocks (pitched by size), plops and splashes ring like real bubbles, and the field guide's leather opening and page turns are recorded (its strap snap and closing clap are synthesized).
  - Music: six recorded Native American flute pieces (from *Spiritual Songs, Traditional Chants & Flute Music of the American Indian*), loudness-matched, shuffled, with 25–55 s of quiet between them. N toggles it; the list is `tracks` in `src/audio/audio.js`.
- **Field guide:** a worn leather folio with a cloth tab for each category. It appears closed, its strap pops free, and the front cover swings across on the spine with the sound of old leather; closing settles it shut. Picking an entry (or A and D within a category) just changes the right-hand page; a leaf turns only when you move to another category (the tabs, W and S, or A and D past the end). The left page indexes that category with a pen-and-watercolour sketch of every species, plant and rock you've recorded; the right page shows the selected study taped in, with its name, Latin name, a handwritten note and when and how you recorded it. Each new discovery's sketch also appears in its toast.
- **Camp:** a dome tent with rainfly, poles and guy lines, two folding chairs (one with a plaid blanket), a stone fire ring with a live fire, embers, smoke drifting on the wind and flickering firelight, a folding table with a lantern that comes on at dusk, and a woodpile with an axe in the stump. Click the fire or the woodpile to stoke it, the table to toggle the lantern, a chair to sit by the fire, or the tent to crawl in and look out through the door (its fabric glows with the light outside); at night, Z in the tent sleeps until dawn.
- **Under the stones:** about half the stones you turn over have something living under them: ground beetles, millipedes and western tiger salamanders on land; mottled sculpin, stonefly nymphs and caddisfly larvae in the creek.
- **Fossils:** six kinds from the rocks of Colorado and Utah (Elrathia trilobite, ammonite, Knightia herring, Florissant leaf, Spirifer brachiopod, crinoid stem), each pressed into a little slab under about 3% of the liftable stones.
- **Field guide:** 43 species, features and fossils, recorded when you click on them, hear them or find them under a stone. Your progress is saved in the browser.

## Code map

```
src/
  main.js            boot, frame loop, ambient effects
  core/              shared uniforms + GLSL, camera controls, picking & interactions
  gfx/               render pipeline (MSAA → fog composite → water → bloom/shafts → grade),
                     procedural textures, foliage materials
  world/             shape (stream path, terrain, mountain, trail, campsites), terrain, sky & lighting, water, waterfall, lake,
                     rocks (generator, layout, carry/stack/flip physics), vegetation, camp, fossils
  critters/          fish, bugs, birds, ground critters, life under stones
  fx/                particles, leaves
  audio/             WebAudio engine (synthesis, samples, music playlist); the files are in public/audio
  ui/                overlay UI, the field-guide folio, its data and its 37 ink-and-wash sketches (ui/sketches)
```

Debug URL parameters: `?x=&z=&d=&yaw=&p=` set the camera, `t=17.5` sets the hour, `pause` stops time, `season=0|1|2` picks the season, `rain` starts rain, `q=0|1|2` sets quality, and `play` skips the intro.
