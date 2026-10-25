import * as THREE from 'three';
import { createChunkedTerrain, elevationAt, type TerrainSite } from './chunkedTerrain';
import { SITE } from './geo';
import { createGlobe } from './globe';
import type { CancelToken } from './tiles';

// The world around the launch site, from ground level to orbit:
//   - real terrain and satellite imagery for ~700 km around the pad (the
//     Rio Grande Valley, Gulf coast and northern Mexico), sharpening from
//     ~550 m per pixel far away down to a few meters wherever the camera
//     is close (see chunkedTerrain.ts)
//   - the whole globe with clouds and atmosphere for high altitudes
// plus a sky that fades from blue to black and haze that thins with height.
//
// Usage: createEnvironment(scene, parent?), then call
// update(cameraAltitude, dt, cameraPosition) every frame and dispose() on cleanup.

export const ENVIRONMENT_CREDITS =
    'Terrain: AWS Terrain Tiles (USGS 3DEP, SRTM, GMTED, ETOPO1) · ' +
    'Imagery: Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020) · ' +
    'Globe: NASA Visible Earth';

// Zoom 8 ≈ 550 m per pixel, 5 tiles ≈ 700 km across; zoom 15 ≈ 4 m per
// pixel, the sharpest elevation there is. The pad area is leveled.
const LAUNCH_SITE: TerrainSite = {
    lat: SITE.lat, lon: SITE.lon,
    rootZoom: 8, rootTiles: 5, maxZoom: 15,
    flattenRadius: 400,
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

    // The scene puts the pad at y = 0, so terrain heights are measured from
    // the pad's own height. Terrain starts loading once that's known.
    const token: CancelToken = { cancelled: false };
    let terrain: ReturnType<typeof createChunkedTerrain> | null = null;
    elevationAt(SITE.lon, SITE.lat, LAUNCH_SITE.maxZoom, token).then(padHeight => {
        if (!token.cancelled) terrain = createChunkedTerrain({ ...LAUNCH_SITE, heightOffset: -padHeight }, group);
    });
    const cameraLocal = new THREE.Vector3();

    return {
        // `cameraPosition` is in scene coordinates
        update(altitude: number, dt: number, cameraPosition: THREE.Vector3) {
            terrain?.update(parent.worldToLocal(cameraLocal.copy(cameraPosition)));

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
            terrain?.dispose();
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
