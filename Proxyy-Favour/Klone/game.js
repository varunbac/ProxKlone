// KLONE — Core engine supporting timer, moves, par metrics, and audio synthesis
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const player = { x: 40, y: 40, size: 24, speed: 3.2 };
const keys = {};

let audioContext = null;
let soundEnabled = true;
let bgmInterval = null;
let lastMotionSoundAt = 0;
let lastCollisionSoundAt = 0;

let gameWon = false, gameStarted = false, currentLevel = 1;
let levelData;
let shiftHeld = false;
let playerMoveCount = 0;

// Timer & Judge state variables
let levelTimerSeconds = 0;
let timerRunning = false;
let timerInterval = null;
let hasPlayerMovedThisLevel = false;
let showTimerInHud = true;

const themes = {
  1: { id: "red", bg1: "#1a0202", bg2: "#2b0505", bg3: "#0a0101", accent: "#ff1e1e", glow: "rgba(255,30,30,0.15)", wall1: "#592b2b", wall2: "#2e1414" },
  2: { id: "blue", bg1: "#020d1a", bg2: "#05182b", bg3: "#01040a", accent: "#1e8aff", glow: "rgba(30,138,255,0.15)", wall1: "#1b3b59", wall2: "#0f1e2e" },
  3: { id: "green", bg1: "#021a1a", bg2: "#052b2b", bg3: "#010a0a", accent: "#00f0ff", glow: "rgba(0,240,255,0.15)", wall1: "#184e59", wall2: "#0c272e" },
  4: { id: "purple", bg1: "#14021a", bg2: "#22052b", bg3: "#08010a", accent: "#b36bff", glow: "rgba(179,107,255,0.15)", wall1: "#3c1b59", wall2: "#1f0f2e" },
  5: { id: "amber", bg1: "#1a1002", bg2: "#2b1b05", bg3: "#0a0601", accent: "#ff9a2e", glow: "rgba(255,154,46,0.15)", wall1: "#593d1b", wall2: "#2e200f" }
};

function applyTheme(themeId) {
  const t = themes[themeId] || themes[1];
  const root = document.documentElement;
  document.body.setAttribute("data-theme", t.id);
  root.style.setProperty("--bg1", t.bg1);
  root.style.setProperty("--bg2", t.bg2);
  root.style.setProperty("--bg3", t.bg3);
  root.style.setProperty("--accent", t.accent);
  root.style.setProperty("--accent-glow", t.glow);
}

function initAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

function startBGM() {
  if (!soundEnabled || bgmInterval) return;
  initAudio();
  if (!audioContext) return;

  const chordProgression = [
    [110, 164.81, 220],     
    [98.00, 146.83, 196],   
    [87.31, 130.81, 174.61],
    [82.41, 123.47, 164.81] 
  ];
  let step = 0;

  bgmInterval = setInterval(() => {
    if (!soundEnabled || !audioContext || !timerRunning) return;
    const now = audioContext.currentTime;
    const chord = chordProgression[step % chordProgression.length];
    step++;

    chord.forEach((freq, idx) => {
      try {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = idx === 0 ? "triangle" : "sine";
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.015, now + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start(now);
        osc.stop(now + 1.5);
      } catch(e) {}
    });
  }, 1600);
}

function stopBGM() {
  if (bgmInterval) {
    clearInterval(bgmInterval);
    bgmInterval = null;
  }
}

function playTone({ frequency = 220, endFrequency = frequency, duration = 0.08, type = "sine", volume = 0.035 } = {}) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioContext) return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.015);
}

function playMotionSound() {
  const now = performance.now();
  if (now - lastMotionSoundAt < 155) return;
  lastMotionSoundAt = now;
  playTone({ frequency: 150, endFrequency: 95, duration: 0.055, type: "triangle", volume: 0.015 });
}

function playCollisionSound() {
  const now = performance.now();
  if (now - lastCollisionSoundAt < 140) return;
  lastCollisionSoundAt = now;

  if (!soundEnabled) return;
  initAudio();
  if (!audioContext) return;

  try {
    const acTime = audioContext.currentTime;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(130, acTime);
    osc.frequency.exponentialRampToValueAtTime(25, acTime + 0.18);

    gain.gain.setValueAtTime(0.22, acTime);
    gain.gain.exponentialRampToValueAtTime(0.001, acTime + 0.18);

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(acTime);
    osc.stop(acTime + 0.2);

    const bufferSize = audioContext.sampleRate * 0.1;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;
    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(450, acTime);

    const noiseGain = audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.18, acTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, acTime + 0.1);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    noise.start(acTime);
  } catch(e) {}
}

function setSoundEnabled(enabled) {
  soundEnabled = enabled;
  const button = document.getElementById("soundToggle");
  if (button) {
    button.textContent = soundEnabled ? "🔊 SOUND ON" : "🔇 SOUND OFF";
    button.setAttribute("aria-pressed", String(soundEnabled));
  }
  if (soundEnabled && gameStarted && timerRunning) {
    startBGM();
  } else {
    stopBGM();
  }
}

function toggleTimerDisplay() {
  showTimerInHud = !showTimerInHud;
  const btn = document.getElementById("timerDisplayToggle");
  if (btn) {
    btn.textContent = showTimerInHud ? "👁 TIMER VISIBLE" : "🙈 TIMER HIDDEN";
    btn.setAttribute("aria-pressed", String(showTimerInHud));
  }
  const badge = document.getElementById("hudTimerBadge");
  if (badge) {
    badge.style.display = showTimerInHud ? "inline-block" : "none";
  }
}

// Timer control functions
function startLevelTimer() {
  if (timerRunning) return;
  timerRunning = true;
  if (soundEnabled) startBGM();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!timerRunning || gameWon || !gameStarted) return;
    
    // Pause if overlays or hidden tab
    const settingsOpen = document.getElementById('settingsModalOverlay')?.classList.contains('open');
    const aiOpen = document.getElementById('aiSidePanel')?.classList.contains('open');
    const howOpen = document.getElementById('ov')?.classList.contains('on');
    const shortcutOpen = document.getElementById('levelShortcutModal')?.classList.contains('open');
    const restartOpen = document.getElementById('restartOverlay')?.classList.contains('open');
    
    if (document.hidden || settingsOpen || aiOpen || howOpen || shortcutOpen || restartOpen) {
      return;
    }

    levelTimerSeconds++;
    updateHudTimerDisplay();
  }, 1000);
}

function pauseLevelTimer() {
  timerRunning = false;
  stopBGM();
}

function resetLevelTimer() {
  timerRunning = false;
  hasPlayerMovedThisLevel = false;
  levelTimerSeconds = 0;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  updateHudTimerDisplay();
}

function formatTimeMMSS(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateHudTimerDisplay() {
  const badge = document.getElementById("hudTimerBadge");
  if (badge) {
    badge.textContent = `⏱ ${formatTimeMMSS(levelTimerSeconds)}`;
  }
}

// Level Config Object containing parMoves, parTime, and star judging rules
const levelConfigs = {
  1: { title: "SWAP BOOTCAMP", theme: 1, parMoves: 15, parTime: 30, cloneIds: [1], hints: ["Nudge: Swap Clone mirrors your moves.", "Concept: Press Q to swap positions, press F on plates to freeze clone.", "Next: Reach the exit portal."] },
  2: { title: "FROZEN VAULT", theme: 2, parMoves: 22, parTime: 45, cloneIds: [1, 2], hints: ["Nudge: Hold Shift to move Freeze clone into position.", "Concept: Coordinate swap and freeze mechanics across scrambled chambers."] },
  3: { title: "SHADOW MAZE", theme: 3, parMoves: 25, parTime: 50, cloneIds: [2, 3], hints: ["Nudge: Herd the Shy clone using your movement angles through the maze."] },
  4: { title: "MAGNETIC GRID", theme: 4, parMoves: 28, parTime: 60, cloneIds: [1, 4], hints: ["Nudge: Magnet clone drags crates into scrambled positions."] },
  5: { title: "THE ULTIMATE PARADOX", theme: 5, parMoves: 35, parTime: 75, cloneIds: [1, 4, 5], hints: ["Nudge: Sacrifice clone X and coordinate 3-point pressure activation."] }
};

function generateLevelData(n) {
  const cfg = levelConfigs[n] || levelConfigs[1];
  const boundaryWalls = [
    { x: 0, y: 0, w: 960, h: 12 },
    { x: 0, y: 528, w: 960, h: 12 },
    { x: 0, y: 0, w: 12, h: 540 },
    { x: 948, y: 0, w: 12, h: 540 }
  ];

  let levelObj;
  if (n === 1) {
    levelObj = {
      title: cfg.title, theme: cfg.theme, par: cfg.parMoves, parTime: cfg.parTime, cloneIds: cfg.cloneIds, hints: cfg.hints,
      start:{x:42,y:42}, goal:{x:870,y:215,w:50,h:110},
      walls:[
        {x:280,y:12,w:18,h:220},
        {x:280,y:320,w:18,h:208},
        {x:550,y:180,w:18,h:280}
      ],
      switches:[{x:180,y:260,w:42,h:42,kind:"single",label:"A"}],
      doors:[{x:810,y:12,w:18,h:220,requires:["A"]}],
      crates:[]
    };
  } else if (n === 2) {
    levelObj = {
      title: cfg.title, theme: cfg.theme, par: cfg.parMoves, parTime: cfg.parTime, cloneIds: cfg.cloneIds, hints: cfg.hints,
      start:{x:42,y:240}, goal:{x:870,y:215,w:50,h:110},
      walls:[
        {x:240,y:12,w:18,h:180},
        {x:240,y:300,w:18,h:228},
        {x:580,y:120,w:18,h:300},
        {x:410,y:220,w:170,h:18}
      ],
      switches:[
        {x:140,y:120,w:36,h:36,label:"A"},
        {x:480,y:420,w:36,h:36,label:"B"}
      ],
      doors:[{x:810,y:12,w:18,h:220,requires:["A","B"]}],
      crates:[]
    };
  } else if (n === 3) {
    levelObj = {
      title: cfg.title, theme: cfg.theme, par: cfg.parMoves, parTime: cfg.parTime, cloneIds: cfg.cloneIds, hints: cfg.hints,
      start:{x:42,y:240}, goal:{x:870,y:215,w:50,h:110},
      walls:[
        {x:320,y:120,w:18,h:300},
        {x:520,y:80,w:18,h:320},
        {x:200,y:260,w:120,h:18},
        {x:650,y:180,w:120,h:18}
      ],
      switches:[
        {x:220,y:140,w:36,h:36,label:"A"},
        {x:600,y:380,w:36,h:36,label:"B"}
      ],
      doors:[{x:810,y:12,w:18,h:220,requires:["A","B"]}],
      crates:[]
    };
  } else if (n === 4) {
    levelObj = {
      title: cfg.title, theme: cfg.theme, par: cfg.parMoves, parTime: cfg.parTime, cloneIds: cfg.cloneIds, hints: cfg.hints,
      start:{x:42,y:140}, goal:{x:870,y:215,w:50,h:110},
      walls:[
        {x:350,y:12,w:18,h:220},
        {x:350,y:320,w:18,h:208},
        {x:620,y:140,w:18,h:280}
      ],
      switches:[
        {x:200,y:240,w:36,h:36,label:"A"},
        {x:500,y:180,w:36,h:36,label:"B"}
      ],
      doors:[{x:810,y:12,w:18,h:220,requires:["A","B"]}],
      crates:[{x:180,y:240,w:32,h:32}]
    };
  } else {
    levelObj = {
      title: cfg.title, theme: cfg.theme, par: cfg.parMoves, parTime: cfg.parTime, cloneIds: cfg.cloneIds, hints: cfg.hints,
      start:{x:42,y:240}, goal:{x:870,y:215,w:50,h:110},
      walls:[
        {x:300,y:12,w:18,h:160},
        {x:300,y:280,w:18,h:248},
        {x:600,y:120,w:18,h:300},
        {x:450,y:240,w:150,h:18}
      ],
      switches:[
        {x:180,y:120,w:36,h:36,label:"F"},
        {x:180,y:400,w:36,h:36,label:"SACRIFICE"},
        {x:500,y:320,w:36,h:36,label:"M"}
      ],
      doors:[{x:810,y:12,w:18,h:220,requires:["F", "SACRIFICE", "M"]}],
      crates:[{x:260,y:260,w:32,h:32}]
    };
  }

  levelObj.walls = [...boundaryWalls, ...levelObj.walls];
  return levelObj;
}

function loadLevel(n) {
  currentLevel = n;
  levelData = generateLevelData(n);
  applyTheme(levelData.theme);
  player.x = levelData.start.x; 
  player.y = levelData.start.y;
  gameWon = false; 
  gameStarted = true;
  playerMoveCount = 0;
  
  resetLevelTimer();
  
  if (typeof initClonesForLevel === "function") initClonesForLevel(n, levelData.cloneIds, levelData.start);
  if (typeof updateCloneDock === "function") updateCloneDock(n);
  if (typeof resetAiHints === "function") resetAiHints();
  if (typeof showLevelShortcutModal === "function") showLevelShortcutModal(n);

  Object.keys(keys).forEach(k => keys[k] = false);
  const badge = document.getElementById("hudLevelBadge");
  const title = document.getElementById("hudLevelTitle");
  if (badge) badge.textContent = `LEVEL 0${n}`;
  if (title) title.textContent = levelData.title;
}

function startLevel(n) { loadLevel(n); }
function startGame() { loadLevel(1); }
function restartGame() { loadLevel(currentLevel); }

function rectsOverlap(a,b) {
  return a.x < b.x+b.w && a.x+a.size > b.x && a.y < b.y+b.h && a.y+a.size > b.y;
}

function activeSwitches() {
  const actors = [player, ...(typeof getClones === "function" ? getClones() : [])];
  const crates = levelData.crates || [];
  const checkObjects = [...actors, ...crates];

  return levelData.switches.filter(s => checkObjects.some(obj => {
    const r = { x: s.x, y: s.y, w: s.w, h: s.h };
    const objSize = obj.size || obj.w || 24;
    return obj.x < r.x + r.w && obj.x + objSize > r.x && obj.y < r.y + r.h && obj.y + objSize > r.y;
  })).map(s => s.label);
}

function solidObjects() {
  const active = activeSwitches();
  const sacrificeCleared = (currentLevel === 5 && (typeof sacrificeActive !== 'undefined' && !sacrificeActive));
  
  return [
    ...(levelData.walls || []),
    ...(levelData.crates || []),
    ...((levelData.doors || []).filter(d => {
      const effectiveReqs = d.requires.filter(req => !(sacrificeCleared && req === "SACRIFICE"));
      return !effectiveReqs.every(id => active.includes(id));
    }))
  ];
}

function blocked(x, y) {
  const a = { x, y, size: player.size };
  const hitSolid = solidObjects().some(o => rectsOverlap(a, { ...o, w: o.w, h: o.h }));
  if (hitSolid) return true;

  const clones = typeof getClones === 'function' ? getClones() : [];
  const hitClone = clones.some(c => rectsOverlap(a, { x: c.x, y: c.y, w: c.size, h: c.size }));
  return hitClone;
}

function updatePlayer() {
  if (!gameStarted || gameWon) return;
  let dx = 0, dy = 0;
  if(keys.w || keys.arrowup) dy -= player.speed;
  if(keys.s || keys.arrowdown) dy += player.speed;
  if(keys.a || keys.arrowleft) dx -= player.speed;
  if(keys.d || keys.arrowright) dx += player.speed;
  if(dx && dy){ dx *= 0.7071; dy *= 0.7071; }
  
  const nx = Math.max(0, Math.min(canvas.width - player.size, player.x + dx));
  const ny = Math.max(0, Math.min(canvas.height - player.size, player.y + dy));
  let collided = false;
  let moved = false;

  if(!blocked(nx, player.y)) { player.x = nx; moved = true; } else if (dx !== 0) collided = true;
  if(!blocked(player.x, ny)) { player.y = ny; moved = true; } else if (dy !== 0) collided = true;
  
  if (Math.abs(dx) > 0 || Math.abs(dy) > 0) playMotionSound();
  if (collided) playCollisionSound();

  shiftHeld = !!keys.shift;

  if (moved) {
    playerMoveCount++;
    if (!hasPlayerMovedThisLevel) {
      hasPlayerMovedThisLevel = true;
      startLevelTimer();
    }
  }

  if(typeof updateClones === "function") updateClones(player, moved, shiftHeld);

  const g = levelData.goal;
  const active = activeSwitches();
  const sacrificeCleared = (currentLevel === 5 && (typeof sacrificeActive !== 'undefined' && !sacrificeActive));
  
  const doorsOpen = levelData.doors.every(d => {
    const effectiveReqs = d.requires.filter(req => !(sacrificeCleared && req === "SACRIFICE"));
    return effectiveReqs.every(id => active.includes(id));
  });

  if(rectsOverlap(player, { x: g.x, y: g.y, w: g.w, h: g.h }) && doorsOpen) {
    gameWon = true;
    pauseLevelTimer();

    // Evaluate Rating & Save with try/catch
    const finalMoves = playerMoveCount;
    const finalSeconds = levelTimerSeconds;
    const parMoves = levelData.par;
    const parTime = levelData.parTime || 45;

    // Star judging rule: 3 stars if at or under par moves AND par time, 2 stars if meeting only one, 1 star for finishing
    let earnedStars = 1;
    const meetsMoves = finalMoves <= parMoves;
    const meetsTime = finalSeconds <= parTime;

    if (meetsMoves && meetsTime) {
      earnedStars = 3;
    } else if (meetsMoves || meetsTime) {
      earnedStars = 2;
    }

    let isNewBest = false;
    try {
      const savedData = JSON.parse(localStorage.getItem('klone_progress_v2') || '{}');
      const prevRecord = savedData[currentLevel] || { stars: 0, time: 999999, moves: 999999 };
      
      let bestStars = Math.max(prevRecord.stars || 0, earnedStars);
      let bestTime = prevRecord.time ? Math.min(prevRecord.time, finalSeconds) : finalSeconds;
      let bestMoves = prevRecord.moves ? Math.min(prevRecord.moves, finalMoves) : finalMoves;

      if (earnedStars > (prevRecord.stars || 0) || (earnedStars === prevRecord.stars && finalSeconds < (prevRecord.time || 999999))) {
        if (prevRecord.stars > 0 && (earnedStars > prevRecord.stars || finalSeconds < prevRecord.time || finalMoves < prevRecord.moves)) {
          isNewBest = true;
        }
      }
      if (prevRecord.time === undefined) isNewBest = true;

      savedData[currentLevel] = { stars: bestStars, time: bestTime, moves: bestMoves };
      savedData.unlocked = Math.max(savedData.unlocked || 1, currentLevel + 1);
      localStorage.setItem('klone_progress_v2', JSON.stringify(savedData));
    } catch(e){}

    const overlay = document.getElementById("restartOverlay");
    if(overlay) overlay.classList.add("open");
    
    const heading = document.getElementById("victoryHeaderTitle");
    if(heading) heading.textContent = "LEVEL COMPLETE";

    const details = document.getElementById("victoryDetails");
    if(details) {
      details.innerHTML = `
        <div style="font-size:22px; color:var(--accent); font-weight:bold; margin-bottom:8px;">${'★'.repeat(earnedStars)}${'☆'.repeat(3 - earnedStars)}</div>
        <div>⏱ Time: <b>${formatTimeMMSS(finalSeconds)}</b> (Par: ${formatTimeMMSS(parTime)})</div>
        <div>👟 Moves: <b>${finalMoves}</b> (Par: ${parMoves})</div>
      `;
    }

    const newBestBanner = document.getElementById("victoryNewBestBanner");
    if (newBestBanner) {
      newBestBanner.style.display = isNewBest ? "block" : "none";
    }

    const btn = document.getElementById("restartButton");
    if(btn) btn.querySelector("span").textContent = currentLevel < 5 ? "NEXT LEVEL →" : "↻ PLAY AGAIN";
  }
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.max(0, Math.min(Number(r) || 0, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();

  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }

  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawBackground() {
  const t = themes[levelData ? levelData.theme : 1];
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, t.bg1); g.addColorStop(0.55, t.bg2); g.addColorStop(1, t.bg3);
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  for(let y = 0; y < canvas.height; y += 40) {
    for(let x = 0; x < canvas.width; x += 40){
      ctx.fillStyle = ((x/40 + y/40) % 2 === 0) ? "rgba(255,255,255,.025)" : "rgba(0,0,0,.04)";
      ctx.fillRect(x + 1, y + 1, 38, 38);
    }
  }
}

function drawWall(o) {
  const t = themes[levelData ? levelData.theme : 1];
  ctx.save(); ctx.shadowColor = "#000"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  const g = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
  g.addColorStop(0, t.wall1); g.addColorStop(1, t.wall2);
  ctx.fillStyle = g; roundedRect(o.x, o.y, o.w, o.h, 4); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = t.accent + "33"; ctx.stroke();
  ctx.restore();
}

function drawWorldObjects() {
  levelData.walls.forEach(drawWall);
  const active = activeSwitches();
  const sacrificeCleared = (currentLevel === 5 && (typeof sacrificeActive !== 'undefined' && !sacrificeActive));

  levelData.doors.forEach(d => {
    const effectiveReqs = d.requires.filter(req => !(sacrificeCleared && req === "SACRIFICE"));
    const open = effectiveReqs.every(id => active.includes(id));
    
    ctx.save(); ctx.shadowColor = open ? themes[levelData.theme].accent : "#ff4f79"; ctx.shadowBlur = open ? 8 : 4;
    ctx.fillStyle = open ? "rgba(30,255,100,.12)" : "#521818";
    ctx.fillRect(d.x, d.y, d.w, d.h);
    ctx.strokeStyle = open ? "#5aff9a" : "#ff557c"; ctx.lineWidth = 2; ctx.strokeRect(d.x + 2, d.y + 2, d.w - 4, d.h - 4);
    ctx.restore();
  });

  levelData.crates.forEach(c => {
    ctx.save(); ctx.shadowColor = themes[levelData.theme].accent; ctx.shadowBlur = 5;
    const gr = ctx.createLinearGradient(c.x, c.y, c.x + c.w, c.y + c.h); gr.addColorStop(0, "#c96f2a"); gr.addColorStop(1, "#592812");
    ctx.fillStyle = gr; roundedRect(c.x, c.y, c.w, c.h, 5); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = "#ffb77a"; ctx.strokeRect(c.x + 5, c.y + 5, c.w - 10, c.h - 10);
    ctx.restore();
  });

  levelData.switches.forEach(s => {
    const on = active.includes(s.label);
    ctx.save(); ctx.shadowColor = on ? themes[levelData.theme].accent : "#ff4747"; ctx.shadowBlur = on ? 10 : 5;
    ctx.fillStyle = on ? themes[levelData.theme].accent : "#541616";
    roundedRect(s.x, s.y, s.w, s.h, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = "#fff"; ctx.font = "bold 11px Arial"; ctx.textAlign = "center"; ctx.fillText(s.label, s.x + s.w/2, s.y + s.h/2 + 4); ctx.restore();
  });
}

function drawGoal() {
  const g = levelData.goal;
  const active = activeSwitches();
  const sacrificeCleared = (currentLevel === 5 && (typeof sacrificeActive !== 'undefined' && !sacrificeActive));
  const doorsOpen = levelData.doors.every(d => {
    const effectiveReqs = d.requires.filter(req => !(sacrificeCleared && req === "SACRIFICE"));
    return effectiveReqs.every(id => active.includes(id));
  });

  const t = themes[levelData.theme];
  ctx.save(); ctx.shadowColor = t.accent; ctx.shadowBlur = 12;
  ctx.fillStyle = "#120505"; roundedRect(g.x, g.y, g.w, g.h, 10); ctx.fill();
  const grad = ctx.createLinearGradient(g.x, g.y, g.x + g.w, g.y + g.h);
  grad.addColorStop(0, doorsOpen ? t.accent : "#4a1616"); grad.addColorStop(1, "#120505");
  ctx.fillStyle = grad; roundedRect(g.x + 5, g.y + 5, g.w - 10, g.h - 10, 8); ctx.fill();
  ctx.strokeStyle = t.accent; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "bold 23px Arial"; ctx.textAlign = "center"; ctx.fillText(doorsOpen ? "✦" : "⌑", g.x + g.w/2, g.y + g.h/2 - 3);
  ctx.font = "bold 10px Arial"; ctx.fillText(doorsOpen ? "OPEN" : "LOCKED", g.x + g.w/2, g.y + g.h - 13); ctx.restore();
}

function drawActor(a, color, outline) {
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 8;
  const gr = ctx.createLinearGradient(a.x, a.y, a.x + a.size, a.y + a.size);
  gr.addColorStop(0, "#ffffff"); gr.addColorStop(.25, color); gr.addColorStop(1, outline);
  ctx.fillStyle = gr; roundedRect(a.x, a.y, a.size, a.size, 7); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = "#07111b"; ctx.fillRect(a.x + 6, a.y + 7, 3, 4); ctx.fillRect(a.x + a.size - 9, a.y + 7, 3, 4);
  ctx.restore();
}

document.addEventListener("keydown", e => {
  initAudio();
  const k = e.key.toLowerCase();
  if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," "].includes(k)) e.preventDefault();
  keys[k] = true;
  if(k === "shift") shiftHeld = true;
  if(k === "r" && gameStarted) restartGame();
  if(gameStarted) handleCloneActions(k, player);
});

document.addEventListener("keyup", e => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if(k === "shift") shiftHeld = false;
});

window.addEventListener("blur", () => {
  Object.keys(keys).forEach(k => keys[k] = false);
  shiftHeld = false;
});

function gameLoop(){
  if(levelData && gameStarted){
    updatePlayer();
    drawBackground();
    drawWorldObjects();
    drawGoal();
    drawActor(player, themes[levelData.theme].accent, "#222");
    if(typeof drawClones === "function") drawClones(ctx);
  } else {
    drawBackground();
  }
  requestAnimationFrame(gameLoop);
}
gameLoop();
