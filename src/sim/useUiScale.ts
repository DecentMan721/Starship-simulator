import { useEffect, useState } from 'react';

// How much to shrink the overlays so they fit the screen. They're drawn for
// a desktop window (the vehicle diagrams alone are ~640 px tall), so a phone
// in landscape (~390 px tall) needs them at about half size. Portrait phones
// are narrow rather than short: there the timeline gets the full width and
// the side panels sit above it instead of beside it.

const DESIGN_HEIGHT = 900;
const DESIGN_WIDTH = 1300;
// Portrait: keep the two side panels to about half the width between them
const PORTRAIT_DESIGN_WIDTH = 800;
const MIN_SCALE = 0.45;
// The play controls stay big enough to tap even when the panels shrink
const MIN_TIMELINE_SCALE = 0.7;

const EDGE = 14;                        // gap between the overlays and the screen edge
const SIDE_PANELS_WIDTH = 174 + 194;    // vehicle diagrams + engines, unscaled
const TIMELINE_MAX_WIDTH = 1400;
const TIMELINE_ASPECT = 110 / 1000;     // the arc's viewBox
const TIMELINE_CONTROLS_HEIGHT = 46;    // play button row under the arc

function measure() {
    // visualViewport is the part actually on screen; on mobile, innerWidth /
    // innerHeight can still be stale right after load or rotation
    const w = window.visualViewport?.width ?? window.innerWidth;
    const h = window.visualViewport?.height ?? window.innerHeight;
    const portrait = h > w;
    const scale = Math.max(MIN_SCALE, Math.min(1, h / DESIGN_HEIGHT, w / (portrait ? PORTRAIT_DESIGN_WIDTH : DESIGN_WIDTH)));

    // Landscape: the timeline fits between the side panels, shrunk with them
    // (but not as far, so its buttons stay easy to tap).
    // Portrait: it spans the screen at full size (easy to tap) and the side
    // panels move up out of its way.
    let timelineScale = Math.max(scale, MIN_TIMELINE_SCALE);
    let timelineWidth = Math.min(TIMELINE_MAX_WIDTH, (w - 2 * EDGE - SIDE_PANELS_WIDTH * scale - 24) / timelineScale);
    let panelBottom = EDGE;
    if (portrait) {
        timelineScale = 1;
        timelineWidth = w - 2 * EDGE;
        panelBottom = EDGE + timelineWidth * TIMELINE_ASPECT + TIMELINE_CONTROLS_HEIGHT + 10;
    }

    return { width: w, height: h, scale, portrait, timelineScale, timelineWidth, panelBottom };
}

export type UiLayout = ReturnType<typeof measure>;

export function useUiScale(): UiLayout {
    const [layout, setLayout] = useState(measure);
    useEffect(() => {
        let timer: number | undefined;
        const update = () => {
            setLayout(measure());
            // Some mobile browsers report the old size on the rotation event
            // itself, so measure again once they've settled
            clearTimeout(timer);
            timer = window.setTimeout(() => setLayout(measure()), 300);
        };
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', update);
        window.visualViewport?.addEventListener('resize', update);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', update);
            window.removeEventListener('orientationchange', update);
            window.visualViewport?.removeEventListener('resize', update);
        };
    }, []);
    return layout;
}
