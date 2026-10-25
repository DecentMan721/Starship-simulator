import { useRef, useState } from 'react';
import { FaPause, FaPlay, FaRotateLeft } from 'react-icons/fa6';
import { SIM_END, SIM_START, TIMELINE_EVENTS } from './flightProfile';
import type { useFlightPlayback } from './useFlightPlayback';
import type { UiLayout } from './useUiScale';

// Webcast-style mission timeline, fixed at the bottom center of the screen:
// a gently curved arc with the milestones as circles (hover for the name),
// a dot for "now", the T-/T+ clock centered under it, and restart,
// play/pause and playback speed below that. Click or drag anywhere along
// the arc to jump to that moment.

// Drawn in a 1000 × 110 box and scaled to fit. The arc is a slice of a big
// circle: 940 wide, rising 40 in the middle.
const W = 1000;
const H = 110;
const CHORD = 940;
const SAG = 40;
const R = (CHORD ** 2 / 4 + SAG ** 2) / (2 * SAG);  // circle radius that gives that curve
const CX = W / 2;
const TOP = 30;                                     // y of the arc's highest point
const CY = TOP + R;                                 // circle center, far below
const HALF_ANGLE = Math.asin(CHORD / 2 / R);

// Time → fraction along the arc (0 = left end) → angle → point.
// The flight is an hour long but most of the action is in the first ten
// minutes, so those get the left 55% of the arc and the long coast, entry
// and splashdown share the rest.
const SPLIT_T = 620;
const SPLIT_F = 0.55;
function fractionOf(t: number) {
    if (t <= SPLIT_T) return SPLIT_F * (t - SIM_START) / (SPLIT_T - SIM_START);
    return SPLIT_F + (1 - SPLIT_F) * (t - SPLIT_T) / (SIM_END - SPLIT_T);
}
function timeAt(fraction: number) {
    if (fraction <= SPLIT_F) return SIM_START + fraction / SPLIT_F * (SPLIT_T - SIM_START);
    return SPLIT_T + (fraction - SPLIT_F) / (1 - SPLIT_F) * (SIM_END - SPLIT_T);
}
function pointAt(fraction: number) {
    const a = -HALF_ANGLE + 2 * HALF_ANGLE * fraction;
    return { x: CX + R * Math.sin(a), y: CY - R * Math.cos(a) };
}

// SVG path for the arc from one fraction to another
function arcPath(from: number, to: number) {
    const a = pointAt(from);
    const b = pointAt(to);
    return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`;
}

function missionClock(t: number) {
    const sign = t < 0 ? '-' : '+';
    const s = Math.floor(Math.abs(t));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `T${sign} ${hh}:${mm}:${ss}`;
}

const SPEEDS = [1, 2, 5, 10, 25, 50];

interface Props {
    playback: ReturnType<typeof useFlightPlayback>;
    ui: UiLayout;
}

export default function MissionTimeline({ playback, ui }: Props) {
    const { time, setTime: onSeek, playing, setPlaying, speed, setSpeed, reset } = playback;
    const svgRef = useRef<SVGSVGElement>(null);
    const [hovered, setHovered] = useState<number | null>(null);
    const dragging = useRef(false);

    // Screen position → time: convert to the SVG's own coordinates, then
    // invert pointAt (the angle comes from how far left/right of center)
    function seekTo(e: React.PointerEvent) {
        const svg = svgRef.current;
        const ctm = svg?.getScreenCTM();
        if (!svg || !ctm) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
        const a = Math.asin(Math.max(-1, Math.min(1, (p.x - CX) / R)));
        const fraction = Math.max(0, Math.min(1, (a + HALF_ANGLE) / (2 * HALF_ANGLE)));
        onSeek(timeAt(fraction));
    }

    const now = fractionOf(time);
    const nowPoint = pointAt(now);
    const event = hovered !== null ? TIMELINE_EVENTS[hovered] : null;

    return (
        <div style={{
            position: "fixed",
            left: "50%",
            bottom: 14,
            transform: `translateX(-50%) scale(${ui.timelineScale})`,
            transformOrigin: "bottom center",
            // As wide as fits between the bottom-left and bottom-right overlays
            width: ui.timelineWidth,
            userSelect: "none",
        }}>
            <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                style={{ width: "100%", display: "block", overflow: "visible", cursor: "pointer", touchAction: "none" }}
                onPointerDown={e => {
                    dragging.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    seekTo(e);
                }}
                onPointerMove={e => dragging.current && seekTo(e)}
                onPointerUp={() => { dragging.current = false; }}
            >
                {/* Fat invisible copy of the arc: an easy target to grab */}
                <path d={arcPath(0, 1)} stroke="transparent" strokeWidth={24} fill="none" />

                {/* Dark halo under the track so it reads over bright plumes and sky */}
                <path d={arcPath(0, 1)} stroke="rgba(0,0,0,0.45)" strokeWidth={8} fill="none" strokeLinecap="round" />

                {/* Track, then the part already flown */}
                <path d={arcPath(0, 1)} stroke="rgba(255,255,255,0.35)" strokeWidth={3} fill="none" />
                <path d={arcPath(0, now)} stroke="#fff" strokeWidth={4} fill="none" />

                {TIMELINE_EVENTS.map((ev, i) => {
                    const p = pointAt(fractionOf(ev.t));
                    const past = ev.t <= time;
                    return (
                        <g
                            key={ev.label}
                            onPointerEnter={() => setHovered(i)}
                            onPointerLeave={() => setHovered(h => (h === i ? null : h))}
                        >
                            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                            <circle
                                cx={p.x} cy={p.y} r={hovered === i ? 9 : 7}
                                fill={past ? "#fff" : "rgba(10,14,30,0.9)"}
                                stroke="#fff" strokeWidth={2}
                            />
                        </g>
                    );
                })}

                {/* Now */}
                <circle cx={nowPoint.x} cy={nowPoint.y} r={10} fill="rgba(255,255,255,0.25)" />
                <circle cx={nowPoint.x} cy={nowPoint.y} r={5} fill="#fff" />

                {/* Hover label above the circle */}
                {event && (() => {
                    const p = pointAt(fractionOf(event.t));
                    const text = `${event.label} · ${missionClock(event.t)}`;
                    const width = text.length * 7 + 16;
                    return (
                        <g pointerEvents="none">
                            <rect x={p.x - width / 2} y={p.y - 36} width={width} height={22} rx={4} fill="rgba(10,14,30,0.9)" />
                            <text x={p.x} y={p.y - 21} textAnchor="middle" fill="#fff" fontSize={12} fontFamily="monospace">
                                {text}
                            </text>
                        </g>
                    );
                })()}

                {/* Clock, centered under the arc */}
                <text
                    x={CX} y={TOP + 50} textAnchor="middle" fill="#fff"
                    fontSize={34} fontWeight="bold" fontFamily="monospace"
                    // Dark outline drawn behind the letters, for the same reason
                    stroke="rgba(0,0,0,0.6)" strokeWidth={5} paintOrder="stroke" strokeLinejoin="round"
                    pointerEvents="none"
                >
                    {missionClock(time)}
                </text>
            </svg>

            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 2 }}>
                <button onClick={reset} style={ROUND} title="Restart" aria-label="Restart">
                    <FaRotateLeft size={14} />
                </button>
                <button
                    onClick={() => setPlaying(!playing)}
                    disabled={time >= SIM_END}
                    style={{ ...ROUND, width: 44, height: 44, background: "#fff", color: "#0a0e1e" }}
                    title={playing ? "Pause" : "Play"}
                    aria-label={playing ? "Pause" : "Play"}
                >
                    {/* The play triangle looks off-center unless nudged right */}
                    {playing ? <FaPause size={16} /> : <FaPlay size={16} style={{ marginLeft: 3 }} />}
                </button>
                <select
                    value={speed}
                    onChange={e => setSpeed(Number(e.target.value))}
                    style={SPEED}
                    title="Playback speed"
                    aria-label="Playback speed"
                >
                    {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
                </select>
            </div>
        </div>
    )
}

const ROUND = {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.45)",
    background: "rgba(10, 14, 30, 0.75)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    cursor: "pointer",
} as const;

const SPEED = {
    height: 34,
    borderRadius: 17,
    border: "1px solid rgba(255,255,255,0.45)",
    background: "rgba(10, 14, 30, 0.75)",
    color: "#fff",
    padding: "0 10px",
    fontFamily: "monospace",
    fontSize: 13,
    cursor: "pointer",
} as const;
