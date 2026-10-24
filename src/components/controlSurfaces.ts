// Shared between StarShip (which draws/moves the surfaces) and whatever
// drives them (sliders now, telemetry later). All angles are in degrees.

// Where each grid fin sits around the booster, in degrees around the y axis
// (0° = +x side). Super Heavy V1/V2 has 4; V3 boosters use 3 larger fins.
export const GRID_FIN_ANGLES = [0, 90, 180];

// Raptors gimbal roughly this far in any direction
export const GIMBAL_LIMIT = 15;

// One steering command shared by every engine in a gimbal group, like real
// thrust vector control. pitch tilts the bells about the x axis (toward ±z),
// yaw tilts them about the z axis (toward ±x).
export interface Gimbal {
    pitch: number;
    yaw: number;
}

export interface ControlSurfaces {
    // [left, right]. 0° = sticking straight out sideways,
    // positive = swung back toward the leeward (steel) side, 90° = folded back
    forwardFlaps: [number, number];
    aftFlaps: [number, number];
    // One per GRID_FIN_ANGLES entry. Rotation about the fin's own shaft.
    gridFins: number[];
    // Booster: the inner 13 engines gimbal, the outer 20 are fixed.
    // Ship: the 3 sea-level engines gimbal, the 3 vacuum engines are fixed.
    boosterGimbal: Gimbal;
    shipGimbal: Gimbal;
}

// ---------- Staging ----------
// Where the ship and booster are relative to each other. With telemetry
// you'd compute these from the two vehicles' own positions/attitudes.

export const SEPARATION_MAX = 200;   // m
export const BOOSTER_FLIP_MAX = 180;

export interface Staging {
    // Gap between the hot-staging ring and the ship's base, in meters
    separation: number;
    // Booster rotation about the x axis around its center of mass, degrees
    // (the flip it does after staging to fly back)
    boosterFlip: number;
}

export const DEFAULT_STAGING: Staging = {
    separation: 0,
    boosterFlip: 0,
};


// ---------- Flight ----------

export const ALTITUDE_MAX = 1_000_000;  // m (1000 km, well into orbit)

export interface Flight {
    // Height of the stack above the launch mount, in meters
    altitude: number;
}

export const DEFAULT_FLIGHT: Flight = {
    altitude: 0,
};


// ---------- Launch tower ----------
// Separate from the vehicle: the tower stays on the ground while
// telemetry moves the rocket.

export const CARRIAGE_RANGE: [number, number] = [25, 128]; // m above ground
export const CHOPSTICK_MAX_OPEN = 70;
export const QD_ARM_MAX = 60;

export interface TowerControls {
    // Height of the chopstick arms, in meters above the ground
    carriageHeight: number;
    // [left, right]. 0° = closed around the booster, positive = swung open
    chopsticks: [number, number];
    // 0° = connected to the ship, positive = swung back toward the tower
    qdArm: number;
}

export const DEFAULT_TOWER_CONTROLS: TowerControls = {
    carriageHeight: 80,
    chopsticks: [45, 45],
    qdArm: 0,
};

export const DEFAULT_CONTROL_SURFACES: ControlSurfaces = {
    forwardFlaps: [0, 0],
    aftFlaps: [0, 0],
    gridFins: GRID_FIN_ANGLES.map(() => 0),
    boosterGimbal: { pitch: 0, yaw: 0 },
    shipGimbal: { pitch: 0, yaw: 0 },
};
