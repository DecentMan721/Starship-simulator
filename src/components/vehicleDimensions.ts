// Starship's main dimensions, shared by the 3D model (StarShip.tsx) and the
// flight simulator (src/sim). Scale: 1 unit = 1 meter.

export const RADIUS = 4.5;          // Starship is 9 m wide
export const BOOSTER_HEIGHT = 71;   // Super Heavy
export const SHIP_BODY_HEIGHT = 40; // ship cylinder, nose cone sits on top
export const NOSE_HEIGHT = 10;      // ship total ≈ 50 m
export const HSR_HEIGHT = 1.8;      // hot-staging ring between booster and ship
export const SHIP_SKIRT = 2.8;      // the ship's body hangs this far below its engine mounts
// Where the ship's base sits when stacked, measured from the booster's base
export const SHIP_STACKED_Y = BOOSTER_HEIGHT + HSR_HEIGHT;
// Roughly where an empty booster's center of mass is (heavy engines at the
// bottom pull it low). The booster flips around this point after staging.
export const BOOSTER_PIVOT_Y = BOOSTER_HEIGHT * 0.4;

// Grid fins: height of their shaft above the booster's base, and how thick
// (deep) the lattice is. The tower catches the booster under these.
export const GRID_FIN_Y = BOOSTER_HEIGHT - 3.5;
export const GRID_FIN_DEPTH = 0.5;
