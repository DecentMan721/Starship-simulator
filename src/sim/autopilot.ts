import {
    GIMBAL_LIMIT, GRID_FIN_ANGLES,
    type ControlSurfaces, type Gimbal, type TowerControls,
} from '../components/controlSurfaces';
import { CATCH_CARRIAGE, T_CATCH, T_SPLASHDOWN, T_STAGING, type FlightState, type VehicleState } from './flightProfile';

// Works out what every fin, flap, engine and tower arm should be doing at a
// moment in the flight, from how the path is turning. A real flight computer
// commands the surfaces and the vehicle turns as a result; here the path is
// known, so this runs it backwards: "to turn like this, the surfaces must
// have been doing that".

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));

// A little jitter, like a real controller constantly making small corrections
// for gusts. Sum of sines so it's smooth and the same every playback.
const wobble = (t: number, seed: number) =>
    Math.sin(t * 1.7 + seed) * 0.6 + Math.sin(t * 4.3 + seed * 2) * 0.4;


// Engine steering. Tilting the bells pushes the base sideways, which turns
// the vehicle (pitchAccel), or with the whole vehicle leaning, slides it
// sideways (horizontalAccel, only used for the booster's final approach).
// With yaw = rotation about z, a positive tilt pushes the base toward -x,
// turning the nose toward +x.
function engineGimbal(v: VehicleState, t: number, seed: number, slide = 0): Gimbal {
    if (v.throttle <= 0) return { pitch: 0, yaw: 0 };
    return {
        pitch: wobble(t, seed) * 0.5,
        yaw: clamp(v.pitchAccel * 4 - v.horizontalAccel * slide + wobble(t, seed + 1) * 0.5, GIMBAL_LIMIT),
    };
}

// Grid fins steer the booster on the way down. Our flight path is in the
// x/y plane, so turning it needs the fins whose shafts point along ±z; fins
// pointing along ±x would roll it instead. Each fin gets the mix that fits
// its position around the body.
function gridFins(booster: VehicleState, t: number) {
    if (t < T_STAGING || t > T_CATCH) return GRID_FIN_ANGLES.map(() => 0);
    // Gentle during the flip/boostback, working hard once falling into air
    const authority = t < 218 ? 0.3 : 1;
    const pitchCmd = clamp((-booster.pitchRate * 3 + wobble(t, 3) * 4) * authority, 25);
    const rollCmd = wobble(t * 0.7, 5) * 3 * authority;
    return GRID_FIN_ANGLES.map(deg => {
        const a = deg * Math.PI / 180;
        return Math.round(Math.sin(a) * pitchCmd + Math.cos(a) * rollCmd);
    });
}

// The ship's flaps hold a partly-folded position during ascent and trim
// with opposite motions front and back to help it pitch, while there's air
// to push on (ascent, and the whole way down from entry). Above ~80 km and
// after splashdown they just hold still.
function shipFlaps(ship: VehicleState, t: number) {
    const hold = 30;
    const inAir = ship.altitude < 80_000 && t >= 0 && t < T_SPLASHDOWN;
    const trim = inAir ? clamp(ship.pitchRate * 8 + wobble(t, 7) * 2, 20) : 0;
    const forward = Math.round(hold + trim);
    const aft = Math.round(hold - trim);
    return {
        forwardFlaps: [forward, forward] as [number, number],
        aftFlaps: [aft, aft] as [number, number],
    };
}

// Tower: QD arm swings away just before liftoff; the carriage waits at catch
// height with the arms open, then closes them around the booster
function tower(t: number): TowerControls {
    const qd = Math.min(1, Math.max(0, (t + 10) / 5)) * 60;
    const closing = Math.min(1, Math.max(0, (t - (T_CATCH - 10)) / 10));
    const arms = 60 * (1 - closing);
    return { carriageHeight: CATCH_CARRIAGE, chopsticks: [arms, arms], qdArm: qd };
}


export function autopilot(flight: FlightState): { controls: ControlSurfaces; tower: TowerControls } {
    const { t, booster, ship } = flight;
    return {
        controls: {
            ...shipFlaps(ship, t),
            gridFins: gridFins(booster, t),
            // The slide gain only matters in the last seconds, when the
            // booster translates over the tower
            boosterGimbal: engineGimbal(booster, t, 11, t > 390 ? 0.8 : 0),
            shipGimbal: engineGimbal(ship, t, 13),
        },
        tower: tower(t),
    };
}
