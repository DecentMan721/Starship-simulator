import { useEffect, useMemo, useRef, useState } from 'react';
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

    // Only recomputed when the time changes
    const flight = useMemo(() => sampleFlight(time), [time]);
    const commands = useMemo(() => autopilot(flight), [flight]);

    return {
        time, setTime, playing, setPlaying, speed, setSpeed,
        flight, commands,
        reset: () => {
            setPlaying(false);
            setTime(SIM_START);
        },
    };
}
