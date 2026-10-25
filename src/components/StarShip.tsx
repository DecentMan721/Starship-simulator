import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
    DEFAULT_FLIGHT, DEFAULT_STAGING, GRID_FIN_ANGLES,
    type ControlSurfaces, type Flight, type Staging, type TowerControls,
} from './controlSurfaces';
import { drawLaunchTower, MOUNT_HEIGHT } from './launchTower';
import { createEnvironment, ENVIRONMENT_CREDITS } from './environment';
import { EARTH_RADIUS } from './environment/geo';
import { createOceanPatch } from './environment/ocean';
import { createVehicleMarkers } from './vehicleMarkers';
import { SPLASHDOWN_DOWNRANGE, type FlightState } from '../sim/flightProfile';
import {
    BOOSTER_HEIGHT, BOOSTER_PIVOT_Y, GRID_FIN_DEPTH, GRID_FIN_Y, HSR_HEIGHT, NOSE_HEIGHT, RADIUS,
    SHIP_BODY_HEIGHT, SHIP_SKIRT, SHIP_STACKED_Y,
} from './vehicleDimensions';


interface props {
    controlSurfaces: ControlSurfaces;
    tower: TowerControls;
    // Manual staging/altitude, used only when there's no `sim`
    staging?: Staging;
    flight?: Flight;
    // When set, the flight simulator places the booster and ship and runs
    // their engines; the staging and flight controls are ignored
    sim?: FlightState | null;
    // Which vehicle the camera follows in the simulator
    follow?: 'booster' | 'ship';
    // Small screens: put the map credits in the top-left corner, where
    // they don't run into the timeline at the bottom
    creditsAtTop?: boolean;
    // Labels marking where the booster and ship are, even far away
    showMarkers?: boolean;
    // Bump this number to zoom the camera back to its starting distance
    resetView?: number;
}

// Scale: 1 unit = 1 meter. Main dimensions live in vehicleDimensions.ts.
const SEGMENTS = 48;         // radial segments, higher = rounder

// How fast surfaces chase their target angle. Higher = snappier actuators.
const ACTUATOR_SPEED = 6;
// The tower carriage moves at a steady speed like a winch (m/s, sped up
// from the real thing so you don't wait around)
const CARRIAGE_SPEED = 10;
// How quickly the ship eases to a new separation distance (like ACTUATOR_SPEED)
const SEPARATION_SPEED = 2;


// Heat tiles: hexagons roughly 30 cm across
const HEX_SIZE = 0.17;  // center to corner, in m
const HEX_COLS = 16;    // hexes across one copy of the texture
const HEX_ROWS = 16;    // must be even so the offset rows line up when it repeats
// The real-world area one copy of the hex texture covers
const HEX_TEX_W = HEX_COLS * Math.sqrt(3) * HEX_SIZE;
const HEX_TEX_H = HEX_ROWS * 1.5 * HEX_SIZE;

// Steel: the body is a stack of rings, each welded from a few sheets
const RING_HEIGHT = 1.83;     // m
const PANELS_AROUND = 4;      // vertical weld seams around each ring
// The steel texture covers 2 panels across and 2 rings tall, because the
// vertical seams are staggered from ring to ring like bricks
const PANEL_W = (2 * Math.PI * RADIUS) / PANELS_AROUND;
const PANEL_TEX_W = 2 * PANEL_W;
const PANEL_TEX_H = 2 * RING_HEIGHT;


// ---------- Textures ----------
// Both patterns are drawn with the 2D canvas API and uploaded as textures.
// Each one is drawn twice: a color image for `map`, and a black/white
// height image for `bumpMap`, where black seams/gaps read as grooves.

// Repeatable pseudo-random number in [0, 1) for a pair of integers.
// Tiles cut in half by the texture edge must get the same shade on both
// sides, so shades come from (wrapped) grid coordinates, not Math.random().
function hash(a: number, b: number) {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
}

// Modulo that stays positive for negative numbers (-1 mod 4 = 3)
function wrap(n: number, m: number) {
    return ((n % m) + m) % m;
}

// A canvas whose pixel size matches the real-world aspect ratio it covers,
// so one pixel is the same size in both directions
function makeCanvas(widthPx: number, worldW: number, worldH: number) {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = Math.round(widthPx * worldH / worldW);
    return { canvas, ctx: canvas.getContext('2d')!, pxPerMeter: widthPx / worldW };
}

function drawHexTiles() {
    const color = makeCanvas(1024, HEX_TEX_W, HEX_TEX_H);
    const height = makeCanvas(1024, HEX_TEX_W, HEX_TEX_H);
    const k = color.pxPerMeter;

    // Background shows through as the gaps between tiles
    color.ctx.fillStyle = '#050505';
    color.ctx.fillRect(0, 0, color.canvas.width, color.canvas.height);
    height.ctx.fillStyle = '#000';
    height.ctx.fillRect(0, 0, height.canvas.width, height.canvas.height);

    // Pointy-top hex grid: columns √3·size apart, rows 1.5·size apart,
    // every odd row shifted half a column. Drawing one extra row/column on
    // each side fills the tiles that hang over the edges.
    const r = HEX_SIZE * 0.93 * k; // a bit smaller than the cell to leave a gap
    for (let row = -1; row <= HEX_ROWS; row++) {
        for (let col = -1; col <= HEX_COLS; col++) {
            const cx = Math.sqrt(3) * HEX_SIZE * (col + (row & 1 ? 0.5 : 0)) * k;
            const cy = 1.5 * HEX_SIZE * row * k;

            const shade = hash(wrap(col, HEX_COLS), wrap(row, HEX_ROWS));
            // Mostly near-black with slight variation, plus the odd lighter
            // replacement tile like on the real ship
            const v = shade > 0.992 ? 48 : 10 + shade * 14;

            for (const { ctx, fill } of [
                { ctx: color.ctx, fill: `rgb(${v}, ${v}, ${v + 2})` },
                { ctx: height.ctx, fill: '#fff' },
            ]) {
                ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = Math.PI / 2 + i * Math.PI / 3; // first corner points up
                    ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
                }
                ctx.closePath();
                ctx.fillStyle = fill;
                ctx.fill();
            }
        }
    }
    return { color: color.canvas, height: height.canvas };
}

function drawSteelPanels() {
    const color = makeCanvas(2048, PANEL_TEX_W, PANEL_TEX_H);
    const height = makeCanvas(2048, PANEL_TEX_W, PANEL_TEX_H);
    const k = color.pxPerMeter;
    const seam = 2; // half the seam width in px

    // Background = weld seams
    color.ctx.fillStyle = '#8a8a8e';
    color.ctx.fillRect(0, 0, color.canvas.width, color.canvas.height);
    height.ctx.fillStyle = '#000';
    height.ctx.fillRect(0, 0, height.canvas.width, height.canvas.height);

    for (let ring = 0; ring < 2; ring++) {
        // p = -1 and 2 are the panels hanging off the edges of the
        // offset ring; they wrap round to match the other side
        for (let p = -1; p <= 2; p++) {
            const x = (p + ring * 0.5) * PANEL_W * k + seam;
            const y = ring * RING_HEIGHT * k + seam;
            const w = PANEL_W * k - seam * 2;
            const h = RING_HEIGHT * k - seam * 2;
            const id = wrap(p, 2);

            // Each sheet is a slightly different shade of steel
            const v = 215 + hash(id, ring) * 40;
            color.ctx.fillStyle = `rgb(${v}, ${v}, ${v + 3})`;
            color.ctx.fillRect(x, y, w, h);

            // Faint horizontal streaks for a rolled-steel look, clipped to the panel
            color.ctx.save();
            color.ctx.beginPath();
            color.ctx.rect(x, y, w, h);
            color.ctx.clip();
            for (let i = 0; i < 60; i++) {
                const sy = y + hash(id * 100 + i, ring) * h;
                const light = hash(i, id + ring * 7) > 0.5;
                color.ctx.fillStyle = light ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
                color.ctx.fillRect(x, sy, w, 1 + hash(i, id) * 2);
            }
            color.ctx.restore();

            height.ctx.fillStyle = '#fff';
            height.ctx.fillRect(x, y, w, h);
        }
    }
    return { color: color.canvas, height: height.canvas };
}

function makeTexture(canvas: HTMLCanvasElement, isColor: boolean, anisotropy: number) {
    const texture = new THREE.CanvasTexture(canvas);
    // Repeat instead of stretching when UVs go past 1
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Keeps the pattern sharp when seen at a glancing angle
    texture.anisotropy = anisotropy;
    // Color images are stored in sRGB, height data isn't
    if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}


// Materials are created once per scene and shared between meshes.
// MeshStandardMaterial reacts to lights, MeshBasicMaterial doesn't.
function createMaterials(anisotropy: number) {
    const hex = drawHexTiles();
    const steel = drawSteelPanels();
    return {
        steel: new THREE.MeshStandardMaterial({
            color: 0xd0d0d4, metalness: 0.9, roughness: 0.3,
            map: makeTexture(steel.color, true, anisotropy),
            bumpMap: makeTexture(steel.height, false, anisotropy),
            bumpScale: 1.5,
            // Draw both sides of each face, so you can see the inside of the
            // ship's open aft skirt from below
            side: THREE.DoubleSide,
        }),
        // For small steel parts where the panel texture would just look smeared
        steelPlain: new THREE.MeshStandardMaterial({ color: 0xc0c0c4, metalness: 0.9, roughness: 0.35 }),
        tiles: new THREE.MeshStandardMaterial({
            color: 0xffffff, metalness: 0.1, roughness: 0.8, // color comes from the map
            map: makeTexture(hex.color, true, anisotropy),
            bumpMap: makeTexture(hex.height, false, anisotropy),
            bumpScale: 2,
        }),
        engine: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.5 }),
        tower: new THREE.MeshStandardMaterial({ color: 0x5c5f66, metalness: 0.5, roughness: 0.65 }),
        // Exhaust: see-through, and not writing depth so the layers don't
        // hide each other. (Additive "glow" blending would vanish against
        // the bright daytime sky, so these use normal blending.)
        plumeOuter: new THREE.MeshBasicMaterial({
            color: 0xff8a3a, transparent: true, opacity: 0.45,
            depthWrite: false, side: THREE.DoubleSide, fog: false,
        }),
        plumeCore: new THREE.MeshBasicMaterial({
            color: 0xfff4d0, transparent: true, opacity: 0.85,
            depthWrite: false, side: THREE.DoubleSide, fog: false,
        }),
    };
}
type Materials = ReturnType<typeof createMaterials>;


// ---------- UV helpers ----------
// A geometry's UVs say which part of the texture lands where. By default
// they run 0→1 across each mesh, so a 71 m booster and a 10 m nose would
// each get one stretched copy. Rescaling them so 1 UV unit = one texture's
// real-world size makes tiles and panels the same size everywhere.

function scaleUVs(geometry: THREE.BufferGeometry, uScale: number, vScale: number, vOffset = 0) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale + vOffset);
    }
    uv.needsUpdate = true;
    return geometry;
}

// LatheGeometry sets v from the profile point index, which squashes the
// texture where the outline is steep. This sets v from the real distance
// along the outline instead. Vertices are stored segment by segment, each
// with one vertex per profile point, so index % points = which point.
function latheUVs(
    geometry: THREE.BufferGeometry,
    profile: THREE.Vector2[],
    uScale: number,
    vPeriod: number,
    vOffset: number,
) {
    const dist = [0];
    for (let j = 1; j < profile.length; j++) {
        dist.push(dist[j - 1] + profile[j].distanceTo(profile[j - 1]));
    }
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
        const j = i % profile.length;
        uv.setXY(i, uv.getX(i) * uScale, vOffset + dist[j] / vPeriod);
    }
    uv.needsUpdate = true;
    return geometry;
}

// The objects the animation loop rotates. Each one sits exactly on its
// hinge line, so rotating it swings the surface around the hinge.
// Flap arrays are [left, right].
interface Hinges {
    forwardFlaps: THREE.Object3D[];
    aftFlaps: THREE.Object3D[];
    gridFins: THREE.Object3D[];
    // Engine bells that gimbal. Their origin is the gimbal point at the top.
    boosterEngines: THREE.Object3D[];
    shipEngines: THREE.Object3D[];
}


// Places `count` copies of makeMesh() evenly in a circle of radius `r`,
// starting at `startAngle` (radians). Returns them so callers can keep
// hold of the ones they want to animate.
function addRing(
    parent: THREE.Object3D,
    count: number,
    r: number,
    y: number,
    makeMesh: () => THREE.Mesh,
    startAngle = 0,
) {
    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < count; i++) {
        const angle = startAngle + (i / count) * Math.PI * 2;
        const mesh = makeMesh();
        mesh.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
        parent.add(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

// Sea-level Raptor bells are ~1.3 m wide. Vacuum Raptors (RVac) are much
// bigger, ~2.3 m wide and longer, for efficiency in thin air.
function makeEngineBell(material: THREE.Material, exitRadius = 0.65, length = 1.5) {
    // radiusTop < radiusBottom gives a nozzle shape.
    // Shifted down so its top touches y = 0 of whatever it's added to. That
    // puts the mesh's origin at the top, which is where a real engine's
    // gimbal pivot is, so rotating the mesh tilts the bell around it.
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.4, exitRadius, length, 20), material);
    bell.geometry.translate(0, -length / 2, 0);
    return bell;
}

// Nose cone outline: radius at height y above the nose base (an ellipse)
function noseRadiusAt(y: number) {
    const t = y / NOSE_HEIGHT;
    return RADIUS * Math.sqrt(1 - t * t);
}


// ---------- Flaps ----------

// Turns a flat 2D outline into a solid plate with slightly rounded edges.
// The outline is drawn with x = outward from the hinge, y = along the hinge,
// and the plate is centered on z so the hinge runs through its middle.
// texW/texH: real-world size of the texture it will wear (tiles by default)
function extrudePlate(shape: THREE.Shape, thickness: number, texW = HEX_TEX_W, texH = HEX_TEX_H) {
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 2,
        curveSegments: 12,
    });
    geometry.translate(0, 0, -thickness / 2);
    // ExtrudeGeometry's UVs are already in meters (they're the outline's
    // x/y), so dividing by the texture size gives 1 UV unit per copy
    return scaleUVs(geometry, 1 / texW, 1 / texH);
}

// Aft flap: big plate, ~10.5 m along the body, ~4 m out.
// The top edge sweeps down and out with a rounded tip.
function aftFlapShape() {
    const s = new THREE.Shape();
    s.moveTo(0, 0);                                 // hinge, bottom
    s.lineTo(3.6, 0.6);                             // bottom edge
    s.lineTo(4.0, 6.0);                             // outer edge
    s.quadraticCurveTo(4.1, 8.2, 2.4, 9.2);         // rounded tip
    s.lineTo(0, 10.5);                              // swept top edge back to hinge
    s.closePath();
    return s;
}

// Forward flap: smaller, more swept, mostly a rounded triangle.
// rootLength is how long the hinge is, so the flap fits the curved nose.
function forwardFlapShape(rootLength: number) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(2.6, 0.5);
    s.quadraticCurveTo(3.0, 2.2, 2.0, 3.6);
    s.quadraticCurveTo(1.0, 5.0, 0, rootLength);
    s.closePath();
    return s;
}

// Builds one flap and its hinge.
//   side: 1 = right (+x), -1 = left (-x)
//   tilt: how far the hinge line leans inward from vertical (radians)
// Hierarchy: mount (position, mirroring) → tilt → hinge (animated) → mesh
function makeFlap(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    side: number,
    position: THREE.Vector3,
    tilt: number,
) {
    const mount = new THREE.Group();
    mount.position.copy(position);
    // Negative scale mirrors everything inside, so one flap shape and one
    // angle convention work for both sides. Three.js fixes up the lighting.
    mount.scale.x = side;

    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.z = tilt; // +z rotation leans local +y toward -x, i.e. inward
    mount.add(tiltGroup);

    // rotation.y on this group swings the flap around the hinge line.
    // Positive swings local +x toward -z, which is the leeward side.
    const hinge = new THREE.Group();
    tiltGroup.add(hinge);

    hinge.add(new THREE.Mesh(geometry, material));
    return { mount, hinge };
}


// ---------- Grid fins ----------

// Clips the infinite line (px, pz) + t·(dx, dz) to a rectangle.
// Returns the two endpoints inside it, or null if it misses.
// (Liang–Barsky algorithm: shrink the t range against each edge.)
function clipLine(
    px: number, pz: number, dx: number, dz: number,
    minX: number, maxX: number, minZ: number, maxZ: number,
): [number, number, number, number] | null {
    let t0 = -Infinity;
    let t1 = Infinity;
    const edges: [number, number][] = [
        [-dx, px - minX], [dx, maxX - px],
        [-dz, pz - minZ], [dz, maxZ - pz],
    ];
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null; // parallel and outside
            continue;
        }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
    }
    if (t0 > t1) return null;
    return [px + t0 * dx, pz + t0 * dz, px + t1 * dx, pz + t1 * dz];
}

// A box running from (x1, z1) to (x2, z2), `height` tall in y
function bar(x1: number, z1: number, x2: number, z2: number, thickness: number, height: number) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const g = new THREE.BoxGeometry(Math.hypot(dx, dz), height, thickness);
    g.rotateY(-Math.atan2(dz, dx));
    g.translate((x1 + x2) / 2, 0, (z1 + z2) / 2);
    return g;
}

// One grid fin as a single geometry: a rectangular frame filled with a
// diagonal lattice, plus the shaft it pivots on.
// Local axes: x = outward from the body (the shaft axis), z = across the fin,
// y = thickness (air flows through the cells along y, i.e. along the rocket).
function gridFinGeometry() {
    const span = 3.2;     // how far it sticks out
    const width = 2.6;    // across
    const depth = GRID_FIN_DEPTH; // cell depth
    const cell = 0.45;    // lattice spacing
    const halfW = width / 2;
    const parts: THREE.BufferGeometry[] = [];

    // Outer frame
    parts.push(
        bar(0, -halfW, span, -halfW, 0.12, depth),
        bar(0, halfW, span, halfW, 0.12, depth),
        bar(0, -halfW, 0, halfW, 0.2, depth),
        bar(span, -halfW, span, halfW, 0.12, depth),
    );

    // Diagonal lattice: two families of parallel lines at ±45°, each line
    // clipped to the frame. Lines are spaced `cell` apart, measured square-on.
    const reach = Math.ceil(Math.hypot(span, width) / cell);
    for (const [dx, dz] of [[Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]]) {
        for (let k = -reach; k <= reach; k++) {
            // Step sideways from the fin's center along the line's normal (-dz, dx)
            const px = span / 2 - dz * k * cell;
            const pz = dx * k * cell;
            const seg = clipLine(px, pz, dx, dz, 0, span, -halfW, halfW);
            if (!seg) continue;
            const [x1, z1, x2, z2] = seg;
            if (Math.hypot(x2 - x1, z2 - z1) < 0.05) continue; // skip slivers at corners
            parts.push(bar(x1, z1, x2, z2, 0.05, depth));
        }
    }

    // Shaft from the body to the frame, along x
    const shaft = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 12);
    shaft.rotateZ(Math.PI / 2);
    shaft.translate(-0.25, 0, 0);
    parts.push(shaft);

    // Merging means one draw call per fin instead of ~30, and one geometry
    // to dispose. The pieces aren't needed after merging.
    const merged = mergeGeometries(parts);
    parts.forEach(p => p.dispose());
    return merged;
}


// ---------- Assembly ----------

function drawShip(m: Materials, hinges: Hinges) {
    // Group origin = the bottom of the ship
    const ship = new THREE.Group();
    ship.name = 'ship';

    // How many copies of each texture fit around the body / across the shield
    const steelAround = (2 * Math.PI * RADIUS) / PANEL_TEX_W;
    const hexAcross = (Math.PI * RADIUS) / HEX_TEX_W;

    // Body. Geometry is centered on its origin, so lift it by half its height.
    // Cylinder UVs: u goes around, v goes bottom (0) to top (1).
    // openEnded (no caps): the bottom is an open skirt around the engines,
    // and the top is hidden under the nose anyway.
    const body = new THREE.Mesh(
        scaleUVs(
            new THREE.CylinderGeometry(RADIUS, RADIUS, SHIP_BODY_HEIGHT, SEGMENTS, 1, true),
            steelAround, SHIP_BODY_HEIGHT / PANEL_TEX_H,
        ),
        m.steel,
    );
    body.position.y = SHIP_BODY_HEIGHT / 2;
    ship.add(body);

    // Aft bulkhead: the flat-looking underside the engines hang from, set up
    // inside the skirt. CircleGeometry faces +z, so tip it to face down.
    const bulkhead = new THREE.Mesh(
        new THREE.CircleGeometry(RADIUS - 0.01, SEGMENTS).rotateX(Math.PI / 2),
        m.engine,
    );
    bulkhead.position.y = SHIP_SKIRT;
    ship.add(bulkhead);

    // Heat shield: a half cylinder (thetaLength = PI), slightly wider so it
    // sits on the steel. It covers the +z side (the belly).
    const shield = new THREE.Mesh(
        scaleUVs(
            new THREE.CylinderGeometry(RADIUS + 0.02, RADIUS + 0.02, SHIP_BODY_HEIGHT, SEGMENTS, 1, true, -Math.PI / 2, Math.PI),
            hexAcross, SHIP_BODY_HEIGHT / HEX_TEX_H,
        ),
        m.tiles,
    );
    shield.position.y = SHIP_BODY_HEIGHT / 2;
    ship.add(shield);

    // Nose cone: LatheGeometry spins a 2D outline (x = radius, y = height)
    // around the y axis.
    const profile: THREE.Vector2[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
        const y = (i / steps) * NOSE_HEIGHT;
        profile.push(new THREE.Vector2(noseRadiusAt(y), y));
    }
    // The v offset continues the pattern from the top of the body, so the
    // panels and tiles line up across the joint instead of restarting
    const nose = new THREE.Mesh(
        latheUVs(
            new THREE.LatheGeometry(profile, SEGMENTS),
            profile, steelAround, PANEL_TEX_H, SHIP_BODY_HEIGHT / PANEL_TEX_H,
        ),
        m.steel,
    );
    nose.position.y = SHIP_BODY_HEIGHT;
    ship.add(nose);

    // Same profile with phiLength = PI for the heat shield on the nose.
    // Its u spans the same half circle as the body's shield, so the hexes
    // get narrower toward the tip as the nose does.
    const shieldProfile = profile.map(p => new THREE.Vector2(p.x + 0.02, p.y));
    const noseShield = new THREE.Mesh(
        latheUVs(
            new THREE.LatheGeometry(shieldProfile, SEGMENTS, -Math.PI / 2, Math.PI),
            shieldProfile, hexAcross, HEX_TEX_H, SHIP_BODY_HEIGHT / HEX_TEX_H,
        ),
        m.tiles,
    );
    noseShield.position.y = SHIP_BODY_HEIGHT;
    ship.add(noseShield);

    // Flaps sit on the left/right edges of the heat shield (±x).
    // Aft hinges are vertical along the body.
    const aftGeometry = extrudePlate(aftFlapShape(), 0.3);

    // Forward hinges follow the nose: run a straight line between two points
    // on the curve and lean the hinge to match.
    const noseY1 = 0.3;
    const noseY2 = 6.3;
    const r1 = noseRadiusAt(noseY1);
    const r2 = noseRadiusAt(noseY2);
    const forwardTilt = Math.atan2(r1 - r2, noseY2 - noseY1);
    const forwardRoot = Math.hypot(r1 - r2, noseY2 - noseY1);
    const forwardGeometry = extrudePlate(forwardFlapShape(forwardRoot), 0.25);

    for (const side of [-1, 1]) { // left first, matching the [left, right] arrays
        const aft = makeFlap(aftGeometry, m.tiles, side, new THREE.Vector3(side * RADIUS, 1.5, 0), 0);
        ship.add(aft.mount);
        hinges.aftFlaps.push(aft.hinge);

        const forward = makeFlap(
            forwardGeometry, m.tiles, side,
            new THREE.Vector3(side * r1, SHIP_BODY_HEIGHT + noseY1, 0),
            forwardTilt,
        );
        ship.add(forward.mount);
        hinges.forwardFlaps.push(forward.hinge);
    }

    // 6 Raptors: 3 sea-level in the center (these gimbal), and 3 fixed
    // vacuum engines around them, rotated 60° to sit in the gaps.
    // Mounted on the bulkhead, so they're tucked inside the skirt.
    hinges.shipEngines.push(...addRing(ship, 3, 1.2, SHIP_SKIRT, () => makeEngineBell(m.engine)));
    addRing(ship, 3, 3.2, SHIP_SKIRT, () => makeEngineBell(m.engine, 1.15, 2.6), Math.PI / 3);

    return ship;
}


// Chines run along the lower booster on opposite sides (degrees around y)
const CHINE_ANGLES = [90, 270];
const CHINE_BOTTOM = 4;   // m above the booster's base
const CHINE_LENGTH = 30;

// Long, thin strip that sticks out ~0.6 m, with tapered ends.
// Starts slightly inside the body (x < 0) so there's no gap at the curve.
function chineShape() {
    const s = new THREE.Shape();
    s.moveTo(-0.1, 0);
    s.lineTo(0.6, 2.5);
    s.lineTo(0.6, CHINE_LENGTH - 2.5);
    s.lineTo(-0.1, CHINE_LENGTH);
    s.closePath();
    return s;
}

function drawBooster(m: Materials, hinges: Hinges) {
    // Group origin = the bottom of the booster
    const booster = new THREE.Group();
    booster.name = 'booster';

    const body = new THREE.Mesh(
        scaleUVs(
            new THREE.CylinderGeometry(RADIUS, RADIUS, BOOSTER_HEIGHT, SEGMENTS),
            (2 * Math.PI * RADIUS) / PANEL_TEX_W, BOOSTER_HEIGHT / PANEL_TEX_H,
        ),
        [m.steel, m.engine, m.engine], // side, top cap, bottom cap
    );
    body.position.y = BOOSTER_HEIGHT / 2;
    booster.add(body);

    // Grid fins near the top. Hierarchy: mount (placed on the body, turned
    // so local +x points outward) → hinge (rotation.x spins the fin on its
    // shaft) → mesh. All fins share one geometry.
    const finGeometry = gridFinGeometry();
    for (const deg of GRID_FIN_ANGLES) {
        const angle = THREE.MathUtils.degToRad(deg);
        const mount = new THREE.Group();
        const r = RADIUS + 0.5; // leave room for the shaft
        mount.position.set(Math.cos(angle) * r, GRID_FIN_Y, Math.sin(angle) * r);
        // Rotating by -angle about y turns local +x toward (cos, 0, sin)
        mount.rotation.y = -angle;
        booster.add(mount);

        const hinge = new THREE.Group();
        mount.add(hinge);
        hinge.add(new THREE.Mesh(finGeometry, m.engine));
        hinges.gridFins.push(hinge);
    }

    // Chines: two long, thin strakes down opposite sides of the lower
    // booster. Fixed, so each is just a plate turned to stick out radially.
    const chineGeometry = extrudePlate(chineShape(), 0.3, PANEL_TEX_W, PANEL_TEX_H);
    for (const deg of CHINE_ANGLES) {
        const angle = THREE.MathUtils.degToRad(deg);
        const chine = new THREE.Mesh(chineGeometry, m.steel);
        chine.position.set(Math.cos(angle) * RADIUS, CHINE_BOTTOM, Math.sin(angle) * RADIUS);
        chine.rotation.y = -angle; // local +x (the plate's outward edge) points away from the body
        booster.add(chine);
    }

    // 33 Raptors: 3 center + 10 inner ring gimbal, the 20 outer ring are fixed
    hinges.boosterEngines.push(
        ...addRing(booster, 3, 0.9, 0, () => makeEngineBell(m.engine)),
        ...addRing(booster, 10, 2.4, 0, () => makeEngineBell(m.engine)),
    );
    addRing(booster, 20, 3.8, 0, () => makeEngineBell(m.engine));

    return booster;
}


// Hot-staging ring: an open cage on top of the booster. At staging the
// ship lights its engines while still attached, and the exhaust escapes
// through these vents before the two push apart. It stays with the booster.
// Origin = bottom of the ring.
function drawHotStageRing(m: Materials) {
    const ring = new THREE.Group();
    const band = 0.3;   // height of the solid bands top and bottom
    const vents = 24;

    // Top and bottom bands: thin flat rings (a circle with a hole) extruded
    // upward, the same way as the launch mount's table
    const outline = new THREE.Shape();
    outline.absarc(0, 0, RADIUS, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, RADIUS - 0.25, 0, Math.PI * 2, true);
    outline.holes.push(hole);
    const bandGeometry = new THREE.ExtrudeGeometry(outline, { depth: band, bevelEnabled: false, curveSegments: SEGMENTS })
        .rotateX(-Math.PI / 2);
    for (const y of [0, HSR_HEIGHT - band]) {
        const b = new THREE.Mesh(bandGeometry, m.steelPlain);
        b.position.y = y;
        ring.add(b);
    }

    // Struts between the vents, slanted like the real ring's angled vents.
    // Each box is built at the origin, tilted, turned to face outward, then
    // moved out to the wall. All merged into one geometry.
    const strutHeight = HSR_HEIGHT - band * 2;
    const struts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < vents; i++) {
        const a = (i / vents) * Math.PI * 2;
        const g = new THREE.BoxGeometry(0.25, strutHeight, 0.45); // x = radial, z = around
        g.rotateX(0.35);       // lean sideways (tilts +y toward the around direction)
        g.rotateY(-a);         // local x → pointing out at angle a
        g.translate(Math.cos(a) * (RADIUS - 0.125), band + strutHeight / 2, Math.sin(a) * (RADIUS - 0.125));
        struts.push(g);
    }
    ring.add(new THREE.Mesh(mergeGeometries(struts), m.steelPlain));
    struts.forEach(s => s.dispose());

    return ring;
}


// Engine exhaust: a glowing outer cone that widens, around a bright core
// that tapers. Built 1 m long with its top at the engines; scale.y sets the
// length, scale.x/z how much it spreads.
function makePlume(m: Materials, radius: number) {
    const plume = new THREE.Group();
    const outer = new THREE.CylinderGeometry(radius, radius * 1.6, 1, 24, 1, true).translate(0, -0.5, 0);
    const core = new THREE.CylinderGeometry(radius * 0.75, radius * 0.2, 1, 24, 1, true).translate(0, -0.5, 0);
    // Drawn after everything else see-through (terrain patches, clouds), or
    // those would paint over the flames when they're behind them
    for (const mesh of [new THREE.Mesh(outer, m.plumeOuter), new THREE.Mesh(core, m.plumeCore)]) {
        mesh.renderOrder = 10;
        plume.add(mesh);
    }
    plume.visible = false;
    return plume;
}

// Shows a plume for the given throttle (0–1). In thin air the exhaust
// balloons out wide; near the ground the air pressure squeezes it narrow.
function updatePlume(plume: THREE.Object3D, throttle: number, altitude: number, length: number) {
    plume.visible = throttle > 0.01;
    if (!plume.visible) return;
    const flicker = 0.92 + Math.random() * 0.16;
    const spread = 1 + 1.2 * THREE.MathUtils.smoothstep(altitude, 15_000, 80_000);
    plume.scale.set(spread, length * Math.sqrt(throttle) * flicker * (1 + spread * 0.3), spread);
}

interface Vehicle {
    stack: THREE.Group;          // the whole vehicle; telemetry moves this
    booster: THREE.Object3D;     // rotate to flip the booster around its center of mass
    ship: THREE.Object3D;        // move position.y to separate
    plumes: { booster: THREE.Object3D; ship: THREE.Object3D };
}

function drawStarShip(m: Materials, hinges: Hinges): Vehicle {
    // The full stack. Moving/rotating this group moves everything inside it.
    // Booster and ship are separate sub-groups so they can come apart.
    const stack = new THREE.Group();

    // The booster hangs from a pivot at its center of mass, so rotating the
    // pivot flips it the way the real one does for boostback
    const boosterPivot = new THREE.Group();
    boosterPivot.position.y = BOOSTER_PIVOT_Y;
    stack.add(boosterPivot);

    const booster = drawBooster(m, hinges);
    booster.position.y = -BOOSTER_PIVOT_Y;
    boosterPivot.add(booster);

    const hsr = drawHotStageRing(m);
    hsr.position.y = BOOSTER_HEIGHT;
    booster.add(hsr); // part of the booster, so it leaves with it

    const ship = drawShip(m, hinges);
    ship.position.y = SHIP_STACKED_Y;
    stack.add(ship);

    // Plumes start just below the engine bells
    const boosterPlume = makePlume(m, RADIUS * 0.85);
    boosterPlume.position.y = -1.5;
    booster.add(boosterPlume);
    const shipPlume = makePlume(m, RADIUS * 0.6);
    ship.add(shipPlume);

    return { stack, booster: boosterPivot, ship, plumes: { booster: boosterPlume, ship: shipPlume } };
}


// Eases a hinge toward its target angle at a framerate-independent rate
function driveHinge(hinge: THREE.Object3D, axis: 'x' | 'y' | 'z', targetDeg: number, dt: number) {
    const target = THREE.MathUtils.degToRad(targetDeg);
    hinge.rotation[axis] = THREE.MathUtils.damp(hinge.rotation[axis], target, ACTUATOR_SPEED, dt);
}

const EARTH_CENTER = new THREE.Vector3(0, -EARTH_RADIUS, 0);

// Places a vehicle part from a simulator pose: `base` is where the vehicle's
// base is, `along` how far up its axis this part's origin sits. Pitch tilts
// from straight up toward +x, which is a negative rotation about z. Roll
// spins it about its own long axis first (order 'ZYX' = roll about y is
// applied before the pitch about z).
function placeAlongAxis(
    obj: THREE.Object3D,
    base: { x: number; y: number; pitch: number; roll: number },
    along: number,
) {
    const a = THREE.MathUtils.degToRad(base.pitch);
    obj.position.set(base.x + Math.sin(a) * along, base.y + Math.cos(a) * along, 0);
    obj.rotation.order = 'ZYX';
    obj.rotation.set(0, THREE.MathUtils.degToRad(base.roll), -a);
}

// Angle around Earth's center from the pad to a point, in the x/y plane
// (0 at the pad, growing as you go east around the planet)
function angleAroundEarth(p: THREE.Vector3) {
    return Math.atan2(p.x, p.y + EARTH_RADIUS);
}

// Moves `current` toward `target` by at most speed·dt, so it travels at a
// constant speed and stops exactly on target
function moveToward(current: number, target: number, speed: number, dt: number) {
    const step = speed * dt;
    if (Math.abs(target - current) <= step) return target;
    return current + Math.sign(target - current) * step;
}


export default function StarShip({
    controlSurfaces,
    tower,
    staging = DEFAULT_STAGING,
    flight = DEFAULT_FLIGHT,
    sim = null,
    follow = 'booster',
    creditsAtTop = false,
    showMarkers = false,
    resetView = 0,
}: props){
    const mountRef = useRef<HTMLDivElement>(null);

    // The animation loop reads angles from this ref. Keeping them out of the
    // scene effect's dependencies means changing an angle doesn't rebuild
    // the whole scene, it just moves the surface on the next frame.
    const surfacesRef = useRef(controlSurfaces);
    useEffect(() => {
        surfacesRef.current = controlSurfaces;
    }, [controlSurfaces]);

    const towerRef = useRef(tower);
    useEffect(() => {
        towerRef.current = tower;
    }, [tower]);

    const stagingRef = useRef(staging);
    useEffect(() => {
        stagingRef.current = staging;
    }, [staging]);

    const flightRef = useRef(flight);
    useEffect(() => {
        flightRef.current = flight;
    }, [flight]);

    const simRef = useRef(sim);
    const followRef = useRef(follow);
    useEffect(() => {
        simRef.current = sim;
        followRef.current = follow;
    }, [sim, follow]);

    const showMarkersRef = useRef(showMarkers);
    const resetViewRef = useRef(resetView);
    useEffect(() => {
        showMarkersRef.current = showMarkers;
        resetViewRef.current = resetView;
    }, [showMarkers, resetView]);

    useEffect(() => {
        const mount = mountRef.current;
        if (!mount) return;

        const scene = new THREE.Scene();

        // The far plane has to reach the whole Earth from orbit (1e8 m)
        // while the near plane still shows bolts on the rocket (0.1 m)
        const camera = new THREE.PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.1,
            1e8
        );
        camera.position.set(170, 90, 150);

        // A normal depth buffer can't tell 0.1 m apart from 100,000 km, so
        // distant things flicker through each other. The logarithmic one
        // spreads its precision evenly across that whole range.
        const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        mount.appendChild(renderer.domElement);

        // Metal is mostly reflection, so with nothing to reflect it looks black.
        // RoomEnvironment is a built-in fake studio that gives it something to reflect.
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environment = envMap;

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 0.3));
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(50, 100, 80);
        scene.add(sun);

        // Terrain, sky, globe. Also takes over scene.background and scene.fog.
        // Everything on or around the Earth lives in this group. When the
        // camera follows the ship around the planet, the group turns about
        // Earth's center so the ship's local "up" stays up on screen;
        // otherwise you'd be watching it upside down over the Indian Ocean.
        const world = new THREE.Group();
        scene.add(world);

        const environment = createEnvironment(scene, world);

        // Open sea at the ship's splashdown point, only shown up close
        const ocean = createOceanPatch(SPLASHDOWN_DOWNRANGE);
        world.add(ocean);

        const materials = createMaterials(renderer.capabilities.getMaxAnisotropy());
        const hinges: Hinges = {
            forwardFlaps: [], aftFlaps: [], gridFins: [], boosterEngines: [], shipEngines: [],
        };
        const vehicle = drawStarShip(materials, hinges);
        // Standing on the launch mount. Telemetry altitude will add to this.
        vehicle.stack.position.y = MOUNT_HEIGHT;
        world.add(vehicle.stack);

        // The tower is added to the scene, not the stack, so it stays put
        // when the rocket moves
        const launchTower = drawLaunchTower(materials.tower, {
            vehicleRadius: RADIUS,
            qdHeight: MOUNT_HEIGHT + SHIP_STACKED_Y + 4, // just above the ship's base
        });
        launchTower.carriage.position.y = towerRef.current.carriageHeight;
        world.add(launchTower.group);

        // Drag to orbit, scroll to zoom, right-drag to pan
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 70, -10); // between the rocket and the tower
        controls.enableDamping = true; // smooth slowdown after dragging
        controls.update();

        // Where the camera-follow target was last frame
        const followPoint = vehicle.stack.position.clone();
        const followDelta = new THREE.Vector3();
        const followTarget = new THREE.Vector3();

        // Reset zoom: the starting view, as offsets from the followed vehicle
        // (recorded on the first frame), and whether we're easing back to it
        let defaultView: { target: THREE.Vector3; distance: number } | null = null;
        let handledReset = resetViewRef.current;
        let resetting = false;
        const resetTarget = new THREE.Vector3();
        const viewDirection = new THREE.Vector3();
        // Grabbing the view mid-reset hands control straight back
        controls.addEventListener('start', () => { resetting = false; });

        const markers = createVehicleMarkers(mount, [
            { label: 'SUPER HEAVY', color: '#ffb347' },
            { label: 'STARSHIP', color: '#8fd3ff' },
        ]);
        // The middle of each vehicle: the booster's pivot is its center of
        // mass; the ship's origin is at its base
        const SHIP_CENTER = new THREE.Vector3(0, (SHIP_BODY_HEIGHT + NOSE_HEIGHT) / 2, 0);
        const markerPositions = [new THREE.Vector3(), new THREE.Vector3()];

        let lastTime = performance.now();
        renderer.setAnimationLoop(() => {
            // Seconds since the last frame, so motion speed doesn't depend on FPS
            const now = performance.now();
            const dt = (now - lastTime) / 1000;
            lastTime = now;

            const s = surfacesRef.current;
            hinges.forwardFlaps.forEach((h, i) => driveHinge(h, 'y', s.forwardFlaps[i], dt));
            hinges.aftFlaps.forEach((h, i) => driveHinge(h, 'y', s.aftFlaps[i], dt));
            hinges.gridFins.forEach((h, i) => driveHinge(h, 'x', s.gridFins[i] ?? 0, dt));

            // Every engine in a group follows the same command
            for (const [engines, gimbal] of [
                [hinges.boosterEngines, s.boosterGimbal],
                [hinges.shipEngines, s.shipGimbal],
            ] as const) {
                for (const e of engines) {
                    driveHinge(e, 'x', gimbal.pitch, dt);
                    driveHinge(e, 'z', gimbal.yaw, dt);
                }
            }

            const t = towerRef.current;
            launchTower.carriage.position.y = moveToward(
                launchTower.carriage.position.y, t.carriageHeight, CARRIAGE_SPEED, dt,
            );
            launchTower.chopsticks.forEach((h, i) => driveHinge(h, 'y', t.chopsticks[i], dt));
            driveHinge(launchTower.qdArm, 'y', t.qdArm, dt);

            const simState = simRef.current;
            if (simState) {
                // Simulator: put each vehicle exactly where the flight
                // profile says. It gives the base position; the booster's
                // pivot sits further up its (tilted) axis, and so does the
                // ship's base when stacked.
                vehicle.stack.position.set(0, 0, 0);
                placeAlongAxis(vehicle.booster, simState.booster, BOOSTER_PIVOT_Y);
                placeAlongAxis(vehicle.ship, simState.ship, SHIP_STACKED_Y);
                updatePlume(vehicle.plumes.booster, simState.booster.throttle, simState.booster.altitude, 45);
                updatePlume(vehicle.plumes.ship, simState.ship.throttle, simState.ship.altitude, 30);
            } else {
                // Undo anything the simulator moved
                vehicle.booster.position.set(0, BOOSTER_PIVOT_Y, 0);
                vehicle.booster.rotation.z = 0;
                vehicle.ship.position.x = 0;
                vehicle.ship.rotation.y = 0;
                vehicle.ship.rotation.z = 0;
                vehicle.plumes.booster.visible = false;
                vehicle.plumes.ship.visible = false;

                // Staging: the ship slides away along the stack's axis, and the
                // booster flips around its center of mass
                const st = stagingRef.current;
                vehicle.ship.position.y = THREE.MathUtils.damp(
                    vehicle.ship.position.y, SHIP_STACKED_Y + st.separation, SEPARATION_SPEED, dt,
                );
                driveHinge(vehicle.booster, 'x', st.boosterFlip, dt);

                // Altitude: lift the whole stack
                vehicle.stack.position.y = THREE.MathUtils.damp(
                    vehicle.stack.position.y, MOUNT_HEIGHT + flightRef.current.altitude, SEPARATION_SPEED, dt,
                );
            }

            const followed = simState
                ? (followRef.current === 'ship' ? vehicle.ship : vehicle.booster)
                : vehicle.stack;

            // Turn the world about Earth's center by the followed object's
            // angle around the planet, eased so switching vehicles swings
            // the view smoothly. Rotating about a point = rotate, then shift
            // so that point ends up back where it was.
            // atan2 jumps from +180° to -180° on the far side of the planet
            // (splashdown is ~194° around), so ease along the shortest way
            // to the new angle instead of swinging the whole world back
            // around the long way. The angle itself is allowed past ±180°.
            const goal = angleAroundEarth(followed.position);
            const turn = THREE.MathUtils.euclideanModulo(goal - world.rotation.z + Math.PI, 2 * Math.PI) - Math.PI;
            const angle = THREE.MathUtils.damp(world.rotation.z, world.rotation.z + turn, 4, dt);
            world.rotation.z = angle;
            world.position.set(-EARTH_RADIUS * Math.sin(angle), -EARTH_RADIUS + EARTH_RADIUS * Math.cos(angle), 0);
            world.updateMatrixWorld(true);

            // Camera follow: move the camera and its orbit target by however
            // far the followed object moved on screen, so you keep your
            // viewing angle and can still orbit around it
            const target = followed.getWorldPosition(followTarget);
            const moved = followDelta.subVectors(target, followPoint);
            camera.position.add(moved);
            controls.target.add(moved);
            followPoint.copy(target);

            defaultView ??= {
                target: controls.target.clone().sub(followPoint),
                distance: camera.position.distanceTo(controls.target),
            };
            if (resetViewRef.current !== handledReset) {
                handledReset = resetViewRef.current;
                resetting = true;
            }
            if (resetting) {
                // Ease the orbit point back onto the vehicle and the distance
                // back to the start, keeping the viewing angle. The distance
                // eases in log space so zooming in from orbit doesn't take
                // forever on the last few hundred meters.
                resetTarget.copy(followPoint).add(defaultView.target);
                viewDirection.subVectors(camera.position, controls.target).normalize();
                const distance = Math.exp(THREE.MathUtils.damp(
                    Math.log(camera.position.distanceTo(controls.target)), Math.log(defaultView.distance), 6, dt,
                ));
                controls.target.lerp(resetTarget, 1 - Math.exp(-6 * dt));
                camera.position.copy(controls.target).addScaledVector(viewDirection, distance);
                if (Math.abs(distance / defaultView.distance - 1) < 0.01 && controls.target.distanceTo(resetTarget) < 0.5) {
                    resetting = false;
                }
            }

            // What the world looks like depends on how high the camera is
            // above the (curved) ground. Earth's center doesn't move when
            // the world turns, since it turns about that point.
            const cameraAltitude = camera.position.distanceTo(EARTH_CENTER) - EARTH_RADIUS;
            environment.update(cameraAltitude, dt, camera.position);
            ocean.visible = cameraAltitude < 50_000;

            controls.update(); // needed every frame when damping is on
            renderer.render(scene, camera);

            vehicle.booster.getWorldPosition(markerPositions[0]);
            vehicle.ship.localToWorld(markerPositions[1].copy(SHIP_CENTER));
            markers.update(camera, markerPositions, showMarkersRef.current, 'STARSHIP + SUPER HEAVY');
        });

        const handleResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            renderer.setAnimationLoop(null);
            controls.dispose();
            markers.dispose();
            environment.dispose();
            ocean.traverse(obj => {
                if (obj instanceof THREE.Mesh) (obj.material as THREE.Material).dispose();
            });

            // GPU memory isn't garbage collected, so free every geometry.
            // Shared geometries get disposed more than once, which is harmless.
            scene.traverse(obj => {
                if (obj instanceof THREE.Mesh) obj.geometry.dispose();
            });
            Object.values(materials).forEach(mat => {
                mat.map?.dispose();
                if ("bumpMap" in mat) mat.bumpMap?.dispose();
                mat.dispose();
            });
            envMap.dispose();
            pmrem.dispose();

            renderer.dispose();
            mount.removeChild(renderer.domElement);
        };
    }, []);

    return(
        <>
            <div ref={mountRef} />
            {/* The map data licenses require crediting the sources on screen */}
            <div style={{
                position: "fixed",
                ...(creditsAtTop
                    ? { left: 8, top: 6, width: "45vw", textAlign: "left" as const }
                    : { left: "50%", transform: "translateX(-50%)", bottom: 2, width: "90vw", textAlign: "center" as const }),
                color: "rgba(255, 255, 255, 0.7)",
                fontFamily: "sans-serif",
                fontSize: 9,
                textShadow: "0 0 3px #000",
                pointerEvents: "none",
            }}>
                {ENVIRONMENT_CREDITS}
            </div>
        </>
    )
}
