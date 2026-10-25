import * as THREE from 'three';
import { EARTH_RADIUS, SITE, TILE_SIZE, lonLatToTile, metersPerPixel, siteToWorldRotation, tileToLonLat } from './geo';
import { fetchElevation, fetchImagery, type CancelToken } from './tiles';

// Terrain around a site that gets sharper where the camera is looking from.
//
// The ground is split into chunks, one per web map tile, arranged as a
// quadtree: a chunk at zoom z can be replaced by its four children at
// z + 1, each covering a quarter of it with the same number of vertices
// and pixels, so twice the detail. Every frame, starting from a block of
// coarse root chunks around the site, needsMoreDetail() decides which
// chunks are close enough to the camera to split. A chunk stays on screen
// until all four of its children have loaded, so splitting never leaves a
// hole, and chunks no one has needed for a while are thrown away.
//
// Chunks are placed on the real sphere (not a flat sheet bent down), so
// they line up with each other and with the globe at any distance. Each
// one gets a short "skirt" hanging down from its edges, which hides the
// thin cracks where a chunk meets a neighbor drawn at a different detail.

export interface TerrainSite {
    lat: number;
    lon: number;
    rootZoom: number;        // zoom of the coarsest chunks
    rootTiles: number;       // root block is this many tiles across (odd, so the site is in the middle one)
    maxZoom: number;         // sharpest chunks (elevation tiles stop at 15)
    flattenRadius?: number;  // level the ground to the pad height this close to the scene origin, m
    heightOffset?: number;   // added to every height (the scene puts the pad, not sea level, at y = 0)
}

const SEGMENTS = 32;          // grid squares per chunk side (8 elevation pixels each; closer up, sharper chunks take over)
const DETAIL_DISTANCE = 1.5;  // split when the camera is closer than this many chunk widths
const MAX_IMAGERY_ZOOM = 16;  // imagery is one zoom sharper than elevation, up to this
const MAX_LOADING = 6;        // chunks downloading at once; the nearest ones go first
const CACHE_SIZE = 250;       // loaded chunks kept around before the oldest unused ones go
const SKIRT = 0.02;           // skirt depth as a fraction of the chunk width
const GIVE_UP_AFTER = 2000;   // ms; downloads not needed for this long are abandoned

// The globe's orientation, which turns latitude/longitude into scene
// directions with the pad on top (see globe.ts)
const GLOBE_ROTATION = siteToWorldRotation(SITE.lat, SITE.lon);

// Scene position of a point at `radius` from Earth's center
function toScene(lon: number, lat: number, radius: number, out: THREE.Vector3) {
    const φ = THREE.MathUtils.degToRad(lat);
    const λ = THREE.MathUtils.degToRad(lon);
    out.set(Math.cos(φ) * Math.cos(λ), Math.sin(φ), -Math.cos(φ) * Math.sin(λ));
    out.multiplyScalar(radius).applyQuaternion(GLOBE_ROTATION);
    out.y -= EARTH_RADIUS; // Earth's center is straight below the pad
    return out;
}

// Reads the height grid between pixels by blending the 4 nearest values
function sampleBilinear(heights: Float32Array, size: number, gx: number, gy: number) {
    const x = THREE.MathUtils.clamp(gx, 0, size - 1.001);
    const y = THREE.MathUtils.clamp(gy, 0, size - 1.001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * size + x0;
    const top = heights[i] * (1 - fx) + heights[i + 1] * fx;
    const bottom = heights[i + size] * (1 - fx) + heights[i + size + 1] * fx;
    return top * (1 - fy) + bottom * fy;
}

// Ground height at a spot, from the elevation tile at `zoom` that covers it
export async function elevationAt(lon: number, lat: number, zoom: number, token: CancelToken) {
    const t = lonLatToTile(lon, lat, zoom);
    const { heights, size } = await fetchElevation(zoom, Math.floor(t.x), Math.floor(t.y), 1, token);
    return Math.max(0, sampleBilinear(heights, size, (t.x % 1) * size - 0.5, (t.y % 1) * size - 0.5));
}

interface Chunk {
    z: number;
    x: number;
    y: number;
    center: THREE.Vector3;  // scene position of the tile's middle at sea level
    size: number;           // width, m
    children?: Chunk[];
    state: 'waiting' | 'loading' | 'ready';
    mesh?: THREE.Mesh;
    token: CancelToken;
    lastUsed: number;       // frame it was last needed
    lastNeededAt: number;   // the same as a time (ms), for giving up on downloads
}

// Whether the camera is close enough to `chunk` that it should be replaced
// by its four sharper children. "Close" scales with the chunk's size, so
// each zoom level hands over to the next at the same apparent size on
// screen, and only the chunks near the camera end up at full detail.
export function needsMoreDetail(chunk: Pick<Chunk, 'z' | 'center' | 'size'>, camera: THREE.Vector3, maxZoom: number) {
    if (chunk.z >= maxZoom) return false;
    const radius = chunk.size * 0.75; // a little over half the diagonal
    const distance = Math.max(0, chunk.center.distanceTo(camera) - radius);
    return distance < chunk.size * DETAIL_DISTANCE;
}

export function createChunkedTerrain(site: TerrainSite, parent: THREE.Object3D) {
    const group = new THREE.Group();
    group.name = 'chunked-terrain';
    parent.add(group);

    const n = site.rootTiles;
    const siteTile = lonLatToTile(site.lon, site.lat, site.rootZoom);
    const rootX0 = Math.floor(siteTile.x) - (n - 1) / 2;
    const rootY0 = Math.floor(siteTile.y) - (n - 1) / 2;

    const chunks = new Map<string, Chunk>();
    function chunkAt(z: number, x: number, y: number) {
        const key = `${z}/${x}/${y}`;
        let chunk = chunks.get(key);
        if (!chunk) {
            const { lon, lat } = tileToLonLat(x + 0.5, y + 0.5, z);
            chunk = {
                z, x, y,
                center: toScene(lon, lat, EARTH_RADIUS, new THREE.Vector3()),
                size: metersPerPixel(lat, z) * TILE_SIZE,
                state: 'waiting',
                token: { cancelled: false },
                lastUsed: 0,
                lastNeededAt: 0,
            };
            chunks.set(key, chunk);
        }
        return chunk;
    }
    const childrenOf = (c: Chunk) => c.children ??= [0, 1, 2, 3].map(i =>
        chunkAt(c.z + 1, c.x * 2 + (i % 2), c.y * 2 + (i >> 1)));

    const roots: Chunk[] = [];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) roots.push(chunkAt(site.rootZoom, rootX0 + i, rootY0 + j));
    }

    // ---------- Building a chunk ----------

    const p = new THREE.Vector3();
    const up = new THREE.Vector3();
    const earthCenter = new THREE.Vector3(0, -EARTH_RADIUS, 0);

    function buildMesh(c: Chunk, heights: Float32Array, heightsSize: number, imagery: HTMLCanvasElement) {
        const S = SEGMENTS;
        const row = S + 1;
        const gridCount = row * row;
        const count = gridCount + 4 * row; // grid, then one strip of skirt per edge
        const positions = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        const colors = new Float32Array(count * 4);

        const scale = 2 ** (c.z - site.rootZoom); // this zoom's tiles per root tile
        const skirtDepth = Math.max(20, c.size * SKIRT);

        for (let j = 0; j <= S; j++) {
            for (let i = 0; i <= S; i++) {
                const v = j * row + i;
                const { lon, lat } = tileToLonLat(c.x + i / S, c.y + j / S, c.z);

                // Height from the elevation tile; the sea surface is flat
                // whatever the sea floor does
                let h = Math.max(0, sampleBilinear(heights, heightsSize, i / S * heightsSize - 0.5, j / S * heightsSize - 0.5));
                h += site.heightOffset ?? 0;
                if (site.flattenRadius) {
                    toScene(lon, lat, EARTH_RADIUS, p);
                    h *= THREE.MathUtils.smoothstep(Math.hypot(p.x, p.z), site.flattenRadius, site.flattenRadius * 2);
                }

                // Stored relative to the chunk's center, so the numbers stay
                // small enough for the GPU's 32-bit floats
                toScene(lon, lat, EARTH_RADIUS + h, p).sub(c.center);
                positions.set([p.x, p.y, p.z], v * 3);
                // Row 0 is the tile's north edge, which is the top of the image
                uvs.set([i / S, 1 - j / S], v * 2);

                // Fade out over the outer 20% of the whole root block, so the
                // terrain blends into the globe instead of ending in a hard edge
                const u = ((c.x + i / S) / scale - rootX0) / n;
                const w = ((c.y + j / S) / scale - rootY0) / n;
                const edge = Math.max(Math.abs(u - 0.5), Math.abs(w - 0.5)) * 2;
                colors.set([1, 1, 1, 1 - THREE.MathUtils.smoothstep(edge, 0.8, 1)], v * 4);
            }
        }

        // Skirts: a copy of each edge, dropped straight down
        const edges = [
            Array.from({ length: row }, (_, k) => k),                 // north
            Array.from({ length: row }, (_, k) => k * row + S),       // east
            Array.from({ length: row }, (_, k) => S * row + S - k),   // south
            Array.from({ length: row }, (_, k) => (S - k) * row),     // west
        ];
        const indices: number[] = [];
        edges.forEach((edge, e) => {
            edge.forEach((v, k) => {
                const s = gridCount + e * row + k;
                p.fromArray(positions, v * 3);
                up.copy(p).add(c.center).sub(earthCenter).normalize();
                p.addScaledVector(up, -skirtDepth);
                positions.set([p.x, p.y, p.z], s * 3);
                uvs.set([uvs[v * 2], uvs[v * 2 + 1]], s * 2);
                colors.set(colors.subarray(v * 4, v * 4 + 4), s * 4);
                if (k < S) indices.push(v, s, edge[k + 1], edge[k + 1], s, s + 1);
            });
        });
        for (let j = 0; j < S; j++) {
            for (let i = 0; i < S; i++) {
                const a = j * row + i;
                indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();

        const texture = new THREE.CanvasTexture(imagery);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;

        // MeshBasicMaterial ignores lights: satellite photos already have real
        // sunlight and shadows baked in, so lighting them again looks wrong.
        // Double-sided so the skirts show from either side.
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
            map: texture,
            vertexColors: true,
            transparent: true,
            side: THREE.DoubleSide,
        }));
        mesh.position.copy(c.center);
        // Draw order for transparent layers: globe (opaque) → terrain → clouds → atmosphere
        mesh.renderOrder = 1;
        mesh.visible = false;
        return mesh;
    }

    async function load(c: Chunk) {
        c.state = 'loading';
        const zi = Math.min(c.z + 1, MAX_IMAGERY_ZOOM);
        const k = 2 ** (zi - c.z); // imagery tiles per chunk side
        const [elevation, imagery] = await Promise.all([
            fetchElevation(c.z, c.x, c.y, 1, c.token),
            fetchImagery(zi, c.x * k, c.y * k, k, c.token),
        ]);
        if (c.token.cancelled) {
            // Given up on while downloading; start fresh if it's needed again
            c.state = 'waiting';
            c.token = { cancelled: false };
            return;
        }
        c.mesh = buildMesh(c, elevation.heights, elevation.size, imagery);
        group.add(c.mesh);
        c.state = 'ready';
    }

    function unload(c: Chunk) {
        if (!c.mesh) return;
        group.remove(c.mesh);
        c.mesh.geometry.dispose();
        const material = c.mesh.material as THREE.MeshBasicMaterial;
        material.map?.dispose();
        material.dispose();
        c.mesh = undefined;
        c.state = 'waiting';
    }

    // ---------- Choosing what to draw ----------

    let frame = 0;
    let now = 0;
    const shown = new Set<Chunk>();
    const wanted = new Set<Chunk>();

    // Walks down from `c`, splitting wherever more detail is needed
    function visit(c: Chunk, camera: THREE.Vector3) {
        c.lastUsed = frame;
        c.lastNeededAt = now;
        if (needsMoreDetail(c, camera, site.maxZoom)) {
            const kids = childrenOf(c);
            for (const k of kids) {
                k.lastUsed = frame;
                k.lastNeededAt = now;
                if (k.state !== 'ready') wanted.add(k);
            }
            if (kids.every(k => k.state === 'ready')) {
                for (const k of kids) visit(k, camera);
                return;
            }
        }
        if (c.state === 'ready') {
            shown.add(c);
            return;
        }
        wanted.add(c);
        // Zooming out to a chunk that isn't loaded (yet): keep showing
        // whichever of its children are, rather than a hole
        for (const k of c.children ?? []) if (k.state === 'ready') shown.add(k);
    }

    return {
        // `camera` is the camera's position in the parent's coordinates
        update(camera: THREE.Vector3) {
            frame++;
            now = performance.now();
            shown.clear();
            wanted.clear();
            for (const root of roots) visit(root, camera);

            for (const c of chunks.values()) {
                if (c.mesh) c.mesh.visible = shown.has(c);
                // Downloads nobody has needed for a couple of seconds. Timed
                // in ms rather than frames, so it behaves the same at any frame rate.
                if (c.state === 'loading' && now - c.lastNeededAt > GIVE_UP_AFTER) c.token.cancelled = true;
            }

            // Start the nearest waiting chunks, a few at a time. Abandoned
            // downloads don't hold up new ones while they wind down.
            let loading = 0;
            for (const c of chunks.values()) if (c.state === 'loading' && !c.token.cancelled) loading++;
            const queue = [...wanted].filter(c => c.state === 'waiting')
                .sort((a, b) => a.center.distanceToSquared(camera) - b.center.distanceToSquared(camera));
            for (const c of queue.slice(0, Math.max(0, MAX_LOADING - loading))) load(c);

            // Free the longest-unused chunks once there are too many. The
            // roots stay, so there's always something to fall back on.
            const loaded = [...chunks.values()].filter(c => c.mesh && !shown.has(c) && c.z > site.rootZoom);
            if (loaded.length > CACHE_SIZE) {
                loaded.sort((a, b) => a.lastUsed - b.lastUsed);
                for (const c of loaded.slice(0, loaded.length - CACHE_SIZE)) unload(c);
            }
        },

        dispose() {
            for (const c of chunks.values()) {
                c.token.cancelled = true;
                unload(c);
            }
            parent.remove(group);
        },
    };
}
