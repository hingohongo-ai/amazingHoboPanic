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

## Controls

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Move | Hold the left button; the hobo walks toward the cursor | First finger on the field becomes a thumb stick | WASD or arrows |
| Swing the bindle | SWING button or right-click | SWING button | Space |
| Eat from the sack | EAT button | EAT button | E |
| Drop food | DROP button | DROP button | Q |

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

## Deploy

Push to `master`. The GitHub Action builds the game and force-pushes `dist/` to the `deploy` branch, and Plesk Git pulls that branch into `skeletonbelly.com/amazingHoboPanic/`. The game is fully static: no server code, no secrets, scores in `localStorage`.

## Layout

```
index.html              page shell and the link back to Skeletonbelly
src/main.ts             Phaser setup
src/config.ts           every tunable number (speeds, damage, Envy, Panic timings)
src/envy.ts             the hidden Envy value that triggers a Panic
src/audio.ts            placeholder whistle, footsteps and bonks (Web Audio, no files)
src/home.ts             shows and hides the back link
src/scenes/             Title, Game and GameOver scenes
.github/workflows/      the deploy Action
```

Built with Phaser 4, TypeScript and Vite. The design doc lives outside the repo.
