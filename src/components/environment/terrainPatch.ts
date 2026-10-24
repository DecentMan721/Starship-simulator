import * as THREE from 'three';
import { SITE, TILE_SIZE, curvatureDrop, lonLatToTile, metersPerPixel } from './geo';
import { fetchElevation, fetchImagery, type CancelToken } from './tiles';

// A terrain patch is a square grid mesh around the launch site: heights from
// elevation tiles, satellite imagery on top, bent down by Earth's curve.
// Several patches at different zoom levels give detail up close and
// coverage far away.

export interface PatchOptions {
    zoom: number;              // elevation tile zoom; each +1 halves the area and doubles the detail
    tilesAcross: number;       // odd, so the site's tile is in the middle
    imageryZoomOffset: number; // imagery this many zoom levels sharper than the elevation
    segments: number;          // mesh grid resolution per side
    flattenRadius?: number;    // flatten the ground to y = 0 this close to the pad, m
    fadeEdge?: boolean;        // fade the outer edge out so it blends into what's behind
    yOffset?: number;          // nudge down so a sharper patch on top doesn't flicker against it
    // Transparent things draw in this order. Patches must go coarse → fine,
    // so a fine patch's faded edge blends over the coarse one under it.
    renderOrder: number;
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


export async function buildTerrainPatch(opts: PatchOptions, token: CancelToken) {
    const { zoom, tilesAcross: n } = opts;

    // Which block of tiles to fetch: the site's tile plus the same number on
    // each side
    const site = lonLatToTile(SITE.lon, SITE.lat, zoom);
    const x0 = Math.floor(site.x) - (n - 1) / 2;
    const y0 = Math.floor(site.y) - (n - 1) / 2;

    const k = opts.imageryZoomOffset;
    const [elevation, imagery] = await Promise.all([
        fetchElevation(zoom, x0, y0, n, token),
        // At zoom+k every tile splits into 2^k × 2^k smaller ones
        fetchImagery(zoom + k, x0 * 2 ** k, y0 * 2 ** k, n * 2 ** k, token),
    ]);
    if (token.cancelled) return null;

    // Size of the patch in meters, and where its center is relative to the
    // site (the site is rarely in the exact middle of its tile)
    const mpp = metersPerPixel(SITE.lat, zoom);
    const width = n * TILE_SIZE * mpp;
    const centerX = ((x0 + n / 2) - site.x) * TILE_SIZE * mpp;
    const centerZ = ((y0 + n / 2) - site.y) * TILE_SIZE * mpp;

    // Flat grid lying on the ground. PlaneGeometry starts upright in x/y;
    // rotating -90° about x lays it down with its top edge to the north (-z).
    const geometry = new THREE.PlaneGeometry(width, width, opts.segments, opts.segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(centerX, 0, centerZ);

    // Converts a scene position to a spot in the height grid
    const gridX = (x: number) => site.x * TILE_SIZE + x / mpp - x0 * TILE_SIZE;
    const gridY = (z: number) => site.y * TILE_SIZE + z / mpp - y0 * TILE_SIZE;
    // Sea level or below reads as 0 (the data includes the sea floor)
    const heightAt = (x: number, z: number) =>
        Math.max(0, sampleBilinear(elevation.heights, elevation.size, gridX(x), gridY(z)));
    // Measure heights from the pad so the pad sits at y = 0
    const siteHeight = heightAt(0, 0);

    const pos = geometry.attributes.position;
    const alpha = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        let h = heightAt(x, z) - siteHeight;

        // Level the pad area, blending back to the real ground further out
        if (opts.flattenRadius) {
            const d = Math.hypot(x, z);
            h *= THREE.MathUtils.smoothstep(d, opts.flattenRadius, opts.flattenRadius * 2);
        }

        pos.setY(i, h - curvatureDrop(x, z) + (opts.yOffset ?? 0));

        // Per-vertex color, white (so the imagery shows unchanged) with alpha
        // fading to 0 over the outer 20% of the patch
        const edge = Math.max(Math.abs(x - centerX), Math.abs(z - centerZ)) / (width / 2);
        alpha.set([1, 1, 1, opts.fadeEdge ? 1 - THREE.MathUtils.smoothstep(edge, 0.8, 1) : 1], i * 4);
    }
    pos.needsUpdate = true;
    geometry.setAttribute('color', new THREE.BufferAttribute(alpha, 4));
    geometry.computeVertexNormals();

    const texture = new THREE.CanvasTexture(imagery);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    // MeshBasicMaterial ignores lights: satellite photos already have real
    // sunlight and shadows baked in, so lighting them again looks wrong
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        vertexColors: true,
        transparent: !!opts.fadeEdge,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = opts.renderOrder;
    return mesh;
}
