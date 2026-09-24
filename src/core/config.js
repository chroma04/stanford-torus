// Physical layout of the habitat. All distances are in metres.
//
// Coordinates used throughout the code base:
//   s — arc length around the ring, measured at the reference ground radius R0 (0 ≤ s < CIRC)
//   u — lateral offset along the spin axis (world Z), 0 at the middle of the valley
//   h — height above the reference ground level, pointing towards the spin axis
//
// World space: the spin axis is +Z. A point (s, u, h) sits at radius R0 - h from
// the axis, at angle s / R0 around it.

export const R0 = 880; // radius of the reference ground level (h = 0)
export const TUBE_HC = 30; // height of the tube's centre line above h = 0
export const TUBE_R = 66; // minor radius of the tube (130 m class tube like the 1975 study)
export const TUBE_TOP = TUBE_HC + TUBE_R; // 96 m — the ceiling / window line
export const CIRC = 2 * Math.PI * R0;

// Spin: 1g at the reference ground radius (≈ 1 rpm).
export const G = 9.81;
export const OMEGA = Math.sqrt(G / R0);

export const SPOKES = 6;
export const SPOKE_SPACING = CIRC / SPOKES;

// World streaming.
export const SECTORS = 96;
export const SECTOR_LEN = CIRC / SECTORS; // 57.6 m
export const ROWS_PER_SECTOR = 48;
export const ROW_DS = SECTOR_LEN / ROWS_PER_SECTOR; // 1.2 m terrain rows
export const CELLS_PER_SECTOR = 5;
export const CELL_LEN = SECTOR_LEN / CELLS_PER_SECTOR; // 11.52 m layout cells
export const TOTAL_CELLS = SECTORS * CELLS_PER_SECTOR;

// Terrain.
export const TERRACES = 4;
export const WATER_H = -0.6;

// The skylight: the band of the tube within this angle of the top is open glazing.
export const WINDOW_HALF_ANGLE = (38 * Math.PI) / 180;

// Wall-mounted monorail.
export const RAIL_H = 44;
export const RAIL_U = -61.2;

// Player.
export const EYE_HEIGHT = 1.68;
export const WALK_SPEED = 4.2;
export const RUN_SPEED = 9.0;
export const MAX_STEP = 0.55;
