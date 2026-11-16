// flight.js - the flight models of the three aircraft. This file does no drawing.
// Classic script. It uses THREE (vector math) and world.js (groundAt, surfaceAt, AIRPORTS).
//
// Each aircraft is one rigid body with 6 degrees of freedom.
// Each step calculates the forces of the air (or the rotor), the engine, the gravity and
// the wheels, then moves the body.
//   CESSNA      a Cessna 172
//   DELTA WING  a powered delta wing (a trike): slow, light, no rudder
//   HELICOPTER  a light helicopter. The throttle lever is the collective.
//
// Body axes are the three.js axes: +x = right, +y = up, -z = forward.
//
// main.js writes the pilot inputs into ctl and plane.thr, plane.flapSet, plane.trim,
// then calls stepPlane(DT) some times each frame.
//
// plane.assist = 1: a flight computer is between you and the controls. Stick in the center = level flight.
//   Airplanes:  stick left, right = bank angle. Stick forward, back = descend, climb. It trims by itself.
//   Helicopter: stick = tilt angle. Lever at 50% = hold the height, more = up, less = down.
//
// Order of this file:
//   constants, aircraft data, state, start positions, assist, air forces, rotor forces,
//   wheels, one step, angles.

// ---------- constants ----------

var G = 9.81;
var KT = 1.94384;        // m/s to knots
var FT = 3.28084;        // m to feet
var DT = 1 / 240;        // one physics step, in seconds

// ---------- aircraft data ----------

// wheels: position in body axes, spring k (N/m), damper c (N s/m).
//   steer: turns with the rudder. brake: has a brake. skid: slides, does not roll.
//   main: counts for "on the ground" and for the touchdown.
// hard: if one of these points touches the ground, the aircraft is broken.

var CESSNA = {
	name: 'CESSNA', heli: 0,
	mass: 1000,          // kg
	S: 16.2,             // wing area, m2
	b: 11.0,             // wing span, m
	c: 1.47,             // wing chord, m
	Ipitch: 1825,        // kg m2, about the x axis
	Iyaw: 2667,          // about the y axis
	Iroll: 1285,         // about the z axis
	// lift
	CL0: 0.31, CLa: 5.14, CLq: 3.9, CLde: 0.43,
	aStall: 0.285,       // rad. The lift starts to break near this angle of attack.
	// drag
	CD0: 0.034, K: 0.062,
	// pitch moment
	Cm0: -0.015, Cma: -0.89, Cmq: -12.4, Cmde: -1.28, CmStall: -0.35,
	// side force
	CYb: -0.31, CYdr: 0.187,
	// roll moment
	Clb: -0.089, Clp: -0.47, Clr: 0.096, Clda: 0.178, Cldr: 0.0147,
	// yaw moment
	Cnb: 0.065, Cnp: -0.03, Cnr: -0.12, Cnda: -0.02, Cndr: -0.0657,
	// largest angles of the control surfaces, rad
	maxElev: 0.36, maxAil: 0.26, maxRud: 0.28, maxTrim: 0.20,
	// flaps: values for each 10 degrees
	flapCL: 0.2, flapCD1: 0.006, flapCD2: 0.0025,
	// propeller
	T0: 2600,            // thrust at full power and no speed, N
	TV: 18.5,            // thrust decrease for each m/s
	idle: 0.05,          // part of the power at idle
	propYaw: 0.015,      // left-turn tendency at high power: yaw moment arm, m. 0 = off, 0.15 = real.
	propRig: 900,        // the airplane is adjusted to fly straight at this thrust (cruise), N
	propWash: 0.7 / 2.84, // more tail effect with power (0 = the tail is not behind the propeller)
	rpmIdle: 600, rpmPower: 1750, rpmSpeed: 350,
	// assist
	assistBank: 0.6,     // bank angle at full stick, rad
	assistClimb: 0.12,   // climb angle at full stick, rad
	aLimit: 0.19,        // the assist does not go above this angle of attack
	// start in the air
	vApproach: 36, flapApproach: 2,
	hardLanding: 4.5,    // m/s down at touchdown that breaks the aircraft
	cg: 1.12,            // height of the origin above the ground when it stands
	wheels: [
		{ x: 0, y: -1.2, z: -1.25, k: 32000, c: 3000, steer: 1, brake: 0, skid: 0, main: 1, down: 0 },
		{ x: -1.27, y: -1.2, z: 0.45, k: 45000, c: 4000, steer: 0, brake: 1, skid: 0, main: 1, down: 0 },
		{ x: 1.27, y: -1.2, z: 0.45, k: 45000, c: 4000, steer: 0, brake: 1, skid: 0, main: 1, down: 0 },
		{ x: 0, y: -0.25, z: 5.3, k: 30000, c: 2500, steer: 0, brake: 0, skid: 1, main: 0, down: 0 }   // tail
	],
	hard: [[0, -0.3, -2.35], [-5.5, 0.9, 0.3], [5.5, 0.9, 0.3], [0, -0.62, 0.2], [0, 1.9, 5.6]]
};

var DELTA = {
	name: 'DELTA WING', heli: 0,
	mass: 320, S: 15, b: 10, c: 1.7,
	Ipitch: 450, Iyaw: 650, Iroll: 500,
	CL0: 0.35, CLa: 3.6, CLq: 2.5, CLde: 0.2,
	aStall: 0.33,
	CD0: 0.075, K: 0.075,
	Cm0: 0, Cma: -0.6, Cmq: -8, Cmde: -0.5, CmStall: -0.3,
	CYb: -0.25, CYdr: 0,
	Clb: -0.11, Clp: -0.5, Clr: 0.1, Clda: 0.16, Cldr: 0,
	Cnb: 0.07, Cnp: -0.03, Cnr: -0.12, Cnda: -0.005, Cndr: 0,
	maxElev: 0.35, maxAil: 0.3, maxRud: 0, maxTrim: 0.25,     // no rudder: you steer with the bar
	flapCL: 0, flapCD1: 0, flapCD2: 0,
	T0: 1500, TV: 28, idle: 0.05, propYaw: 0, propRig: 0, propWash: 0,
	rpmIdle: 800, rpmPower: 1700, rpmSpeed: 200,
	assistBank: 0.55, assistClimb: 0.1, aLimit: 0.22,
	vApproach: 22, flapApproach: 0,
	hardLanding: 4.5,
	cg: 0.93,
	wheels: [
		{ x: 0, y: -1.0, z: -1.3, k: 11600, c: 1000, steer: 1, brake: 0, skid: 0, main: 1, down: 0 },
		{ x: -0.85, y: -1.0, z: 0.45, k: 16500, c: 1400, steer: 0, brake: 1, skid: 0, main: 1, down: 0 },
		{ x: 0.85, y: -1.0, z: 0.45, k: 16500, c: 1400, steer: 0, brake: 1, skid: 0, main: 1, down: 0 }
	],
	hard: [[0, 1.9, -1.9], [-5, 1.5, 1.3], [5, 1.5, 1.3], [0, -0.6, 0], [0, 1.4, 2.0]]
};

var HELI = {
	name: 'HELICOPTER', heli: 1,
	mass: 1000,
	Ipitch: 2800, Iyaw: 2200, Iroll: 900,
	// the rotor turns the body at these rates at full stick, rad/s
	ratePitch: 0.8, rateRoll: 1.2, rateYaw: 1.0,
	tau: 0.25,           // seconds to get to that rate (pitch and roll)
	tauYaw: 0.5,
	thrust0: 0.4,        // rotor thrust / weight with the lever at 0. Lever at 0.6 = hover.
	sink: 700,           // thrust decrease for each m/s of climb, N. It makes the climb rate steady.
	flapback: 60,        // nose-up moment for each m/s of forward speed, N m
	dihedral: 40,        // roll moment against a side speed, N m for each m/s
	vane: 25,            // the tail fin turns the nose into the air flow
	stab: 3,             // the tail plane holds the nose in the air flow
	torque: 1500,        // the body turns against the rotor when you change the lever, N m
	dragFront: 1.8, dragSide: 2.5, dragUp: 4.0,     // drag areas, m2
	rpmIdle: 2200, rpmPower: 300, rpmSpeed: 0,
	assistPitch: 0.3, assistBank: 0.4,              // tilt angles at full stick, rad
	assistBrake: 0.16,   // largest tilt that the assist uses to stop, rad
	assistVs: 6,         // climb rate with the lever at 100%, m/s
	aStall: 9,           // no stall
	vApproach: 30, flapApproach: 0,
	hardLanding: 3.5,
	cg: 1.18,
	wheels: [
		{ x: -0.95, y: -1.25, z: -0.9, k: 30000, c: 3500, steer: 0, brake: 0, skid: 1, main: 1, down: 0 },
		{ x: 0.95, y: -1.25, z: -0.9, k: 30000, c: 3500, steer: 0, brake: 0, skid: 1, main: 1, down: 0 },
		{ x: -0.95, y: -1.25, z: 1.1, k: 30000, c: 3500, steer: 0, brake: 0, skid: 1, main: 1, down: 0 },
		{ x: 0.95, y: -1.25, z: 1.1, k: 30000, c: 3500, steer: 0, brake: 0, skid: 1, main: 1, down: 0 }
	],
	hard: [[0, -0.3, -1.9], [0, 0.4, 6.0], [-3.8, 1.6, 0], [3.8, 1.6, 0], [0, 1.6, -3.8], [0, 1.6, 3.8], [0, -0.9, 0]]
};

var AIRCRAFT = [CESSNA, DELTA, HELI];
var AC = CESSNA;         // the aircraft that you fly now

// the start positions. kind 0 = on the runway, 1 = in the air, 2.5 km before the runway.
var STARTS = [
	{ ap: 0, kind: 0 }, { ap: 0, kind: 1 },
	{ ap: 1, kind: 0 }, { ap: 1, kind: 1 },
	{ ap: 2, kind: 0 }, { ap: 2, kind: 1 }
];

// ---------- state ----------

// pilot inputs, each from -1 to 1 (brake: 0 to 1)
var ctl = { pitch: 0, roll: 0, yaw: 0, brake: 0 };   // pitch: + = pull, roll: + = right, yaw: + = right

// the commands that go to the controls: from the pilot, or from the assist
var cmd = { pitch: 0, roll: 0, yaw: 0, thrust: -1 };

var plane = {
	type: 0,         // index in AIRCRAFT
	assist: 1,       // 1 = the flight computer holds the aircraft level
	pos: new THREE.Vector3(),     // world, m
	vel: new THREE.Vector3(),     // world, m/s
	quat: new THREE.Quaternion(), // body to world
	omega: new THREE.Vector3(),   // body axes, rad/s
	thr: 0,          // throttle lever (helicopter: collective lever), 0 to 1
	power: 0,        // engine power, follows thr
	flapSet: 0,      // flap lever: 0, 1, 2, 3 = 0, 10, 20, 30 degrees
	flaps: 0,        // flap position, follows flapSet
	trim: 0,         // -1 to 1, + = nose up
	elev: 0, ail: 0, rud: 0,   // control positions, follow cmd
	// memory of the assist
	bankCmd: 0, climbCmd: 0, aRef: 0, hdgHold: 0,     // climbCmd is the tilt command for the helicopter
	// values for the instruments
	ias: 0,          // indicated airspeed, m/s
	alpha: 0,        // angle of attack, rad
	beta: 0,         // slip angle, rad
	rpm: 600,
	ball: 0,         // slip ball, rad. + = ball to the right.
	gload: 1,
	turnRate: 0,     // rad/s, + = right
	onGround: 1,
	stall: 0,        // 1 = the stall warning is on
	crashed: '',     // text = the aircraft is broken
	touchdown: 0,    // sink rate of the last touchdown, m/s
	touchTime: -99,  // time of the last touchdown
	time: 0,
	start: 0         // index in STARTS
};

var att = { hdg: 0, pitch: 0, bank: 0 };   // rad. hdg: 0 = north, + = to the east.

function setAircraft(index) {
	plane.type = index;
	AC = AIRCRAFT[index];
}

// ---------- start positions ----------

// the angle of attack, trim and throttle for steady flight at speed V on a path angle gamma
function trimFor(V, gamma, flaps, out) {
	var A = AC;
	var q = 0.5 * 1.225 * V * V;
	var CL = A.mass * G * Math.cos(gamma) / (q * A.S);
	var alpha = (CL - A.CL0 - A.flapCL * flaps) / A.CLa;
	var de = -(A.Cm0 + A.Cma * alpha) / A.Cmde;
	var CD = A.CD0 + A.flapCD1 * flaps + A.flapCD2 * flaps * flaps + A.K * CL * CL;
	var T = q * A.S * CD + A.mass * G * Math.sin(gamma);
	var drag = 0.02 * q * A.S;
	var pf = (T + drag) / (A.T0 - A.TV * V + drag);
	out.alpha = alpha;
	out.trim = clamp(-de / A.maxTrim, -1, 1);
	out.thr = clamp((pf - A.idle) / (1 - A.idle), 0, 1);
}

var _trim = {};
var _p = new THREE.Vector3();
var _axisX = new THREE.Vector3(1, 0, 0);
var _axisY = new THREE.Vector3(0, 1, 0);
var _q1 = new THREE.Quaternion();

function resetPlane(index) {
	var p = plane, A = AC;
	var st = STARTS[index];
	var ap = AIRPORTS[st.ap];
	var hdg, pitch, k, V, gamma;
	p.start = index;
	p.omega.set(0, 0, 0);
	p.elev = 0;
	p.ail = 0;
	p.rud = 0;
	p.crashed = '';
	p.touchTime = -99;
	p.stall = 0;
	p.ball = 0;
	p.bankCmd = 0;
	p.climbCmd = 0;
	p.aRef = 0;
	p.flapSet = 0;
	p.flaps = 0;
	for (k = 0; k < A.wheels.length; k++) A.wheels[k].down = 0;

	if (st.kind === 0) {
		// on the runway, engine at idle
		hdg = ap.dep > 0 ? ap.hdg : ap.hdg + 180;
		apPoint(ap, -ap.dep * (ap.len / 2 - 25), 0, _p);
		p.pos.set(_p.x, ap.elev + A.cg, _p.z);
		p.vel.set(0, 0, 0);
		pitch = 0;
		p.thr = 0;
		p.power = 0;
		p.trim = A.heli ? 0 : 0.25;
		p.onGround = 1;
		for (k = 0; k < A.wheels.length; k++) A.wheels[k].down = A.wheels[k].main;
	} else {
		// in the air, 2.5 km before the runway, on the 3 degree path
		hdg = ap.hdg;
		V = A.vApproach;
		gamma = -3 * Math.PI / 180;
		apPoint(ap, -ap.len / 2 - 2500, 0, _p);
		p.pos.set(_p.x, ap.elev + 2750 * Math.tan(-gamma), _p.z);
		if (A.heli) {
			// level flight. Lever: 50% holds the height with the assist, 60% is the hover thrust without it.
			gamma = 0;
			pitch = -0.07;
			p.thr = p.assist ? 0.5 : 0.6;
			p.trim = 0;
		} else {
			trimFor(V, gamma, A.flapApproach, _trim);
			pitch = _trim.alpha + gamma;
			p.thr = _trim.thr;
			p.trim = _trim.trim;
			p.flapSet = A.flapApproach;
			p.flaps = A.flapApproach;
			p.climbCmd = gamma;
		}
		p.vel.set(V * Math.cos(gamma) * Math.sin(hdg * Math.PI / 180), V * Math.sin(gamma),
			-V * Math.cos(gamma) * Math.cos(hdg * Math.PI / 180));
		p.power = p.thr;
		p.onGround = 0;
	}
	p.quat.setFromAxisAngle(_axisY, -hdg * Math.PI / 180);
	p.quat.multiply(_q1.setFromAxisAngle(_axisX, pitch));
	updateAttitude();
	p.hdgHold = att.hdg;
}

// ---------- assist ----------

// difference of two directions, from -PI to PI
function angleDiff(a, b) {
	var d = a - b;
	while (d > Math.PI) d -= Math.PI * 2;
	while (d < -Math.PI) d += Math.PI * 2;
	return d;
}

// Airplanes. Roll: the stick sets the bank angle. Pitch: the stick sets the climb angle.
// The trim follows, thus the stick stays near the center. The angle of attack has a limit, thus no stall.
function assistWing(dt, V, alpha, beta) {
	var p = plane, A = AC;
	var gamma = V > 5 ? Math.asin(clamp(p.vel.y / V, -1, 1)) : 0;
	var target, e, need;

	// roll
	p.bankCmd = p.onGround ? 0 : approach(p.bankCmd, ctl.roll * A.assistBank, 0.6 * dt);
	cmd.roll = clamp(3 * (p.bankCmd - att.bank) + p.omega.z, -1, 1);

	// yaw: on the ground it holds the direction of the runway, in the air it removes the slip
	cmd.yaw = ctl.yaw;
	if (p.onGround) {
		if (Math.abs(ctl.yaw) > 0.05 || V < 3) p.hdgHold = att.hdg;
		else cmd.yaw += clamp(4 * angleDiff(p.hdgHold, att.hdg), -0.5, 0.5);
	} else {
		cmd.yaw += clamp(2.5 * beta, -0.4, 0.4);
		p.hdgHold = att.hdg;
	}
	cmd.yaw = clamp(cmd.yaw, -1, 1);

	// pitch: on the ground the stick is direct, thus you pull to lift off
	if (p.onGround) {
		cmd.pitch = ctl.pitch;
		p.climbCmd = 0;
		p.aRef = 0;
		return;
	}
	p.climbCmd = approach(p.climbCmd, ctl.pitch * A.assistClimb, 0.12 * dt);
	// the angle of attack that gives the necessary lift at this speed and bank angle
	need = A.mass * G * Math.cos(gamma) / (Math.max(0.5 * air.rho * V * V, 40) * A.S * Math.max(0.6, Math.cos(att.bank)));
	need = (need - A.CL0 - A.flapCL * p.flaps) / A.CLa;
	// aRef is a small correction that removes the remaining error
	p.aRef = clamp(p.aRef + 0.4 * (p.climbCmd - gamma) * dt, -0.05, 0.05);
	target = p.climbCmd + clamp(need + p.aRef, -0.08, A.aLimit);
	target = Math.min(target, gamma + A.aLimit);
	e = clamp(6 * (target - att.pitch) - 1.5 * p.omega.x, -1, 1);
	cmd.pitch = e;
	p.trim = clamp(p.trim + 0.25 * e * dt, -1, 1);
}

// Helicopter. The stick sets the tilt angle. The lever sets the climb rate: 50% = hold the height.
function assistHeli(dt) {
	var p = plane, A = AC;
	var vsTarget, tilt, pitchT, bankT;
	cmd.yaw = ctl.yaw * 0.6;
	// at low speed it holds the direction of the nose against the tail fin effect
	if (Math.abs(air.u) < 10) {
		cmd.yaw -= (1 - Math.abs(air.u) / 10) * A.vane * air.v * (Math.abs(air.u) + 0.2 * Math.abs(air.v)) * A.tauYaw / (A.Iyaw * A.rateYaw);
	}
	if (p.onGround && p.thr < 0.45) {
		// on the ground with a low lever: it stands
		cmd.pitch = 0;
		cmd.roll = 0;
		p.climbCmd = 0;
		p.bankCmd = 0;
		cmd.thrust = A.mass * G * (0.3 + 1.5 * Math.max(0, p.thr - 0.25));
		return;
	}
	// stick in the center: it tilts against the speed, thus it slows to a hover
	pitchT = ctl.pitch * A.assistPitch;
	bankT = ctl.roll * A.assistBank;
	if (Math.abs(ctl.pitch) < 0.05) pitchT = clamp(0.012 * air.u, -A.assistBrake, A.assistBrake);
	if (Math.abs(ctl.roll) < 0.05 && Math.abs(air.u) < 12) bankT = clamp(-0.012 * air.v, -A.assistBrake, A.assistBrake);
	p.climbCmd = approach(p.climbCmd, pitchT, 0.5 * dt);
	p.bankCmd = approach(p.bankCmd, bankT, 0.7 * dt);
	cmd.pitch = clamp(4 * (p.climbCmd - att.pitch), -1, 1);
	cmd.roll = clamp(4 * (p.bankCmd - att.bank), -1, 1);
	vsTarget = (p.thr - 0.5) * 2;
	if (Math.abs(vsTarget) < 0.08) vsTarget = 0;
	vsTarget *= A.assistVs;
	tilt = Math.max(0.6, Math.cos(att.pitch) * Math.cos(att.bank));
	cmd.thrust = clamp(A.mass * (G + 1.5 * (vsTarget - p.vel.y)) / tilt, 0.3 * A.mass * G, 1.45 * A.mass * G);
}

// ---------- air forces (airplanes) ----------

var _qi = new THREE.Quaternion();
var _vb = new THREE.Vector3();
var _fb = new THREE.Vector3();    // force, body axes
var _fw = new THREE.Vector3();    // force of the wheels, world axes
var _tb = new THREE.Vector3();    // torque, body axes
var _tw = new THREE.Vector3();    // torque of the wheels, world axes
var _r = new THREE.Vector3();
var _v = new THREE.Vector3();
var _dir = new THREE.Vector3();
var _side = new THREE.Vector3();
var _f = new THREE.Vector3();
var _dq = new THREE.Quaternion();
var air = { u: 0, v: 0, w: 0, V: 0, alpha: 0, beta: 0, rho: 1.225 };

function crash(text) {
	if (plane.crashed === '') plane.crashed = text;
}

// the speed of the air in body axes
function airData() {
	var p = plane;
	air.rho = 1.225 * Math.pow(Math.max(0.3, 1 - 2.2558e-5 * p.pos.y), 4.2559);
	_qi.copy(p.quat).invert();
	_vb.copy(p.vel).applyQuaternion(_qi);
	air.u = -_vb.z;                 // forward
	air.v = _vb.x;                  // to the right
	air.w = -_vb.y;                 // down
	air.V = Math.sqrt(air.u * air.u + air.v * air.v + air.w * air.w);
	air.alpha = air.V > 0.5 ? Math.atan2(air.w, air.u) : 0;
	air.beta = Math.asin(clamp(air.v / Math.max(air.V, 1), -1, 1));
}

// wing, tail and propeller. The result is in _fb (force) and _tb (torque).
function wingForces() {
	var p = plane, A = AC;
	var u = air.u, V = air.V, alpha = air.alpha, beta = air.beta;
	var Vs = Math.max(V, 1);
	var qbar = 0.5 * air.rho * V * V;
	var pr = -p.omega.z;            // roll rate, + = right wing down
	var qr = p.omega.x;             // pitch rate, + = nose up
	var rr = -p.omega.y;            // yaw rate, + = nose right

	// the propeller
	var pf = A.idle + (1 - A.idle) * p.power;
	var sigma = air.rho / 1.225;
	var T = pf * sigma * Math.max(0, A.T0 - A.TV * u) - (1 - pf) * 0.02 * qbar * A.S;
	if (u < 1 && T < 0) T = 0;
	p.rpm = A.rpmIdle + p.power * (A.rpmPower + A.rpmSpeed * clamp(u / 60, 0, 1));

	// the tail is in the air flow of the propeller, thus it has more effect with power
	var qtail = qbar + A.propWash * Math.max(T, 0);

	// control surface angles. de: + = trailing edge down. dr: + = trailing edge left.
	var de = clamp(-(p.elev * A.maxElev + p.trim * A.maxTrim), -0.5, 0.42);
	var da = p.ail * A.maxAil;
	var dr = -p.rud * A.maxRud;

	// stall: sig changes from 0 (smooth flow) to 1 (separated flow)
	var e1 = Math.exp(-50 * (alpha - A.aStall));
	var e2 = Math.exp(50 * (alpha + A.aStall));
	var sig = (1 + e1 + e2) / ((1 + e1) * (1 + e2));
	var sa = Math.sin(alpha), ca = Math.cos(alpha);
	var sgn = alpha < 0 ? -1 : 1;

	var CLlin = A.CL0 + A.flapCL * p.flaps + A.CLa * alpha;
	var CL = (1 - sig) * CLlin + sig * 1.1 * Math.sin(2 * alpha);
	CL += A.CLq * qr * A.c / (2 * Vs) + A.CLde * de;
	var CD = A.CD0 + A.flapCD1 * p.flaps + A.flapCD2 * p.flaps * p.flaps
		+ (1 - sig) * A.K * CLlin * CLlin + sig * 1.8 * sa * sa + 0.15 * beta * beta;
	var CY = A.CYb * beta + A.CYdr * dr;

	var bv = A.b / (2 * Vs);
	var Cm = A.Cm0 + A.Cma * alpha + A.CmStall * sig * sgn + A.Cmq * qr * A.c / (2 * Vs);
	var Cl = A.Clb * beta + A.Clp * pr * bv + A.Clr * rr * bv + A.Clda * da;
	var Cn = A.Cnb * beta + A.Cnp * pr * bv + A.Cnr * rr * bv + A.Cnda * da;

	var L = qbar * A.S * CL;
	var D = qbar * A.S * CD;
	var Y = qbar * A.S * CY;

	// force in body axes: lift is at 90 degrees to the air flow, drag is along it
	_fb.set(Y, L * ca + D * sa, D * ca - L * sa - T);

	// moments: pitch (+ = nose up), roll (+ = right), yaw (+ = nose right)
	var Mp = qbar * A.S * A.c * Cm + qtail * A.S * A.c * A.Cmde * de;
	var Mr = qbar * A.S * A.b * Cl + qtail * A.S * A.b * A.Cldr * dr;
	var My = qbar * A.S * A.b * Cn + qtail * A.S * A.b * A.Cndr * dr;
	My -= A.propYaw * (Math.max(T, 0) * (1 + 5 * clamp(alpha, 0, 0.3)) - A.propRig);
	_tb.set(Mp, -My, -Mr);

	p.stall = (!p.onGround && alpha > A.aStall - 0.075 && V > 8) ? 1 : 0;
}

// ---------- rotor forces (helicopter) ----------

// The rotor thrust is along the body up axis. The stick tilts the body, thus it tilts the thrust.
// The result is in _fb (force) and _tb (torque).
function rotorForces() {
	var p = plane, A = AC;
	var u = air.u, v = air.v, w = air.w, V = air.V;
	var weight = A.mass * G;
	var pr = -p.omega.z, qr = p.omega.x, rr = -p.omega.y;
	var h, T, part, k;

	if (cmd.thrust >= 0) {
		T = cmd.thrust;                            // the assist gives the thrust
	} else {
		// lever to thrust. Near the ground and with forward speed the rotor gives more.
		h = p.pos.y - A.cg - groundAt(p.pos.x, p.pos.z);
		T = weight * (A.thrust0 + p.power) * (air.rho / 1.225);
		T *= 1 + 0.12 * clamp(1 - h / 8, 0, 1);
		T *= 1 + 0.1 * clamp(V / 20, 0, 1);
		T += A.sink * w;                           // w is the speed down: climb = less thrust
		T = clamp(T, 0, 1.6 * weight);
	}
	part = clamp(T / weight, 0, 1.2);              // a rotor with low thrust has low control power
	p.rpm = A.rpmIdle + A.rpmPower * clamp(T / weight, 0, 1.5) / 1.5;

	// drag of the body
	k = 0.5 * air.rho;
	_fb.set(-k * A.dragSide * v * Math.abs(v), T + k * A.dragUp * w * Math.abs(w), k * A.dragFront * u * Math.abs(u));

	// moments: pitch (+ = nose up), roll (+ = right), yaw (+ = nose right)
	var Mp = A.Ipitch * (A.ratePitch * cmd.pitch * part - qr) / A.tau + A.flapback * u - A.stab * w * Math.abs(u);
	var Mr = A.Iroll * (A.rateRoll * cmd.roll * part - pr) / A.tau - A.dihedral * v;
	var My = A.Iyaw * (A.rateYaw * cmd.yaw - rr) / A.tauYaw + A.vane * v * (Math.abs(u) + 0.2 * Math.abs(v));
	if (cmd.thrust < 0) My -= A.torque * (p.power - 0.6);
	_tb.set(Mp, -My, -Mr);
	p.stall = 0;
}

// ---------- wheels ----------

// springs, friction, brakes. The result is in _fw (force) and _tw (torque), in world axes.
function wheelForces() {
	var p = plane, A = AC;
	var k, w, g, pen, N, mu, vl, vs, fl, fs, sa;
	var mains = 0;
	var speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
	_fw.set(0, 0, 0);
	_tw.set(0, 0, 0);
	for (k = 0; k < A.wheels.length; k++) {
		w = A.wheels[k];
		_r.set(w.x, w.y, w.z).applyQuaternion(p.quat);
		g = groundAt(p.pos.x + _r.x, p.pos.z + _r.z);
		pen = g - (p.pos.y + _r.y);
		if (pen <= 0) {
			w.down = 0;
			continue;
		}
		// velocity of the wheel = velocity of the body + rotation
		_v.set(w.x, w.y, w.z);
		_v.crossVectors(p.omega, _v).applyQuaternion(p.quat).add(p.vel);
		if (!w.down) {
			if (-_v.y > A.hardLanding) crash('HARD LANDING');
			if (w.main && !p.onGround) {
				p.touchdown = -_v.y;
				p.touchTime = p.time;
			}
		}
		w.down = 1;
		if (g <= 0) crash('WATER');
		if (pen > 0.5) crash('CRASH');
		if (w.main) mains++;

		N = Math.max(0, w.k * pen - w.c * _v.y);

		// direction of the wheel on the ground. The nose wheel turns with the rudder.
		sa = 0;
		if (w.steer) sa = p.rud * 0.35 / (1 + speed * speed / 40);
		_dir.set(Math.sin(sa), 0, -Math.cos(sa)).applyQuaternion(p.quat);
		_dir.y = 0;
		_dir.normalize();
		_side.set(-_dir.z, 0, _dir.x);
		vl = _v.dot(_dir);
		vs = _v.dot(_side);

		if (w.skid) {
			fl = -N * 0.45 * clamp(vl / 0.3, -1, 1);
			fs = -N * 0.45 * clamp(vs / 0.3, -1, 1);
		} else {
			mu = surfaceAt(p.pos.x + _r.x, p.pos.z + _r.z) === 0 ? 0.02 : 0.07;
			mu += w.brake * ctl.brake * 0.45;
			fl = -N * mu * clamp(vl / 0.02, -1, 1);
			fs = -N * 0.55 * clamp(vs / 0.3, -1, 1);
		}
		_f.set(_dir.x * fl + _side.x * fs, N, _dir.z * fl + _side.z * fs);
		_fw.add(_f);
		_tw.add(_v.crossVectors(_r, _f));
	}
	// 2 or more points on the ground = the aircraft stands or rolls
	p.onGround = mains > (A.heli ? 1 : 0) ? 1 : 0;

	for (k = 0; k < A.hard.length; k++) {
		_r.set(A.hard[k][0], A.hard[k][1], A.hard[k][2]).applyQuaternion(p.quat);
		if (p.pos.y + _r.y < groundAt(p.pos.x + _r.x, p.pos.z + _r.z)) {
			crash(p.pos.y + _r.y < 0.01 ? 'WATER' : 'CRASH');
		}
	}
}

// ---------- one step ----------

function stepPlane(dt) {
	var p = plane, A = AC;
	var ball, ox, oy, oz;
	if (p.crashed !== '') return;
	p.time += dt;
	updateAttitude();
	airData();

	// the commands: from the pilot, or from the assist
	cmd.pitch = ctl.pitch;
	cmd.roll = ctl.roll;
	cmd.yaw = ctl.yaw;
	cmd.thrust = -1;
	if (p.assist) {
		if (A.heli) assistHeli(dt);
		else assistWing(dt, air.V, air.alpha, air.beta);
	}

	// the controls and the engine do not move immediately
	p.elev = approach(p.elev, cmd.pitch, 5 * dt);
	p.ail = approach(p.ail, cmd.roll, 5 * dt);
	p.rud = approach(p.rud, cmd.yaw, 5 * dt);
	p.flaps = approach(p.flaps, p.flapSet, 0.4 * dt);
	p.power = approach(p.power, p.thr, (A.heli ? 1.5 : 0.9) * dt);

	if (A.heli) rotorForces();
	else wingForces();
	wheelForces();

	// ---- values for the instruments ----
	_v.copy(_fw).applyQuaternion(_qi).add(_fb);     // all forces but gravity, body axes
	p.gload = _v.y / (A.mass * G);
	ball = clamp(-Math.atan2(_v.x, Math.max(Math.abs(_v.y), 0.05 * A.mass * G)), -0.25, 0.25);
	p.ball += (ball - p.ball) * Math.min(1, 6 * dt);
	p.alpha = air.alpha;
	p.beta = air.beta;
	p.ias = air.V * Math.sqrt(air.rho / 1.225);
	_v.copy(p.omega).applyQuaternion(p.quat);
	p.turnRate = -_v.y;

	// ---- move the body ----
	// linear: world axes
	_f.copy(_fb).applyQuaternion(p.quat).add(_fw);
	_f.y -= A.mass * G;
	p.vel.addScaledVector(_f, dt / A.mass);
	p.pos.addScaledVector(p.vel, dt);

	// angular: body axes, with the gyroscopic terms
	_tb.add(_tw.applyQuaternion(_qi));
	ox = p.omega.x;
	oy = p.omega.y;
	oz = p.omega.z;
	p.omega.x += dt * (_tb.x - (A.Iroll - A.Iyaw) * oy * oz) / A.Ipitch;
	p.omega.y += dt * (_tb.y - (A.Ipitch - A.Iroll) * oz * ox) / A.Iyaw;
	p.omega.z += dt * (_tb.z - (A.Iyaw - A.Ipitch) * ox * oy) / A.Iroll;
	_dq.set(p.omega.x * dt / 2, p.omega.y * dt / 2, p.omega.z * dt / 2, 1).normalize();
	p.quat.multiply(_dq).normalize();
}

// ---------- angles ----------

var _a1 = new THREE.Vector3();
var _a2 = new THREE.Vector3();

function updateAttitude() {
	_a1.set(0, 0, -1).applyQuaternion(plane.quat);
	att.hdg = Math.atan2(_a1.x, -_a1.z);
	if (att.hdg < 0) att.hdg += Math.PI * 2;
	att.pitch = Math.asin(clamp(_a1.y, -1, 1));
	_a1.set(1, 0, 0).applyQuaternion(plane.quat);
	_a2.set(0, 1, 0).applyQuaternion(plane.quat);
	att.bank = Math.atan2(-_a1.y, _a2.y);
}
