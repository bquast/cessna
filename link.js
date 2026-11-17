// link.js - the copilot link. A second device sees the flight and changes the options.
// Classic script. It uses Peer from peerjs.min.js (WebRTC), flight.js and the options of main.js.
//
// How it works:
//   The pilot device (the Quest) has a code of 6 digits. The device keeps the code.
//   The copilot device (the Mac) opens the same page and gives that code.
//   A public server (PeerJS cloud) helps the two devices to find each other. After that
//   the data goes directly from device to device. On the same WiFi it stays in your network.
//   The pilot sends the state of the flight 20 times each second.
//   The copilot draws the same island from that state and sends back option changes.
//
// URL parameters:
//   ?join=123456           join this pilot as copilot when the page opens
//   ?peer=host:port        use your own PeerServer, not the public one
//
// main.js calls linkStart() one time and linkUpdate() each frame.

// ---------- constants ----------

var LINK_PREFIX = 'cessna-vr-';      // the name of this game on the server
var LINK_RATE = 20;                  // state messages each second
var LINK_TIMEOUT = 3;                // seconds with no message = no signal

// ---------- state ----------

var link = {
	peer: null,
	role: 'pilot',       // 'pilot' = this device flies. 'copilot' = this device shows the flight of the pilot.
	code: '',            // the code of this device
	joined: '',          // copilot: the code of the pilot
	conns: [],           // pilot: the connected copilots
	conn: null,          // copilot: the connection to the pilot
	online: 0,           // 1 = connected to the server
	status: 'OFF',       // short text for the hub and the panel
	time: 0,             // time to the next state message
	count: 0,            // number of the state message
	seen: -1,            // copilot: number of the last state message
	silent: 0,           // copilot: seconds from the last state message
	head: new THREE.Quaternion()    // copilot: the head direction of the pilot
};

// ---------- setup ----------

function linkParam(name) {
	var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
	return m ? decodeURIComponent(m[1]) : '';
}

function linkOptions() {
	var own = linkParam('peer').split(':');
	if (own[0] === '') return { debug: 1 };      // the public PeerJS server
	return { host: own[0], port: parseInt(own[1] || '443', 10), path: '/', secure: window.location.protocol === 'https:', debug: 1 };
}

function linkNewCode() {
	var code = '' + Math.floor(100000 + Math.random() * 900000);
	try {
		localStorage.setItem('cessna.code', code);
	} catch (e) {
		// no storage: a new code on each visit
	}
	return code;
}

// connect to the server with the code of this device, then wait for a copilot
function linkStart() {
	var join = linkParam('join');
	if (typeof Peer === 'undefined') {
		link.status = 'NO LIBRARY';
		return;
	}
	try {
		link.code = localStorage.getItem('cessna.code') || '';
	} catch (e) {
		link.code = '';
	}
	if (!/^\d{6}$/.test(link.code)) link.code = linkNewCode();
	linkOpen();
	if (/^\d{6}$/.test(join)) linkJoin(join);
}

function linkOpen() {
	var peer = new Peer(LINK_PREFIX + link.code, linkOptions());
	link.peer = peer;
	link.status = 'WAIT';
	peer.on('open', function () {
		link.online = 1;
		if (link.role === 'pilot') link.status = link.conns.length ? 'ON' : 'READY';
		if (link.role === 'copilot' && link.joined === link.code) linkLeave('THIS IS YOUR OWN CODE');
		if (link.role === 'copilot' && !link.conn) linkConnect();
		linkChanged();
	});
	peer.on('connection', function (conn) {
		// a copilot comes in
		conn.on('open', function () {
			link.conns.push(conn);
			if (link.role === 'pilot') link.status = 'ON';
			linkChanged();
		});
		conn.on('data', linkCommand);
		conn.on('close', function () {
			var k = link.conns.indexOf(conn);
			if (k >= 0) link.conns.splice(k, 1);
			if (link.role === 'pilot') link.status = link.conns.length ? 'ON' : 'READY';
			linkChanged();
		});
	});
	peer.on('disconnected', function () {
		// the server connection is gone. The device-to-device connections stay. Try again in 5 s.
		link.online = 0;
		setTimeout(function () {
			if (link.peer === peer && !peer.destroyed) peer.reconnect();
		}, 5000);
	});
	peer.on('error', function (err) {
		if (err.type === 'unavailable-id') {
			// a different device has this code: get a new one
			peer.destroy();
			link.code = linkNewCode();
			linkOpen();
		} else if (err.type === 'peer-unavailable') {
			linkLeave('NO PILOT WITH THIS CODE');
		} else if (!link.online) {
			link.status = 'OFF LINE';
		}
		linkChanged();
	});
}

// tell main.js to draw the hub and the panel again
function linkChanged() {
	game.hubDirty = 1;
}

// ---------- pilot ----------

function round3(v) {
	return Math.round(v * 1000) / 1000;
}

// the state of the flight, as one small object
function linkState() {
	var p = plane;
	return {
		t: 's',
		k: link.count++,
		a: p.type,
		st: p.start,
		p: [round3(p.pos.x), round3(p.pos.y), round3(p.pos.z)],
		q: [p.quat.x, p.quat.y, p.quat.z, p.quat.w],
		v: [round3(p.vel.x), round3(p.vel.y), round3(p.vel.z)],
		w: [round3(p.omega.x), round3(p.omega.y), round3(p.omega.z)],
		n: [round3(p.thr), round3(p.power), round3(p.flaps), round3(p.trim), round3(p.elev), round3(p.ail), round3(p.rud),
			round3(p.ias), Math.round(p.rpm), round3(p.ball), round3(p.turnRate), round3(p.alpha)],
		f: [p.flapSet, p.onGround, p.stall, game.paused],
		c: [round3(ctl.pitch), round3(ctl.roll), round3(ctl.yaw), round3(ctl.brake)],
		cr: p.crashed,
		td: [round3(p.touchdown), round3(p.time - p.touchTime)],
		o: [opt.aircraft, opt.assist, opt.level, opt.open, opt.hand],
		h: [round3(camera.quaternion.x), round3(camera.quaternion.y), round3(camera.quaternion.z), round3(camera.quaternion.w)]
	};
}

// a message from a copilot: it selected a line of the options hub
function linkCommand(m) {
	if (link.role !== 'pilot' || !m || m.t !== 'c') return;
	if (typeof m.row === 'number' && m.row >= 0 && m.row <= 6) hubAction(Math.floor(m.row));
}

// ---------- copilot ----------

// become the copilot of the pilot with this code
function linkJoin(code) {
	if (!link.peer || !/^\d{6}$/.test(code)) {
		link.status = link.peer ? 'THE CODE HAS 6 DIGITS' : 'NO LIBRARY: peerjs.min.js';
		linkChanged();
		return;
	}
	link.role = 'copilot';
	link.joined = code;
	link.status = 'CONNECTING';
	link.silent = 0;
	link.seen = -1;
	try {
		localStorage.setItem('cessna.join', code);
	} catch (e) {
		// no storage
	}
	if (link.online && code === link.code) linkLeave('THIS IS YOUR OWN CODE');
	else if (link.online) linkConnect();
	linkChanged();
}

function linkConnect() {
	var conn = link.peer.connect(LINK_PREFIX + link.joined, { serialization: 'json', reliable: false });
	link.conn = conn;
	conn.on('open', function () {
		link.status = 'ON';
		link.silent = 0;
		linkChanged();
	});
	conn.on('data', linkReceive);
	conn.on('close', function () {
		if (link.conn === conn) linkLeave('THE PILOT IS GONE');
	});
}

// stop as copilot. This device flies again.
function linkLeave(text) {
	if (link.conn) {
		link.conn.close();
		link.conn = null;
	}
	if (link.role === 'copilot') {
		link.role = 'pilot';
		linkSolo();                    // main.js: your own options and a new start
	}
	link.status = text || (link.conns.length ? 'ON' : 'READY');
	linkChanged();
}

// a state message from the pilot: copy it into the flight model of this device
function linkReceive(m) {
	var p = plane;
	if (link.role !== 'copilot' || !m || m.t !== 's') return;
	// the messages can come in the incorrect sequence: ignore an old one
	if (m.k < link.seen && link.seen - m.k < 200) return;
	link.seen = m.k;
	link.silent = 0;
	if (link.status !== 'ON') {
		link.status = 'ON';
		linkChanged();
	}
	linkOptionsFrom(m.o, m.a);         // main.js: aircraft and options of the pilot
	p.start = m.st;
	p.pos.set(m.p[0], m.p[1], m.p[2]);
	p.quat.set(m.q[0], m.q[1], m.q[2], m.q[3]);
	p.vel.set(m.v[0], m.v[1], m.v[2]);
	p.omega.set(m.w[0], m.w[1], m.w[2]);
	p.thr = m.n[0];
	p.power = m.n[1];
	p.flaps = m.n[2];
	p.trim = m.n[3];
	p.elev = m.n[4];
	p.ail = m.n[5];
	p.rud = m.n[6];
	p.ias = m.n[7];
	p.rpm = m.n[8];
	p.ball = m.n[9];
	p.turnRate = m.n[10];
	p.alpha = m.n[11];
	p.flapSet = m.f[0];
	p.onGround = m.f[1];
	p.stall = m.f[2];
	game.paused = m.f[3];
	ctl.pitch = m.c[0];
	ctl.roll = m.c[1];
	ctl.yaw = m.c[2];
	ctl.brake = m.c[3];
	p.crashed = m.cr;
	p.touchdown = m.td[0];
	p.touchTime = p.time - m.td[1];
	link.head.set(m.h[0], m.h[1], m.h[2], m.h[3]).normalize();
}

// copilot: send the selection of a hub line to the pilot
function linkSelect(row) {
	if (link.conn && link.conn.open) link.conn.send({ t: 'c', row: row });
}

// copilot: between two messages the aircraft moves on with its last speed
var _lq = new THREE.Quaternion();

function linkCoast(dt) {
	var p = plane;
	if (p.crashed !== '' || game.paused) return;
	p.time += dt;
	p.pos.addScaledVector(p.vel, dt);
	_lq.set(p.omega.x * dt / 2, p.omega.y * dt / 2, p.omega.z * dt / 2, 1).normalize();
	p.quat.multiply(_lq).normalize();
}

// ---------- each frame ----------

function linkUpdate(dt) {
	var k, state;
	if (link.role === 'copilot') {
		link.silent += dt;
		if (link.silent > 15 && link.status !== 'ON' && link.status !== 'NO SIGNAL') {
			linkLeave(link.online ? 'NO ANSWER FROM THIS CODE' : 'NO CONNECTION TO THE SERVER');
			return;
		}
		if (link.silent > LINK_TIMEOUT && link.status === 'ON') {
			link.status = 'NO SIGNAL';
			linkChanged();
		}
		return;
	}
	if (link.conns.length === 0) return;
	link.time -= dt;
	if (link.time > 0) return;
	link.time = 1 / LINK_RATE;
	state = linkState();
	for (k = 0; k < link.conns.length; k++) {
		if (link.conns[k].open) link.conns[k].send(state);
	}
}
