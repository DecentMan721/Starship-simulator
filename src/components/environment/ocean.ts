import * as THREE from 'three';
import { EARTH_RADIUS, curvatureDrop } from './geo';

// A patch of open sea at a point far downrange (the ship's splashdown), for
// close-up views where the coarse globe would look like a blurry blue
// sphere sitting a few hundred meters too low.
//
// `downrange` is measured along the surface heading east from the pad, the
// same way the flight profile measures it.

export function createOceanPatch(downrange: number, radius = 150_000) {
    // Anchor at Earth's center and turn toward the spot, so the patch sits
    // on top of the globe there, with its center at sea level
    const anchor = new THREE.Group();
    anchor.position.set(0, -EARTH_RADIUS, 0);
    anchor.rotation.z = -downrange / EARTH_RADIUS; // turns +y toward +x by that angle

    // A flat disc with rings of vertices out from the center, then bent
    // down by Earth's curve. Built around its own center (not Earth's) so
    // the numbers stay small and precise.
    const geometry = new THREE.RingGeometry(1, radius, 128, 48).rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        pos.setY(i, -curvatureDrop(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    // Low roughness so it picks up a sheen from the environment lighting
    const sea = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x0b3a5a, roughness: 0.25, metalness: 0 }),
    );
    sea.position.y = EARTH_RADIUS;
    anchor.add(sea);
    return anchor;
}
