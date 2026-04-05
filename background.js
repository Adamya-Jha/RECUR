const MAX_HISTORY = 15;

// --- Tab History (session storage persists across MV3 background sleeps) ---

async function getHistory() {
  const result = await browser.storage.session.get("tabHistory");
  return result.tabHistory || [];
}

async function setHistory(history) {
  await browser.storage.session.set({ tabHistory: history });
}

async function init() {
  const existing = await getHistory();
  if (existing.length === 0) {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      await setHistory([tabs[0].id]);
    }
  }
}

init();

// --- Quick-switch cycling session state (in-memory, resets on sleep) ---
let isCycling = false;
let cycleSnapshot = [];      // frozen history captured when session starts
let cycleIndex = 0;          // current position within snapshot (1-based)
let cycleTimer = null;
let cycleOriginTabId = null; // tab we started cycling from
let cycleTimeoutMs = 800;
const MAX_CYCLE_DEPTH = 4;

async function loadCycleTimeout() {
  const result = await browser.storage.local.get("cycleTimeoutMs");
  if (result.cycleTimeoutMs) {
    cycleTimeoutMs = result.cycleTimeoutMs;
  }
}

loadCycleTimeout();

browser.tabs.onActivated.addListener(async (activeInfo) => {
  if (isCycling) return; // suppress history reshuffling during a cycling session

  const tabId = activeInfo.tabId;
  let history = await getHistory();
  history = history.filter(id => id !== tabId);
  history.unshift(tabId);
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
  }
  await setHistory(history);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  let history = await getHistory();
  history = history.filter(id => id !== tabId);
  await setHistory(history);
});

// --- Command Handlers ---

browser.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "quick-switch") {
      await handleQuickSwitch();
    } else if (command === "normal-switch-backward") {
      await handleNormalSwitch(-1);
    } else if (command === "normal-switch-forward") {
      await handleNormalSwitch(1);
    }
  } catch (error) {
    console.error(`[RECUR] Error handling command "${command}":`, error);
  }
});

async function handleQuickSwitch() {
  if (!isCycling) {
    cycleSnapshot = await getHistory();
    if (cycleSnapshot.length < 2) return;
    isCycling = true;
    cycleOriginTabId = cycleSnapshot[0];
    cycleIndex = 1;
  } else {
    cycleIndex++;
    // wrap back to 1 once we hit MAX_CYCLE_DEPTH or run out of history
    const maxIndex = Math.min(MAX_CYCLE_DEPTH, cycleSnapshot.length - 1);
    if (cycleIndex > maxIndex) cycleIndex = 1;
  }

  // each press resets the timer — session stays alive while user keeps pressing
  if (cycleTimer) clearTimeout(cycleTimer);
  cycleTimer = setTimeout(() => endCycleSession(), cycleTimeoutMs);

  const targetTabId = cycleSnapshot[cycleIndex];
  try {
    await browser.tabs.update(targetTabId, { active: true });
  } catch (error) {
    console.error("[RECUR] Tab no longer exists:", error);
    cycleSnapshot = cycleSnapshot.filter(id => id !== targetTabId);
    cycleIndex = Math.min(cycleIndex, cycleSnapshot.length - 1);
    if (cycleIndex >= 1) {
      await browser.tabs.update(cycleSnapshot[cycleIndex], { active: true });
    }
  }
}

async function endCycleSession() {
  const landedTabId = (cycleSnapshot.length > 0 && cycleIndex > 0)
    ? cycleSnapshot[cycleIndex]
    : null;
  const originTabId = cycleOriginTabId;

  isCycling = false;
  cycleTimer = null;
  cycleSnapshot = [];
  cycleIndex = 0;
  cycleOriginTabId = null;

  if (!landedTabId) return;

  // Rebuild history as [landed, origin, ...rest] so the next single press
  // of quick-switch correctly toggles back to where the user came from.
  let history = await getHistory();
  history = history.filter(id => id !== landedTabId && id !== originTabId);
  if (originTabId && originTabId !== landedTabId) history.unshift(originTabId);
  history.unshift(landedTabId);

  if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
  await setHistory(history);
}

async function handleNormalSwitch(direction) {
  const tabs = await browser.tabs.query({ currentWindow: true });
  tabs.sort((a, b) => a.index - b.index);

  const currentTab = tabs.find(t => t.active);
  if (!currentTab) return;

  const currentPos = tabs.indexOf(currentTab);
  // modulo ensures wrap-around (e.g. going left from tab 0 → last tab)
  const nextPos = (currentPos + direction + tabs.length) % tabs.length;
  await browser.tabs.update(tabs[nextPos].id, { active: true });
}

// --- Message Handlers ---

browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "reload_settings") {
    loadCycleTimeout();
  }
});
