import * as THREE from 'three';

// On-screen markers for the booster and ship, so you can find them when
// they're specks thousands of km away. Plain HTML laid over the canvas and
// moved every frame (cheaper than re-rendering React 60 times a second).
// A vehicle off screen or behind the camera gets pinned to the nearest
// edge, with an arrow pointing the way to it.

const EDGE_MARGIN = 28;   // px kept clear at the screen edge for pinned markers
const MERGE_DISTANCE = 24; // px; closer than this, the two read as one stack

export interface MarkerTarget {
    label: string;
    color: string;
    position: THREE.Vector3; // world position
}

function formatDistance(m: number) {
    if (m < 1000) return `${Math.round(m)} m`;
    if (m < 100_000) return `${(m / 1000).toFixed(1)} km`;
    return `${Math.round(m / 1000).toLocaleString()} km`;
}

function makeMarker(color: string) {
    const el = document.createElement('div');
    Object.assign(el.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        pointerEvents: 'none',
        display: 'none',
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#fff',
        textShadow: '0 0 3px #000, 0 0 3px #000',
        whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>);

    // Ring centered on the vehicle
    const ring = document.createElement('div');
    Object.assign(ring.style, {
        position: 'absolute',
        left: '-9px',
        top: '-9px',
        width: '14px',
        height: '14px',
        border: `2px solid ${color}`,
        borderRadius: '50%',
        boxShadow: '0 0 3px #000',
    });

    // Arrow toward an off-screen vehicle, rotated each frame
    const arrow = document.createElement('div');
    Object.assign(arrow.style, {
        position: 'absolute',
        left: '-6px',
        top: '-6px',
        width: '0',
        height: '0',
        borderTop: '6px solid transparent',
        borderBottom: '6px solid transparent',
        borderLeft: `12px solid ${color}`,
        transformOrigin: '6px 6px',
        filter: 'drop-shadow(0 0 2px #000)',
    });

    const text = document.createElement('div');
    Object.assign(text.style, {
        position: 'absolute',
        left: '12px',
        top: '-8px',
    });

    el.append(ring, arrow, text);
    return { el, ring, arrow, text };
}

export function createVehicleMarkers(container: HTMLElement, targets: Omit<MarkerTarget, 'position'>[]) {
    const markers = targets.map(t => makeMarker(t.color));
    markers.forEach(m => container.appendChild(m.el));
    const ndc = new THREE.Vector3();

    function update(camera: THREE.PerspectiveCamera, positions: THREE.Vector3[], visible: boolean, stackLabel: string) {
        const w = window.innerWidth;
        const h = window.innerHeight;

        // Screen position of each vehicle, pinned to the edge if off screen
        const placed = positions.map(p => {
            ndc.copy(p).project(camera);
            // Behind the camera, the projection comes out mirrored
            const behind = ndc.z > 1;
            let x = behind ? -ndc.x : ndc.x;
            let y = behind ? -ndc.y : ndc.y;
            const onScreen = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
            if (!onScreen) {
                // Slide in from the center along the same direction until
                // it touches the edge margin
                const mx = 1 - (2 * EDGE_MARGIN) / w;
                const my = 1 - (2 * EDGE_MARGIN) / h;
                const k = Math.min(mx / Math.abs(x || 1e-6), my / Math.abs(y || 1e-6));
                x *= k;
                y *= k;
            }
            return {
                x: (x + 1) / 2 * w,
                y: (1 - y) / 2 * h,
                onScreen,
                angle: Math.atan2(-y, x),
                distance: camera.position.distanceTo(p),
            };
        });

        // Still stacked (or far enough away to overlap): one marker for both
        const merged = placed.length === 2 && Math.hypot(placed[0].x - placed[1].x, placed[0].y - placed[1].y) < MERGE_DISTANCE;

        markers.forEach((m, i) => {
            const p = placed[i];
            const show = visible && !(merged && i === 0);
            m.el.style.display = show ? 'block' : 'none';
            if (!show) return;
            m.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
            m.ring.style.display = p.onScreen ? 'block' : 'none';
            m.arrow.style.display = p.onScreen ? 'none' : 'block';
            m.arrow.style.transform = `rotate(${p.angle}rad)`;
            // Labels near the right edge would run off screen, so flip them left
            const flip = p.x > w - 150;
            m.text.style.left = flip ? 'auto' : '12px';
            m.text.style.right = flip ? '12px' : 'auto';
            m.text.textContent = `${merged ? stackLabel : targets[i].label} · ${formatDistance(p.distance)}`;
        });
    }

    function dispose() {
        markers.forEach(m => m.el.remove());
    }

    return { update, dispose };
}
