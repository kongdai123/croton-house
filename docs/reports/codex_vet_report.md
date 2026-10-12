Updated all 13 poses in `SPOTS`: **9 approximate matches; 4 impossible with the current model**. None qualifies as tight.

[Report table and individual sheets](notes/vet_report.md) · [Overview](../evidence/vet_all.jpg)

All poses pass the 0.15 m collision-clearance check. Build passes. Only `SPOTS` changed; no commit or push.

One runtime fix remains outside scope: fly-to resets selected eye heights to 1.62 m after arrival, preventing the low-camera poses from holding their alignment.