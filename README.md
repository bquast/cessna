# cessna

A Cessna 172 flight simulator for Meta Quest 3 (WebXR). It also runs in a desktop browser.
It is a static site: no build step, no server code.

## Files

| File | Function |
|---|---|
| `index.html` | Page, VR button, five script tags |
| `three.min.js` | three.js r187, as a classic script (global `THREE`) |
| `world.js` | Island, three airports, lights, trees, clouds, sky |
| `flight.js` | Flight model: air forces, propeller, wheels. No drawing. |
| `cockpit.js` | Airplane model, instruments, map screen, shadow |
| `main.js` | Setup, input, sound, text display, frame loop |
| `.nojekyll` | Tells GitHub Pages to publish the files as they are |

## Deploy

GitHub Pages (classic): Settings > Pages > Deploy from a branch > `master`, folder `/ (root)`.

Cloudflare Pages: connect the repo, no build command, output directory `/`.

WebXR needs HTTPS. The two hosts supply it.

## Controls

| | Quest | Mac |
|---|---|---|
| Pitch and roll (yoke) | right stick | pointer, no press |
| Throttle | left stick up, down | `W` `S` |
| Rudder and nose wheel | left stick left, right | `A` `D` |
| Brakes | trigger | `SPACE` |
| Flaps down, up | `X`, `Y` | `F`, `R` |
| Trim nose down, up | `A`, `B` | arrow up, arrow down |
| Next start position | hold the left stick button | `N` |
| Start again | hold the right stick button | `ENTER` |
| Look left, right | your head | `Q` `E` |
| Open view: no airplane body, instruments at the top | grip | `V` |
| Outside view | - | `C` |
| Pause | - | `P` |

A gamepad on the Mac uses the same layout as the Quest controllers.

## Open view

The open view hides the airplane body, thus you can see the ground below and around you.
The instruments are on a small board above your forward view. There is no yoke.
The YOKE indicator on the board shows your inputs: orange dot = yoke (down = pull), bottom mark = rudder, left mark = trim.
The flight model does not change: the wings and the wheels are there, but you do not see them.
The browser keeps your selection. `OPEN_ANGLE` and `OPEN_DIST` at the top of `cockpit.js` set the position of the board.

## Start positions

Each airport has two: on the runway, and in the air 2.5 km before the runway (70 kt, flaps 20).

| Airport | Height | Runway | Note |
|---|---|---|---|
| VALLE | 130 ft | 09, 1200 m | Flat land. Start here. |
| COSTA | 16 ft | 34, 800 m | On the west coast. |
| SIERRA | 2590 ft | 08 to land, 26 to take off, 650 m | On a mountain shelf. One direction only. |

## Fly

- Takeoff: full throttle, a small quantity of right rudder, pull lightly at 55 kt, climb at 75 kt.
- Cruise: 75% throttle gives approximately 95 kt. Full throttle gives 118 kt. Use the trim to hold the nose.
- Landing: 65 to 70 kt with flaps 20 or 30. PAPI lights at the left of the runway:
  2 white + 2 red = correct path, more red = too low. Throttle to idle and pull lightly near the ground.
- More than 890 ft/min down at touchdown breaks the airplane.

## Numbers that you can change

- `flight.js`, object `AC`: all aerodynamic numbers. `propYaw` is the left-turn tendency (0.015 = light, 0.15 = real).
- `main.js`, top: `STICK_CURVE`, `THROTTLE_RATE`, `TRIM_RATE`, `INVERT_PITCH`, `AUTO_RUDDER`.
- `world.js`, top: `AIRPORTS`, sun, fog.

## three.js

`three.min.js` is the official r187 module build, changed to one classic script with esbuild.
To make it again, or to make it from a newer release:

```
npm pack three
tar xzf three-*.tgz
npx esbuild package/build/three.module.js --bundle --format=iife --global-name=THREE --minify --outfile=three.min.js
```

The game code also runs with the original r159 `three.min.js`.
