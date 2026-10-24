import { TILE_SIZE } from './geo';

// Downloading map tiles and stitching them together.
//
// Elevation: AWS Terrain Tiles in "Terrarium" format, where each PNG pixel's
// color encodes a height. Free, no key.
// Imagery: Sentinel-2 cloudless by EOX, a cloud-free satellite mosaic (10 m
// detail). Free for non-commercial use with attribution.
// Both servers send CORS headers, which WebGL needs to use their images.

const ELEVATION_URL = (z: number, x: number, y: number) =>
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const IMAGERY_URL = (z: number, x: number, y: number) =>
    `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`;

// Lets the caller stop work it no longer needs (e.g. the component unmounted)
export interface CancelToken {
    cancelled: boolean;
}

function loadImageOnce(url: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous'; // ask for CORS so the canvas stays readable
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

// A patch asks for ~125 tiles at once. Tile servers push back on bursts
// like that by failing some requests, so downloads go through a queue
// that runs a few at a time.
const MAX_PARALLEL = 8;
let active = 0;
const waiting: (() => void)[] = [];

async function inQueue<T>(job: () => Promise<T>): Promise<T> {
    if (active >= MAX_PARALLEL) await new Promise<void>(resolve => waiting.push(resolve));
    active++;
    try {
        return await job();
    } finally {
        active--;
        waiting.shift()?.();
    }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retries a failed tile a couple of times with growing pauses. Resolves with
// null instead of failing in the end, so one missing tile just leaves a gap
// rather than breaking the whole patch.
async function loadImage(url: string, token: CancelToken): Promise<HTMLImageElement | null> {
    for (let attempt = 0; attempt < 3 && !token.cancelled; attempt++) {
        if (attempt > 0) await sleep(500 * 2 ** attempt);
        const img = await inQueue(() => loadImageOnce(url));
        if (img) return img;
    }
    return null;
}

// Downloads an n × n block of tiles starting at (x0, y0) and draws them into
// one canvas, each tile at its spot in the grid
async function mosaic(
    url: (z: number, x: number, y: number) => string,
    zoom: number, x0: number, y0: number, n: number,
    token: CancelToken,
) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n * TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const jobs: Promise<void>[] = [];
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            jobs.push(loadImage(url(zoom, x0 + i, y0 + j), token).then(img => {
                if (img && !token.cancelled) ctx.drawImage(img, i * TILE_SIZE, j * TILE_SIZE);
            }));
        }
    }
    await Promise.all(jobs);
    return canvas;
}

export function fetchImagery(zoom: number, x0: number, y0: number, n: number, token: CancelToken) {
    return mosaic(IMAGERY_URL, zoom, x0, y0, n, token);
}

// Heights in meters for an n × n block of tiles, as one square grid of
// (n·256)² values, row by row from the north-west corner
export async function fetchElevation(zoom: number, x0: number, y0: number, n: number, token: CancelToken) {
    const canvas = await mosaic(ELEVATION_URL, zoom, x0, y0, n, token);
    const size = canvas.width;
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, size, size);
    const heights = new Float32Array(size * size);
    for (let i = 0; i < heights.length; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        // Terrarium encoding. Missing tiles read as 0,0,0 = -32768, and the
        // patch builder clamps everything below sea level anyway.
        heights[i] = r * 256 + g + b / 256 - 32768;
    }
    return { heights, size };
}
