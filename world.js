// world.js - the island, the airports, the sky.
// Classic script. It uses THREE from three.min.js.
// Units are meters. North is -z. East is +x. Sea level is y = 0.
//
// flight.js uses groundAt() and surfaceAt().
// main.js calls makeHeights() and makeWorld() one time, and updateWorld() each frame.
//
// Order of this file:
//   constants, math, heights, colors, terrain mesh, runways, lights,
//   trees and buildings, clouds, sky, update.

// ---------- constants ----------

var SIZE = 32000;        // side of the terrain square
var GRID = 256;          // cells on each side
var CELL = SIZE / GRID;  // 125 m
var HALF = SIZE / 2;
var VOLC_X = 8500;       // volcano center
var VOLC_Z = 3500;
var FOG_COLOR = 0xc4d8e4;
var SKY_COLOR = 0x4f86c0;
var SEA_COLOR = 0x2d6485;
var SUN_DIR = new THREE.Vector3(-0.45, 0.72, 0.53).normalize();

// hdg: direction of the landing, in degrees. len, wid: runway size.
// dep: direction of the takeoff. 1 = the same as the landing, -1 = opposite.
// SIERRA is a mountain strip: you land in the direction of the mountain and take off away from it.
var AIRPORTS = [
	{ name: 'VALLE', x: -3500, z: 0, elev: 40, hdg: 90, len: 1200, wid: 23, dep: 1 },
	{ name: 'COSTA', x: -10200, z: 6800, elev: 5, hdg: 340, len: 800, wid: 18, dep: 1 },
	{ name: 'SIERRA', x: 6800, z: -2000, elev: 790, hdg: 80, len: 650, wid: 15, dep: -1 }
];

var heights = new Float32Array((GRID + 1) * (GRID + 1));
var mapCanvas = null;    // small picture of the island for the map screen
var world = {};          // the meshes that updateWorld() moves

// ---------- math ----------

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function smooth(t) {
	return t * t * (3 - 2 * t);
}

function approach(v, target, step) {
	if (v < target) return Math.min(v + step, target);
	return Math.max(v - step, target);
}

function hash(x, z) {
	var s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
	return s - Math.floor(s);
}

function noise(x, z) {
	var xi = Math.floor(x), zi = Math.floor(z);
	var u = smooth(x - xi), v = smooth(z - zi);
	var a = hash(xi, zi), b = hash(xi + 1, zi);
	var c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// the result is between 0 and 0.94
function fbm(x, z) {
	return noise(x, z) * 0.5 + noise(x * 2, z * 2) * 0.25 + noise(x * 4, z * 4) * 0.125 + noise(x * 8, z * 8) * 0.0625;
}

// random numbers with a seed, thus the island is the same on each load
function makeRandom(seed) {
	return function () {
		seed = (seed + 0x6D2B79F5) | 0;
		var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ---------- airports: local axes ----------

// distance along the runway (0 = middle, + = in the direction of hdg)
function apAlong(ap, x, z) {
	var r = ap.hdg * Math.PI / 180;
	return (x - ap.x) * Math.sin(r) - (z - ap.z) * Math.cos(r);
}

// distance across the runway (+ = right of the direction of hdg)
function apAcross(ap, x, z) {
	var r = ap.hdg * Math.PI / 180;
	return (x - ap.x) * Math.cos(r) + (z - ap.z) * Math.sin(r);
}

// world point from runway axes. The result goes into out (a Vector3).
function apPoint(ap, along, across, out) {
	var r = ap.hdg * Math.PI / 180;
	out.x = ap.x + along * Math.sin(r) + across * Math.cos(r);
	out.z = ap.z - along * Math.cos(r) + across * Math.sin(r);
	out.y = ap.elev;
	return out;
}

// 1 on the flat airport area, 0 at 1500 m from it
function flatWeight(ap, x, z) {
	var da = Math.max(0, Math.abs(apAlong(ap, x, z)) - (ap.len / 2 + 350));
	var dc = Math.max(0, Math.abs(apAcross(ap, x, z)) - 280);
	var d = Math.sqrt(da * da + dc * dc);
	return 1 - smooth(clamp(d / 1500, 0, 1));
}

// ---------- heights ----------

// the island before the airports are made flat
function rawHeight(x, z) {
	var d = Math.sqrt(x * x + z * z);
	var ang = Math.atan2(z, x);
	var edge = 12800 + 1500 * Math.sin(ang * 3 + 1) + 800 * Math.sin(ang * 5 + 2.5);
	var land = 1 - smooth(clamp((d - edge + 3000) / 3000, 0, 1));

	// lowland with small hills
	var h = 30 + 60 * fbm(x / 5000 + 3, z / 5000 + 7) + 40 * (fbm(x / 1100 + 9, z / 1100 + 4) - 0.47);

	// mountains in the north-east half
	var m = smooth(clamp((x * 0.8 - z * 0.5 - 2000) / 7000, 0, 1));
	var f = fbm(x / 6500 + 11, z / 6500 + 5) / 0.9375;
	var ridge = 1 - Math.abs(2 * f - 1);
	h += m * (200 + 1100 * ridge * ridge + 300 * fbm(x / 1700 + 2, z / 1700 + 8));

	// volcano with a crater
	var dx = x - VOLC_X, dz = z - VOLC_Z;
	var dv = Math.sqrt(dx * dx + dz * dz);
	h += 1500 * Math.pow(clamp(1 - dv / 5500, 0, 1), 1.7);
	if (dv < 600) h -= 220 * smooth(1 - dv / 600);

	h = h * land - 40 * (1 - land);
	return h;
}

function makeHeights() {
	var i, j, k, x, z, h, w;
	for (j = 0; j <= GRID; j++) {
		for (i = 0; i <= GRID; i++) {
			x = i * CELL - HALF;
			z = j * CELL - HALF;
			h = rawHeight(x, z);
			for (k = 0; k < AIRPORTS.length; k++) {
				w = flatWeight(AIRPORTS[k], x, z);
				h = h + (AIRPORTS[k].elev - h) * w;
			}
			if (h < 0) h = Math.max(h * 3, -60);   // steep sea floor: less depth noise at the shore
			heights[j * (GRID + 1) + i] = h;
		}
	}
}

// height of the terrain mesh at (x, z). It is the same triangle math as the mesh.
function terrainAt(x, z) {
	var gx = clamp((x + HALF) / CELL, 0, GRID - 0.0001);
	var gz = clamp((z + HALF) / CELL, 0, GRID - 0.0001);
	var i = Math.floor(gx), j = Math.floor(gz);
	var u = gx - i, v = gz - j;
	var n = GRID + 1;
	var a = heights[j * n + i], b = heights[j * n + i + 1];
	var c = heights[(j + 1) * n + i], d = heights[(j + 1) * n + i + 1];
	if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
	return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

// height of the surface below an object: terrain or sea
function groundAt(x, z) {
	return Math.max(0, terrainAt(x, z));
}

// 0 = runway or apron, 1 = grass, 2 = water
function surfaceAt(x, z) {
	var k, ap, al, ac;
	for (k = 0; k < AIRPORTS.length; k++) {
		ap = AIRPORTS[k];
		al = apAlong(ap, x, z);
		ac = apAcross(ap, x, z);
		if (Math.abs(al) <= ap.len / 2 && Math.abs(ac) <= ap.wid / 2) return 0;
		if (Math.abs(al) <= 120 && ac <= -ap.wid / 2 && ac >= -135) return 0;
	}
	if (terrainAt(x, z) <= 0) return 2;
	return 1;
}

// ---------- colors ----------

var _c1 = new THREE.Color();
var _c2 = new THREE.Color();
var FIELD_COLORS = [0x6f8f4a, 0x86a052, 0x9aa35c, 0x7d9a50, 0xa39a62, 0x5f8446];

// color of the ground at a grid point. slope = height change / distance.
function groundColor(x, z, h, slope, out) {
	var n = fbm(x / 900 + 5, z / 900 + 1);
	if (h < 4) {
		out.setHex(0xcdbb8c);                       // sand
	} else if (h < 160 && slope < 0.09) {
		// farm fields: patches of 375 m
		var px = Math.floor(x / 375), pz = Math.floor(z / 375);
		out.setHex(FIELD_COLORS[Math.floor(hash(px, pz) * FIELD_COLORS.length)]);
		out.lerp(_c2.setHex(0x55793f), n * 0.5);
	} else {
		out.setHex(0x4c7438);                       // forest
		out.lerp(_c2.setHex(0x345a2c), n);
	}
	if (h >= 4 && h < 9) out.lerp(_c2.setHex(0xcdbb8c), (9 - h) / 5);
	var rock = clamp((slope - 0.38) / 0.25, 0, 1);
	out.lerp(_c2.setHex(0x7b766a), rock);
	var high = clamp((h - 1250) / 500, 0, 1);
	out.lerp(_c2.setHex(0x5c5650), high);          // dark volcanic rock
	return out;
}

function slopeAt(i, j) {
	var n = GRID + 1;
	var i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, GRID);
	var j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, GRID);
	var sx = (heights[j * n + i1] - heights[j * n + i0]) / ((i1 - i0) * CELL);
	var sz = (heights[j1 * n + i] - heights[j0 * n + i]) / ((j1 - j0) * CELL);
	return Math.sqrt(sx * sx + sz * sz);
}

// ---------- textures ----------

function canvasTexture(canvas) {
	var t = new THREE.CanvasTexture(canvas);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}

// gray noise. It gives the ground a visible texture when you fly low.
function makeDetailTexture() {
	var c = document.createElement('canvas');
	c.width = 256;
	c.height = 256;
	var g = c.getContext('2d');
	var img = g.createImageData(256, 256);
	var rnd = makeRandom(7);
	var x, y, v, k;
	for (y = 0; y < 256; y++) {
		for (x = 0; x < 256; x++) {
			// the noise repeats at 256, thus the texture has no visible edges
			v = 0.5 * tileNoise(x / 32, y / 32, 8) + 0.3 * tileNoise(x / 8, y / 8, 32) + 0.2 * rnd();
			v = 200 + 55 * v;
			k = (y * 256 + x) * 4;
			img.data[k] = v;
			img.data[k + 1] = v;
			img.data[k + 2] = v;
			img.data[k + 3] = 255;
		}
	}
	g.putImageData(img, 0, 0);
	var t = canvasTexture(c);
	t.wrapS = THREE.RepeatWrapping;
	t.wrapT = THREE.RepeatWrapping;
	return t;
}

// noise that repeats after 'period' cells
function tileNoise(x, z, period) {
	var xi = Math.floor(x), zi = Math.floor(z);
	var u = smooth(x - xi), v = smooth(z - zi);
	var x0 = xi % period, x1 = (xi + 1) % period;
	var z0 = zi % period, z1 = (zi + 1) % period;
	var a = hash(x0, z0), b = hash(x1, z0), c = hash(x0, z1), d = hash(x1, z1);
	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------- terrain mesh ----------

function makeTerrain(scene) {
	var n = GRID + 1;
	var pos = new Float32Array(n * n * 3);
	var col = new Float32Array(n * n * 3);
	var uv = new Float32Array(n * n * 2);
	var idx = new Uint32Array(GRID * GRID * 6);
	var i, j, k, x, z, h, a, b, c, d;

	// the map picture gets the same colors
	mapCanvas = document.createElement('canvas');
	mapCanvas.width = n;
	mapCanvas.height = n;
	var mg = mapCanvas.getContext('2d');
	var img = mg.createImageData(n, n);
	var shade;

	for (j = 0; j < n; j++) {
		for (i = 0; i < n; i++) {
			k = j * n + i;
			x = i * CELL - HALF;
			z = j * CELL - HALF;
			h = heights[k];
			pos[k * 3] = x;
			pos[k * 3 + 1] = h;
			pos[k * 3 + 2] = z;
			uv[k * 2] = x / 180;
			uv[k * 2 + 1] = z / 180;
			groundColor(x, z, h, slopeAt(i, j), _c1);
			col[k * 3] = _c1.r;
			col[k * 3 + 1] = _c1.g;
			col[k * 3 + 2] = _c1.b;

			if (h <= 0) _c1.setHex(SEA_COLOR);
			shade = 1;
			if (h > 0 && i > 0) shade = clamp(1 + (h - heights[k - 1]) / 160, 0.6, 1.35);
			_c2.copy(_c1).convertLinearToSRGB();
			img.data[k * 4] = clamp(_c2.r * 255 * shade, 0, 255);
			img.data[k * 4 + 1] = clamp(_c2.g * 255 * shade, 0, 255);
			img.data[k * 4 + 2] = clamp(_c2.b * 255 * shade, 0, 255);
			img.data[k * 4 + 3] = 255;
		}
	}
	mg.putImageData(img, 0, 0);

	// two triangles for each cell. The diagonal is b-c, the same as in terrainAt().
	k = 0;
	for (j = 0; j < GRID; j++) {
		for (i = 0; i < GRID; i++) {
			a = j * n + i;
			b = a + 1;
			c = a + n;
			d = c + 1;
			idx[k++] = a; idx[k++] = c; idx[k++] = b;
			idx[k++] = b; idx[k++] = c; idx[k++] = d;
		}
	}

	var geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	geo.setIndex(new THREE.BufferAttribute(idx, 1));
	geo.computeVertexNormals();
	var mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeDetailTexture() });
	scene.add(new THREE.Mesh(geo, mat));

	// the sea
	var sea = new THREE.Mesh(
		new THREE.PlaneGeometry(240000, 240000),
		new THREE.MeshLambertMaterial({ color: SEA_COLOR })
	);
	sea.rotation.x = -Math.PI / 2;
	scene.add(sea);
}

// ---------- runways ----------

// a flat rectangle on the airport, given in runway axes
function apQuad(ap, a0, a1, c0, c1, mat, order) {
	var p = new THREE.Vector3();
	var pos = [], k;
	var corners = [[a0, c0], [a1, c0], [a0, c1], [a1, c1]];
	for (k = 0; k < 4; k++) {
		apPoint(ap, corners[k][0], corners[k][1], p);
		pos.push(p.x, p.y, p.z);
	}
	var geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
	geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
	// u = along the runway, v = 1 at the left edge
	geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
	geo.setIndex([0, 2, 1, 2, 3, 1]);       // the top side is the front side
	// the quad is in the same plane as the flat terrain. The offset puts it in front.
	mat.polygonOffset = true;
	mat.polygonOffsetFactor = -2 * order;
	mat.polygonOffsetUnits = -8 * order;
	mat.side = THREE.DoubleSide;
	var mesh = new THREE.Mesh(geo, mat);
	mesh.renderOrder = order;
	return mesh;
}

// the runway picture: asphalt, lines, numbers. 1 canvas unit = 1 m after the scale.
function makeRunwayTexture(ap) {
	var c = document.createElement('canvas');
	c.width = 4096;
	c.height = 128;
	var g = c.getContext('2d');
	var rnd = makeRandom(ap.len);
	var L = ap.len, W = ap.wid;
	var i, x, y, s, w;

	g.fillStyle = '#3d3f42';
	g.fillRect(0, 0, c.width, c.height);
	for (i = 0; i < 9000; i++) {
		s = 40 + Math.floor(rnd() * 45);
		g.fillStyle = 'rgb(' + s + ',' + s + ',' + (s + 3) + ')';
		g.fillRect(rnd() * c.width, rnd() * c.height, 2 + rnd() * 10, 1 + rnd() * 2);
	}
	// dark tire marks in the two touchdown areas
	g.fillStyle = 'rgba(20,20,20,0.25)';
	g.fillRect(c.width * 0.12, c.height * 0.3, c.width * 0.2, c.height * 0.4);
	g.fillRect(c.width * 0.68, c.height * 0.3, c.width * 0.2, c.height * 0.4);

	g.scale(c.width / L, c.height / W);
	g.fillStyle = '#e8e8e2';
	g.fillRect(0, 0.6, L, 0.8);                    // edge lines
	g.fillRect(0, W - 1.4, L, 0.8);
	for (x = 75; x < L - 100; x += 60) {
		g.fillRect(x, W / 2 - 0.45, 30, 0.9);      // center line
	}
	w = (W - 5) / 15;                               // threshold bars
	for (i = 0; i < 8; i++) {
		y = 2.5 + i * 2 * w;
		g.fillRect(6, y, 30, w);
		g.fillRect(L - 36, y, 30, w);
	}
	if (L >= 1000) {                                // aiming point marks
		g.fillRect(300, W / 2 - 7.5, 45, 4);
		g.fillRect(300, W / 2 + 3.5, 45, 4);
		g.fillRect(L - 345, W / 2 - 7.5, 45, 4);
		g.fillRect(L - 345, W / 2 + 3.5, 45, 4);
	}
	// the numbers. The pilot reads them in the direction of the landing.
	var n1 = Math.round(ap.hdg / 10) % 36;
	var n2 = (n1 + 18) % 36;
	if (n1 === 0) n1 = 36;
	if (n2 === 0) n2 = 36;
	s = W * 0.5;
	g.font = 'bold ' + s + 'px sans-serif';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.save();
	g.translate(42 + s / 2, W / 2);
	g.rotate(Math.PI / 2);
	g.fillText((n1 < 10 ? '0' : '') + n1, 0, 0);
	g.restore();
	g.save();
	g.translate(L - 42 - s / 2, W / 2);
	g.rotate(-Math.PI / 2);
	g.fillText((n2 < 10 ? '0' : '') + n2, 0, 0);
	g.restore();
	return canvasTexture(c);
}

function makeAirports(scene) {
	var k, ap;
	var apron = new THREE.MeshLambertMaterial({ color: 0x55585c });
	for (k = 0; k < AIRPORTS.length; k++) {
		ap = AIRPORTS[k];
		scene.add(apQuad(ap, -ap.len / 2, ap.len / 2, -ap.wid / 2, ap.wid / 2,
			new THREE.MeshLambertMaterial({ map: makeRunwayTexture(ap) }), 2));
		// apron and taxiway on the left side
		scene.add(apQuad(ap, -120, 120, -135, -65, apron.clone(), 1));
		scene.add(apQuad(ap, -8, 8, -65, -ap.wid / 2, apron.clone(), 1));
	}
}

// ---------- lights ----------

// runway edge lights and PAPI lights are points with a constant size on the screen
function makeLights(scene) {
	var pos = [], col = [];
	var p = new THREE.Vector3();
	var k, ap, a, e, s;
	world.papi = [];

	function light(ap, along, across, r, g, b) {
		apPoint(ap, along, across, p);
		pos.push(p.x, p.y + 0.5, p.z);
		col.push(r, g, b);
		return pos.length / 3 - 1;
	}

	for (k = 0; k < AIRPORTS.length; k++) {
		ap = AIRPORTS[k];
		for (a = -ap.len / 2; a <= ap.len / 2 + 1; a += 50) {
			light(ap, a, -ap.wid / 2 - 2, 1, 1, 0.8);
			light(ap, a, ap.wid / 2 + 2, 1, 1, 0.8);
		}
		for (a = -ap.wid / 2; a <= ap.wid / 2 + 0.1; a += ap.wid / 6) {
			light(ap, -ap.len / 2 - 3, a, 0.2, 1, 0.3);    // green: start of the runway
			light(ap, ap.len / 2 + 3, a, 1, 0.15, 0.1);    // red: end of the runway
		}
		// PAPI: 4 lights on the left side, for a landing in the direction of hdg.
		// light 0 is the nearest to the runway.
		for (e = 0; e < 4; e++) {
			s = light(ap, -ap.len / 2 + 250, -ap.wid / 2 - 12 - e * 8, 1, 1, 1);
			world.papi.push({ ap: ap, index: s, x: p.x, z: p.z, limit: 3.5 - e * 0.33 });
		}
	}
	var geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
	geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
	var mat = new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true });
	world.lights = new THREE.Points(geo, mat);
	world.lights.frustumCulled = false;
	scene.add(world.lights);
}

// PAPI: 2 white + 2 red = you are on the 3 degree path. More red = too low.
function updatePapi(px, py, pz) {
	var col = world.lights.geometry.attributes.color;
	var k, l, d, ang;
	for (k = 0; k < world.papi.length; k++) {
		l = world.papi[k];
		d = Math.sqrt((px - l.x) * (px - l.x) + (pz - l.z) * (pz - l.z));
		ang = Math.atan2(py - l.ap.elev, d) * 180 / Math.PI;
		if (ang > l.limit) col.setXYZ(l.index, 1, 1, 1);
		else col.setXYZ(l.index, 1, 0.08, 0.05);
	}
	col.needsUpdate = true;
}

// ---------- trees and buildings ----------

function makeTrees(scene) {
	var rnd = makeRandom(11);
	var geo = new THREE.ConeGeometry(4, 11, 6);
	geo.translate(0, 5.5, 0);
	var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
	var m = new THREE.Matrix4();
	var q = new THREE.Quaternion();
	var s = new THREE.Vector3();
	var p = new THREE.Vector3();
	var k, i, ap, mesh, n, x, z, h, al, ac, r, ang, tries, sc, j, bad;

	// one group of trees for each airport, thus the far groups are not drawn
	for (k = 0; k < AIRPORTS.length; k++) {
		ap = AIRPORTS[k];
		mesh = new THREE.InstancedMesh(geo, mat, 3200);
		n = 0;
		tries = 0;
		while (n < 3200 && tries < 40000) {
			tries++;
			r = 150 + 3300 * Math.sqrt(rnd());
			ang = rnd() * Math.PI * 2;
			x = ap.x + r * Math.cos(ang);
			z = ap.z + r * Math.sin(ang);
			h = terrainAt(x, z);
			if (h < 2.5) continue;
			al = apAlong(ap, x, z);
			ac = apAcross(ap, x, z);
			// keep the runway, the approach paths and the apron clear
			if (Math.abs(ac) < 55 && Math.abs(al) < ap.len / 2 + 900) continue;
			if (ac > -190 && ac < 0 && Math.abs(al) < 200) continue;
			// more trees in groups
			if (fbm(x / 500 + 20, z / 500 + 30) < 0.4 && rnd() < 0.8) continue;
			sc = 0.7 + rnd() * 0.9;
			p.set(x, h - 0.3, z);
			s.set(sc, sc * (0.8 + rnd() * 0.5), sc);
			m.compose(p, q, s);
			mesh.setMatrixAt(n, m);
			_c1.setHex(0x2f5a2a).lerp(_c2.setHex(0x4f7a35), rnd());
			mesh.setColorAt(n, _c1);
			n++;
		}
		mesh.count = n;
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		scene.add(mesh);
	}

	// buildings: hangars and a tower at each airport, and a town north of VALLE
	var box = new THREE.BoxGeometry(1, 1, 1);
	box.translate(0, 0.5, 0);
	var houses = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), 700);
	var wall = [0xd9d2c0, 0xc9b99a, 0xb8c0c4, 0xcfa98a, 0xe2ddd0, 0xa9b3a0];
	n = 0;

	function building(x, y, z, w, hgt, dp, rot, color) {
		p.set(x, y, z);
		q.setFromAxisAngle(s.set(0, 1, 0), rot);
		s.set(w, hgt, dp);
		m.compose(p, q, s);
		houses.setMatrixAt(n, m);
		houses.setColorAt(n, _c1.setHex(color));
		n++;
	}

	for (k = 0; k < AIRPORTS.length; k++) {
		ap = AIRPORTS[k];
		r = -ap.hdg * Math.PI / 180;
		for (i = -1; i <= 1; i++) {
			apPoint(ap, i * 70, -160, p);
			building(p.x, ap.elev, p.z, 26, 9, 32, r, 0xb9bec2);
		}
		apPoint(ap, 150, -150, p);
		building(p.x, ap.elev, p.z, 7, 20, 7, r, 0xd8d8d2);
		apPoint(ap, 150, -150, p);
		building(p.x, ap.elev + 20, p.z, 10, 4, 10, r, 0x4a5a66);
	}
	// the town: streets of 40 m
	ap = AIRPORTS[0];
	for (i = 0; i < 520; i++) {
		x = ap.x + Math.round((-900 + rnd() * 2600) / 40) * 40 + 8;
		z = ap.z + Math.round((-2400 + rnd() * 1300) / 40) * 40 + 8;
		h = terrainAt(x, z);
		if (h < 3 || Math.abs(apAcross(ap, x, z)) < 330) continue;
		j = rnd();
		building(x, h - 0.5, z, 10 + rnd() * 12, j < 0.08 ? 14 + rnd() * 16 : 4 + rnd() * 5, 9 + rnd() * 10, 0,
			wall[Math.floor(rnd() * wall.length)]);
	}
	// some farms
	for (i = 0; i < 90; i++) {
		x = (rnd() - 0.5) * 22000;
		z = (rnd() - 0.5) * 22000;
		h = terrainAt(x, z);
		bad = h < 6 || h > 300;
		for (k = 0; k < AIRPORTS.length; k++) {
			if (flatWeight(AIRPORTS[k], x, z) > 0.98) bad = true;
		}
		if (bad) continue;
		building(x, h - 0.5, z, 14, 6, 22, rnd() * 3, 0xb5694f);
	}
	houses.count = n;
	houses.instanceMatrix.needsUpdate = true;
	houses.frustumCulled = false;
	scene.add(houses);
}

// ---------- clouds ----------

function makeClouds(scene) {
	var rnd = makeRandom(5);
	var geo = new THREE.IcosahedronGeometry(1, 1);
	var mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a8f96 });
	var mesh = new THREE.InstancedMesh(geo, mat, 600);
	var m = new THREE.Matrix4();
	var q = new THREE.Quaternion();
	var s = new THREE.Vector3();
	var p = new THREE.Vector3();
	var n = 0, i, j, cx, cy, cz, size, puffs;
	for (i = 0; i < 80; i++) {
		cx = (rnd() - 0.5) * 44000;
		cz = (rnd() - 0.5) * 44000;
		cy = 1500 + rnd() * 900;
		size = 250 + rnd() * 400;
		puffs = 5 + Math.floor(rnd() * 3);
		for (j = 0; j < puffs; j++) {
			p.set(cx + (rnd() - 0.5) * size * 2.4, cy + rnd() * size * 0.25, cz + (rnd() - 0.5) * size * 1.6);
			s.set(size * (0.6 + rnd() * 0.6), size * (0.22 + rnd() * 0.16), size * (0.5 + rnd() * 0.5));
			m.compose(p, q, s);
			mesh.setMatrixAt(n++, m);
		}
	}
	mesh.count = n;
	mesh.instanceMatrix.needsUpdate = true;
	mesh.frustumCulled = false;
	scene.add(mesh);
}

// ---------- sky ----------

function makeSky(scene) {
	// a large ball around the camera. The color changes from the horizon to the top.
	var geo = new THREE.SphereGeometry(27000, 24, 16);
	var pos = geo.attributes.position;
	var col = new Float32Array(pos.count * 3);
	var i, t;
	for (i = 0; i < pos.count; i++) {
		t = clamp(pos.getY(i) / 27000, 0, 1);
		_c1.setHex(FOG_COLOR).lerp(_c2.setHex(SKY_COLOR), Math.pow(t, 0.55));
		col[i * 3] = _c1.r;
		col[i * 3 + 1] = _c1.g;
		col[i * 3 + 2] = _c1.b;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	world.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
		vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false
	}));
	world.sky.renderOrder = -10;
	world.sky.frustumCulled = false;
	scene.add(world.sky);

	var sun = new THREE.Mesh(
		new THREE.CircleGeometry(700, 24),
		new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false, depthWrite: false })
	);
	sun.position.copy(SUN_DIR).multiplyScalar(26000);
	sun.lookAt(0, 0, 0);
	sun.renderOrder = -9;
	world.sky.add(sun);

	scene.fog = new THREE.Fog(FOG_COLOR, 2500, 26000);
	scene.background = new THREE.Color(FOG_COLOR);
	scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x8f8b76, 1.5));
	var light = new THREE.DirectionalLight(0xfff3dd, 2.3);
	light.position.copy(SUN_DIR);
	scene.add(light);
}

// ---------- make and update ----------

function makeWorld(scene) {
	makeSky(scene);
	makeTerrain(scene);
	makeAirports(scene);
	makeLights(scene);
	makeTrees(scene);
	makeClouds(scene);
}

var papiTime = 0;

// (x, y, z) is the position of the airplane
function updateWorld(dt, x, y, z) {
	world.sky.position.set(x, 0, z);
	papiTime += dt;
	if (papiTime > 0.1) {
		papiTime = 0;
		updatePapi(x, y, z);
	}
}
