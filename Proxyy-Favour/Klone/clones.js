// KLONE — Multi-clone cooperation system with strict queue tracking and actor collision rules

const cloneModes = {
  1: { id: 1, name: "Swap Clone", color: "#8be9ff", icon: "⇄", rule: "Mirrors moves. Press Q to swap. Press F while on a plate to freeze it in place.", keyHint: "Q / F", level: 1 },
  2: { id: 2, name: "Freeze Clone", color: "#b36bff", icon: "❄", rule: "Copies moves while holding Shift. Press F on a plate to lock.", keyHint: "Shift / F", level: 2 },
  3: { id: 3, name: "Shy Clone", color: "#ff9a2e", icon: "👁", rule: "Moves away when close. Press F while on a plate to lock.", keyHint: "F", level: 3 },
  4: { id: 4, name: "Magnet Clone", color: "#5aff9a", icon: "🧲", rule: "Mirrors moves and drags crates. Press F on a plate to lock.", keyHint: "F", level: 4 },
  5: { id: 5, name: "Sacrifice Clone", color: "#ffd27a", icon: "✦", rule: "Mirrors moves. Press X to destroy, or F on a plate to lock.", keyHint: "X / F", level: 5 }
};

const cloneConfig = {
  cloneSize: 24
};

let clones = [];
let sacrificeActive = true;

function getClones() { return clones; }

function initClonesForLevel(levelNum, activeCloneIds, startPos, switches) {
  clones = [];
  sacrificeActive = true;

  const sx = startPos ? startPos.x : 42;
  const sy = startPos ? startPos.y : 42;

  // Fallback to levelData.switches if switches argument is missing
  const levelSwitches = switches || (typeof levelData !== 'undefined' && levelData ? levelData.switches : []);

  if (Array.isArray(activeCloneIds)) {
    activeCloneIds.forEach((id, index) => {
      let spawnX, spawnY;

      // Rule 1 Fixed: Spawn the Swap Clone (ID 1) very close to its pressure tile
      if (id === 1 && levelSwitches && levelSwitches.length > 0) {
        const targetSwitch = levelSwitches[0];
        spawnX = targetSwitch.x - 30; // Positioned right next to the plate
        spawnY = targetSwitch.y + (targetSwitch.h / 2) - (cloneConfig.cloneSize / 2);
      } else {
        spawnX = sx + 140 + 80 * index;
        spawnY = sy + (index % 2 === 0 ? 60 : -60);
      }

      clones.push({
        id: id,
        name: cloneModes[id] ? cloneModes[id].name : "Clone",
        x: spawnX,
        y: spawnY,
        size: cloneConfig.cloneSize,
        kind: id,
        color: cloneModes[id] ? cloneModes[id].color : "#fff",
        spawnOrigin: { x: spawnX, y: spawnY },
        playerOriginSnapshot: { x: sx, y: sy },
        isFrozenOnPlate: false
      });
    });
  }
}

function isCloneOnSwitch(clone) {
  if (typeof levelData === 'undefined' || !levelData || !levelData.switches) return false;
  return levelData.switches.some(s => {
    return clone.x < s.x + s.w && clone.x + clone.size > s.x &&
           clone.y < s.y + s.h && clone.y + clone.size > s.y;
  });
}

function isCloneBlocked(x, y, size = 24, excludeClone = null, player = null) {
  if (typeof levelData === 'undefined' || !levelData) return false;
  const a = { x, y, size };

  const active = (typeof activeSwitches === 'function') ? activeSwitches() : [];
  const solids = [
    ...(levelData.walls || []),
    ...(levelData.crates || []),
    ...((levelData.doors || []).filter(d => !d.requires.every(id => active.includes(id))))
  ];

  const hitSolid = solids.some(o => a.x < o.x + o.w && a.x + a.size > o.x && a.y < o.y + o.h && a.y + a.size > o.y);
  if (hitSolid) return true;

  if (player && a.x < player.x + player.size && a.x + a.size > player.x && a.y < player.y + player.size && a.y + a.size > player.y) {
    return true;
  }

  const hitOtherClone = clones.some(c => {
    if (c === excludeClone) return false;
    return a.x < c.x + c.size && a.x + a.size > c.x && a.y < c.y + c.size && a.y + a.size > c.y;
  });

  return hitOtherClone;
}

function updateClones(player, playerMoved, shiftHeld) {
  clones.forEach((clone) => {
    if (clone.isFrozenOnPlate) {
      return;
    }

    let targetX = clone.x;
    let targetY = clone.y;

    if (clone.kind === 1 || clone.kind === 4 || clone.kind === 5) {
      const base = clone.playerOriginSnapshot || { x: 42, y: 42 };
      const deltaX = player.x - base.x;
      const deltaY = player.y - base.y;
      targetX = clone.spawnOrigin.x - deltaX;
      targetY = clone.spawnOrigin.y - deltaY;

      if (clone.kind === 4 && levelData && levelData.crates) {
        const mDx = targetX - clone.x;
        const mDy = targetY - clone.y;
        levelData.crates.forEach(crate => {
          const cDist = Math.hypot(crate.x - clone.x, crate.y - clone.y);
          if (cDist < 45) {
            const cNewX = crate.x + mDx;
            const cNewY = crate.y + mDy;
            if (!isCloneBlocked(cNewX, cNewY, crate.w, clone, player)) {
              crate.x = cNewX;
              crate.y = cNewY;
            }
          }
        });
      }
    } 
    else if (clone.kind === 2) {
      if (shiftHeld && playerMoved) {
        const pDx = player.x - (clone.lastPlayerX || player.x);
        const pDy = player.y - (clone.lastPlayerY || player.y);
        targetX = clone.x + pDx;
        targetY = clone.y + pDy;
      }
    } 
    else if (clone.kind === 3) {
      const dist = Math.hypot(player.x - clone.x, player.y - clone.y);
      if (dist < 85 && playerMoved) {
        const angle = Math.atan2(clone.y - player.y, clone.x - player.x);
        targetX = clone.x + Math.cos(angle) * 3.2;
        targetY = clone.y + Math.sin(angle) * 3.2;
      }
    }

    clone.lastPlayerX = player.x;
    clone.lastPlayerY = player.y;

    // Rule 2 Fixed: Prevent wall-crossing by checking X and Y movements independently 
    // with full collision validation, preventing diagonal clipping through solid boundaries.
    if (!isCloneBlocked(targetX, clone.y, clone.size, clone, player)) {
      clone.x = targetX;
    }
    if (!isCloneBlocked(clone.x, targetY, clone.size, clone, player)) {
      clone.y = targetY;
    }
  });
}

function handleCloneActions(key, player) {
  const k = key.toLowerCase();
  
  if (k === 'q') {
    const swapClone = clones.find(c => c.kind === 1);
    if (swapClone && !swapClone.isFrozenOnPlate) {
      const tempX = player.x;
      const tempY = player.y;
      if (!isCloneBlocked(swapClone.x, swapClone.y, player.size, swapClone, null) && 
          !isCloneBlocked(tempX, tempY, swapClone.size, null, null)) {
        player.x = swapClone.x;
        player.y = swapClone.y;
        swapClone.x = tempX;
        swapClone.y = tempY;

        swapClone.spawnOrigin = { x: tempX, y: tempY };
        swapClone.playerOriginSnapshot = { x: player.x, y: player.y };
      }
    }
  }

  if (k === 'f') {
    let closestClone = null;
    let minDist = Infinity;

    clones.forEach(c => {
      const dist = Math.hypot(player.x - c.x, player.y - c.y);
      if (dist < minDist) {
        minDist = dist;
        closestClone = c;
      }
    });

    if (closestClone) {
      if (closestClone.isFrozenOnPlate) {
        closestClone.isFrozenOnPlate = false;
        closestClone.spawnOrigin = { x: closestClone.x, y: closestClone.y };
        closestClone.playerOriginSnapshot = { x: player.x, y: player.y };
      } else if (isCloneOnSwitch(closestClone)) {
        closestClone.isFrozenOnPlate = true;
      }
    }
  }

  if (k === 'x' && sacrificeActive) {
    const sacIndex = clones.findIndex(c => c.kind === 5);
    if (sacIndex !== -1) {
      const sac = clones[sacIndex];
      const dist = Math.hypot(player.x - sac.x, player.y - sac.y);
      if (dist < 45 && !sac.isFrozenOnPlate) {
        clones.splice(sacIndex, 1);
        sacrificeActive = false;
      }
    }
  }
}

function drawClones(ctx) {
  clones.forEach((c) => {
    ctx.save();
    
    const isFrozen = c.isFrozenOnPlate;
    const drawColor = isFrozen ? "#00f0ff" : c.color;

    ctx.shadowColor = drawColor;
    ctx.shadowBlur = 8;
    const g = ctx.createLinearGradient(c.x, c.y, c.x + c.size, c.y + c.size);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(.3, drawColor);
    g.addColorStop(1, "#111");
    ctx.fillStyle = g;
    roundedRect(c.x, c.y, c.size, c.size, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isFrozen ? "#00f0ff" : "#ffffffaa";
    ctx.lineWidth = isFrozen ? 2.5 : 1.5;
    ctx.stroke();
    ctx.fillStyle = "#07111b";
    ctx.fillRect(c.x + 6, c.y + 7, 3, 4);
    ctx.fillRect(c.x + c.size - 9, c.y + 7, 3, 4);

    const cloneInfo = cloneModes[c.kind];
    let labelText = cloneInfo ? `${cloneInfo.icon} ${cloneInfo.name}` : c.name;
    if (isFrozen) labelText += " [FROZEN]";

    ctx.font = "bold 11px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = drawColor;
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 3;
    ctx.fillText(labelText, c.x + c.size / 2, c.y - 6);

    ctx.restore();
  });
}

function resetClonesState() {
  clones = [];
  sacrificeActive = true;
  if (typeof currentLevel !== 'undefined' && typeof levelData !== 'undefined') {
    initClonesForLevel(currentLevel, levelData.cloneIds, levelData.start, levelData.switches);
  }
}

//Final Changes Done
