// main.js - setup, options, pilot input, sound, text display, the frame loop.
// Classic script. It uses THREE, world.js, flight.js, cockpit.js, link.js.
//
// Order of this file:
//   constants, setup, options, panel, start positions, keyboard and pointer, hand stick,
//   hub pointer, pilot input, sound, text display, camera, frame loop.

// ---------- constants ----------

var THROTTLE_RATE = 0.5;     // throttle change in one second with the key or the stick
var TRIM_RATE = 0.2;         // trim change in one second
var STICK_CURVE = 1.6;       // more than 1 = the stick is less sensitive near the center
var INVERT_PITCH = 1;        // 1 = pull (stick or pointer down) moves the nose up. -1 = opposite.
var AUTO_RUDDER = 0;         // 1 = the rudder moves with the ailerons (only without the assist)
var HOLD_TIME = 0.8;         // seconds to hold a thumbstick button for a restart
var HAND_FULL = 0.44;        // hand stick: tilt of the controller for the full input, rad (25 degrees)
var HAND_HOLD = 1;           // hand stick: 1 = hold the grip to fly. 0 = press the grip one time, press again to release.

// ---------- setup ----------

var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');    // the origin is the head at the start, seated or standing
document.body.appendChild(renderer.domElement);

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.25, 30000);

makeHeights();
makeWorld(scene);
makeAirplane(scene);
parts.rig.add(camera);

// a black ball around the head. It hides the view after a crash and at a restart.
var blind = new THREE.Mesh(
	new THREE.SphereGeometry(1, 16, 12),
	new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false })
);
blind.renderOrder = 1000;
camera.add(blind);

var hud = document.getElementById('hud');
var note = document.getElementById('note');
var enterButton = document.getElementById('enter');

var game = {
	paused: 0,
	chase: 0,            // 1 = desktop camera behind the aircraft
	fade: 1,             // 1 = black, 0 = clear
	crashTime: 0,        // seconds from the crash
	acc: 0,              // time that the physics must do
	message: '',
	warn: 0,
	hudTime: 0,
	lookYaw: 0,
	holdLeft: 0,
	holdRight: 0,
	hubHover: -1,        // line of the options hub below the pointer
	hubDirty: 1          // 1 = draw the hub again
};

window.addEventListener('resize', function () {
	if (renderer.xr.isPresenting) return;
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

// VR button
if (navigator.xr && navigator.xr.isSessionSupported) {
	navigator.xr.isSessionSupported('immersive-vr').then(function (ok) {
		if (ok) enterButton.style.display = 'block';
	});
}
enterButton.addEventListener('click', function () {
	startSound();
	if (renderer.xr.isPresenting) {
		renderer.xr.getSession().end();
		return;
	}
	navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] }).then(function (session) {
		setChase(0);
		renderer.xr.setSession(session);
	});
});
renderer.xr.addEventListener('sessionstart', function () {
	enterButton.textContent = 'EXIT VR';
});
renderer.xr.addEventListener('sessionend', function () {
	enterButton.textContent = 'ENTER VR';
	camera.position.set(0, 0, 0);
	camera.rotation.set(0, 0, 0);
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	ray.line.visible = false;
	ray.dot.visible = false;
});

// ---------- options ----------

// The options are on the hub of the instrument board. The browser keeps them for the next visit.
var opt = {
	aircraft: 0,     // index in AIRCRAFT
	assist: 1,       // 1 = the flight computer holds the aircraft level
	level: 1,        // 1 = your view stays level with the horizon. The aircraft tilts around you.
	open: 0,         // 1 = open view: no aircraft body, instruments at the top
	hand: 0          // 1 = the right controller is the stick: hold the grip and tilt the controller
};

function loadOptions() {
	var saved, key;
	try {
		saved = JSON.parse(localStorage.getItem('cessna.options') || '{}');
		for (key in opt) {
			if (typeof saved[key] === 'number') opt[key] = saved[key];
		}
	} catch (e) {
		// no storage: the options are for this visit only
	}
	opt.aircraft = clamp(Math.round(opt.aircraft), 0, AIRCRAFT.length - 1);
}

function saveOptions() {
	try {
		localStorage.setItem('cessna.options', JSON.stringify(opt));
	} catch (e) {
		// no storage
	}
}

// put the options into the flight model and the models
function applyOptions() {
	setAircraft(opt.aircraft);
	plane.assist = opt.assist;
	setBody(opt.aircraft);
	setOpenView(opt.open, game.chase);
	game.hubDirty = 1;
}

// the lines of the hub: label and value
function hubLines() {
	return [
		['AIRCRAFT', AC.name],
		['ASSIST', opt.assist ? 'ON' : 'OFF'],
		['LEVEL VIEW', opt.level ? 'ON' : 'OFF'],
		['OPEN VIEW', opt.open ? 'ON' : 'OFF'],
		['HAND STICK', opt.hand ? 'ON: GRIP' : 'OFF'],
		['NEXT START', '>'],
		['START AGAIN', '>'],
		link.role === 'copilot' ? ['COPILOT OF ' + link.joined, link.status] : ['COPILOT ' + link.code, link.status]
	];
}

// you selected line 'row' of the hub
function hubAction(row) {
	if (row > 6) return;                 // the last line shows the copilot code, it has no function
	if (link.role === 'copilot') {
		linkSelect(row);                 // the pilot device makes the change, then its state comes back
		return;
	}
	if (row === 0) {
		opt.aircraft = (opt.aircraft + 1) % AIRCRAFT.length;
		applyOptions();
		restart(plane.start);
	}
	if (row === 1) {
		opt.assist = 1 - opt.assist;
		plane.assist = opt.assist;
	}
	if (row === 2) opt.level = 1 - opt.level;
	if (row === 3) {
		opt.open = 1 - opt.open;
		setOpenView(opt.open, game.chase);
	}
	if (row === 4) {
		opt.hand = 1 - opt.hand;
		hand.held = 0;
	}
	if (row === 5) nextStart();
	if (row === 6) restart(plane.start);
	game.hubDirty = 1;
	saveOptions();
}

// copilot: use the aircraft and the options of the pilot. They are not kept in the browser.
function linkOptionsFrom(o, aircraft) {
	if (opt.aircraft === aircraft && opt.assist === o[1] && opt.level === o[2] && opt.open === o[3] && opt.hand === o[4]) return;
	opt.aircraft = aircraft;
	opt.assist = o[1];
	opt.level = o[2];
	opt.open = o[3];
	opt.hand = o[4];
	applyOptions();
}

// this device stops as copilot: your own options again, and a new start
function linkSolo() {
	opt.aircraft = 0;
	opt.assist = 1;
	opt.level = 1;
	opt.open = 0;
	opt.hand = 0;
	loadOptions();
	applyOptions();
	game.paused = 0;
	ctl.pitch = 0;
	ctl.roll = 0;
	ctl.yaw = 0;
	ctl.brake = 0;
	restart(0);
}

// ---------- panel ----------

// The panel is on the page, at the top right (not in VR). It has the same lines as the options hub,
// and the controls to become the copilot of a different device.
var panelRows = document.getElementById('rows');
var panelCode = document.getElementById('mycode');
var panelInput = document.getElementById('code');
var panelJoin = document.getElementById('join');
var panelState = document.getElementById('linkstate');
var panelButtons = [];

function makePanel() {
	var k, b;
	for (k = 0; k < 7; k++) {
		b = document.createElement('button');
		b.addEventListener('click', hubAction.bind(null, k));
		panelRows.appendChild(b);
		panelButtons.push(b);
	}
	try {
		panelInput.value = linkParam('join') || localStorage.getItem('cessna.join') || '';
	} catch (e) {
		panelInput.value = '';
	}
	panelJoin.addEventListener('click', function () {
		startSound();
		if (link.role === 'copilot') linkLeave('');
		else linkJoin(panelInput.value.replace(/\D/g, ''));
	});
}

function drawPanel() {
	var lines = hubLines();
	var k;
	for (k = 0; k < panelButtons.length; k++) {
		panelButtons[k].textContent = (k + 1) + '  ' + lines[k][0] + ': ' + lines[k][1];
	}
	panelCode.textContent = 'Code of this device: ' + link.code + (link.role === 'pilot' ? '   ' + link.status : '');
	panelJoin.textContent = link.role === 'copilot' ? 'STOP COPILOT' : 'BE COPILOT';
	panelInput.disabled = link.role === 'copilot';
	panelState.textContent = link.role === 'copilot' ? 'Copilot of ' + link.joined + ': ' + link.status
		: (link.status.length > 6 ? link.status : '');
}

makePanel();

// ---------- start positions ----------

function restart(index) {
	resetPlane(index);
	game.fade = 1;
	game.crashTime = 0;
	game.acc = 0;
	vsiShown = 0;
}

function nextStart() {
	restart((plane.start + 1) % STARTS.length);
}

loadOptions();
applyOptions();
restart(0);

// ---------- keyboard and pointer ----------

var keys = {};
var pointer = { x: 0, y: 0, used: 0 };
var padUsed = 0;         // 1 = a gamepad gave an input, thus the pointer is not the yoke

window.addEventListener('keydown', function (e) {
	var digit;
	var fly = link.role !== 'copilot';      // a copilot does not fly
	startSound();
	if (e.target === panelInput) {
		if (e.code === 'Enter') panelJoin.click();
		return;                              // you type the code: these are not flight keys
	}
	if (e.repeat) return;
	keys[e.code] = 1;
	if (fly && e.code === 'KeyF') plane.flapSet = Math.min(3, plane.flapSet + 1);
	if (fly && e.code === 'KeyR') plane.flapSet = Math.max(0, plane.flapSet - 1);
	if (e.code === 'KeyC') setChase(1 - game.chase);
	if (fly && e.code === 'KeyP') game.paused = 1 - game.paused;
	if (e.code === 'Enter') hubAction(6);
	if (e.code === 'KeyN') hubAction(5);
	if (e.code === 'KeyV') hubAction(3);
	// keys 1 to 7 = the lines of the options hub
	if (e.code.indexOf('Digit') === 0) {
		digit = parseInt(e.code.slice(5), 10);
		if (digit >= 1 && digit <= HUB_ROWS) hubAction(digit - 1);
	}
	if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
});
window.addEventListener('keyup', function (e) {
	keys[e.code] = 0;
});
window.addEventListener('pointermove', function (e) {
	pointer.x = clamp((e.clientX - window.innerWidth / 2) / (window.innerWidth * 0.4), -1, 1);
	pointer.y = clamp((e.clientY - window.innerHeight / 2) / (window.innerHeight * 0.4), -1, 1);
	pointer.used = 1;
});
window.addEventListener('pointerdown', startSound);

// ---------- hand stick ----------

// The right controller is the stick, as in an ultralight or a helicopter.
// Hold the grip: the position of your hand at that moment is the center.
// Then tilt the controller: forward and back = pitch, left and right = roll.
// Release the grip: the stick goes back to the center.
var hand = { held: 0, pitch: 0, roll: 0, neutral: new THREE.Quaternion(), now: new THREE.Quaternion() };
var _hq = new THREE.Quaternion();

// the tilt of the hand from the center position. q and neutral are in the axes of the head rig.
// The result is in hand.pitch (+ = pull) and hand.roll (+ = right), where 1 = HAND_FULL.
function handTilt(q, neutral) {
	var half, s, k;
	_hq.copy(neutral).invert().premultiply(q);        // the turn from neutral to q
	if (_hq.w < 0) _hq.set(-_hq.x, -_hq.y, -_hq.z, -_hq.w);
	half = Math.acos(clamp(_hq.w, -1, 1));
	s = Math.sin(half);
	k = s > 0.0001 ? 2 * half / s : 2;
	hand.pitch = _hq.x * k / HAND_FULL;    // turn about the right axis: the top of the controller moves to you
	hand.roll = -_hq.z * k / HAND_FULL;    // turn about the back axis: the top of the controller moves right
}

// ---------- hub pointer ----------

// In VR you point at a line of the options hub with a controller and pull the trigger.
var ray = {
	caster: new THREE.Raycaster(),
	origin: new THREE.Vector3(),
	dir: new THREE.Vector3(),
	quat: new THREE.Quaternion(),
	line: null,
	dot: null
};
ray.line = new THREE.Line(
	new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
	new THREE.LineBasicMaterial({ color: 0xffffff, fog: false })
);
ray.line.frustumCulled = false;
ray.line.visible = false;
scene.add(ray.line);
ray.dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff9a2e, fog: false }));
ray.dot.visible = false;
scene.add(ray.dot);

// which line of the hub does a ray hit? origin and dir are in world axes. The result is the line, or -1.
function hubPoint(origin, dir) {
	var hits;
	ray.caster.set(origin, dir);
	ray.caster.far = 3;
	hits = ray.caster.intersectObject(parts.hub, false);
	if (hits.length === 0 || !hits[0].uv) return -1;
	ray.dot.position.copy(hits[0].point).addScaledVector(dir, -0.004);
	return clamp(Math.floor((1 - hits[0].uv.y) * HUB_ROWS), 0, HUB_ROWS - 1);
}

// ---------- pilot input ----------

// dead zone and curve for a stick axis
function stick(v, dead) {
	var a = Math.abs(v);
	if (a < dead) return 0;
	a = Math.min(1, (a - dead) / (1 - dead));
	return (v < 0 ? -1 : 1) * Math.pow(a, STICK_CURVE);
}

function pressed(gp, i) {
	return gp.buttons[i] && gp.buttons[i].pressed ? 1 : 0;
}

function value(gp, i) {
	return gp.buttons[i] ? gp.buttons[i].value : 0;
}

var prev = {};           // button states of the last frame, to find a new press

function newPress(name, down) {
	var was = prev[name] || 0;
	prev[name] = down;
	return down && !was;
}

// xrFrame: the WebXR frame, or null on the desktop
function readInput(dt, xrFrame) {
	var pitch = 0, roll = 0, yaw = 0, brake = 0, thr = 0, trim = 0;
	var holdL = 0, holdR = 0, hover = -1;
	var session = renderer.xr.getSession();
	var space = session ? renderer.xr.getReferenceSpace() : null;
	var k, src, gp, pads, x, y, pose, o, row, trigger, grip;

	// keyboard
	if (keys.KeyW) thr += 1;
	if (keys.KeyS) thr -= 1;
	if (keys.KeyA) yaw -= 1;
	if (keys.KeyD) yaw += 1;
	if (keys.Space) brake = 1;
	if (keys.ArrowDown) trim += 1;
	if (keys.ArrowUp) trim -= 1;
	game.lookYaw = approach(game.lookYaw, (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0), 4 * dt);

	// a gamepad on the desktop. Standard layout: left stick = axes 0, 1. Right stick = axes 2, 3.
	if (!session && navigator.getGamepads) {
		pads = navigator.getGamepads();
		for (k = 0; k < pads.length; k++) {
			gp = pads[k];
			if (!gp || gp.axes.length < 4) continue;
			x = stick(gp.axes[2], 0.1);
			y = stick(gp.axes[3], 0.1);
			if (x !== 0 || y !== 0 || Math.abs(gp.axes[0]) > 0.3 || Math.abs(gp.axes[1]) > 0.3) padUsed = 1;
			roll += x;
			pitch += y;
			yaw += stick(gp.axes[0], 0.15);
			thr -= stick(gp.axes[1], 0.3);
			brake = Math.max(brake, value(gp, 6), value(gp, 7));
			if (pressed(gp, 0)) trim -= 1;
			if (pressed(gp, 1)) trim += 1;
			if (newPress('padX', pressed(gp, 2))) plane.flapSet = Math.min(3, plane.flapSet + 1);
			if (newPress('padY', pressed(gp, 3))) plane.flapSet = Math.max(0, plane.flapSet - 1);
			holdL = Math.max(holdL, pressed(gp, 10));
			holdR = Math.max(holdR, pressed(gp, 11));
		}
	}

	// the pointer is the yoke: no press is necessary. Center of the window = neutral.
	if (!session && pointer.used && !padUsed) {
		roll += stick(pointer.x, 0.04);
		pitch += stick(pointer.y, 0.04);
	}

	// VR controllers. axes 2, 3 = thumbstick. buttons: 0 trigger, 1 grip, 3 stick, 4 A or X, 5 B or Y.
	if (session) {
		for (k = 0; k < session.inputSources.length; k++) {
			src = session.inputSources[k];
			gp = src.gamepad;
			if (!gp || gp.axes.length < 4) continue;
			trigger = value(gp, 0);
			grip = pressed(gp, 1);

			// does this controller point at the options hub?
			row = -1;
			pose = (xrFrame && space && src.targetRaySpace) ? xrFrame.getPose(src.targetRaySpace, space) : null;
			if (pose && !(src.handedness === 'right' && hand.held)) {
				o = pose.transform.orientation;
				ray.quat.set(o.x, o.y, o.z, o.w);
				o = pose.transform.position;
				ray.origin.set(o.x, o.y, o.z).applyMatrix4(parts.rig.matrixWorld);
				ray.dir.set(0, 0, -1).applyQuaternion(ray.quat).transformDirection(parts.rig.matrixWorld);
				row = hubPoint(ray.origin, ray.dir);
				if (row >= 0) {
					hover = row;
					ray.line.geometry.attributes.position.setXYZ(0, ray.origin.x, ray.origin.y, ray.origin.z);
					ray.line.geometry.attributes.position.setXYZ(1, ray.dot.position.x, ray.dot.position.y, ray.dot.position.z);
					ray.line.geometry.attributes.position.needsUpdate = true;
				}
			}
			// on the hub the trigger selects the line. Away from the hub the trigger is the brake.
			if (newPress('trig' + src.handedness, trigger > 0.6 ? 1 : 0) && row >= 0) hubAction(row);
			if (row < 0) brake = Math.max(brake, trigger);

			if (src.handedness === 'right') {
				roll += stick(gp.axes[2], 0.1);
				pitch += stick(gp.axes[3], 0.1);
				if (pressed(gp, 4)) trim -= 1;               // A: nose down
				if (pressed(gp, 5)) trim += 1;               // B: nose up
				holdR = Math.max(holdR, pressed(gp, 3));

				// hand stick
				pose = (opt.hand && xrFrame && space && src.gripSpace) ? xrFrame.getPose(src.gripSpace, space) : null;
				if (pose) {
					o = pose.transform.orientation;
					hand.now.set(o.x, o.y, o.z, o.w);
					if (newPress('grip', grip)) {
						if (HAND_HOLD || !hand.held) {
							hand.held = 1;
							hand.neutral.copy(hand.now);
						} else {
							hand.held = 0;
						}
					}
					if (HAND_HOLD && !grip) hand.held = 0;
					if (hand.held) {
						handTilt(hand.now, hand.neutral);
						pitch += stick(hand.pitch, 0.08);
						roll += stick(hand.roll, 0.08);
					}
				} else {
					hand.held = 0;
				}
			}
			if (src.handedness === 'left') {
				yaw += stick(gp.axes[2], 0.15);
				thr -= stick(gp.axes[3], 0.3);
				if (newPress('vrX', pressed(gp, 4))) plane.flapSet = Math.min(3, plane.flapSet + 1);   // X: flaps down
				if (newPress('vrY', pressed(gp, 5))) plane.flapSet = Math.max(0, plane.flapSet - 1);   // Y: flaps up
				holdL = Math.max(holdL, pressed(gp, 3));
			}
		}
	}
	ray.line.visible = hover >= 0;
	ray.dot.visible = hover >= 0;
	if (hover !== game.hubHover) {
		game.hubHover = hover;
		game.hubDirty = 1;
	}

	if (link.role === 'copilot') return;     // a copilot does not fly: the inputs come from the pilot

	roll = clamp(roll, -1, 1);
	if (AUTO_RUDDER && !opt.assist) yaw += roll * 0.35;
	ctl.pitch = clamp(pitch * INVERT_PITCH, -1, 1);
	ctl.roll = roll;
	ctl.yaw = clamp(yaw, -1, 1);
	ctl.brake = clamp(brake, 0, 1);
	plane.thr = clamp(plane.thr + clamp(thr, -1, 1) * THROTTLE_RATE * dt, 0, 1);
	if (!opt.assist) plane.trim = clamp(plane.trim + trim * TRIM_RATE * dt, -1, 1);    // the assist trims by itself

	// hold the left thumbstick button = next start position. Right = start again.
	game.holdLeft = holdL ? game.holdLeft + dt : 0;
	game.holdRight = holdR ? game.holdRight + dt : 0;
	if (game.holdLeft > HOLD_TIME) {
		game.holdLeft = -100;
		nextStart();
	}
	if (game.holdRight > HOLD_TIME) {
		game.holdRight = -100;
		restart(plane.start);
	}
}

// ---------- sound ----------

var snd = null;

function startSound() {
	if (snd) {
		if (snd.ctx.state === 'suspended') snd.ctx.resume();
		return;
	}
	var Ctx = window.AudioContext || window.webkitAudioContext;
	if (!Ctx) return;
	var ctx = new Ctx();
	var i, data;
	snd = { ctx: ctx };
	snd.master = ctx.createGain();
	snd.master.gain.value = 0.5;
	snd.master.connect(ctx.destination);

	// engine: two oscillators into a low-pass filter
	snd.engFilter = ctx.createBiquadFilter();
	snd.engFilter.type = 'lowpass';
	snd.engGain = ctx.createGain();
	snd.engGain.gain.value = 0;
	snd.eng1 = ctx.createOscillator();
	snd.eng1.type = 'sawtooth';
	snd.eng2 = ctx.createOscillator();
	snd.eng2.type = 'square';
	snd.eng1.connect(snd.engFilter);
	snd.eng2.connect(snd.engFilter);
	snd.engFilter.connect(snd.engGain);
	snd.engGain.connect(snd.master);
	snd.eng1.start();
	snd.eng2.start();

	// wind, tires and rotor: noise
	var buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
	data = buf.getChannelData(0);
	for (i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	snd.noise = ctx.createBufferSource();
	snd.noise.buffer = buf;
	snd.noise.loop = true;
	snd.windFilter = ctx.createBiquadFilter();
	snd.windFilter.type = 'lowpass';
	snd.windFilter.frequency.value = 700;
	snd.windGain = ctx.createGain();
	snd.windGain.gain.value = 0;
	snd.noise.connect(snd.windFilter);
	snd.windFilter.connect(snd.windGain);
	snd.windGain.connect(snd.master);
	snd.tireFilter = ctx.createBiquadFilter();
	snd.tireFilter.type = 'bandpass';
	snd.tireFilter.frequency.value = 1400;
	snd.tireGain = ctx.createGain();
	snd.tireGain.gain.value = 0;
	snd.noise.connect(snd.tireFilter);
	snd.tireFilter.connect(snd.tireGain);
	snd.tireGain.connect(snd.master);

	// rotor: low noise that pulses 13 times each second (the blades)
	snd.rotorFilter = ctx.createBiquadFilter();
	snd.rotorFilter.type = 'lowpass';
	snd.rotorFilter.frequency.value = 260;
	snd.rotorPulse = ctx.createGain();
	snd.rotorPulse.gain.value = 0.5;
	snd.rotorLfo = ctx.createOscillator();
	snd.rotorLfo.frequency.value = 13;
	snd.rotorDepth = ctx.createGain();
	snd.rotorDepth.gain.value = 0.5;
	snd.rotorLfo.connect(snd.rotorDepth);
	snd.rotorDepth.connect(snd.rotorPulse.gain);
	snd.rotorGain = ctx.createGain();
	snd.rotorGain.gain.value = 0;
	snd.noise.connect(snd.rotorFilter);
	snd.rotorFilter.connect(snd.rotorPulse);
	snd.rotorPulse.connect(snd.rotorGain);
	snd.rotorGain.connect(snd.master);
	snd.rotorLfo.start();
	snd.noise.start();

	// stall warning
	snd.horn = ctx.createOscillator();
	snd.horn.type = 'triangle';
	snd.horn.frequency.value = 1750;
	snd.hornGain = ctx.createGain();
	snd.hornGain.gain.value = 0;
	snd.horn.connect(snd.hornGain);
	snd.hornGain.connect(snd.master);
	snd.horn.start();
	snd.lastTouch = -99;
}

function updateSound() {
	if (!snd) return;
	var p = plane;
	var t = snd.ctx.currentTime;
	var quiet = (p.crashed !== '' || game.paused) ? 0 : 1;
	var f = p.rpm / 60 * 2;      // 4 cylinders: 2 pulses for each turn
	snd.eng1.frequency.setTargetAtTime(f, t, 0.05);
	snd.eng2.frequency.setTargetAtTime(f / 2, t, 0.05);
	snd.engFilter.frequency.setTargetAtTime(260 + p.power * 700, t, 0.05);
	snd.engGain.gain.setTargetAtTime(quiet * (AC.heli ? 0.1 : 0.1 + 0.22 * p.power), t, 0.05);
	snd.rotorGain.gain.setTargetAtTime(quiet * (AC.heli ? 0.6 + 0.5 * p.power : 0), t, 0.1);
	snd.windGain.gain.setTargetAtTime(quiet * clamp(p.ias * p.ias / 3600, 0, 1.4) * 0.3, t, 0.1);
	snd.hornGain.gain.setTargetAtTime(quiet * p.stall * 0.07, t, 0.02);
	if (p.touchTime !== snd.lastTouch) {
		snd.lastTouch = p.touchTime;
		if (p.touchTime > 0) {
			snd.tireGain.gain.cancelScheduledValues(t);
			snd.tireGain.gain.setValueAtTime(clamp(0.15 + p.touchdown * 0.15, 0, 0.7), t);
			snd.tireGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
		}
	}
}

// ---------- text display ----------

function pad3(n) {
	return ('00' + n).slice(-3);
}

// the message for the map screen and for the desktop text
function updateMessage() {
	var p = plane;
	var edge = Math.max(Math.abs(p.pos.x), Math.abs(p.pos.z));
	game.message = '';
	game.warn = 0;
	if (p.crashed !== '') {
		game.message = p.crashed;
		game.warn = 1;
	} else if (game.paused) {
		game.message = 'PAUSE';
	} else if (p.stall) {
		game.message = 'STALL';
		game.warn = 1;
	} else if (edge > 21000) {
		game.message = 'TURN BACK';
		game.warn = 1;
	} else if (p.time - p.touchTime < 6) {
		game.message = 'LANDING ' + Math.round(p.touchdown * 196.85) + ' FT/MIN';
	}
	if (edge > 27000) restart(p.start);
}

function updateHud(dt) {
	game.hudTime += dt;
	if (game.hudTime < 0.1) return;
	game.hudTime = 0;
	var p = plane;
	var st = STARTS[p.start];
	var hdg = Math.round(att.hdg * 180 / Math.PI) % 360;
	var vs = Math.round(p.vel.y * 196.85 / 10) * 10;
	hud.textContent =
		'IAS ' + pad3(Math.round(p.ias * KT)) + ' kt   ALT ' + Math.round(p.pos.y * FT / 10) * 10 + ' ft   VS ' + (vs >= 0 ? '+' : '') + vs +
		'   HDG ' + pad3(hdg === 0 ? 360 : hdg) + (AC.heli ? '   LEVER ' : '   PWR ') + Math.round(p.thr * 100) + '%   RPM ' + Math.round(p.rpm / 10) * 10 +
		'   FLAPS ' + Math.round(p.flaps * 10) + '   TRIM ' + (p.trim >= 0 ? '+' : '') + Math.round(p.trim * 10) +
		(ctl.brake > 0 ? '   BRAKE' : '');
	note.textContent = AC.name + (opt.assist ? ' + ASSIST' : '') + '   ' +
		(game.message !== '' ? game.message : AIRPORTS[st.ap].name + (st.kind ? ' approach' : ' runway'));
	note.style.color = game.warn ? '#ff8a7a' : '#e8ede8';
}

// ---------- camera ----------

var _look = new THREE.Vector3();
var _back = new THREE.Vector3();
var _yawQ = new THREE.Quaternion();
var _up = new THREE.Vector3(0, 1, 0);

function setChase(on) {
	if (renderer.xr.isPresenting) on = 0;
	game.chase = on;
	setOpenView(opt.open, on);
	if (on) {
		scene.add(camera);
		_back.set(0, 0, 1).applyQuaternion(plane.quat);
		camera.position.copy(plane.pos).addScaledVector(_back, 16);
		camera.position.y += 4;
	} else {
		parts.rig.add(camera);
		camera.position.set(0, 0, 0);
		camera.rotation.set(0, 0, 0);
	}
}

function updateCamera(dt) {
	// Level view: your head position turns with the direction of the nose only.
	// It does not roll and it does not pitch, thus the horizon stays level. The aircraft tilts around you.
	if (opt.level) {
		_yawQ.setFromAxisAngle(_up, -att.hdg);
		parts.rig.quaternion.copy(plane.quat).invert().multiply(_yawQ);
	} else {
		parts.rig.quaternion.set(0, 0, 0, 1);
	}
	if (renderer.xr.isPresenting) return;
	if (game.chase) {
		// behind the aircraft, level with the horizon
		_back.set(0, 0, 1).applyQuaternion(plane.quat);
		_back.y = 0;
		_back.normalize();
		_look.copy(plane.pos).addScaledVector(_back, 16);
		_look.y += 4.5;
		camera.position.lerp(_look, Math.min(1, 5 * dt));
		camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z) + 1);
		camera.lookAt(plane.pos);
	} else if (link.role === 'copilot') {
		camera.quaternion.slerp(link.head, Math.min(1, 6 * dt));    // you look where the pilot looks
	} else {
		camera.rotation.set(opt.open ? 0.02 : -0.12, game.lookYaw * 1.5, 0, 'YXZ');
	}
}

// ---------- frame loop ----------

var lastTime = 0;

function frame(time, xrFrame) {
	var dt = clamp((time - lastTime) / 1000, 0.001, 0.05);
	var steps = 0;
	lastTime = time;

	readInput(dt, xrFrame || null);

	if (link.role === 'copilot') {
		linkCoast(dt);                       // no physics here: the state comes from the pilot
	} else if (!game.paused && plane.crashed === '') {
		game.acc += dt;
		while (game.acc >= DT && steps < 16) {
			stepPlane(DT);
			game.acc -= DT;
			steps++;
		}
	}
	linkUpdate(dt);

	// after a crash: dark view, then the same start position again
	if (plane.crashed !== '') {
		game.crashTime += dt;
		game.fade = approach(game.fade, 1, dt / 0.8);
		if (game.crashTime > 2.2 && link.role !== 'copilot') restart(plane.start);
	} else {
		game.fade = approach(game.fade, 0, dt / 0.7);
	}
	blind.material.opacity = game.fade;
	blind.visible = game.fade > 0.001;

	updateAttitude();
	updateMessage();
	updateAirplane(dt, game.message, game.warn);
	if (game.hubDirty) {
		game.hubDirty = 0;
		drawHub(hubLines(), game.hubHover);
		drawPanel();
	}
	updateWorld(dt, plane.pos.x, plane.pos.y, plane.pos.z);
	updateCamera(dt);
	updateSound();
	updateHud(dt);
	renderer.render(scene, camera);
}

linkStart();
renderer.setAnimationLoop(frame);
