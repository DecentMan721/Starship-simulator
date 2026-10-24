import { GIMBAL_LIMIT, type Gimbal } from '../components/controlSurfaces';
import type { EngineSet, FlightState } from './flightProfile';

// Bottom-right overlay: each vehicle's Raptors seen from below, Starship on
// top and Super Heavy underneath. Firing engines glow; the ones that gimbal
// shift in the direction their nozzles are pointing.

interface Engine {
    x: number;
    y: number;
    r: number;            // nozzle exit radius
    group: 'center' | 'inner' | 'outer' | 'sea' | 'vacuum';
}

// Engines evenly spaced around a ring: count, ring radius, exit radius, start angle
function ring(count: number, radius: number, exit: number, group: Engine['group'], start = 0): Engine[] {
    return Array.from({ length: count }, (_, i) => {
        const a = start + (i / count) * Math.PI * 2;
        return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, r: exit, group };
    });
}

// A diagram, not to scale: rings spread a little wider and nozzles drawn a
// little smaller than the real thing, so there's room to see each one move
const BOOSTER_ENGINES = [
    ...ring(3, 1.0, 0.45, 'center'),
    ...ring(10, 2.7, 0.45, 'inner'),
    ...ring(20, 4.3, 0.45, 'outer'),
];
const SHIP_ENGINES = [
    ...ring(3, 1.3, 0.5, 'sea'),
    ...ring(3, 3.4, 1.0, 'vacuum', Math.PI / 3),
];
const OUTLINE = 4.95;

const GIMBALS: Engine['group'][] = ['center', 'inner', 'sea'];

function isLit(e: Engine, set: EngineSet) {
    switch (set) {
        case 'all': return true;
        case 'inner13': return e.group === 'center' || e.group === 'inner';
        case 'center3': return e.group === 'center' || e.group === 'sea'; // booster center 3 / ship sea-level 3
        default: return false;
    }
}

function EngineDiagram({ name, engines, set, gimbal }: {
    name: string; engines: Engine[]; set: EngineSet; gimbal: Gimbal;
}) {
    // Real gimbal angles are only a few degrees, so the shift is
    // exaggerated: half the gimbal limit already moves a nozzle its full
    // 0.6 units. Yaw tilts toward +x (right); pitch tilts toward -z (up here).
    const shift = (deg: number) => Math.max(-1, Math.min(1, deg / (GIMBAL_LIMIT / 2))) * 0.6;
    const dx = shift(gimbal.yaw);
    const dy = -shift(gimbal.pitch);
    const lit = engines.filter(e => isLit(e, set)).length;

    return (
        <div style={{ textAlign: "center" }}>
            <svg viewBox="-5.4 -5.4 10.8 10.8" width={170} height={170} style={{ display: "block", margin: "0 auto" }}>
                <circle r={OUTLINE} fill="rgba(0,0,0,0.35)" stroke="#8a8f99" strokeWidth={0.08} />
                {engines.map((e, i) => {
                    const on = isLit(e, set);
                    const moves = GIMBALS.includes(e.group);
                    return (
                        <g key={i}>
                            {/* Where a gimballing nozzle sits when centered */}
                            {moves && (
                                <circle cx={e.x} cy={e.y} r={e.r} fill="none" stroke="#6b707a" strokeWidth={0.05} strokeDasharray="0.15 0.12" />
                            )}
                            <circle
                                cx={e.x + (moves ? dx : 0)}
                                cy={e.y + (moves ? dy : 0)}
                                r={e.r}
                                fill={on ? "#ffb347" : "#23252b"}
                                stroke={on ? "#fff3d6" : "#6b707a"}
                                strokeWidth={on ? 0.1 : 0.06}
                                style={{ filter: on ? "drop-shadow(0 0 0.3px #ff9a3c)" : undefined }}
                            />
                        </g>
                    );
                })}
            </svg>
            <div>{name}</div>
            <div style={{ color: lit ? "#ffcf8a" : "#8a8f99" }}>{lit}/{engines.length} RAPTORS</div>
        </div>
    )
}

export default function EngineOverlay({ flight, boosterGimbal, shipGimbal }: {
    flight: FlightState; boosterGimbal: Gimbal; shipGimbal: Gimbal;
}) {
    return (
        <div style={{
            position: "fixed",
            right: 14,
            bottom: 14,
            padding: "8px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            background: "rgba(10, 14, 30, 0.7)",
            borderRadius: 8,
            color: "#eee",
            fontFamily: "monospace",
            fontSize: 11,
        }}>
            <EngineDiagram name="STARSHIP" engines={SHIP_ENGINES} set={flight.ship.engines} gimbal={shipGimbal} />
            <EngineDiagram name="SUPER HEAVY" engines={BOOSTER_ENGINES} set={flight.booster.engines} gimbal={boosterGimbal} />
        </div>
    )
}
