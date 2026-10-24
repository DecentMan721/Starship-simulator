import * as THREE from 'three';
import { createGlobe } from './globe';
import { buildTerrainPatch, type PatchOptions } from './terrainPatch';
import type { CancelToken } from './tiles';

// The world around the launch site, from ground level to orbit:
//   - a detailed local patch (~22 km) of real terrain and satellite imagery
//   - a regional patch (~700 km) of the Rio Grande Valley, Gulf coast and
//     northern Mexico, bent by Earth's curve so a horizon appears as you climb
//   - the whole globe with clouds and atmosphere for high altitudes
// plus a sky that fades from blue to black and haze that thins with height.
//
// Usage: createEnvironment(scene, parent?), then call update(cameraAltitude, dt)
// every frame and dispose() on cleanup.

export const ENVIRONMENT_CREDITS =
    'Terrain: AWS Terrain Tiles (USGS 3DEP, SRTM, GMTED, ETOPO1) · ' +
    'Imagery: Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020) · ' +
    'Globe: NASA Visible Earth';

// Draw order for transparent layers: globe (opaque) → regional → local → clouds → atmosphere
// Zoom 13 ≈ 17 m per elevation pixel; imagery one level sharper (≈ 9 m)
const LOCAL: PatchOptions = {
    zoom: 13, tilesAcross: 5, imageryZoomOffset: 1, segments: 384,
    flattenRadius: 400, fadeEdge: true, renderOrder: 2,
};
// Zoom 8 ≈ 550 m per pixel, 5 tiles ≈ 700 km. Sits a few meters below the
// local patch so the two never fight over the same depth.
const REGIONAL: PatchOptions = {
    zoom: 8, tilesAcross: 5, imageryZoomOffset: 1, segments: 256,
    fadeEdge: true, yOffset: -5, renderOrder: 1,
};

const SKY_GROUND = new THREE.Color(0x8db8e8);
const SKY_HIGH = new THREE.Color(0x0b1633);   // deep blue in the upper atmosphere
const SKY_SPACE = new THREE.Color(0x000000);


// `parent` is what the terrain and globe are added to (default: the scene);
// the scene itself is still where the sky color and haze are set.
export function createEnvironment(scene: THREE.Scene, parent: THREE.Object3D = scene) {
    const group = new THREE.Group();
    group.name = 'environment';
    parent.add(group);

    const globe = createGlobe();
    group.add(globe.group);

    // Haze: fades distant terrain into the sky color near the ground
    const fog = new THREE.Fog(SKY_GROUND, 15_000, 300_000);
    scene.fog = fog;
    const sky = new THREE.Color();
    scene.background = sky;

    // Patches download in the background and appear when ready
    const token: CancelToken = { cancelled: false };
    for (const options of [LOCAL, REGIONAL]) {
        buildTerrainPatch(options, token).then(mesh => {
            if (mesh && !token.cancelled) group.add(mesh);
        });
    }

    return {
        update(altitude: number, dt: number) {
            // Sky: blue → deep blue by 30 km → black by 100 km
            const t1 = THREE.MathUtils.smoothstep(altitude, 0, 30_000);
            const t2 = THREE.MathUtils.smoothstep(altitude, 30_000, 100_000);
            sky.copy(SKY_GROUND).lerp(SKY_HIGH, t1).lerp(SKY_SPACE, t2);

            // Haze thins out with height: push the fog distances out
            // exponentially until it has no effect above ~40 km
            const thin = THREE.MathUtils.smoothstep(altitude, 2_000, 40_000);
            fog.color.copy(sky);
            fog.near = 15_000 * Math.pow(1e5, thin);
            fog.far = 300_000 * Math.pow(1e5, thin);

            globe.update(altitude, dt);
        },

        dispose() {
            token.cancelled = true;
            group.traverse(obj => {
                if (obj instanceof THREE.Mesh) {
                    obj.geometry.dispose();
                    const material = obj.material as THREE.Material & { map?: THREE.Texture; alphaMap?: THREE.Texture };
                    material.map?.dispose();
                    material.alphaMap?.dispose();
                    material.dispose();
                }
            });
            parent.remove(group);
            scene.fog = null;
        },
    };
}
