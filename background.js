// ============================================================
// Tab Switcher — Background Script
// ============================================================
// Uses browser.storage.session to persist tab history across
// MV3 background script sleeps (session storage survives
// the event page being suspended, unlike in-memory variables).
// ============================================================

const MAX_HISTORY = 15;

// --- Tab History (persisted in session storage) ---

async function getHistory() {
  const result = await browser.storage.session.get("tabHistory");
  return result.tabHistory || [];
}

async function setHistory(history) {
  await browser.storage.session.set({ tabHistory: history });
}

// Initialize history with the currently active tab on startup
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
let isCycling = false;          // true while in a rapid-press session
let cycleSnapshot = [];         // frozen history from when session started
let cycleIndex = 0;             // current position in the snapshot (1-based into snapshot)
let cycleTimer = null;          // timeout that ends the session
let cycleOriginTabId = null;    // the tab we started cycling from
let cycleTimeoutMs = 800;       // user-configurable via options page
const MAX_CYCLE_DEPTH = 4;      // cycle through at most 4 recent tabs

// Load user's preferred cycle timeout from persistent storage
async function loadCycleTimeout() {
  const result = await browser.storage.local.get("cycleTimeoutMs");
  if (result.cycleTimeoutMs) {
    cycleTimeoutMs = result.cycleTimeoutMs;
  }
}

loadCycleTimeout();

// Track tabs as they become active
browser.tabs.onActivated.addListener(async (activeInfo) => {
  // Suppress history reshuffling while cycling through tabs
  if (isCycling) return;

  const tabId = activeInfo.tabId;
  let history = await getHistory();

  // Remove existing entry to avoid duplicates, then prepend
  history = history.filter(id => id !== tabId);
  history.unshift(tabId);

  // Cap the history size
  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
  }

  await setHistory(history);
});

// When a tab is closed, just clean it from history.
// Removing a closed tab shifts everything down in the array,
// so the quick-switch shortcut naturally lands on the right tab.
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
    console.error(`[Tab Switcher] Error handling command "${command}":`, error);
  }
});

// Quick Switch: cycle through history[1..MAX_CYCLE_DEPTH] on rapid successive presses
async function handleQuickSwitch() {
  if (!isCycling) {
    // --- Start a new cycling session ---
    cycleSnapshot = await getHistory();
    if (cycleSnapshot.length < 2) return;

    isCycling = true;
    cycleOriginTabId = cycleSnapshot[0]; // remember where we started
    cycleIndex = 1; // first press goes to history[1]
  } else {
    // --- Continue the cycling session ---
    cycleIndex++;

    // Cap at MAX_CYCLE_DEPTH or end of snapshot, wrap back to 1
    const maxIndex = Math.min(MAX_CYCLE_DEPTH, cycleSnapshot.length - 1);
    if (cycleIndex > maxIndex) {
      cycleIndex = 1;
    }
  }

  // Reset the timeout — session continues as long as presses keep coming
  if (cycleTimer) clearTimeout(cycleTimer);
  cycleTimer = setTimeout(() => endCycleSession(), cycleTimeoutMs);

  // Switch to the tab at the current cycle position
  const targetTabId = cycleSnapshot[cycleIndex];
  try {
    await browser.tabs.update(targetTabId, { active: true });
  } catch (error) {
    console.error("[Tab Switcher] Tab no longer exists:", error);
    // Remove dead tab from snapshot and retry
    cycleSnapshot = cycleSnapshot.filter(id => id !== targetTabId);
    cycleIndex = Math.min(cycleIndex, cycleSnapshot.length - 1);
    if (cycleIndex >= 1) {
      await browser.tabs.update(cycleSnapshot[cycleIndex], { active: true });
    }
  }
}

// End the cycling session and commit the correct history order
async function endCycleSession() {
  const landedTabId = (cycleSnapshot.length > 0 && cycleIndex > 0)
    ? cycleSnapshot[cycleIndex]
    : null;
  const originTabId = cycleOriginTabId;

  // Reset cycling state
  isCycling = false;
  cycleTimer = null;
  cycleSnapshot = [];
  cycleIndex = 0;
  cycleOriginTabId = null;

  if (!landedTabId) return;

  // Rebuild history: landed tab at [0], origin tab at [1], then the rest.
  // This ensures the NEXT single press of quick-switch toggles back
  // to where the user came from.
  let history = await getHistory();
  history = history.filter(id => id !== landedTabId && id !== originTabId);
  if (originTabId && originTabId !== landedTabId) {
    history.unshift(originTabId);  // [1] = where we came from
  }
  history.unshift(landedTabId);    // [0] = where we are now

  if (history.length > MAX_HISTORY) {
    history = history.slice(0, MAX_HISTORY);
  }
  await setHistory(history);
}

// Normal Switch: move forward (+1) or backward (-1) in tab index order, with wrap-around
async function handleNormalSwitch(direction) {
  const tabs = await browser.tabs.query({ currentWindow: true });

  // Sort by visual index (left to right in the tab bar)
  tabs.sort((a, b) => a.index - b.index);

  const currentTab = tabs.find(t => t.active);
  if (!currentTab) return;

  const currentPos = tabs.indexOf(currentTab);
  // Wrap around: going before tab 0 wraps to last; going past last wraps to 0
  const nextPos = (currentPos + direction + tabs.length) % tabs.length;

  await browser.tabs.update(tabs[nextPos].id, { active: true });
}

// --- Message Handlers ---

// Listen for settings changes from the options page
browser.runtime.onMessage.addListener((msg) => {
  if (msg.action === "reload_settings") {
    loadCycleTimeout();
  }
});
