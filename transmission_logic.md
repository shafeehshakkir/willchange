# Context: Manual Transmission Physics Model

I need to implement realistic manual transmission and engine physics for this project. The system must calculate a virtual `RPM` (revolutions per minute) and a virtual vehicle `Speed` (which controls the MP3's `playbackRate`). 

Please mimic the following mechanical behaviors and math in our update loop.

## 1. Core State Variables
Set up these constants and state variables in the engine logic:
*   `IDLE_RPM = 800`: The engine's resting RPM.
*   `MAX_RPM = 7000`: The redline limit.
*   `STALL_RPM = 400`: If RPM drops below this while in gear, the engine dies.
*   `currentRPM = 800`: The dynamic gauge value.
*   `virtualSpeed = 0`: The momentum of the car (maps directly to song `playbackRate`, where `1.0` speed = normal song speed).

## 2. Gear Ratios
Define an array or dictionary of gear ratios. Lower gears multiply the RPM much faster relative to speed.
*   Neutral (N): `Ratio = 0`
*   Gear 1: `Ratio = 3.5`
*   Gear 2: `Ratio = 2.0`
*   Gear 3: `Ratio = 1.4`
*   Gear 4: `Ratio = 1.0`
*   Gear 5: `Ratio = 0.8`
*   Gear 6: `Ratio = 0.6`

## 3. The Physics Loop (Calculated every frame)
The engine behaves differently based on the status of the **Clutch** (`0.0` = released/engaged, `1.0` = fully depressed/disconnected).

### State A: Clutch is Depressed (Neutral or Disconnected)
When the clutch is `> 0.8` (or the car is in Neutral), the engine is physically disconnected from the wheels.
*   **RPM Logic:** The RPM is dictated purely by the Throttle input. 
    *   $Target RPM = IDLE\_RPM + (Throttle \times (MAX\_RPM - IDLE\_RPM))$
    *   Lerp the `currentRPM` toward this target smoothly. If throttle is released, RPM should drop quickly back to `IDLE_RPM`.
*   **Speed Logic:** `virtualSpeed` slowly decays (coasting) due to friction.

### State B: Clutch is Released (In Gear)
When the clutch is `< 0.2` and a gear is selected, the engine is physically locked to the wheels.
*   **Speed Logic:** The throttle adds acceleration to `virtualSpeed`. The acceleration amount is heavily multiplied by the current Gear Ratio (1st gear accelerates fast, 6th gear accelerates slowly).
*   **RPM Logic:** The RPM is strictly locked to the vehicle's speed and the gear ratio.
    *   $Target RPM = (virtualSpeed \times Base Multiplier) \times Current Gear Ratio$ 
    *   *(Note: Tune the `Base Multiplier` so that at normal song speed (`virtualSpeed = 1.0`) in 4th gear, the RPM is around 3000).*
    *   Lerp the `currentRPM` tightly to this value.

## 4. The Shifting Sequence (How the Rev Meter Behaves)
When the user shifts, the system should execute this exact sequence:
1.  **Accelerating in 1st:** `virtualSpeed` increases. Because the 1st gear ratio is high (`3.5`), `currentRPM` climbs very rapidly toward `MAX_RPM`.
2.  **Clutch In:** User presses the clutch (`> 0.8`). The engine disconnects. Because they likely released the throttle, `currentRPM` rapidly drops toward `IDLE_RPM` (800). `virtualSpeed` stops increasing and begins to coast.
3.  **Change Gear:** User moves the stick to 2nd Gear. 
4.  **Clutch Out:** User releases the clutch (`< 0.2`). The engine reconnects to the wheels. Because 2nd gear has a lower ratio (`2.0`), the $Target RPM$ for the current speed is much lower. 
5.  **The Rev Match (RPM Drop):** The `currentRPM` instantly snaps/lerps to this new, lower RPM value. If the user didn't apply throttle to match it, the car jerks (briefly slow down `virtualSpeed`). 

## 5. Stalling & Grinding Edge Cases
*   **Stalling:** If the user is at `0` speed, is in 1st gear, and releases the clutch without applying enough throttle, the math will force the $Target RPM$ to `0`. If `currentRPM` falls below `STALL_RPM` (400), trigger the stall state. Set song `playbackRate = 0` and play stall SFX.
*   **Grinding:** If the user changes the gear variable while the clutch is `< 0.85`, reject the gear change, play the `gear_grind.wav` sound effect, and do not update the gear state.
*   **Redlining:** If `currentRPM >= MAX_RPM`, cap the RPM, apply audio distortion to the Web Audio node, and stop increasing `virtualSpeed` regardless of throttle input.