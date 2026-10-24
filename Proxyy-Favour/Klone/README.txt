CLONE PARADOX — MODE HINTS + ECHO LABELS UPDATE

Apply this update to your existing project by replacing the matching files:
- index.html
- style.css
- game.js
- clones.js
- ui.js

Features added:
- Exactly two clones (Echo 1 and Echo 2) plus the player: three moving characters/objects total.
- Synthesized motion ticks and wall/obstacle collision sound effects, with an on/off toggle. No external audio assets needed.
- Each level shows a suggested clone mode and a short explanation.
- Labels are drawn above the clones on the canvas and update with the selected mode.
- Echo 1 is labelled PATH REPLAY; Echo 2 is labelled MIRROR, DELAYED, or REPLAY.
- Dual Replay now offsets Echo 2 slightly so both echoes are visible instead of overlapping.

Run index.html with VS Code Live Server.

Note: The suggested mode is a gameplay hint based on the current level design, not a proof that a level has only one solution. Test and tune puzzle geometry and switch conditions during playtesting.
