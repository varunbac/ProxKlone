// UI overlays, How to Play tabs, Developers modal, Control Dock, Level Select & AI Support
(function(){
  var homeStage = document.getElementById('homeStage');
  var gamePlayContainer = document.getElementById('gamePlayContainer');
  var howBtn = document.getElementById('how');
  var startBtn = document.getElementById('start');
  var levelOverlay = document.getElementById('levelOverlay');
  var backToStart = document.getElementById('backToStart');
  var goModal = document.getElementById('goModal');
  var count = document.getElementById('count');
  var msg = document.getElementById('goMsg');
  var restartOverlay = document.getElementById('restartOverlay');
  var restartButton = document.getElementById('restartButton');
  var settingsModalOverlay = document.getElementById('settingsModalOverlay');
  var exitToHomeBtn = document.getElementById('exitToHomeBtn');
  var devsModal = document.getElementById('devsModal');
  var devsBtn = document.getElementById('devs');

  var levelShortcutModal = document.getElementById('levelShortcutModal');
  var closeLevelShortcutBtn = document.getElementById('closeLevelShortcutBtn');

  var timer = null;

  // Global theme switcher helper for pill buttons
  window.applyThemeByStr = function(themeName, themeNum) {
    if (typeof applyTheme === 'function') {
      applyTheme(themeNum);
    }
    document.body.setAttribute("data-theme", themeName);
    
    // Highlight active pill button
    const pills = document.querySelectorAll('.theme-pill');
    pills.forEach(p => {
      if (p.getAttribute('data-theme-val') === themeName) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });
  };

  // Developer mode click counter logic (5 clicks)
  let devClicks = 0;
  let developerModeActive = false;
  const devTriggerBtn = document.getElementById('devModeTriggerBtn');
  
  if (devTriggerBtn) {
    devTriggerBtn.onclick = function() {
      devClicks++;
      if (devClicks >= 5 && !developerModeActive) {
        developerModeActive = true;
        devTriggerBtn.textContent = "🔓 DEV MODE ACTIVE";
        devTriggerBtn.style.color = "#5aff9a";
        devTriggerBtn.style.borderColor = "#5aff9a";
        devTriggerBtn.title = "Developer mode active. All chambers are unlocked.";
      } else if (!developerModeActive) {
        const remaining = 5 - devClicks;
        devTriggerBtn.textContent = `v2.0.4 (${remaining} clicks left)`;
      }
    };
  }

  // Developers modal
  if (devsBtn && devsModal) {
    devsBtn.onclick = function() { devsModal.classList.add('open'); };
    devsModal.addEventListener('click', function(e) {
      if (e.target === devsModal || e.target.hasAttribute('data-close-devs')) {
        devsModal.classList.remove('open');
      }
    });
  }

  // How to play pop-up
  var names = ['Goal','Controls','Clones','Board','Tips'];
  var icons = ['1','2','3','4','5'];
  var panes = [].slice.call(document.querySelectorAll('.pane'));
  var tabs = document.getElementById('tabs');
  var dots = document.getElementById('dots');
  var ov = document.getElementById('ov');
  var back = document.getElementById('back');
  var next = document.getElementById('next');
  var cur = 0;

  if (tabs && tabs.children.length === 0) {
    names.forEach(function(n,i){
      var t = document.createElement('button'); t.className = 'tab'; t.setAttribute('role', 'tab'); t.innerHTML = '<i>' + icons[i] + '</i><span>' + n + '</span>';
      t.onclick = function(){ go(i); }; tabs.appendChild(t);
      var d = document.createElement('button'); d.className = 'dot'; d.setAttribute('aria-label', n); d.onclick = function(){ go(i); }; dots.appendChild(d);
    });
  }

  function go(i){
    cur = Math.max(0, Math.min(names.length - 1, i));
    panes.forEach(function(p, k){ p.classList.toggle('on', k === cur); });
    if (tabs) [].forEach.call(tabs.children, function(t, k){ t.setAttribute('aria-selected', k === cur); });
    if (dots) [].forEach.call(dots.children, function(d, k){ d.classList.toggle('on', k === cur); });
    if (back) back.disabled = cur === 0;
    if (next && next.firstChild) {
      next.firstChild.textContent = cur === names.length - 1 ? "GOT IT, LET’S PLAY" : 'NEXT';
    }
    var stageEl = document.getElementById('stage');
    if (stageEl) stageEl.scrollTop = 0;
  }

  function closeRules(){
    try {
      var neverBox = document.getElementById('never');
      if (neverBox && neverBox.checked) localStorage.setItem('klone_seen_rules', '1');
    } catch(e){}
    if (ov) ov.classList.remove('on');
  }

  if (next) next.onclick = function(){ cur === names.length - 1 ? closeRules() : go(cur + 1); };
  if (back) back.onclick = function(){ go(cur - 1); };
  var closeBtnX = document.getElementById('x');
  if (closeBtnX) closeBtnX.onclick = closeRules;
  if (howBtn && ov) howBtn.onclick = function(){ ov.classList.add('on'); go(0); };

  // Displays round-specific controls below playing zone
  window.updateCloneDock = function(lvl) {
    const controlsContainer = document.getElementById('levelActiveControlsList');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = "";
    
    const activeIds = (typeof levelData !== 'undefined' && levelData && levelData.cloneIds) ? levelData.cloneIds : [];
    
    activeIds.forEach(i => {
      const cloneInfo = cloneModes[i];
      if (!cloneInfo) return;
      
      const badge = document.createElement('div');
      badge.className = 'level-control-badge';
      badge.style.borderColor = cloneInfo.color;
      badge.innerHTML = `
        <span class="key-tag" style="background:${cloneInfo.color}; color:#000;">${cloneInfo.keyHint}</span>
        <div class="desc-box">
          <b>${cloneInfo.name}</b>
          <p>${cloneInfo.rule}</p>
        </div>
      `;
      controlsContainer.appendChild(badge);
    });

    updateSettingsQuickControls(activeIds);
  };

  // Pops up chamber shortcut info banner at level start
  window.showLevelShortcutModal = function(lvl) {
    if (!levelShortcutModal) return;
    const activeIds = (typeof levelData !== 'undefined' && levelData && levelData.cloneIds) ? levelData.cloneIds : [];
    const container = document.getElementById('shortcutPopupList');
    if (!container) return;

    container.innerHTML = "";
    activeIds.forEach(i => {
      const mode = cloneModes[i];
      const div = document.createElement('div');
      div.className = 'shortcut-pop-item';
      div.style.borderLeft = `4px solid ${mode.color}`;
      div.innerHTML = `
        <div style="font-size:18px; font-weight:bold; color:${mode.color};">${mode.icon} ${mode.name}</div>
        <div style="font-size:14px; margin-top:4px; color:#fff;">Key Shortcut: <span style="background:#222; padding:3px 8px; border-radius:4px; border:1px solid ${mode.color};">${mode.keyHint}</span></div>
        <div style="font-size:12px; color:#bbb; margin-top:4px;">${mode.rule}</div>
      `;
      container.appendChild(div);
    });

    levelShortcutModal.classList.add('open');
    closeLevelShortcutBtn.onclick = function() {
      levelShortcutModal.classList.remove('open');
    };
  };

  function updateSettingsQuickControls(activeIds) {
    const box = document.getElementById('settingsQuickControlsBox');
    if (!box) return;

    let abilityKeys = ["WASD / Arrows (Move)", "F (Freeze on Plate)"];
    if (activeIds.includes(1)) abilityKeys.push("Q (Swap)");
    if (activeIds.includes(2)) abilityKeys.push("Shift (Freeze Movement)");
    if (activeIds.includes(5)) abilityKeys.push("X (Sacrifice)");

    box.innerHTML = `
      <p style="font-size: 11px; color: var(--accent); font-weight: bold; margin-bottom: 6px;">CURRENT LEVEL SHORTCUTS</p>
      <p style="font-size: 12px; color: #ccc; margin: 3px 0;">• Active Shortcuts: ${abilityKeys.join(" | ")}</p>
      <p style="font-size: 12px; color: #ccc; margin: 3px 0;">• Restart: R | Help: H</p>
    `;
  }

  function renderLevelGrid() {
    const grid = document.getElementById('levelCardsGrid');
    if (!grid) return;
    grid.innerHTML = "";
    
    let unlockedMax = 1;
    try {
      const saved = JSON.parse(localStorage.getItem('klone_progress') || '{}');
      unlockedMax = saved.unlocked || 1;
    } catch(e){}

    const levelDetails = [
      { id: 1, name: "SWAP BOOTCAMP", clone: "Swap Clone" },
      { id: 2, name: "FROZEN VAULT", clone: "Freeze Clone" },
      { id: 3, name: "SHADOW MAZE", clone: "Shy Clone" },
      { id: 4, name: "MAGNETIC GRID", clone: "Magnet Clone" },
      { id: 5, name: "THE ULTIMATE PARADOX", clone: "Sacrifice Clone" }
    ];

    if (developerModeActive) {
      document.getElementById('levelOverlaySub').textContent = "🛠️ DEVELOPER MODE UNLOCKED";
      document.getElementById('levelOverlayTitle').textContent = "SELECT ANY CHAMBER";
    }

    levelDetails.forEach(lvl => {
      const isUnlocked = developerModeActive || (lvl.id <= unlockedMax);
      let stars = 0;
      try {
        const saved = JSON.parse(localStorage.getItem('klone_progress') || '{}');
        stars = saved[lvl.id] || 0;
      } catch(e){}

      const btn = document.createElement('button');
      btn.className = `fn-card level-card ${isUnlocked ? '' : 'locked'}`;
      btn.style.opacity = isUnlocked ? "1" : "0.5";
      btn.innerHTML = `
        <div class="fn-card-thumb"><span>0${lvl.id}</span></div>
        <div class="fn-card-content">
          <h3>CHAMBER 0${lvl.id}</h3>
          <p>${lvl.name}</p>
          <span class="fn-play-tag">${isUnlocked ? (developerModeActive ? 'UNLOCKED (DEV)' : '★'.repeat(stars) + '☆'.repeat(3 - stars)) : 'LOCKED'}</span>
        </div>
      `;
      
      if (isUnlocked) {
        btn.onclick = function() {
          levelOverlay.classList.remove('open');
          homeStage.classList.add('hidden');
          gamePlayContainer.classList.remove('hidden');
          startCountdownAndLevel(lvl.id);
        };
      }
      grid.appendChild(btn);
    });
  }

  function startCountdownAndLevel(lvl) {
    var n = 3;
    count.textContent = n;
    msg.textContent = 'Get ready…';
    goModal.classList.add('open');
    
    clearInterval(timer);
    timer = setInterval(function() {
      n--;
      if(n > 0) {
        count.textContent = n;
      } else {
        clearInterval(timer);
        goModal.classList.remove('open');
        startLevel(lvl);
      }
    }, 800);
  }

  if (startBtn) {
    startBtn.onclick = function(){ 
      renderLevelGrid();
      levelOverlay.classList.add('open'); 
    };
  }
  if (backToStart) {
    backToStart.onclick = function(){ levelOverlay.classList.remove('open'); };
  }

  if (restartButton) {
    restartButton.onclick = function() {
      restartOverlay.classList.remove('open');
      if(typeof gameWon !== 'undefined' && gameWon && typeof currentLevel !== 'undefined' && currentLevel < 5 && restartButton.querySelector('span').textContent.includes("NEXT")) {
        startLevel(currentLevel + 1);
      } else {
        restartGame();
      }
    };
  }

  document.getElementById('openSettingsModalBtnHome').onclick = function(){ settingsModalOverlay.classList.add('open'); };
  document.getElementById('openSettingsModalBtn').onclick = function(){ settingsModalOverlay.classList.add('open'); };
  settingsModalOverlay.onclick = function(e) {
    if(e.target === settingsModalOverlay || e.target.hasAttribute('data-close-settings')) settingsModalOverlay.classList.remove('open');
  };

  if (exitToHomeBtn) {
    exitToHomeBtn.onclick = function() {
      settingsModalOverlay.classList.remove('open');
      gamePlayContainer.classList.add('hidden');
      homeStage.classList.remove('hidden');
      if (typeof gameStarted !== 'undefined') gameStarted = false;
    };
  }
})();

// AI Help logic
var hintIndex = 0;
var hintsRemaining = 3;

function resetAiHints() {
  hintIndex = 0;
  hintsRemaining = 3;
  const btn = document.getElementById('aiHintBtn');
  const hdr = document.getElementById('aiHeaderTitle');
  if (btn) {
    btn.disabled = false;
    btn.textContent = "💡 Get Hint (3 left)";
    btn.style.opacity = "1";
  }
  if (hdr) hdr.textContent = "🤖 KLONE AI HELP (3/3)";
  const content = document.getElementById('aiModalContent');
  if (content) {
    content.innerHTML = '<div class="ai-chat-bubble">Hello! Click "Get Hint" below for progressive hints (max 3 per level).</div>';
  }
}

function openAIPanel() { document.getElementById('aiSidePanel').classList.add('open'); }
function closeAIPanel() { document.getElementById('aiSidePanel').classList.remove('open'); }

function appendAiMessage(text) {
  var content = document.getElementById('aiModalContent');
  if (!content) return;
  var bubble = document.createElement('div');
  bubble.className = 'ai-chat-bubble';
  bubble.textContent = text;
  content.appendChild(bubble);
  content.scrollTop = content.scrollHeight;
}

function aiActionGetHint() {
  if (hintsRemaining <= 0) return;
  
  if (typeof levelData !== 'undefined' && levelData.hints && levelData.hints.length > 0) {
    var hint = levelData.hints[hintIndex % levelData.hints.length];
    hintIndex++;
    hintsRemaining--;
    
    appendAiMessage(`[Hint ${3 - hintsRemaining}/3]: ${hint}`);
    
    const btn = document.getElementById('aiHintBtn');
    const hdr = document.getElementById('aiHeaderTitle');
    if (btn) {
      btn.textContent = `💡 Get Hint (${hintsRemaining} left)`;
      if (hintsRemaining === 0) {
        btn.disabled = true;
        btn.style.opacity = "0.4";
      }
    }
    if (hdr) hdr.textContent = `🤖 KLONE AI HELP (${hintsRemaining}/3)`;
  } else {
    appendAiMessage("No hints available for this chamber.");
  }
}

function aiActionExplainClone() {
  if (typeof levelData !== 'undefined' && levelData.cloneIds) {
    const activeText = levelData.cloneIds.map(id => {
      const mode = cloneModes[id];
      return `• ${mode.name}: ${mode.rule} (Key: ${mode.keyHint})`;
    }).join("\n");
    appendAiMessage(`📋 ACTIVE CLONES & KEYS IN THIS LEVEL:\n${activeText}`);
  } else {
    appendAiMessage("📋 CLONE GUIDE:\n1. Swap: Press Q to swap, F to freeze on plate.\n2. Freeze: Hold Shift to move, F to freeze on plate.\n3. Shy: Moves away, F to freeze on plate.\n4. Magnet: Drags crates, F to freeze on plate.\n5. Sacrifice: Press X next to it, F to freeze on plate.");
  }
}

function aiActionWhatDoesThisDo() {
  appendAiMessage("🔍 OBJECT GUIDE:\n• Pressure Plates: Step on them or press F with a clone to lock it in place.\n• Crates: Push forward onto plates.\n• Exit Portal: Reach it once doors are unlocked.");
}

var openAiHome = document.getElementById('openAiModalBtnHome');
var openAiGame = document.getElementById('openAiModalBtn');
if (openAiHome) openAiHome.onclick = openAIPanel;
if (openAiGame) openAiGame.onclick = openAIPanel;
