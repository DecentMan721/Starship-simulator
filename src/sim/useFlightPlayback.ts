import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autopilot } from './autopilot';
import { SIM_END, SIM_START, sampleFlight } from './flightProfile';

// Plays the flight back: owns the clock (mission time, play/pause, speed)
// and turns the current time into the full state of the flight.
export function useFlightPlayback() {
    const [time, setTime] = useState(SIM_START);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);

    // Kept in a ref so the frame loop can read the latest value without
    // restarting every time it changes
    const timeRef = useRef(time);
    useEffect(() => {
        timeRef.current = time;
    }, [time]);

    useEffect(() => {
        if (!playing) return;
        let last = performance.now();
        let frame = requestAnimationFrame(function tick(now) {
            const dt = (now - last) / 1000;
            last = now;
            const next = Math.min(SIM_END, timeRef.current + dt * speed);
            timeRef.current = next;
            setTime(next);
            if (next >= SIM_END) {
                setPlaying(false);
                return;
            }
            frame = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(frame);
    }, [playing, speed]);

    // Jump to a time. The ref is updated right away too: if it waited for
    // the effect above, a playing frame loop could still read the old time
    // and snap back to it, which makes dragging the timeline stutter.
    const seek = useCallback((t: number) => {
        const next = Math.min(SIM_END, Math.max(SIM_START, t));
        timeRef.current = next;
        setTime(next);
    }, []);

    // Only recomputed when the time changes
    const flight = useMemo(() => sampleFlight(time), [time]);
    const commands = useMemo(() => autopilot(flight), [flight]);

    return {
        time, setTime: seek, playing, setPlaying, speed, setSpeed,
        flight, commands,
        reset: () => {
            setPlaying(false);
            seek(SIM_START);
        },
    };
}
