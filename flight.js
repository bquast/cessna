// flight.js - the flight model of the airplane. This file does no drawing.
// Classic script. It uses THREE (vector math) and world.js (groundAt, surfaceAt, AIRPORTS).
//
// The airplane is one rigid body with 6 degrees of freedom.
// Each step calculates the forces of the air, the propeller, the gravity and the wheels,
// then moves the body. The numbers are those of a Cessna 172.
//
// Body axes are the three.js axes: +x = right, +y = up, -z = forward.
//
// main.js writes the pilot inputs into ctl and plane.thr, plane.flapSet, plane.trim,
// then calls stepPlane(DT) some times each frame.

// ---------- constants ----------

var G = 9.81;
var KT = 1.94384;        // m/s to knots
var FT = 3.28084;        // m to feet
var DT = 1 / 240;        // one physics step, in seconds
var HARD_LANDING = 4.5;  // m/s down at touchdown that breaks the airplane (890 ft/min)

var AC = {
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
	propArea: 2.84       // m2
};

// the wheels. Position in body axes, spring (N/m), damper (N s/m).
var WHEELS = [
	{ x: 0, y: -1.2, z: -1.25, k: 32000, c: 3000, steer: 1, brake: 0, skid: 0, down: 0 },
	{ x: -1.27, y: -1.2, z: 0.45, k: 45000, c: 4000, steer: 0, brake: 1, skid: 0, down: 0 },
	{ x: 1.27, y: -1.2, z: 0.45, k: 45000, c: 4000, steer: 0, brake: 1, skid: 0, down: 0 },
	{ x: 0, y: -0.25, z: 5.3, k: 30000, c: 2500, steer: 0, brake: 0, skid: 1, down: 0 }   // tail
];

// if one of these points touches the ground, the airplane is broken
var HARD_POINTS = [
	[0, -0.3, -2.35],    // nose
	[-5.5, 0.9, 0.3],    // left wing tip
	[5.5, 0.9, 0.3],     // right wing tip
	[0, -0.62, 0.2],     // belly
	[0, 1.9, 5.6]        // top of the fin
];

// the start positions. kind 0 = on the runway, 1 = in the air, 2.5 km before the runway.
var STARTS = [
	{ ap: 0, kind: 0 }, { ap: 0, kind: 1 },
	{ ap: 1, kind: 0 }, { ap: 1, kind: 1 },
	{ ap: 2, kind: 0 }, { ap: 2, kind: 1 }
];

// ---------- state ----------

// pilot inputs, each from -1 to 1 (brake: 0 to 1)
var ctl = { pitch: 0, roll: 0, yaw: 0, brake: 0 };   // pitch: + = pull, roll: + = right, yaw: + = right

var plane = {
	pos: new THREE.Vector3(),     // world, m
	vel: new THREE.Vector3(),     // world, m/s
	quat: new THREE.Quaternion(), // body to world
	omega: new THREE.Vector3(),   // body axes, rad/s
	thr: 0,          // throttle lever, 0 to 1
	power: 0,        // engine power, follows thr
	flapSet: 0,      // flap lever: 0, 1, 2, 3 = 0, 10, 20, 30 degrees
	flaps: 0,        // flap position, follows flapSet
	trim: 0,         // -1 to 1, + = nose up
	elev: 0, ail: 0, rud: 0,   // control positions, follow ctl
	// values for the instruments
	ias: 0,          // indicated airspeed, m/s
	alpha: 0,        // angle of attack, rad
	rpm: 600,
	ball: 0,         // slip ball, rad. + = ball to the right.
	gload: 1,
	turnRate: 0,     // rad/s, + = right
	onGround: 1,
	stall: 0,        // 1 = the stall warning is on
	crashed: '',     // text = the airplane is broken
	touchdown: 0,    // sink rate of the last touchdown, m/s
	touchTime: -99,  // time of the last touchdown
	time: 0,
	start: 0         // index in STARTS
};

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
	var p = plane;
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
	for (k = 0; k < WHEELS.length; k++) WHEELS[k].down = 0;

	if (st.kind === 0) {
		// on the runway, engine at idle
		hdg = ap.dep > 0 ? ap.hdg : ap.hdg + 180;
		apPoint(ap, -ap.dep * (ap.len / 2 - 25), 0, _p);
		p.pos.set(_p.x, ap.elev + 1.12, _p.z);
		p.vel.set(0, 0, 0);
		pitch = 0;
		p.thr = 0;
		p.power = 0;
		p.flapSet = 0;
		p.flaps = 0;
		p.trim = 0.25;
		p.onGround = 1;
		for (k = 0; k < 3; k++) WHEELS[k].down = 1;
	} else {
		// on the 3 degree path to the runway, 70 kt, flaps 20
		hdg = ap.hdg;
		V = 36;
		gamma = -3 * Math.PI / 180;
		apPoint(ap, -ap.len / 2 - 2500, 0, _p);
		p.pos.set(_p.x, ap.elev + 2750 * Math.tan(-gamma), _p.z);
		trimFor(V, gamma, 2, _trim);
		pitch = _trim.alpha + gamma;
		p.vel.set(V * Math.cos(gamma) * Math.sin(hdg * Math.PI / 180), V * Math.sin(gamma),
			-V * Math.cos(gamma) * Math.cos(hdg * Math.PI / 180));
		p.thr = _trim.thr;
		p.power = _trim.thr;
		p.flapSet = 2;
		p.flaps = 2;
		p.trim = _trim.trim;
		p.onGround = 0;
	}
	p.quat.setFromAxisAngle(_axisY, -hdg * Math.PI / 180);
	p.quat.multiply(_q1.setFromAxisAngle(_axisX, pitch));
}

// ---------- one step ----------

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

function crash(text) {
	if (plane.crashed === '') plane.crashed = text;
}

function stepPlane(dt) {
	var p = plane, A = AC;
	var k, w, g, pen, N, mu, vl, vs, fl, fs, sa;
	if (p.crashed !== '') return;
	p.time += dt;

	// the controls and the engine do not move immediately
	p.elev = approach(p.elev, ctl.pitch, 5 * dt);
	p.ail = approach(p.ail, ctl.roll, 5 * dt);
	p.rud = approach(p.rud, ctl.yaw, 5 * dt);
	p.flaps = approach(p.flaps, p.flapSet, 0.4 * dt);
	p.power = approach(p.power, p.thr, 0.9 * dt);

	// ---- the air ----
	var rho = 1.225 * Math.pow(Math.max(0.3, 1 - 2.2558e-5 * p.pos.y), 4.2559);
	_qi.copy(p.quat).invert();
	_vb.copy(p.vel).applyQuaternion(_qi);
	var u = -_vb.z;                 // forward
	var v = _vb.x;                  // to the right
	var wd = -_vb.y;                // down
	var V = Math.sqrt(u * u + v * v + wd * wd);
	var Vs = Math.max(V, 1);
	var alpha = V > 0.5 ? Math.atan2(wd, u) : 0;
	var beta = Math.asin(clamp(v / Vs, -1, 1));
	var qbar = 0.5 * rho * V * V;
	var pr = -p.omega.z;            // roll rate, + = right wing down
	var qr = p.omega.x;             // pitch rate, + = nose up
	var rr = -p.omega.y;            // yaw rate, + = nose right

	// the propeller
	var pf = A.idle + (1 - A.idle) * p.power;
	var sigma = rho / 1.225;
	var T = pf * sigma * Math.max(0, A.T0 - A.TV * u) - (1 - pf) * 0.02 * qbar * A.S;
	if (u < 1 && T < 0) T = 0;
	p.rpm = 600 + p.power * (1750 + 350 * clamp(u / 60, 0, 1));

	// the tail is in the air flow of the propeller, thus it has more effect with power
	var qtail = qbar + 0.7 * Math.max(T, 0) / A.propArea;

	// control surface angles. de: + = trailing edge down. dr: + = trailing edge left.
	var de = clamp(-(p.elev * A.maxElev + p.trim * A.maxTrim), -0.5, 0.42);
	var da = p.ail * A.maxAil;
	var dr = -p.rud * A.maxRud;

	// stall: sig changes from 0 (smooth flow) to 1 (separated flow)
	var e1 = Math.exp(-50 * (alpha - A.aStall));
	var e2 = Math.exp(50 * (alpha + A.aStall));
	var sig = (1 + e1 + e2) / ((1 + e1) * (1 + e2));
	var sa2 = Math.sin(alpha), ca = Math.cos(alpha);
	var sgn = alpha < 0 ? -1 : 1;
	var dCLf = A.flapCL * p.flaps;

	var CLlin = A.CL0 + dCLf + A.CLa * alpha;
	var CL = (1 - sig) * CLlin + sig * 1.1 * Math.sin(2 * alpha);
	CL += A.CLq * qr * A.c / (2 * Vs) + A.CLde * de;
	var CD = A.CD0 + A.flapCD1 * p.flaps + A.flapCD2 * p.flaps * p.flaps
		+ (1 - sig) * A.K * CLlin * CLlin + sig * 1.8 * sa2 * sa2 + 0.15 * beta * beta;
	var CY = A.CYb * beta + A.CYdr * dr;

	var bv = A.b / (2 * Vs);
	var Cm = A.Cm0 + A.Cma * alpha + A.CmStall * sig * sgn + A.Cmq * qr * A.c / (2 * Vs);
	var Cl = A.Clb * beta + A.Clp * pr * bv + A.Clr * rr * bv + A.Clda * da;
	var Cn = A.Cnb * beta + A.Cnp * pr * bv + A.Cnr * rr * bv + A.Cnda * da;

	var L = qbar * A.S * CL;
	var D = qbar * A.S * CD;
	var Y = qbar * A.S * CY;

	// force in body axes: lift is at 90 degrees to the air flow, drag is along it
	_fb.set(Y, L * ca + D * sa2, D * ca - L * sa2 - T);

	// moments: pitch (+ = nose up), roll (+ = right), yaw (+ = nose right)
	var Mp = qbar * A.S * A.c * Cm + qtail * A.S * A.c * A.Cmde * de;
	var Mr = qbar * A.S * A.b * Cl + qtail * A.S * A.b * A.Cldr * dr;
	var My = qbar * A.S * A.b * Cn + qtail * A.S * A.b * A.Cndr * dr;
	My -= A.propYaw * (Math.max(T, 0) * (1 + 5 * clamp(alpha, 0, 0.3)) - A.propRig);
	_tb.set(Mp, -My, -Mr);

	// ---- the wheels ----
	_fw.set(0, 0, 0);
	_tw.set(0, 0, 0);
	var mains = 0;
	var speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
	for (k = 0; k < WHEELS.length; k++) {
		w = WHEELS[k];
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
			if (-_v.y > HARD_LANDING) crash('HARD LANDING');
			if (!w.skid && !p.onGround) {
				p.touchdown = -_v.y;
				p.touchTime = p.time;
			}
		}
		w.down = 1;
		if (g <= 0) crash('WATER');
		if (pen > 0.5) crash('CRASH');
		if (!w.skid && k > 0) mains++;

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
			fl = -N * 0.4 * clamp(vl / 0.3, -1, 1);
			fs = -N * 0.4 * clamp(vs / 0.3, -1, 1);
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
	p.onGround = mains > 0 ? 1 : 0;

	for (k = 0; k < HARD_POINTS.length; k++) {
		_r.set(HARD_POINTS[k][0], HARD_POINTS[k][1], HARD_POINTS[k][2]).applyQuaternion(p.quat);
		if (p.pos.y + _r.y < groundAt(p.pos.x + _r.x, p.pos.z + _r.z)) {
			crash(p.pos.y + _r.y < 0.01 ? 'WATER' : 'CRASH');
		}
	}

	// ---- values for the instruments ----
	_v.copy(_fw).applyQuaternion(_qi).add(_fb);     // all forces but gravity, body axes
	p.gload = _v.y / (A.mass * G);
	var ball = clamp(-Math.atan2(_v.x, Math.max(Math.abs(_v.y), 500)), -0.25, 0.25);
	p.ball += (ball - p.ball) * Math.min(1, 6 * dt);
	p.alpha = alpha;
	p.ias = V * Math.sqrt(sigma);
	p.stall = (!p.onGround && alpha > A.aStall - 0.075 && V > 8) ? 1 : 0;
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
	var ox = p.omega.x, oy = p.omega.y, oz = p.omega.z;
	p.omega.x += dt * (_tb.x - (A.Iroll - A.Iyaw) * oy * oz) / A.Ipitch;
	p.omega.y += dt * (_tb.y - (A.Ipitch - A.Iroll) * oz * ox) / A.Iyaw;
	p.omega.z += dt * (_tb.z - (A.Iyaw - A.Ipitch) * ox * oy) / A.Iroll;
	_dq.set(p.omega.x * dt / 2, p.omega.y * dt / 2, p.omega.z * dt / 2, 1).normalize();
	p.quat.multiply(_dq).normalize();
}

// ---------- angles for the instruments ----------

var att = { hdg: 0, pitch: 0, bank: 0 };   // rad. hdg: 0 = north, + = to the east.

function updateAttitude() {
	_v.set(0, 0, -1).applyQuaternion(plane.quat);
	att.hdg = Math.atan2(_v.x, -_v.z);
	if (att.hdg < 0) att.hdg += Math.PI * 2;
	att.pitch = Math.asin(clamp(_v.y, -1, 1));
	_r.set(1, 0, 0).applyQuaternion(plane.quat);
	_f.set(0, 1, 0).applyQuaternion(plane.quat);
	att.bank = Math.atan2(-_r.y, _f.y);
}
