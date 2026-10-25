import { GRID_FIN_ANGLES, type ControlSurfaces } from '../components/controlSurfaces';
import type { FlightState, VehicleState } from './flightProfile';
import type { UiLayout } from './useUiScale';

// Bottom-left overlay: flat drawings of Starship (top) and Super Heavy
// (bottom), with each fin drawn at its current angle and the number next to
// it, plus speed and altitude underneath.
//
// Both are drawn looking at the belly, with the flaps on the left/right
// edges like the 3D model. A flap folding back toward the far side looks
// narrower from here (its width × cos(angle)), which is how they're drawn.

const STEEL = "#c8c8cc";
const TILES = "#2a2a30";
const EDGE = "#9aa3ad";
const FIN = "#5d626b";
const LABEL = { fill: "#fff", fontSize: 10, fontFamily: "monospace" } as const;

const rad = (deg: number) => deg * Math.PI / 180;

// A flap outline drawn for the right side with its hinge along x = 0;
// mirrored for the left. scaleX shrinks it as it folds back.
function Flap({ points, x, y, side, angle }: {
    points: string; x: number; y: number; side: 1 | -1; angle: number;
}) {
    const width = Math.max(0.12, Math.cos(rad(angle)));
    return (
        <polygon
            points={points}
            transform={`translate(${x} ${y}) scale(${side * width} 1)`}
            fill={TILES}
            stroke={EDGE}
            strokeWidth={0.8}
        />
    );
}

function ShipDrawing({ c }: { c: ControlSurfaces }) {
    const forward = "0,0 11,4 12,13 0,19";
    const aft = "0,0 9,4 15,14 14,34 0,38";
    return (
        <svg viewBox="0 -10 140 230" width={150} height={246} style={{ display: "block", margin: "0 auto" }}>
            {/* Nose and body, belly (heat tiles) toward us */}
            <path d="M55,60 C55,30 62,14 70,14 C78,14 85,30 85,60 Z" fill={TILES} stroke={EDGE} />
            <rect x={55} y={60} width={30} height={148} fill={TILES} stroke={EDGE} />

            <Flap points={forward} x={84} y={44} side={1} angle={c.forwardFlaps[1]} />
            <Flap points={forward} x={56} y={44} side={-1} angle={c.forwardFlaps[0]} />
            <Flap points={aft} x={85} y={166} side={1} angle={c.aftFlaps[1]} />
            <Flap points={aft} x={55} y={166} side={-1} angle={c.aftFlaps[0]} />

            <text x={112} y={58} {...LABEL}>{c.forwardFlaps[1]}°</text>
            <text x={28} y={58} textAnchor="end" {...LABEL}>{c.forwardFlaps[0]}°</text>
            <text x={114} y={188} {...LABEL}>{c.aftFlaps[1]}°</text>
            <text x={26} y={188} textAnchor="end" {...LABEL}>{c.aftFlaps[0]}°</text>

            <text x={70} y={218} textAnchor="middle" {...LABEL} fill="#9ab">
                GIMBAL {c.shipGimbal.yaw.toFixed(1)}°
            </text>
        </svg>
    );
}

// Grid fins seen from the side. A fin sticking out left/right turns about
// a shaft that lies across the picture, so we see its edge tilt and grow
// taller. A fin facing us turns about a shaft pointing at us, so we see it
// rotate in the picture. Fins on the far side are drawn faint.
function GridFin({ mount, angle }: { mount: number; angle: number }) {
    const a = rad(mount);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const y = 36;

    if (Math.abs(c) > 0.7) {
        const side = c > 0 ? 1 : -1;
        const x = side > 0 ? 85 : 55;
        const height = 3 + 16 * Math.abs(Math.sin(rad(angle)));
        return (
            <g>
                <rect
                    x={side > 0 ? x : x - 20} y={y - height / 2} width={20} height={height}
                    fill={FIN} stroke={EDGE} strokeWidth={0.6}
                />
                <text x={side > 0 ? x + 24 : x - 24} y={y + 4} textAnchor={side > 0 ? "start" : "end"} {...LABEL}>
                    {angle}°
                </text>
            </g>
        );
    }

    const front = s > 0;
    return (
        <g opacity={front ? 1 : 0.4}>
            <rect
                x={58} y={y - 3} width={24} height={6}
                transform={`rotate(${angle} 70 ${y})`}
                fill={FIN} stroke={EDGE} strokeWidth={0.6}
                strokeDasharray={front ? undefined : "2 1.5"}
            />
            {/* Label above the top of the booster, where it's clear of the
                ring and side fins, with a thin line down to the fin */}
            <line x1={70} y1={-1} x2={70} y2={y - 4} stroke={EDGE} strokeWidth={0.6} strokeDasharray="1.5 1" />
            <text x={70} y={-3} textAnchor="middle" {...LABEL}>{angle}°</text>
        </g>
    );
}

function BoosterDrawing({ c }: { c: ControlSurfaces }) {
    return (
        <svg viewBox="0 -10 140 230" width={150} height={246} style={{ display: "block", margin: "0 auto" }}>
            {/* Hot-staging ring, body, engine skirt */}
            <rect x={55} y={14} width={30} height={7} fill="#4a4d55" stroke={EDGE} />
            {[59, 64, 69, 74, 79].map(x => (
                <line key={x} x1={x} y1={15} x2={x + 2.5} y2={20} stroke="#1a1b20" strokeWidth={1.5} />
            ))}
            <rect x={55} y={21} width={30} height={182} fill={STEEL} stroke={EDGE} />
            <path d="M57,203 L83,203 L81,210 L59,210 Z" fill="#55585f" />

            {GRID_FIN_ANGLES.map((mount, i) => (
                <GridFin key={mount} mount={mount} angle={c.gridFins[i] ?? 0} />
            ))}

            <text x={70} y={218} textAnchor="middle" {...LABEL} fill="#9ab">
                GIMBAL {c.boosterGimbal.yaw.toFixed(1)}°
            </text>
        </svg>
    );
}

function Stats({ name, v }: { name: string; v: VehicleState & { phase: string } }) {
    return (
        <div style={{ textAlign: "center", lineHeight: 1.45 }}>
            <div style={{ fontWeight: "bold", letterSpacing: 1 }}>{name}</div>
            <div>SPEED {Math.round(v.speed * 3.6).toLocaleString()} km/h</div>
            <div>ALTITUDE {Math.max(0, v.altitude / 1000).toFixed(1)} km</div>
            <div style={{ color: "#9ab" }}>{v.phase}</div>
        </div>
    );
}

export default function VehicleDiagrams({ flight, controls, ui }: { flight: FlightState; controls: ControlSurfaces; ui: UiLayout }) {
    return (
        <div style={{
            position: "fixed",
            left: 14,
            bottom: ui.panelBottom,
            transform: `scale(${ui.scale})`,
            transformOrigin: "bottom left",
            padding: "8px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            background: "rgba(10, 14, 30, 0.7)",
            borderRadius: 8,
            color: "#eee",
            fontFamily: "monospace",
            fontSize: 11,
        }}>
            <div>
                <ShipDrawing c={controls} />
                <Stats name="STARSHIP" v={flight.ship} />
            </div>
            <div>
                <BoosterDrawing c={controls} />
                <Stats name="SUPER HEAVY" v={flight.booster} />
            </div>
        </div>
    )
}
