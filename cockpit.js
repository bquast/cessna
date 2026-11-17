// cockpit.js - the three aircraft models, the instrument panel, the options hub, the shadow.
// Classic script. It uses THREE, world.js and flight.js.
//
// main.js calls makeAirplane() one time and updateAirplane() each frame.
// The model is in body axes: +x = right, +y = up, -z = forward. The origin is the center of gravity.
//
// Order of this file:
//   constants, shape helpers, aircraft bodies, dial helpers, instruments, options hub, open view,
//   map screen, shadow, update.

// ---------- constants ----------

var EYE = new THREE.Vector3(-0.27, 0.45, 0.25);   // the eye of the pilot, in body axes
var PANEL_Z = -0.57;     // the face of the instrument panel
var MAP_RANGE = 14000;   // meters across the map screen
var OPEN_ANGLE = 24;     // open view: the instrument board is this many degrees above the horizon
var OPEN_DIST = 0.8;     // open view: distance from the eye to the board, m
var BOARD_W = 0.94, BOARD_H = 0.25;                  // size of the board
var BOARD_X = EYE.x + 0.296, BOARD_Y = 0.083;        // center of the instruments on the panel
var HUB_ROWS = 8;        // lines of the options hub

var parts = { open: 0, outside: 0 };   // the parts that move
var MAT = null;          // the materials of the aircraft bodies
var mapScreen = { canvas: null, g: null, texture: null, time: 0 };
var hub = { canvas: null, g: null, texture: null };

// ---------- shape helpers ----------

function lambert(color) {
	return new THREE.MeshLambertMaterial({ color: color });
}

function box(parent, mat, w, h, d, x, y, z) {
	var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.position.set(x, y, z);
	parent.add(m);
	return m;
}

// a round bar from point 1 to point 2
function rod(parent, mat, radius, x1, y1, z1, x2, y2, z2) {
	var a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
	var len = a.distanceTo(b);
	var m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
	m.position.copy(a).add(b).multiplyScalar(0.5);
	m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
	parent.add(m);
	return m;
}

// a box that changes size from the front (z1) to the back (z2).
// w = width, b = bottom y, t = top y.
function hull(parent, mat, z1, w1, b1, t1, z2, w2, b2, t2) {
	var f = [[-w1 / 2, b1, z1], [w1 / 2, b1, z1], [w1 / 2, t1, z1], [-w1 / 2, t1, z1]];
	var k = [[-w2 / 2, b2, z2], [w2 / 2, b2, z2], [w2 / 2, t2, z2], [-w2 / 2, t2, z2]];
	var pos = [];
	function quad(a, b, c, d) {
		pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
		pos.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
	}
	quad(f[1], f[0], f[3], f[2]);   // front
	quad(k[0], k[1], k[2], k[3]);   // back
	quad(f[0], k[0], k[3], f[3]);   // left
	quad(k[1], f[1], f[2], k[2]);   // right
	quad(f[3], k[3], k[2], f[2]);   // top
	quad(f[1], k[1], k[0], f[0]);   // bottom
	var geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
	geo.computeVertexNormals();
	var m = new THREE.Mesh(geo, mat);
	parent.add(m);
	return m;
}

// a control surface that turns about a hinge along x. The hinge is at (x, y, z).
function surface(parent, mat, w, chord, x, y, z) {
	var pivot = new THREE.Group();
	pivot.position.set(x, y, z);
	box(pivot, mat, w, 0.05, chord, 0, 0, chord / 2);
	parent.add(pivot);
	return pivot;
}

// ---------- airplane ----------

function makeAirplane(scene) {
	var root = new THREE.Group();
	var k;
	parts.root = root;
	MAT = {
		white: lambert(0xe6e3da), accent: lambert(0x3d5f7c), dark: lambert(0x2b2d31), seat: lambert(0x4b4138),
		metal: lambert(0x8d9093), tire: lambert(0x18181a), sail: lambert(0xc9793a),
		disc: new THREE.MeshBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false })
	};
	MAT.white.side = THREE.DoubleSide;
	MAT.accent.side = THREE.DoubleSide;
	MAT.sail.side = THREE.DoubleSide;

	// one body for each aircraft. Only the body of the aircraft that you fly is in view.
	parts.bodies = [makeCessna(), makeDelta(), makeHeli()];
	for (k = 0; k < parts.bodies.length; k++) {
		parts.bodies[k].visible = false;
		root.add(parts.bodies[k]);
	}
	parts.body = parts.bodies[0];

	parts.panel = new THREE.Group();
	root.add(parts.panel);
	makeInstruments(parts.panel);

	// the place of the head. main.js puts the camera into this group.
	parts.rig = new THREE.Group();
	parts.rig.position.copy(EYE);
	root.add(parts.rig);

	scene.add(root);
	makeShadow(scene);
}

function makeSeats(body, x) {
	box(body, MAT.seat, 0.44, 0.1, 0.46, x, -0.27, 0.3);
	box(body, MAT.seat, 0.44, 0.6, 0.08, x, 0.05, 0.58);
}

function makeWheel(body, x, y, z) {
	var geo = new THREE.CylinderGeometry(0.2, 0.2, 0.13, 12);
	geo.rotateZ(Math.PI / 2);
	var m = new THREE.Mesh(geo, MAT.tire);
	m.position.set(x, y, z);
	body.add(m);
}

// a disc that you can see through: a propeller or a rotor that turns
function makeDisc(body, radius, x, y, z) {
	var m = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), MAT.disc.clone());
	m.position.set(x, y, z);
	body.add(m);
	return m;
}

function makeCessna() {
	var body = new THREE.Group();
	var white = MAT.white, accent = MAT.accent, dark = MAT.dark, metal = MAT.metal;
	var s, g;

	// nose and engine cover
	hull(body, white, -2.3, 0.62, -0.42, 0.0, -0.62, 1.12, -0.55, 0.15);
	hull(body, accent, -2.32, 0.5, -0.3, -0.1, -2.3, 0.62, -0.42, 0.0);
	g = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 10), metal);
	g.rotation.x = -Math.PI / 2;
	g.position.set(0, -0.2, -2.45);
	body.add(g);
	parts.prop = makeDisc(body, 0.95, 0, -0.2, -2.4);
	// two blades. You see them only at low engine speed.
	parts.blades = box(body, new THREE.MeshBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.5, depthWrite: false }),
		0.14, 1.86, 0.02, 0, -0.2, -2.41);

	// cabin: floor, sides, back wall, panel. The windows are open.
	box(body, dark, 1.12, 0.04, 2.0, 0, -0.55, 0.39);
	box(body, white, 0.03, 0.57, 2.0, -0.565, -0.27, 0.39);
	box(body, white, 0.03, 0.57, 2.0, 0.565, -0.27, 0.39);
	box(body, accent, 0.035, 0.1, 2.0, -0.567, -0.2, 0.39);
	box(body, accent, 0.035, 0.1, 2.0, 0.567, -0.2, 0.39);
	box(body, dark, 1.12, 1.42, 0.04, 0, 0.16, 1.4);
	box(body, dark, 1.12, 0.77, 0.05, 0, -0.165, PANEL_Z - 0.025);       // instrument panel
	box(body, dark, 1.14, 0.025, 0.1, 0, 0.225, PANEL_Z);                // cover above the panel
	// thin posts
	rod(body, white, 0.016, -0.56, 0.2, -0.6, -0.54, 0.87, -0.28);
	rod(body, white, 0.016, 0.56, 0.2, -0.6, 0.54, 0.87, -0.28);
	rod(body, white, 0.018, -0.56, 0.0, 0.75, -0.55, 0.87, 0.75);
	rod(body, white, 0.018, 0.56, 0.0, 0.75, 0.55, 0.87, 0.75);
	makeSeats(body, -0.27);
	makeSeats(body, 0.27);

	// wing, struts, flaps, ailerons
	box(body, white, 11.0, 0.16, 1.25, 0, 0.95, 0.325);
	box(body, accent, 0.3, 0.165, 1.26, -5.36, 0.95, 0.325);
	box(body, accent, 0.3, 0.165, 1.26, 5.36, 0.95, 0.325);
	rod(body, white, 0.035, -0.56, -0.45, 0.25, -2.5, 0.88, 0.35);
	rod(body, white, 0.035, 0.56, -0.45, 0.25, 2.5, 0.88, 0.35);
	parts.flapL = surface(body, white, 2.25, 0.3, -1.72, 0.93, 0.95);
	parts.flapR = surface(body, white, 2.25, 0.3, 1.72, 0.93, 0.95);
	parts.ailL = surface(body, white, 2.35, 0.3, -4.04, 0.93, 0.95);
	parts.ailR = surface(body, white, 2.35, 0.3, 4.04, 0.93, 0.95);

	// rear body and tail
	hull(body, white, 1.4, 1.14, -0.57, 0.87, 5.6, 0.12, 0.12, 0.45);
	box(body, white, 3.4, 0.06, 0.75, 0, 0.3, 5.05);
	parts.elevator = surface(body, white, 3.4, 0.4, 0, 0.3, 5.42);
	hull(body, white, 4.2, 0.06, 0.4, 0.5, 5.5, 0.06, 0.4, 1.95);
	hull(body, accent, 4.9, 0.065, 1.45, 1.6, 5.5, 0.065, 1.6, 1.95);
	parts.rudder = new THREE.Group();
	parts.rudder.position.set(0, 0, 5.5);
	box(parts.rudder, white, 0.05, 1.45, 0.42, 0, 1.2, 0.21);
	body.add(parts.rudder);

	// landing gear
	rod(body, white, 0.04, -0.5, -0.5, 0.45, -1.27, -1.0, 0.45);
	rod(body, white, 0.04, 0.5, -0.5, 0.45, 1.27, -1.0, 0.45);
	rod(body, metal, 0.03, 0, -0.45, -1.25, 0, -1.0, -1.25);
	for (s = 0; s < 3; s++) makeWheel(body, CESSNA.wheels[s].x, -1.0, CESSNA.wheels[s].z);

	// yoke: it moves with the elevator and the ailerons
	parts.yoke = new THREE.Group();
	parts.yoke.position.set(EYE.x, -0.09, PANEL_Z + 0.2);
	rod(parts.yoke, metal, 0.012, 0, 0, -0.25, 0, 0, 0);
	box(parts.yoke, dark, 0.26, 0.03, 0.03, 0, 0, 0);
	box(parts.yoke, dark, 0.03, 0.1, 0.03, -0.13, 0.04, 0);
	box(parts.yoke, dark, 0.03, 0.1, 0.03, 0.13, 0.04, 0);
	body.add(parts.yoke);

	// throttle knob: in = full power
	parts.throttle = new THREE.Group();
	parts.throttle.position.set(0.08, -0.13, PANEL_Z);
	rod(parts.throttle, metal, 0.006, 0, 0, -0.1, 0, 0, 0.02);
	g = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 12), lambert(0x101010));
	g.rotation.x = Math.PI / 2;
	g.position.z = 0.03;
	parts.throttle.add(g);
	body.add(parts.throttle);
	return body;
}

// a powered delta wing (a trike). The pilot is in the middle: the sail is above the head,
// the control bar is in front of the chest, the engine and the propeller are behind.
function makeDelta() {
	var body = new THREE.Group();
	var metal = MAT.metal, dark = MAT.dark, white = MAT.white;
	var apex = [0, 1.95, -1.9], left = [-5, 1.55, 1.3], right = [5, 1.55, 1.3], rear = [0, 1.62, 1.0];
	var geo, s;
	body.position.x = EYE.x;        // the eye is 0.27 m left of the origin, thus the body moves with it

	geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(apex.concat(left, rear, apex, rear, right)), 3));
	geo.computeVertexNormals();
	body.add(new THREE.Mesh(geo, MAT.sail));
	rod(body, white, 0.035, apex[0], apex[1], apex[2], left[0], left[1], left[2]);
	rod(body, white, 0.035, apex[0], apex[1], apex[2], right[0], right[1], right[2]);
	rod(body, metal, 0.03, apex[0], apex[1], apex[2], 0, 1.6, 1.9);                // keel
	rod(body, metal, 0.03, 0, -0.35, 0.78, 0, 1.68, 0.45);                         // mast
	// Control frame and bar. They turn about the hang point at the top of the frame.
	// This is weight shift, as in a real trike: to pull the nose up you push the bar forward,
	// and to turn right the bar moves to the left. The bar is low, below your forward view.
	parts.deltaBar = new THREE.Group();
	parts.deltaBar.position.set(0, 1.68, -0.1);
	rod(parts.deltaBar, metal, 0.012, 0, 0, 0, -0.8, -2.28, -0.7);
	rod(parts.deltaBar, metal, 0.012, 0, 0, 0, 0.8, -2.28, -0.7);
	rod(parts.deltaBar, dark, 0.018, -0.8, -2.28, -0.7, 0.8, -2.28, -0.7);
	body.add(parts.deltaBar);
	// Minimal body: thin tubes only, thus you can see down between your feet.
	rod(body, metal, 0.02, 0, -0.78, -1.3, 0, -0.78, 1.0);                         // lower keel to the nose wheel
	rod(body, metal, 0.015, -0.2, -0.62, -0.95, 0.2, -0.62, -0.95);                // foot bar
	rod(body, metal, 0.015, 0, -0.78, -0.95, 0, -0.62, -0.95);
	rod(body, dark, 0.02, -0.2, -0.3, 0.55, 0.2, -0.3, 0.55);                      // seat: two thin tubes behind you
	rod(body, dark, 0.02, -0.2, 0.2, 0.62, 0.2, 0.2, 0.62);
	box(body, dark, 0.4, 0.4, 0.5, 0, 0.1, 1.05);                                  // engine, behind you
	parts.deltaProp = makeDisc(body, 0.8, 0, 0.2, 1.4);
	// wheels
	rod(body, metal, 0.03, -0.85, -0.8, 0.45, 0.85, -0.8, 0.45);
	for (s = 0; s < 3; s++) makeWheel(body, DELTA.wheels[s].x, -0.8, DELTA.wheels[s].z);
	return body;
}

// a light helicopter with skids. The cabin is open: floor, roof, back wall and thin posts.
function makeHeli() {
	var body = new THREE.Group();
	var white = MAT.white, accent = MAT.accent, metal = MAT.metal, dark = MAT.dark;
	var s, g;
	box(body, dark, 1.3, 0.05, 2.2, 0, -0.57, 0.2);                                // floor
	hull(body, white, -1.6, 0.5, -0.57, -0.3, -0.9, 1.3, -0.6, -0.12);             // low nose
	box(body, accent, 0.03, 0.3, 2.2, -0.65, -0.42, 0.2);
	box(body, accent, 0.03, 0.3, 2.2, 0.65, -0.42, 0.2);
	box(body, dark, 1.3, 1.72, 0.05, 0, 0.29, 1.28);                               // back wall
	box(body, white, 1.3, 0.06, 1.7, 0, 1.15, 0.45);                               // roof
	rod(body, white, 0.016, -0.65, -0.27, -0.9, -0.62, 1.12, -0.38);
	rod(body, white, 0.016, 0.65, -0.27, -0.9, 0.62, 1.12, -0.38);
	box(body, dark, 0.3, 0.5, 0.2, BOARD_X, -0.3, PANEL_Z - 0.1);                  // foot of the instrument board
	makeSeats(body, -0.27);
	makeSeats(body, 0.27);
	// Cyclic: the stick between your knees. It tilts in the same direction as your input.
	parts.cyclic = new THREE.Group();
	parts.cyclic.position.set(EYE.x, -0.55, -0.2);
	rod(parts.cyclic, metal, 0.012, 0, 0, 0, 0, 0.55, 0);
	g = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), dark);
	g.position.y = 0.6;
	parts.cyclic.add(g);
	body.add(parts.cyclic);
	// Collective: the lever at the left of your seat. It goes up with the lever input.
	parts.collective = new THREE.Group();
	parts.collective.position.set(EYE.x - 0.28, -0.3, 0.3);
	rod(parts.collective, metal, 0.012, 0, 0, 0, 0, 0, -0.45);
	g = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10), dark);
	g.rotation.x = Math.PI / 2;
	g.position.z = -0.48;
	parts.collective.add(g);
	body.add(parts.collective);
	// rotor
	rod(body, metal, 0.05, 0, 1.15, 0.4, 0, 1.75, 0.4);
	parts.rotor = makeDisc(body, 3.8, 0, 1.75, 0.4);
	parts.rotor.rotation.x = -Math.PI / 2;
	parts.rotorBlades = box(body, new THREE.MeshBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.35, depthWrite: false }),
		7.6, 0.02, 0.22, 0, 1.76, 0.4);
	// tail
	hull(body, white, 1.28, 0.5, 0.1, 0.75, 5.9, 0.12, 0.45, 0.6);
	hull(body, accent, 5.3, 0.05, 0.1, 0.6, 6.0, 0.05, 0.3, 1.35);
	s = makeDisc(body, 0.55, 0.12, 0.72, 5.85);
	s.rotation.y = Math.PI / 2;
	// skids
	for (s = -1; s <= 1; s += 2) {
		rod(body, metal, 0.03, s * 0.95, -1.22, -1.4, s * 0.95, -1.22, 1.5);
		rod(body, metal, 0.025, s * 0.55, -0.57, -0.7, s * 0.95, -1.22, -0.8);
		rod(body, metal, 0.025, s * 0.55, -0.57, 0.9, s * 0.95, -1.22, 1.0);
	}
	return body;
}

// show the body of one aircraft
function setBody(type) {
	var k;
	for (k = 0; k < parts.bodies.length; k++) parts.bodies[k].visible = false;
	parts.body = parts.bodies[type];
	setOpenView(parts.open, parts.outside);
}

// ---------- dial helpers ----------

// a round instrument face. draw(g) paints it on a 256 x 256 canvas.
// Angles are in degrees, clockwise from the top.
function makeDial(parent, x, y, r, draw) {
	var c = document.createElement('canvas');
	c.width = 256;
	c.height = 256;
	var g = c.getContext('2d');
	g.fillStyle = '#2b2d31';
	g.fillRect(0, 0, 256, 256);
	g.fillStyle = '#0c0c0d';
	g.beginPath();
	g.arc(128, 128, 124, 0, Math.PI * 2);
	g.fill();
	g.strokeStyle = '#55585c';
	g.lineWidth = 4;
	g.stroke();
	draw(g);
	var group = new THREE.Group();
	group.position.set(x, y, PANEL_Z + 0.004);
	var face = new THREE.Mesh(new THREE.CircleGeometry(r, 36), new THREE.MeshBasicMaterial({ map: canvasTexture(c) }));
	group.add(face);
	parent.add(group);
	group.userData.face = face;
	return group;
}

function tick(g, angle, r0, r1, width, color) {
	var a = angle * Math.PI / 180;
	g.strokeStyle = color || '#f0f0ea';
	g.lineWidth = width;
	g.beginPath();
	g.moveTo(128 + r0 * Math.sin(a), 128 - r0 * Math.cos(a));
	g.lineTo(128 + r1 * Math.sin(a), 128 - r1 * Math.cos(a));
	g.stroke();
}

function label(g, text, angle, r, size, color) {
	var a = angle * Math.PI / 180;
	g.fillStyle = color || '#f0f0ea';
	g.font = 'bold ' + size + 'px sans-serif';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText(text, 128 + r * Math.sin(a), 128 - r * Math.cos(a));
}

// a colored band from angle a0 to a1
function band(g, a0, a1, r, width, color) {
	g.strokeStyle = color;
	g.lineWidth = width;
	g.beginPath();
	g.arc(128, 128, r, (a0 - 90) * Math.PI / 180, (a1 - 90) * Math.PI / 180);
	g.stroke();
}

// a needle that points up. Turn it with rotation.z = -angle.
function makeNeedle(dial, r, len, width, color) {
	var geo = new THREE.PlaneGeometry(width, len);
	geo.translate(0, len / 2 - r * 0.12, 0);
	var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color || 0xf4f4ee }));
	m.position.z = 0.003;
	dial.add(m);
	return m;
}

// ---------- instruments ----------

// The six main instruments are in front of the left seat, in the standard order:
//   speed     attitude   altitude
//   turn      heading    climb
function makeInstruments(root) {
	var R = 0.048;
	var x0 = EYE.x - 0.108, x1 = EYE.x, x2 = EYE.x + 0.108;
	var y0 = 0.135, y1 = 0.027;
	var d, i, m;

	// airspeed, knots. 2 degrees for each knot.
	d = makeDial(root, x0, y0, R, function (g) {
		band(g, 86, 170, 112, 8, '#e8e8e8');       // flap range
		band(g, 102, 254, 103, 8, '#3fae4a');      // normal range
		band(g, 254, 316, 103, 8, '#e0c53a');      // caution
		tick(g, 316, 92, 122, 5, '#e03a2e');       // never exceed
		for (i = 40; i <= 160; i += 10) tick(g, i * 2, i % 20 ? 96 : 88, 118, i % 20 ? 2 : 4);
		for (i = 40; i <= 160; i += 20) label(g, '' + i, i * 2, 70, 22);
		label(g, 'KNOTS', 0, 40, 15, '#a0a4a8');
	});
	parts.asi = makeNeedle(d, R, R * 0.88, 0.005);

	// altitude, feet. Long needle = hundreds, short needle = thousands.
	d = makeDial(root, x2, y0, R, function (g) {
		for (i = 0; i < 50; i++) tick(g, i * 7.2, i % 5 ? 106 : 96, 118, i % 5 ? 2 : 4);
		for (i = 0; i < 10; i++) label(g, '' + i, i * 36, 76, 28);
		label(g, 'ALT', 0, 40, 15, '#a0a4a8');
		label(g, '100 FT', 180, 40, 14, '#a0a4a8');
	});
	parts.alt1000 = makeNeedle(d, R, R * 0.52, 0.008);
	parts.alt100 = makeNeedle(d, R, R * 0.88, 0.005);
	parts.alt100.position.z = 0.004;

	// climb, hundreds of feet in one minute. 0 is at the left.
	d = makeDial(root, x2, y1, R, function (g) {
		for (i = -20; i <= 20; i++) tick(g, 270 + i * 9, i % 5 ? 106 : 96, 118, i % 5 ? 2 : 4);
		label(g, '0', 270, 74, 26);
		label(g, '5', 315, 76, 22);
		label(g, '10', 0, 76, 22);
		label(g, '15', 45, 76, 22);
		label(g, '5', 225, 76, 22);
		label(g, '10', 180, 76, 22);
		label(g, '15', 135, 76, 22);
		label(g, '20', 90, 72, 22);
		label(g, 'UP', 312, 40, 14, '#a0a4a8');
		label(g, 'DN', 228, 40, 14, '#a0a4a8');
	});
	parts.vsi = makeNeedle(d, R, R * 0.88, 0.005);

	// heading: the card turns, the orange mark at the top is the nose
	d = makeDial(root, x1, y1, R, function (g) {
		var names = ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'];
		for (i = 0; i < 72; i++) tick(g, i * 5, i % 2 ? 108 : 100, 120, i % 6 ? 2 : 4);
		for (i = 0; i < 12; i++) {
			g.save();
			g.translate(128, 128);
			g.rotate(i * 30 * Math.PI / 180);
			g.translate(-128, -128);
			label(g, names[i], 0, 80, i % 3 ? 24 : 30);
			g.restore();
		}
	});
	parts.hdg = d.userData.face;
	m = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.02), new THREE.MeshBasicMaterial({ color: 0xff9a2e }));
	m.position.set(0, R * 0.86, 0.003);
	d.add(m);
	m = new THREE.Mesh(new THREE.PlaneGeometry(0.004, R * 0.9), new THREE.MeshBasicMaterial({ color: 0xff9a2e }));
	m.position.set(0, 0, 0.003);
	d.add(m);

	// turn and slip: the small airplane shows the turn rate, the ball shows the slip
	d = makeDial(root, x0, y1, R, function (g) {
		tick(g, 90, 96, 120, 5);
		tick(g, 270, 96, 120, 5);
		tick(g, 110, 96, 120, 5);
		tick(g, 250, 96, 120, 5);
		label(g, 'L', 232, 100, 22);
		label(g, 'R', 128, 100, 22);
		label(g, '2 MIN', 0, 62, 14, '#a0a4a8');
		// tube of the ball
		g.fillStyle = '#d8d8cf';
		g.fillRect(58, 176, 140, 30);
		g.fillStyle = '#0c0c0d';
		g.fillRect(109, 174, 3, 34);
		g.fillRect(144, 174, 3, 34);
	});
	parts.turn = new THREE.Group();
	parts.turn.position.z = 0.003;
	m = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.3, 0.005), new THREE.MeshBasicMaterial({ color: 0xf4f4ee }));
	parts.turn.add(m);
	m = new THREE.Mesh(new THREE.PlaneGeometry(0.005, 0.014), new THREE.MeshBasicMaterial({ color: 0xf4f4ee }));
	m.position.y = 0.007;
	parts.turn.add(m);
	d.add(parts.turn);
	parts.ball = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 16), new THREE.MeshBasicMaterial({ color: 0x0c0c0d }));
	parts.ball.position.set(0, -R * 0.49, 0.003);
	d.add(parts.ball);
	parts.ballRange = R * 0.48;

	// attitude: a ball that shows the horizon. Blue = sky, brown = ground.
	var c = document.createElement('canvas');
	c.width = 256;
	c.height = 256;
	var g2 = c.getContext('2d');
	g2.fillStyle = '#3f8fd6';
	g2.fillRect(0, 0, 256, 128);
	g2.fillStyle = '#7a5230';
	g2.fillRect(0, 128, 256, 128);
	g2.fillStyle = '#ffffff';
	g2.fillRect(0, 126, 256, 4);
	for (i = -60; i <= 60; i += 10) {
		if (i === 0) continue;
		g2.fillRect(0, 128 - i * 256 / 180 - 1, 256, 2);      // a line for each 10 degrees of pitch
	}
	parts.attitude = new THREE.Mesh(new THREE.SphereGeometry(0.05, 28, 20), new THREE.MeshBasicMaterial({ map: canvasTexture(c) }));
	parts.attitude.position.set(x1, y0, PANEL_Z - 0.036);
	root.add(parts.attitude);
	d = new THREE.Group();
	d.position.set(x1, y0, PANEL_Z);
	m = new THREE.Mesh(new THREE.RingGeometry(0.0345, R, 36), new THREE.MeshBasicMaterial({ color: 0x1a1b1d }));
	m.position.z = 0.002;
	d.add(m);
	// the fixed orange symbol of the airplane
	var orange = new THREE.MeshBasicMaterial({ color: 0xff9a2e });
	m = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.003), orange);
	m.position.set(-0.02, 0, 0.0155);
	d.add(m);
	m = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.003), orange);
	m.position.set(0.02, 0, 0.0155);
	d.add(m);
	m = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.004), orange);
	m.position.set(0, 0, 0.0155);
	d.add(m);
	root.add(d);

	// engine speed, RPM x 100
	d = makeDial(root, EYE.x + 0.235, y1, 0.04, function (g) {
		band(g, 225 + 2100 / 3500 * 270, 225 + 2700 / 3500 * 270, 108, 8, '#3fae4a');
		tick(g, 225 + 2700 / 3500 * 270, 94, 122, 5, '#e03a2e');
		for (i = 0; i <= 35; i += 5) {
			tick(g, 225 + i * 270 / 35, 96, 118, 4);
			label(g, '' + i, 225 + i * 270 / 35, 72, 24);
		}
		label(g, 'RPM', 180, 60, 16, '#a0a4a8');
		label(g, 'x100', 180, 84, 14, '#a0a4a8');
	});
	parts.rpm = makeNeedle(d, 0.04, 0.035, 0.005);

	// control indicator: it shows your stick inputs
	// Orange dot = yoke (down = pull). Bottom mark = rudder. Left mark = trim.
	d = makeDial(root, EYE.x + 0.235, y0, 0.04, function (g) {
		g.strokeStyle = '#8a8e92';
		g.lineWidth = 3;
		g.strokeRect(66, 66, 124, 124);
		g.lineWidth = 1.5;
		g.beginPath();
		g.moveTo(128, 66);
		g.lineTo(128, 190);
		g.moveTo(66, 128);
		g.lineTo(190, 128);
		g.moveTo(66, 214);          // rudder line
		g.lineTo(190, 214);
		g.moveTo(48, 66);           // trim line
		g.lineTo(48, 190);
		g.stroke();
		tick(g, 180, 80, 92, 3, '#8a8e92');
		tick(g, 270, 74, 86, 3, '#8a8e92');
		label(g, 'YOKE', 0, 86, 15, '#a0a4a8');
	});
	parts.ctlRange = 62 * 0.04 / 128;        // half of the square, in meters
	parts.ctlDot = new THREE.Mesh(new THREE.CircleGeometry(0.0042, 16), orange);
	parts.ctlDot.position.z = 0.004;
	d.add(parts.ctlDot);
	parts.ctlRud = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 0.009), new THREE.MeshBasicMaterial({ color: 0xf4f4ee }));
	parts.ctlRud.position.set(0, -86 * 0.04 / 128, 0.003);
	d.add(parts.ctlRud);
	parts.ctlTrim = new THREE.Mesh(new THREE.PlaneGeometry(0.009, 0.004), new THREE.MeshBasicMaterial({ color: 0xf4f4ee }));
	parts.ctlTrim.position.set(-80 * 0.04 / 128, 0, 0.003);
	d.add(parts.ctlTrim);

	// the map screen
	mapScreen.canvas = document.createElement('canvas');
	mapScreen.canvas.width = 256;
	mapScreen.canvas.height = 256;
	mapScreen.g = mapScreen.canvas.getContext('2d');
	mapScreen.texture = canvasTexture(mapScreen.canvas);
	m = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.21), new THREE.MeshBasicMaterial({ map: mapScreen.texture }));
	m.position.set(EYE.x + 0.415, 0.085, PANEL_Z + 0.004);
	root.add(m);
	box(root, lambert(0x17181a), 0.225, 0.225, 0.006, EYE.x + 0.415, 0.085, PANEL_Z - 0.001);

	// the options hub: a list of options at the right of the map screen.
	// You point at a line with a controller and pull the trigger. main.js draws the text.
	hub.canvas = document.createElement('canvas');
	hub.canvas.width = 256;
	hub.canvas.height = 256;
	hub.g = hub.canvas.getContext('2d');
	hub.texture = canvasTexture(hub.canvas);
	parts.hub = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.21), new THREE.MeshBasicMaterial({ map: hub.texture }));
	parts.hub.position.set(EYE.x + 0.6425, 0.085, PANEL_Z + 0.004);
	root.add(parts.hub);

	// a small board behind the instruments. The Cessna cockpit has its own panel, thus it does not show there.
	parts.board = box(root, lambert(0x2b2d31), BOARD_W, BOARD_H, 0.05, BOARD_X, BOARD_Y, PANEL_Z - 0.025);
	parts.board.visible = false;
}

// ---------- open view ----------

// Open view: no aircraft body. The instruments are on a small board above your forward view.
// Thus you can see the ground below and around you.
// The board is attached to your head position (the rig). With the level view it stays level with you.
var _boardAt = new THREE.Vector3();

function setOpenView(on, outside) {
	var e = OPEN_ANGLE * Math.PI / 180;
	parts.open = on;
	parts.outside = outside;
	// three.js needs true or false here, not 1 or 0
	parts.body.visible = on ? (outside ? true : false) : true;    // the outside view always shows the aircraft
	parts.board.visible = (on || plane.type !== 0) ? true : false;
	// the delta wing has no dash: its instruments are always on the board at the top
	if (on || plane.type === 1) {
		// turn the board to the eye, then move its center to the point above the forward view
		parts.rig.add(parts.panel);
		parts.panel.rotation.set(e, 0, 0);
		_boardAt.set(BOARD_X, BOARD_Y, PANEL_Z).applyEuler(parts.panel.rotation);
		parts.panel.position.set(-_boardAt.x, OPEN_DIST * Math.sin(e) - _boardAt.y, -OPEN_DIST * Math.cos(e) - _boardAt.z);
	} else {
		parts.root.add(parts.panel);
		parts.panel.rotation.set(0, 0, 0);
		parts.panel.position.set(0, 0, 0);
	}
}

// draw the options hub. lines: array of [label, value]. hover: the line below the pointer, or -1.
function drawHub(lines, hover) {
	var g = hub.g;
	var h = 256 / HUB_ROWS;
	var k;
	g.fillStyle = '#15171a';
	g.fillRect(0, 0, 256, 256);
	g.font = 'bold 14px monospace';
	g.textBaseline = 'middle';
	for (k = 0; k < lines.length; k++) {
		g.fillStyle = k === hover ? '#3d6f9c' : (k % 2 ? '#1f2226' : '#262a2f');
		g.fillRect(3, k * h + 2, 250, h - 4);
		g.fillStyle = '#aab2b8';
		g.textAlign = 'left';
		g.fillText(lines[k][0], 10, k * h + h / 2 + 1);
		g.fillStyle = '#ffffff';
		g.textAlign = 'right';
		g.fillText(lines[k][1], 246, k * h + h / 2 + 1);
	}
	hub.texture.needsUpdate = true;
}

// ---------- map screen ----------

// The map turns with the airplane: the top of the screen is the direction of the nose.
// message: one line of text, or ''. warn: 1 = show the message in red.
function drawMapScreen(message, warn) {
	var g = mapScreen.g;
	var p = plane;
	var s = 256 / MAP_RANGE;                 // pixels for each meter
	var n = GRID + 1;
	var k, ap, a, b, dx, dz, dist, brg, txt;

	g.setTransform(1, 0, 0, 1, 0, 0);
	g.fillStyle = '#23516b';
	g.fillRect(0, 0, 256, 256);

	g.translate(128, 150);
	g.rotate(-att.hdg);
	g.scale(s, s);
	g.translate(-p.pos.x, -p.pos.z);
	g.drawImage(mapCanvas, -HALF - CELL / 2, -HALF - CELL / 2, n * CELL, n * CELL);
	// runways
	a = new THREE.Vector3();
	b = new THREE.Vector3();
	g.lineCap = 'butt';
	for (k = 0; k < AIRPORTS.length; k++) {
		ap = AIRPORTS[k];
		apPoint(ap, -ap.len / 2, 0, a);
		apPoint(ap, ap.len / 2, 0, b);
		g.strokeStyle = '#101010';
		g.lineWidth = 260;
		g.beginPath();
		g.moveTo(a.x, a.z);
		g.lineTo(b.x, b.z);
		g.stroke();
		g.strokeStyle = '#ffffff';
		g.lineWidth = 130;
		g.stroke();
		// the long line shows the approach path
		apPoint(ap, -ap.len / 2 - 3000, 0, b);
		g.strokeStyle = '#ffd24a';
		g.lineWidth = 45;
		g.beginPath();
		g.moveTo(a.x, a.z);
		g.lineTo(b.x, b.z);
		g.stroke();
	}

	// the airplane symbol
	g.setTransform(1, 0, 0, 1, 0, 0);
	g.fillStyle = '#ffffff';
	g.strokeStyle = '#000000';
	g.lineWidth = 2;
	g.beginPath();
	g.moveTo(128, 138);
	g.lineTo(137, 160);
	g.lineTo(128, 155);
	g.lineTo(119, 160);
	g.closePath();
	g.stroke();
	g.fill();

	// top line: the airport of the start position, with direction and distance
	ap = AIRPORTS[STARTS[p.start].ap];
	dx = ap.x - p.pos.x;
	dz = ap.z - p.pos.z;
	dist = Math.sqrt(dx * dx + dz * dz) / 1852;
	brg = Math.round(Math.atan2(dx, -dz) * 180 / Math.PI);
	if (brg <= 0) brg += 360;
	g.fillStyle = 'rgba(0,0,0,0.65)';
	g.fillRect(0, 0, 256, 30);
	g.fillRect(0, 226, 256, 30);
	g.fillStyle = '#e8f0e8';
	g.font = 'bold 17px monospace';
	g.textAlign = 'left';
	g.textBaseline = 'middle';
	g.fillText(ap.name + '  ' + ('00' + brg).slice(-3) + '°  ' + dist.toFixed(1) + ' NM', 6, 16);
	txt = (AC.heli ? 'LEVER ' : 'PWR ') + Math.round(p.thr * 100);
	if (!AC.heli) txt = 'TRIM ' + (p.trim >= 0 ? '+' : '') + Math.round(p.trim * 10) + '  ' + txt;
	if (p.type === 0) txt = 'FLAP ' + Math.round(p.flaps * 10) + '  ' + txt;
	g.fillText(txt, 6, 242);
	if (message !== '') {
		g.fillStyle = warn ? 'rgba(170,20,10,0.9)' : 'rgba(0,0,0,0.7)';
		g.fillRect(0, 34, 256, 30);
		g.fillStyle = '#ffffff';
		g.textAlign = 'center';
		g.fillText(message, 128, 50);
	}
	mapScreen.texture.needsUpdate = true;
}

// ---------- shadow ----------

function makeShadow(scene) {
	var c = document.createElement('canvas');
	c.width = 128;
	c.height = 128;
	var g = c.getContext('2d');
	g.fillStyle = '#000000';
	// 128 pixels = 12 m. The nose is at the top.
	g.fillRect(58, 14, 12, 92);         // body
	g.fillRect(5, 36, 118, 15);         // wing
	g.fillRect(46, 94, 36, 9);          // tail
	var t = new THREE.CanvasTexture(c);
	var mat = new THREE.MeshBasicMaterial({
		map: t, transparent: true, opacity: 0.45, depthWrite: false,
		polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -24
	});
	parts.shadow = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), mat);
	parts.shadow.rotation.order = 'YXZ';
	parts.shadow.renderOrder = 3;
	scene.add(parts.shadow);
}

// ---------- update ----------

var _inv = new THREE.Quaternion();
var _axisZ = new THREE.Vector3(0, 0, 1);
var vsiShown = 0;

// move the model and the instruments to the state of the flight model
function updateAirplane(dt, message, warn) {
	var p = plane, A = AC;
	var root = parts.root;
	var deg = Math.PI / 180;
	var kt, ft, h, gy, k;

	root.position.copy(p.pos);
	root.quaternion.copy(p.quat);

	if (p.type === 0) {
		// control surfaces
		parts.elevator.rotation.x = -(p.elev * A.maxElev + p.trim * A.maxTrim);
		parts.rudder.rotation.y = p.rud * A.maxRud;
		parts.ailL.rotation.x = p.ail * A.maxAil;
		parts.ailR.rotation.x = -p.ail * A.maxAil;
		parts.flapL.rotation.x = p.flaps * 10 * deg;
		parts.flapR.rotation.x = p.flaps * 10 * deg;
		parts.yoke.position.z = PANEL_Z + 0.2 + p.elev * 0.07;
		parts.yoke.rotation.z = -p.ail * 1.1;
		parts.throttle.position.z = PANEL_Z + 0.09 * (1 - p.thr);
		// propeller: a disc at high speed, blades at low speed
		parts.blades.rotation.z += p.rpm / 60 * Math.PI * 2 * dt * 0.13;   // slow, thus the blades do not flicker
		parts.blades.material.opacity = clamp(0.55 - p.power * 2, 0.08, 0.55);
		parts.prop.material.opacity = 0.03 + 0.05 * clamp(p.power * 3, 0, 1);
	} else if (p.type === 1) {
		parts.deltaProp.material.opacity = 0.05 + 0.08 * clamp(p.power * 3, 0, 1);
		parts.deltaBar.rotation.set(0.12 * ctl.pitch, 0, -0.12 * ctl.roll);    // your input, the same as the YOKE indicator
	} else {
		parts.rotorBlades.rotation.y += 2.2 * dt;                          // slow, thus the blades do not flicker
		parts.cyclic.rotation.set(0.3 * ctl.pitch, 0, -0.3 * ctl.roll);
		parts.collective.rotation.x = 0.4 * p.thr;
	}

	// instruments
	kt = p.ias * KT;
	parts.asi.rotation.z = -clamp(kt, 0, 165) * 2 * deg;
	ft = p.pos.y * FT;
	parts.alt100.rotation.z = -(ft % 1000) * 0.36 * deg;
	parts.alt1000.rotation.z = -(ft % 10000) * 0.036 * deg;
	vsiShown += (p.vel.y * 196.85 - vsiShown) * Math.min(1, 2.5 * dt);
	parts.vsi.rotation.z = -(270 + clamp(vsiShown, -1950, 1950) * 0.09) * deg;
	parts.hdg.rotation.z = att.hdg;
	parts.turn.rotation.z = -clamp(p.turnRate / (3 * deg) * 20 * deg, -0.7, 0.7);
	parts.ball.position.x = clamp(p.ball / 0.12, -1, 1) * parts.ballRange;
	parts.rpm.rotation.z = -(225 + p.rpm / 3500 * 270) * deg;
	parts.ctlDot.position.x = ctl.roll * parts.ctlRange;       // your inputs, not the control surfaces
	parts.ctlDot.position.y = -ctl.pitch * parts.ctlRange;
	parts.ctlRud.position.x = ctl.yaw * parts.ctlRange;
	parts.ctlTrim.position.y = -p.trim * parts.ctlRange;
	// You see the ball from the outside. Thus pitch turns it in the direction opposite to the
	// airplane (nose up = more blue at the symbol), and bank keeps the line level with the horizon.
	parts.attitude.quaternion.setFromAxisAngle(_axisZ, att.bank).multiply(_inv.setFromAxisAngle(_axisX, att.pitch));

	// map screen: 4 times each second
	mapScreen.time += dt;
	if (mapScreen.time > 0.25) {
		mapScreen.time = 0;
		drawMapScreen(message, warn);
	}

	// shadow on the ground, in the direction away from the sun
	gy = groundAt(p.pos.x, p.pos.z);
	h = p.pos.y - AC.cg - gy;
	if (h < 400) {
		parts.shadow.visible = true;
		k = h / SUN_DIR.y;
		parts.shadow.position.set(p.pos.x - SUN_DIR.x * k, 0, p.pos.z - SUN_DIR.z * k);
		parts.shadow.position.y = groundAt(parts.shadow.position.x, parts.shadow.position.z) + 0.03;
		parts.shadow.rotation.set(-Math.PI / 2, -att.hdg, 0);
		parts.shadow.material.opacity = 0.45 * (1 - h / 400);
	} else {
		parts.shadow.visible = false;
	}
}
