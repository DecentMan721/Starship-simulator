import { useEffect, useState } from 'react';
import { FaCompress, FaExpand } from 'react-icons/fa6';

// View controls: which vehicle the camera follows, full screen, zooming
// back to the starting view, and markers showing where each vehicle is.
// Playback controls live under the timeline; telemetry is in the overlays
// along the bottom of the screen.

interface SimPanelProps {
    follow: 'booster' | 'ship';
    onFollowChange: (follow: 'booster' | 'ship') => void;
    showMarkers: boolean;
    onShowMarkersChange: (show: boolean) => void;
    onResetView: () => void;
}

// Tracks whether the page is full screen. The browser can also leave full
// screen on its own (Esc key), so listen for changes rather than assuming.
function useFullscreen() {
    const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    const toggle = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
    };
    return { isFullscreen, toggle };
}

export default function SimPanel({ follow, onFollowChange, showMarkers, onShowMarkersChange, onResetView }: SimPanelProps) {
    const { isFullscreen, toggle } = useFullscreen();

    return (
        <>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            Camera:
            {(["booster", "ship"] as const).map(f => (
                <button key={f} onClick={() => onFollowChange(f)} style={{ fontWeight: f === follow ? "bold" : "normal" }}>
                    {f === "booster" ? "Booster" : "Ship"}
                </button>
            ))}
            <button
                onClick={toggle}
                title={isFullscreen ? "Exit full screen" : "Full screen"}
                aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
                style={{ marginLeft: 6, display: "flex", alignItems: "center", padding: "3px 6px" }}
            >
                {isFullscreen ? <FaCompress size={14} /> : <FaExpand size={14} />}
            </button>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            View:
            <button onClick={onResetView} title="Zoom back to the starting view">
                Reset zoom
            </button>
            <button
                onClick={() => onShowMarkersChange(!showMarkers)}
                aria-pressed={showMarkers}
                title="Show where the booster and ship are, even far away"
                style={{ fontWeight: showMarkers ? "bold" : "normal" }}
            >
                Markers
            </button>
        </div>
        </>
    )
}
