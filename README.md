# cessna

A flight simulator for Meta Quest 3 (WebXR) with three aircraft: a Cessna 172, a powered delta wing and a helicopter.
It also runs in a desktop browser. It is a static site: no build step, no server code.

## Files

| File | Function |
|---|---|
| `index.html` | Page, VR button, options panel, seven script tags |
| `three.min.js` | three.js r187, as a classic script (global `THREE`) |
| `world.js` | Island, three airports, lights, trees, clouds, sky |
| `flight.js` | Flight models and the assist. No drawing. |
| `cockpit.js` | Aircraft models, instruments, map screen, options hub, shadow |
| `link.js` | Copilot link: pairing, state messages, option changes |
| `peerjs.min.js` | PeerJS 1.5.5 (WebRTC library), not changed |
| `main.js` | Setup, options, panel, input, sound, text display, frame loop |
| `.nojekyll` | Tells GitHub Pages to publish the files as they are |

## Deploy

GitHub Pages (classic): Settings > Pages > Deploy from a branch > `master`, folder `/ (root)`.

Cloudflare Pages: connect the repo, no build command, output directory `/`.

WebXR needs HTTPS. The two hosts supply it.

## Options hub

The options are at the right of the map screen. In VR, point at a line with a controller and pull the trigger.
On the Mac, use the keys `1` to `7`. The browser keeps your options.

| Line | Option | Function |
|---|---|---|
| 1 | AIRCRAFT | Cessna, delta wing, helicopter |
| 2 | ASSIST | ON: a flight computer holds the aircraft level. Stick in the center = level flight. |
| 3 | LEVEL VIEW | ON: your view stays level with the horizon. The aircraft tilts around you. This helps against motion sickness. |
| 4 | OPEN VIEW | ON: no aircraft body, the instruments are on a board above your forward view |
| 5 | HAND STICK | ON: the right controller is the stick. Hold the grip and tilt the controller. |
| 6 | NEXT START | The next start position |
| 7 | START AGAIN | The same start position again |
| 8 | COPILOT | Shows the code of this device and the state of the copilot link. It has no function. |

### Assist

- Airplanes: stick left and right sets the bank angle (35 degrees at full stick). Stick forward and back sets the descent or climb angle.
  The assist trims, removes the slip, holds the runway direction in the takeoff roll and keeps the wing below the stall angle.
  On the ground the pitch is direct: pull to lift off.
- Helicopter: the stick sets the tilt angle. With the stick in the center the helicopter slows to a hover.
  The lever sets the climb rate: 50% holds the height, more goes up, less goes down. Below 45% on the ground it stands.
- ASSIST OFF gives you the direct controls and the real behavior.

### Controls that you can see

- Helicopter: the cyclic (the stick between your knees) tilts with your stick input. The collective (the lever at your left) goes up with the lever input.
- Delta wing: the control bar moves as in a real trike (weight shift): to pull the nose up the bar goes forward, to turn right the bar goes left.
- Cessna: the yoke. In the open view there is no body, thus no stick: the YOKE indicator on the board shows your input.

### Hand stick

Hold the right grip: the position of your hand at that moment is the center.
Tilt the controller forward and back for pitch, left and right for roll. 25 degrees is the full input.
Release the grip and the stick is in the center again. `HAND_FULL` and `HAND_HOLD` are at the top of `main.js`.

## Copilot

A second device can show the flight and change the options. Example: you fly on the Quest, a friend looks on the MacBook.

1. On the Quest, read the code of 6 digits: line 8 of the options hub, or the panel on the page before you go into VR.
   The device keeps its code, thus it is the same each time.
2. On the Mac, open the same page. Type the code in the panel at the top right and press BE COPILOT.
   The Mac keeps the last code. You can also open the page with `?join=123456` at the end of the address.
3. The Mac shows the same island and the aircraft of the pilot, and it looks where the pilot looks. `C` gives the outside view.
4. The buttons of the panel (or the keys `1` to `7`) change the options on the pilot device.
5. STOP COPILOT makes the Mac a usual pilot device again.

How it works: a public server (PeerJS cloud) helps the two devices to find each other. After that the data goes
directly between the devices with WebRTC. On the same WiFi it stays in your network. Bluetooth is not possible between two browsers.
The pilot sends its state 20 times each second. The copilot has no flight model of its own.

To use your own server and not the public one, run PeerServer (`npm install peer`) and open the page with `?peer=host:port` on the two devices.

Limits: there is no list of pilots, you must know the code. A person who knows the code can change the options, but cannot fly.

## Controls

| | Quest | Mac |
|---|---|---|
| Stick: pitch and roll | right stick, or the hand stick | pointer, no press |
| Throttle (helicopter: lever) | left stick up, down | `W` `S` |
| Rudder, nose wheel, helicopter pedals | left stick left, right | `A` `D` |
| Brakes | trigger (when you do not point at the hub) | `SPACE` |
| Flaps down, up (Cessna) | `X`, `Y` | `F`, `R` |
| Trim nose down, up (ASSIST OFF) | `A`, `B` | arrow up, arrow down |
| Next start position | hub, or hold the left stick button | `6` or `N` |
| Start again | hub, or hold the right stick button | `7` or `ENTER` |
| Look left, right | your head | `Q` `E` |
| Outside view | - | `C` |
| Pause | - | `P` |

A gamepad on the Mac uses the same layout as the Quest controllers.

## Aircraft

| | Cessna | Delta wing | Helicopter |
|---|---|---|---|
| Lift-off | approximately 60 kt | approximately 43 kt | lever above 60% (assist: above 50%) |
| Cruise | 95 kt | 45 kt | 70 kt |
| Top speed | 118 kt | 55 kt | 90 kt |
| Stall | 51 kt | 32 kt | none |
| Hard landing limit | 890 ft/min | 890 ft/min | 690 ft/min |

## Start positions

Each airport has two: on the runway, and in the air 2.5 km before the runway.

| Airport | Height | Runway | Note |
|---|---|---|---|
| VALLE | 130 ft | 09, 1200 m | Flat land. Start here. |
| COSTA | 16 ft | 34, 800 m | On the west coast. |
| SIERRA | 2590 ft | 08 to land, 26 to take off, 650 m | On a mountain shelf. One direction only. |

PAPI lights at the left of each runway: 2 white + 2 red = correct path, more red = too low.

## Numbers that you can change

- `flight.js`, objects `CESSNA`, `DELTA`, `HELI`: all flight numbers and the assist limits. `propYaw` is the left-turn tendency (0.015 = light, 0.15 = real).
- `main.js`, top: `STICK_CURVE`, `THROTTLE_RATE`, `TRIM_RATE`, `INVERT_PITCH`, `AUTO_RUDDER`, `HAND_FULL`, `HAND_HOLD`.
- `cockpit.js`, top: `OPEN_ANGLE`, `OPEN_DIST` (position of the board in the open view).
- `link.js`, top: `LINK_RATE`, `LINK_PREFIX`.
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
