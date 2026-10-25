import StarShip from "../components/StarShip";

import { useState } from "react";
import EngineOverlay from "../sim/EngineOverlay";
import MissionTimeline from "../sim/MissionTimeline";
import SimPanel from "../sim/SimPanel";
import VehicleDiagrams from "../sim/VehicleDiagrams";
import { useFlightPlayback } from "../sim/useFlightPlayback";
import { useUiScale } from "../sim/useUiScale";


// The flight simulator: the flight profile and autopilot drive the rocket,
// tower and every control surface; the overlays show what they're doing
export default function Home() {

    const [follow, setFollow] = useState<"booster" | "ship">("booster")
    const playback = useFlightPlayback()
    const { flight, commands } = playback
    const ui = useUiScale()


    return (
        <main>

            <div style={{
                position: "fixed",
                top: 16,
                right: 16,
                padding: 12,
                background: "rgba(20, 22, 35, 0.85)",
                color: "#eee",
                fontFamily: "monospace",
                fontSize: 13,
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                transform: `scale(${ui.scale})`,
                transformOrigin: "top right",
            }}>
                <SimPanel follow={follow} onFollowChange={setFollow} />
            </div>

            <VehicleDiagrams flight={flight} controls={commands.controls} ui={ui} />
            <MissionTimeline playback={playback} ui={ui} />
            <EngineOverlay
                flight={flight}
                boosterGimbal={commands.controls.boosterGimbal}
                shipGimbal={commands.controls.shipGimbal}
                ui={ui}
            />

            <StarShip
                controlSurfaces={commands.controls}
                tower={commands.tower}
                sim={flight}
                follow={follow}
                creditsAtTop={ui.scale < 1}
            />
        </main>
    )
}
