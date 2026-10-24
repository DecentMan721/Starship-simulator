import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// "Mechazilla": the Starbase launch tower, the carriage that rides up and
// down it carrying the two "chopstick" catch arms, the ship quick-disconnect
// (QD) arm, and the orbital launch mount (OLM) the booster stands on.
// Scale: 1 unit = 1 meter. y = 0 is the ground, the rocket's axis is x = z = 0.

export const MOUNT_HEIGHT = 20;              // top of the launch mount, where the booster sits

const TOWER_W = 12;                          // square tower, 12 m a side
const TOWER_HEIGHT = 135;                    // steel structure; lightning rod goes on top
const TOWER_Z = -22;                         // tower center. It stands on the -z side,
const TOWER_FACE_Z = TOWER_Z + TOWER_W / 2;  // so this is the face toward the rocket

const CARRIAGE_W = TOWER_W + 2;              // the carriage wraps around the tower
const CARRIAGE_H = 6;

const ARM_LENGTH = 35;
const ARM_W = 2.5;
const ARM_H = 4;
// Top of the rail on each arm, above the carriage's middle. The booster's
// grid fins come to rest on this when it's caught.
export const CHOPSTICK_RAIL_TOP = ARM_H / 2 + 0.5;


// Everything the animation loop moves. Chopsticks are [left, right].
export interface TowerParts {
    group: THREE.Group;
    carriage: THREE.Object3D;      // move position.y
    chopsticks: THREE.Object3D[];  // rotate rotation.y
    qdArm: THREE.Object3D;         // rotate rotation.y
}


// ---------- Truss building blocks ----------

// A square bar from point a to point b. BoxGeometry is built along y,
// so rotate y onto the a→b direction and move it to the midpoint.
function bar3(a: THREE.Vector3, b: THREE.Vector3, thickness: number) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const geometry = new THREE.BoxGeometry(thickness, dir.length(), thickness);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const middle = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    geometry.applyMatrix4(new THREE.Matrix4().compose(middle, rotation, new THREE.Vector3(1, 1, 1)));
    return geometry;
}

interface TrussOptions {
    length: number;   // along +z
    width: number;    // x, centered
    height: number;   // y, centered
    bay: number;      // spacing between cross frames
    chord: number;    // thickness of the 4 long corner members
    brace: number;    // thickness of the cross members and diagonals
    xBrace?: boolean; // X in every panel instead of a zig-zag
}

// A rectangular lattice beam: 4 long chords at the corners, a rectangular
// frame every `bay` meters, and diagonals on all 4 faces. The tower,
// carriage and arms are all this same shape at different sizes.
// Merged into one geometry because it's hundreds of bars.
function trussGeometry(o: TrussOptions) {
    const hw = o.width / 2;
    const hh = o.height / 2;
    const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const at = (c: [number, number], z: number) => new THREE.Vector3(c[0], c[1], z);
    const parts: THREE.BufferGeometry[] = [];

    for (const c of corners) {
        parts.push(bar3(at(c, 0), at(c, o.length), o.chord));
    }

    const bays = Math.max(1, Math.round(o.length / o.bay));
    const step = o.length / bays;
    for (let i = 0; i <= bays; i++) {
        for (let k = 0; k < 4; k++) {
            parts.push(bar3(at(corners[k], i * step), at(corners[(k + 1) % 4], i * step), o.brace));
        }
    }

    for (let i = 0; i < bays; i++) {
        const z0 = i * step;
        const z1 = z0 + step;
        for (let k = 0; k < 4; k++) {
            const a = corners[k];
            const b = corners[(k + 1) % 4];
            // Zig-zag flips direction every bay; X-bracing does both
            if (o.xBrace || i % 2 === 0) parts.push(bar3(at(a, z0), at(b, z1), o.brace));
            if (o.xBrace || i % 2 === 1) parts.push(bar3(at(b, z0), at(a, z1), o.brace));
        }
    }

    const merged = mergeGeometries(parts);
    parts.forEach(p => p.dispose());
    return merged;
}

// The same truss standing upright: rotating -90° about x turns +z into +y
function verticalTruss(o: TrussOptions) {
    return trussGeometry(o).rotateX(-Math.PI / 2);
}


// ---------- Parts ----------

function drawLaunchMount(material: THREE.Material) {
    const mount = new THREE.Group();
    const ringThickness = 2.5;

    // Ring table: a flat annulus (a circle with a hole cut out) extruded
    // upward. The hole lets the booster's engines fire through.
    const ring = new THREE.Shape();
    ring.absarc(0, 0, 8.5, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 4.9, 0, Math.PI * 2, true);
    ring.holes.push(hole);
    const table = new THREE.Mesh(
        new THREE.ExtrudeGeometry(ring, { depth: ringThickness, bevelEnabled: false, curveSegments: 48 })
            .rotateX(-Math.PI / 2),
        material,
    );
    table.position.y = MOUNT_HEIGHT - ringThickness;
    mount.add(table);

    // 6 legs
    const legHeight = MOUNT_HEIGHT - ringThickness;
    const legGeometry = new THREE.BoxGeometry(1.6, legHeight, 1.6);
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const leg = new THREE.Mesh(legGeometry, material);
        leg.position.set(Math.cos(a) * 7, legHeight / 2, Math.sin(a) * 7);
        mount.add(leg);
    }

    // 20 hold-down clamps around the booster's base
    const clampGeometry = new THREE.BoxGeometry(0.8, 1.2, 0.6);
    for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const clamp = new THREE.Mesh(clampGeometry, material);
        clamp.position.set(Math.cos(a) * 5.2, MOUNT_HEIGHT + 0.6, Math.sin(a) * 5.2);
        clamp.rotation.y = -a;
        mount.add(clamp);
    }
    return mount;
}

// Carriage + chopsticks. The carriage's origin is its middle, so its
// position.y is the height of the arms.
function drawCarriage(material: THREE.Material, vehicleRadius: number) {
    const carriage = new THREE.Group();
    carriage.position.set(0, MOUNT_HEIGHT + 20, TOWER_Z);

    const frame = new THREE.Mesh(
        verticalTruss({
            length: CARRIAGE_H, width: CARRIAGE_W, height: CARRIAGE_W,
            bay: CARRIAGE_H, chord: 0.6, brace: 0.3, xBrace: true,
        }).translate(0, -CARRIAGE_H / 2, 0),
        material,
    );
    carriage.add(frame);

    // Each arm runs along local +z from its pivot. A rail along the top
    // inner edge is what the booster's catch pins ride on.
    const armGeometry = mergeGeometries([
        trussGeometry({ length: ARM_LENGTH, width: ARM_W, height: ARM_H, bay: 2.5, chord: 0.35, brace: 0.18 }),
        bar3(
            new THREE.Vector3(-ARM_W / 2 + 0.3, ARM_H / 2 + 0.25, 1),
            new THREE.Vector3(-ARM_W / 2 + 0.3, ARM_H / 2 + 0.25, ARM_LENGTH - 0.5),
            0.5,
        ),
    ]);
    const pinGeometry = new THREE.CylinderGeometry(0.6, 0.6, ARM_H + 1.5, 16);

    // Pivots sit on the carriage's front face, spaced so the closed arms
    // just clear the booster
    const pivotX = vehicleRadius + 0.3 + ARM_W / 2;
    const pivotZ = CARRIAGE_W / 2;
    const chopsticks: THREE.Object3D[] = [];

    for (const side of [-1, 1]) { // left first, matching [left, right]
        const pin = new THREE.Mesh(pinGeometry, material);
        pin.position.set(side * pivotX, 0, pivotZ);
        carriage.add(pin);

        // Same mirroring trick as the flaps: scale.x = -1 on the left means
        // a positive angle opens both arms outward
        const mount = new THREE.Group();
        mount.position.set(side * pivotX, 0, pivotZ);
        mount.scale.x = side;
        carriage.add(mount);

        // 0° = closed, pointing straight at the rocket.
        // rotation.y > 0 swings +z toward +x, i.e. outward.
        const hinge = new THREE.Group();
        mount.add(hinge);
        hinge.add(new THREE.Mesh(armGeometry, material));
        chopsticks.push(hinge);
    }

    return { carriage, chopsticks };
}

// Ship QD arm: pivots on the tower's front-left corner. 0° = reaching the
// ship, positive = swinging back to fold flat against the tower face.
function drawQdArm(material: THREE.Material, vehicleRadius: number, height: number) {
    const pivot = new THREE.Vector3(-TOWER_W / 2, height, TOWER_FACE_Z + 1.2);
    // Aim at the side of the ship nearest the tower
    const dx = 0 - pivot.x;
    const dz = -(vehicleRadius + 0.2) - pivot.z;
    const length = Math.hypot(dx, dz);

    const mount = new THREE.Group();
    mount.position.copy(pivot);
    mount.rotation.y = Math.atan2(dx, dz); // turns local +z toward the ship

    const hinge = new THREE.Group();
    mount.add(hinge);

    const arm = new THREE.Mesh(
        mergeGeometries([
            trussGeometry({ length: length - 1, width: 2, height: 2.5, bay: 2, chord: 0.3, brace: 0.15 }),
            // The hood that clamps onto the ship's QD plate
            new THREE.BoxGeometry(2.6, 3.2, 1).translate(0, 0, length - 0.5),
        ]),
        material,
    );
    hinge.add(arm);
    return { mount, hinge };
}


export function drawLaunchTower(
    material: THREE.Material,
    opts: { vehicleRadius: number; qdHeight: number },
): TowerParts {
    const group = new THREE.Group();
    group.name = 'launchTower';

    const tower = new THREE.Mesh(
        verticalTruss({
            length: TOWER_HEIGHT, width: TOWER_W, height: TOWER_W,
            bay: 7.5, chord: 1.2, brace: 0.35, xBrace: true,
        }),
        material,
    );
    tower.position.z = TOWER_Z;
    group.add(tower);

    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 12, 8), material);
    rod.position.set(0, TOWER_HEIGHT + 6, TOWER_Z);
    group.add(rod);

    group.add(drawLaunchMount(material));

    const { carriage, chopsticks } = drawCarriage(material, opts.vehicleRadius);
    group.add(carriage);

    const qd = drawQdArm(material, opts.vehicleRadius, opts.qdHeight);
    group.add(qd.mount);

    return { group, carriage, chopsticks, qdArm: qd.hinge };
}
