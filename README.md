# Amazing Hobo Panic

A joke browser game for skeletonbelly.com. You are a rail-riding hobo scavenging a railyard town. Do too well and the train whistle blows, the tramping feet draw near, and a horde of hobos arrives to take what you have, then mostly beats itself up.

This is the **gray-box prototype**: a flat top-down map with colored rectangles and synthesized placeholder sound. It exists to find out whether the loop is fun before any art is made.

| Rectangle | What it is |
| --- | --- |
| Tan | You |
| Brown, orange, cream (small) | Beans, pie, chicken |
| Blue | Townsfolk (they can see you eat) |
| Red | The railyard dog |
| Olive | Panic hobos (gray once flattened) |
| Black, on the wire at the top | Crows. Watch the crows. |
| Olive, alone at the map's edge | A lone hobo, watching. Get close and he ducks away. |
| White marks on shopfronts and boxcars | Chalk hobo signs. Somebody has been leaving word. |
| Gray puffs on the far right | Smoke from campfires that weren't there yesterday. |
| Two yellow dots in a boxcar | Eyes. |
| Slatted gray over the bright shopfront | The shopkeeper's shutter. No pie today. |
| White, pacing the bright shopfront | The shopkeeper. Stand at his windowsill for a moment to lift the pie; it comes back every so often. |
| Dark barrel with an orange flame | A barrel fire. Stand near it to warm up. |
| Dark green box | A dumpster. Stand against it to dive in. |
| Blue box on main street | The horse trough. Stand in it to wash. |
| Pale gray (small) | Newspaper. It goes in your shirt, not your sack. |
| Green haze and flies around you | Your Stink. There is no meter. |
| Outlined square with a name under it | A sack, a coat, a hat, boots, a harmonica or a cheese. Walk over it to take it. |
| Thin slanted bar with a name under it | A stick. The rebar is wedged in the track by the dog: stand still at it to pry it loose. |
| Coloured outline round you | The coat you have on. A block on your head is a hat; a strip under you is boots. |

## Controls

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Move | Hold the left button; the hobo walks toward the cursor | First finger on the field becomes a thumb stick | WASD or arrows |
| Swing the bindle | SWING button or right-click | SWING button | Space |
| Eat from the sack | EAT button | EAT button | E |
| Drop the newest thing in the sack | DROP button | DROP button | Q |
| Play the harmonica | PLAY button | PLAY button | F |
| Unwrap the Limburger | CHEESE button | CHEESE button | C |

## Survival

A day lasts three minutes and the last minute is night. Night and rain drain Warmth: low Warmth slows you, and no Warmth drains Health. Barrel fires warm you, dry daylight slowly does too, and newspaper soaks up cold until rain ruins it.

Stink rises on its own, jumps with every dumpster dive, and beans add a little more. The shopkeeper sees a long way ahead of him and not far behind, and he smells a ripe hobo in any direction; caught, you are swept off the property. In a Panic the mob gathers round you first and only then turns on itself, and hobos hesitate to hit a truly rank opponent. The trough and the rain wash Stink off.

## Bindle and coats

You start with a twig and a hanky that holds three things. A better stick hits harder and reaches further; a better sack holds more. Gear turns up now and then in dumpsters and falls out of flattened hobos; walk over a piece to take it, and whatever it replaces drops where you stand. You wear one hat, one coat and one pair of boots.

| Coat | In a Panic | The rest of the time |
| --- | --- | --- |
| Wool coat | Nothing | Halves the cold |
| Stiff overcoat | Blocks a share of every bindle hit | A little warmth |
| Barrel and suspenders | Blocks most of a hit and cannot be staggered | Very slow, and you cannot bend over: no dumpsters, no pie, no rebar |
| Bean-can armor | Blocks more for every empty can; eating beans adds a can | It clanks, so the dog notices you from further off |

| Hat or boots | In a Panic | The rest of the time |
| --- | --- | --- |
| Stew pot | Blocks a little of every bindle hit | Nothing |
| Top hat and monocle | Hobos go for you first | The shopkeeper leaves you alone, and Envy climbs faster |
| Hobnail boots | Cannot be staggered, and your swing shoves hobos much further | Loud: the dog and the shopkeeper notice you from further off |

Two things go in the sack and are not food. The harmonica gets a PLAY button: nearby hobos stop and dance, you cannot swing while you play, and you need your breath back before the next tune. The Limburger gets a CHEESE button: unwrap it and your Stink goes straight to the top. EAT skips both; DROP drops the newest thing in the sack whatever it is.

Take a piece that fell out of a flattened hobo and the next horde mutters about it. Dry newspaper in your shirt blocks a little too. A bindle hit can stagger you: for a second or two you cannot swing and your feet only half listen. The game-over screen says what killed you.

A full belly mends you: while Hunger is near the top, Health comes back and Hunger goes faster. It does not work during a Panic.

Townsfolk step back from a ripe hobo and tell him so. Keep Stink at its maximum for 20 seconds and they shout a warning, then swarm you and drive you into the horse trough. They hold you in the water until every last bit of Stink is gone. Nothing you wear stops them.

As Envy climbs the town changes in stages: crows and a far-off harmonica, then watchers at the edge, chalk signs and smoke, then rattling dumpsters, eyes in the boxcars, muttering townsfolk and the shopkeeper's shutter. It all clears when the whistle blows; the shutter goes up once the Panic is over.

Eating in private lowers Envy; eating where anyone can see raises it. Dropped food pulls the horde and the dog off you, and the hobo who grabs it becomes a target for the rest. On a phone, play in landscape.

## Develop

```
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` type-checks and writes the static site to `dist/`.

In dev mode the game is on `window.__game`, so the browser console can poke at it. To force a Panic:

```js
__game.scene.getScene('Game').envy.add(999)
```

To be handed a coat, or to be staggered:

```js
__game.scene.getScene('Game').takeGear({ kind: 'wear', wear: { ...see COATS in src/config.ts } })
__game.scene.getScene('Game').stagger = 2
```

To see the hint stages without tripping a Panic (0.35 is Rising, 0.6 High, 0.85 Critical), or to be two seconds from a townsfolk swarm:

```js
g = __game.scene.getScene('Game'); g.envy.value = g.envy.threshold * 0.9
g.stink = 100; g.ripeFor = 18
```

To start a shower, or to jump to dusk:

```js
__game.scene.getScene('Game').sky.startRain()
__game.scene.getScene('Game').sky.seconds = 120
```

## Deploy

Push to `master`. The GitHub Action builds the game and force-pushes `dist/` to the `deploy` branch, and Plesk Git pulls that branch into `skeletonbelly.com/amazingHoboPanic/`. The game is fully static: no server code, no secrets, scores in `localStorage`.

## Layout

```
index.html              page shell and the link back to Skeletonbelly
src/main.ts             Phaser setup
src/config.ts           every tunable number (speeds, damage, Envy, Panic timings, day length, Warmth, Stink, sticks, sacks, coats, hint stages, townsfolk, healing)
src/envy.ts             the hidden Envy value that triggers a Panic
src/sky.ts              the clock and the weather: day, night and rain
src/audio.ts            placeholder whistle, footsteps, bonks and rain (Web Audio, no files)
src/home.ts             shows and hides the back link
src/scenes/             Title, Game and GameOver scenes
.github/workflows/      the deploy Action
```

Built with Phaser 4, TypeScript and Vite. The design doc lives outside the repo.
