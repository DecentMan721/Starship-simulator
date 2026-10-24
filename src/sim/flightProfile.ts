import { EARTH_RADIUS } from '../components/environment/geo';
import { CHOPSTICK_RAIL_TOP, MOUNT_HEIGHT } from '../components/launchTower';
import { GRID_FIN_DEPTH, GRID_FIN_Y } from '../components/vehicleDimensions';

// A Starship flight profile built from the publicly reported milestones of
// the test flights (Flight 5 onward): max Q ≈ T+1:00, MECO and hot staging
// ≈ T+2:40 at ~67 km, boostback ≈ T+2:50–3:38, booster apogee ~95 km, landing
// burn from ≈ T+6:25 and tower catch ≈ T+6:50, ship engine cutoff (SECO)
// ≈ T+8:25 at ~160 km, coast to entry interface ≈ T+47:30, peak heating
// ≈ T+52, belly-flop, flip and landing burn, then splashdown in the Indian
// Ocean ≈ T+1:06. Exact second-by-second telemetry isn't published, so the
// points between milestones are smooth estimates.
//
// Positions are measured along the ground ("downrange", toward the east,
// over the Gulf) and up from the launch mount, then wrapped onto the curved
// Earth when converted to scene coordinates. Heading due east from Starbase
// and following the curve of the Earth, ~21,500 km brings the ship to about
// 25°S 98°E: the Indian Ocean west of Australia, where the test flights end.

export const SIM_START = -15;   // s, a little countdown before liftoff
export const SIM_END = 4020;    // s, a minute after splashdown
export const T_STAGING = 161;   // s, the ship separates
export const T_CATCH = 409;     // s, the booster settles into the chopsticks
export const T_SECO = 505;      // s, the ship's engines cut off
export const T_ENTRY = 2850;    // s, entry interface (~120 km)
export const T_FLIP = 3930;     // s, the ship flips upright and lights 3 engines
export const T_SPLASHDOWN = 3960;
export const SPLASHDOWN_DOWNRANGE = 21_561_000; // m

// Milestones shown as circles on the mission timeline (name on hover)
export const TIMELINE_EVENTS: { t: number; label: string }[] = [
    { t: 0, label: 'Liftoff' },
    { t: 58, label: 'Max Q' },
    { t: 155, label: 'MECO' },
    { t: T_STAGING, label: 'Hot staging' },
    { t: 170, label: 'Boostback burn' },
    { t: 385, label: 'Landing burn' },
    { t: T_CATCH, label: 'Booster catch' },
    { t: T_SECO, label: 'SECO' },
    { t: T_ENTRY, label: 'Entry interface' },
    { t: 3150, label: 'Peak heating' },
    { t: T_FLIP, label: 'Flip & landing burn' },
    { t: T_SPLASHDOWN, label: 'Splashdown' },
];

// Carriage height for the catch, and the booster altitude (base above the
// mount) that puts its grid fins exactly on the chopstick rails
export const CATCH_CARRIAGE = 100;
const CATCH_ALT = CATCH_CARRIAGE + CHOPSTICK_RAIL_TOP - (GRID_FIN_Y - GRID_FIN_DEPTH / 2) - MOUNT_HEIGHT;


// ---------- Smooth curves through keyframes ----------
// Monotone cubic interpolation (Fritsch–Carlson, aka PCHIP): a smooth curve
// through every point that never overshoots between them. A plain spline
// can bulge past a keyframe, which would e.g. push the booster underground
// just before the catch.
class Track {
    private times: number[];
    private values: number[];
    private slopes: number[];

    constructor(times: number[], values: number[]) {
        this.times = times;
        this.values = values;
        const n = times.length;
        const h = (k: number) => times[k + 1] - times[k];
        const delta = (k: number) => (values[k + 1] - values[k]) / h(k);
        this.slopes = times.map((_, k) => {
            if (k === 0) return delta(0);
            if (k === n - 1) return delta(n - 2);
            const d0 = delta(k - 1);
            const d1 = delta(k);
            if (d0 * d1 <= 0) return 0; // a peak or valley: flat here, no overshoot
            const w1 = 2 * h(k) + h(k - 1);
            const w2 = h(k) + 2 * h(k - 1);
            return (w1 + w2) / (w1 / d0 + w2 / d1);
        });
    }

    at(t: number) {
        const { times, values, slopes } = this;
        if (t <= times[0]) return values[0];
        if (t >= times[times.length - 1]) return values[values.length - 1];
        let k = 0;
        while (times[k + 1] < t) k++;
        const h = times[k + 1] - times[k];
        const s = (t - times[k]) / h;
        // Cubic Hermite: blend the two end values and end slopes
        const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
        const h10 = s ** 3 - 2 * s ** 2 + s;
        const h01 = -2 * s ** 3 + 3 * s ** 2;
        const h11 = s ** 3 - s ** 2;
        return h00 * values[k] + h10 * h * slopes[k] + h01 * values[k + 1] + h11 * h * slopes[k + 1];
    }
}

// Straight lines between points, for on/off-ish things like throttle
function linear(keys: [number, number][], t: number) {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
        const [t1, v1] = keys[i];
        if (t <= t1) {
            const [t0, v0] = keys[i - 1];
            return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
        }
    }
    return keys[keys.length - 1][1];
}

// A 2D path: [time s, downrange km, altitude km] → meters
function path(keys: [number, number, number][]) {
    const times = keys.map(k => k[0]);
    return {
        downrange: new Track(times, keys.map(k => k[1] * 1000)),
        altitude: new Track(times, keys.map(k => k[2] * 1000)),
    };
}
type Path = ReturnType<typeof path>;


// ---------- The flight ----------

// Both vehicles ride together until staging. Both paths start with these
// points, and until staging both use this path on its own, so the curve
// can't be bent by where each one goes afterward.
const STACK: [number, number, number][] = [
    [SIM_START, 0, 0],
    [0, 0, 0],
    [8, 0, 0.12],
    [20, 0, 0.8],
    [35, 0.4, 3.2],
    [58, 2.5, 11.5],     // max Q
    [80, 7, 21],
    [100, 13, 31],
    [120, 22, 42],
    [140, 34, 54],
    [T_STAGING, 55, 67], // hot staging
];

// The extra point (halfway between where the ship and booster are at 170 s)
// keeps the stack path's speed right up to the moment of staging
const STACK_PATH = path([...STACK, [170, 63.8, 72.2]]);

const SHIP = path([
    ...STACK,
    [170, 64.1, 72.35],  // pulling ahead of the booster along the flight path
    [200, 110, 90],
    [250, 190, 113],
    [300, 300, 132],
    [350, 440, 145],
    [400, 610, 153],
    [450, 820, 158],
    [T_SECO, 1100, 160], // SECO
    [560, 1490, 162],    // coasting at ~7 km/s, rising toward apogee
    [620, 1920, 163],
    [900, 3880, 178],
    [1500, 8080, 205],   // apogee
    [2200, 12_980, 185],
    [T_ENTRY, 17_500, 120], // entry interface
    [3000, 18_500, 98],
    [3150, 19_400, 75],  // peak heating
    [3400, 20_600, 55],
    [3600, 21_300, 38],
    [3750, 21_520, 20],  // subsonic: falling belly-first
    [3850, 21_555, 6],
    [3900, 21_559, 3],
    [3925, 21_560.5, 0.8],
    [T_FLIP + 5, 21_561, 0.35],
    [3952, SPLASHDOWN_DOWNRANGE / 1000, 0.04],
    // Base at sea level (heights are measured from the mount, which is above it)
    [T_SPLASHDOWN, SPLASHDOWN_DOWNRANGE / 1000, -MOUNT_HEIGHT / 1000],
    [SIM_END, SPLASHDOWN_DOWNRANGE / 1000, -MOUNT_HEIGHT / 1000],
]);

const BOOSTER = path([
    ...STACK,
    [170, 63.5, 72],     // still coasting east as it flips
    [190, 72, 82],
    [218, 76, 90],       // boostback done: now heading back west
    [240, 72, 93],       // apogee
    [270, 60, 88],
    [300, 45, 72],
    [330, 28, 48],
    [355, 13, 24],
    [372, 4, 9],
    [385, 0.8, 2.2],     // landing burn starts
    [395, 0.12, 0.45],
    [403, 0.01, 0.1],    // above the tower, arms closing; drop straight down from here
    [T_CATCH, 0, CATCH_ALT / 1000],
    [SIM_END, 0, CATCH_ALT / 1000],
]);

// After staging the booster doesn't point where it's going: it flips to fire
// back toward the pad, then falls engines-first for the catch. Degrees from
// local vertical, positive = nose toward the east. The first key is filled
// in below with its heading at the moment of staging.
const BOOSTER_PITCH_KEYS: [number, number][] = [
    [168, -75],          // flipped: nose west and up for boostback
    [218, -75],
    [240, -30],
    [280, -8],           // engines down, slight lean to glide back toward the pad
    [380, -4],
    [395, 0],
    [399, -3],           // lean to slide west over the tower...
    [405, 2],            // ...and back to stop
    [T_CATCH, 0],
];

// 1 = all engines at full power. The booster relights 13 engines for
// boostback and landing; during hot staging it keeps its center 3 running.
const BOOSTER_THROTTLE: [number, number][] = [
    [0, 0], [0.01, 1], [155, 1], [156, 0.1], [161, 0.1], [161.5, 0],
    [169, 0], [170, 0.4], [217, 0.4], [218, 0],
    [384, 0], [385, 0.4], [400, 0.25], [408, 0.1], [T_CATCH, 0],
];
// The ship lights its engines while still attached (that's hot staging),
// and relights its 3 sea-level engines for the landing flip
const SHIP_THROTTLE: [number, number][] = [
    [158, 0], [158.5, 1], [T_SECO, 1], [T_SECO + 0.5, 0],
    [T_FLIP, 0], [T_FLIP + 1, 0.6], [T_SPLASHDOWN - 2, 0.4], [T_SPLASHDOWN, 0],
];

// From shortly before entry the ship flies its own attitude instead of
// pointing where it's going: belly-first into the air at a steep angle of
// attack (nose ~45° up from its path), level belly-flop as it falls, then a
// quick flip upright for the landing burn. The first key is filled in with
// its heading when this starts.
const T_ENTRY_PREP = 2750;
const SHIP_PITCH_KEYS: [number, number][] = [
    [T_ENTRY, 45],
    [3600, 45],
    [3750, 70],
    [3850, 90],          // falling flat, belly down
    [T_FLIP - 2, 90],
    [T_FLIP + 5, 0],     // flipped upright, engines down
];
// Roll about the ship's long axis, degrees. The heat shield is on the ship's
// side, so it has to roll 90° to turn its belly toward the ground.
const SHIP_ROLL: [number, number][] = [
    [T_ENTRY_PREP, 0], [T_ENTRY - 20, 90],
];


// ---------- Sampling ----------

export interface VehicleState {
    // Scene position of the vehicle's base (for the ship, as if stacked:
    // the scene adds the stacking offset), meters
    x: number;
    y: number;
    // Degrees from straight up, positive toward +x, in scene terms (includes
    // the tilt of the local ground on the curved Earth)
    pitch: number;
    roll: number;           // degrees about the long axis (turns the ship's belly)
    pitchRate: number;      // deg/s, relative to the local vertical
    pitchAccel: number;     // deg/s²
    horizontalAccel: number; // m/s², toward the east
    throttle: number;
    altitude: number;       // m above the mount
    downrange: number;      // m
    speed: number;          // m/s
}

const STEP = 0.1; // s, for working out rates by comparing nearby moments

function rate(f: (t: number) => number, t: number) {
    return (f(t + STEP) - f(t - STEP)) / (2 * STEP);
}

// Which way the vehicle is moving, in degrees from vertical toward east
function headingOf(p: Path, t: number) {
    const up = rate(tt => p.altitude.at(tt), t);
    const east = rate(tt => p.downrange.at(tt), t);
    return Math.hypot(up, east) < 1 ? 0 : Math.atan2(east, up) * 180 / Math.PI;
}

const boosterPitchTrack = (() => {
    const keys: [number, number][] = [[T_STAGING, headingOf(STACK_PATH, T_STAGING)], ...BOOSTER_PITCH_KEYS];
    return new Track(keys.map(k => k[0]), keys.map(k => k[1]));
})();

const shipPitchTrack = (() => {
    const keys: [number, number][] = [[T_ENTRY_PREP, headingOf(SHIP, T_ENTRY_PREP)], ...SHIP_PITCH_KEYS];
    return new Track(keys.map(k => k[0]), keys.map(k => k[1]));
})();

// Pitch relative to the local vertical: rockets point where they're going,
// except the booster after staging and the ship from entry on
function localPitch(kind: 'booster' | 'ship', t: number) {
    if (kind === 'booster' && t > T_STAGING) return boosterPitchTrack.at(t);
    if (kind === 'ship' && t > T_ENTRY_PREP) return shipPitchTrack.at(t);
    return headingOf(pathOf(kind, t), t);
}

function pathOf(kind: 'booster' | 'ship', t: number) {
    if (t <= T_STAGING) return STACK_PATH;
    return kind === 'booster' ? BOOSTER : SHIP;
}

function sampleVehicle(kind: 'booster' | 'ship', t: number): VehicleState {
    const p = pathOf(kind, t);
    const downrange = p.downrange.at(t);
    const altitude = p.altitude.at(t);

    // Wrap onto the curved Earth: travelling `downrange` along the surface
    // is turning by angle θ around Earth's center (scene origin is the mount,
    // Earth's center is EARTH_RADIUS below the ground)
    const θ = downrange / EARTH_RADIUS;
    const r = EARTH_RADIUS + MOUNT_HEIGHT + altitude;

    const pitch = localPitch(kind, t);
    const pitchRate = rate(tt => localPitch(kind, tt), t);

    return {
        x: r * Math.sin(θ),
        y: r * Math.cos(θ) - EARTH_RADIUS,
        pitch: pitch + θ * 180 / Math.PI,
        roll: kind === 'ship' ? linear(SHIP_ROLL, t) : 0,
        pitchRate,
        pitchAccel: rate(tt => rate(ttt => localPitch(kind, ttt), tt), t),
        horizontalAccel: rate(tt => rate(ttt => p.downrange.at(ttt), tt), t),
        throttle: linear(kind === 'booster' ? BOOSTER_THROTTLE : SHIP_THROTTLE, t),
        altitude,
        downrange,
        speed: Math.hypot(rate(tt => p.altitude.at(tt), t), rate(tt => p.downrange.at(tt), t)),
    };
}

// Which engines are firing. Super Heavy has 3 center, 10 inner (these two
// groups gimbal) and 20 outer engines; boostback and landing use only some.
// For the ship, 'center3' means its 3 sea-level engines.
export type EngineSet = 'all' | 'inner13' | 'center3' | 'off';

function boosterEngines(t: number): EngineSet {
    if (t < 0) return 'off';
    if (t <= 155) return 'all';
    if (t <= 161.5) return 'center3';   // kept running through hot staging
    if (t >= 170 && t <= 217) return 'inner13'; // boostback
    if (t >= 385 && t < 400) return 'inner13';  // landing burn...
    if (t >= 400 && t < T_CATCH) return 'center3'; // ...down to 3 for the hover
    return 'off';
}

function boosterPhase(t: number) {
    if (t < 0) return 'Countdown';
    if (t < 50) return 'Liftoff';
    if (t < 66) return 'Max Q';
    if (t < 155) return 'Ascent';
    if (t < T_STAGING) return 'MECO · hot staging';
    if (t < 170) return 'Flip';
    if (t < 218) return 'Boostback burn';
    if (t < 385) return 'Coast & descent';
    if (t < T_CATCH) return 'Landing burn';
    return 'Caught by the tower';
}

function shipPhase(t: number) {
    if (t < 158) return 'Stacked';
    if (t < T_STAGING) return 'Hot staging';
    if (t < T_SECO) return 'Ascent burn';
    if (t < T_ENTRY) return 'SECO · coasting';
    if (t < 3300) return 'Entry · peak heating';
    if (t < 3750) return 'Entry';
    if (t < T_FLIP) return 'Belly flop';
    if (t < T_SPLASHDOWN) return 'Flip & landing burn';
    return 'Splashdown · Indian Ocean';
}

function shipEngines(t: number, throttle: number): EngineSet {
    if (throttle <= 0) return 'off';
    return t >= T_FLIP ? 'center3' : 'all'; // landing uses the 3 sea-level engines
}

export interface FlightState {
    t: number;
    booster: VehicleState & { phase: string; engines: EngineSet };
    ship: VehicleState & { phase: string; engines: EngineSet };
}

export function sampleFlight(t: number): FlightState {
    const booster = sampleVehicle('booster', t);
    const ship = sampleVehicle('ship', t);
    return {
        t,
        booster: { ...booster, phase: boosterPhase(t), engines: boosterEngines(t) },
        ship: { ...ship, phase: shipPhase(t), engines: shipEngines(t, ship.throttle) },
    };
}
