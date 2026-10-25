import * as THREE from 'three';

// Geography helpers. The 3D scene uses meters with the launch mount at the
// origin, +y up, east = +x and north = -z. Everything here converts between
// that and latitude/longitude or web map tile numbers.

export const EARTH_RADIUS = 6_371_000;          // mean radius, m
const MERCATOR_RADIUS = 6_378_137;              // what web map tiles are built on

// Starbase orbital launch mount, Starbase, Texas
export const SITE = { lat: 25.9966, lon: -97.1567 };

const toRad = (deg: number) => deg * Math.PI / 180;


// ---------- Web map tiles ----------
// Map tiles split the world (in the Web Mercator projection) into a
// 2^zoom × 2^zoom grid of 256 px squares. Tile (0, 0) is the top-left
// (north-west) corner. Fractional results tell you where inside a tile a
// point falls.

export const TILE_SIZE = 256;

export function lonLatToTile(lon: number, lat: number, zoom: number) {
    const n = 2 ** zoom;
    const latRad = toRad(lat);
    return {
        x: (lon + 180) / 360 * n,
        y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n,
    };
}

// The reverse: tile coordinates (fractions allowed) → degrees
export function tileToLonLat(x: number, y: number, zoom: number) {
    const n = 2 ** zoom;
    return {
        lon: x / n * 360 - 180,
        lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI,
    };
}

// Real-world size of one tile pixel near `lat`. Mercator stretches things
// away from the equator, which is what the cos(lat) undoes.
export function metersPerPixel(lat: number, zoom: number) {
    return Math.cos(toRad(lat)) * 2 * Math.PI * MERCATOR_RADIUS / (TILE_SIZE * 2 ** zoom);
}


// ---------- Earth's curve ----------

// How far the ground drops below a flat plane at horizontal distance
// sqrt(x² + z²) from the origin (good approximation up to a few hundred km).
// Bending the terrain by this is what makes a horizon appear.
export function curvatureDrop(x: number, z: number) {
    return (x * x + z * z) / (2 * EARTH_RADIUS);
}

// The globe's texture puts latitude/longitude at fixed directions on the
// sphere. This rotation turns the globe so the launch site sits at the top
// (+y), with its north facing -z and east facing +x, matching the scene.
export function siteToWorldRotation(lat: number, lon: number) {
    const φ = toRad(lat);
    const λ = toRad(lon);
    // The site's local directions, written in the globe's own coordinates
    // (from how SphereGeometry lays out its UVs)
    const up = new THREE.Vector3(Math.cos(φ) * Math.cos(λ), Math.sin(φ), -Math.cos(φ) * Math.sin(λ));
    const east = new THREE.Vector3(-Math.sin(λ), 0, -Math.cos(λ));
    const north = new THREE.Vector3(-Math.sin(φ) * Math.cos(λ), Math.cos(φ), Math.sin(φ) * Math.sin(λ));

    // Map east→+x, up→+y, north→-z. For a rotation the inverse is the
    // transpose, so: world basis × (globe basis)ᵀ
    const globeBasis = new THREE.Matrix4().makeBasis(east, up, north);
    const worldBasis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1),
    );
    return new THREE.Quaternion().setFromRotationMatrix(worldBasis.multiply(globeBasis.transpose()));
}
