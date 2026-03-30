// ============================================================
// Tab Switcher — Options Page Script
// ============================================================

const COMMAND_IDS = {
  "quick-switch": "keys-quick-switch",
  "normal-switch-backward": "keys-normal-switch-backward",
  "normal-switch-forward": "keys-normal-switch-forward",
};

const DEFAULT_CYCLE_TIME = 800;

// --- Shortcut Display ---

function renderKeys(shortcutStr) {
  if (!shortcutStr) {
    const el = document.createElement("span");
    el.className = "unbound-pill";
    el.textContent = "Not set";
    const frag = document.createDocumentFragment();
    frag.appendChild(el);
    return frag;
  }

  const parts = shortcutStr.split("+");
  const frag = document.createDocumentFragment();

  parts.forEach((part, index) => {
    const kbd = document.createElement("kbd");
    kbd.textContent = normalizeKey(part);
    frag.appendChild(kbd);

    if (index < parts.length - 1) {
      const sep = document.createElement("span");
      sep.className = "key-separator";
      sep.textContent = "+";
      frag.appendChild(sep);
    }
  });

  return frag;
}

function normalizeKey(key) {
  const map = {
    "Alt": "Alt", "Ctrl": "Ctrl", "Control": "Ctrl",
    "Shift": "Shift", "Meta": "⌘", "MacCtrl": "⌃",
    "Up": "↑", "Down": "↓", "Left": "←", "Right": "→",
  };
  return map[key] ?? key;
}

async function loadShortcuts() {
  const commands = await browser.commands.getAll();
  for (const command of commands) {
    const containerId = COMMAND_IDS[command.name];
    if (!containerId) continue;
    const container = document.getElementById(containerId);
    if (!container) continue;
    container.innerHTML = "";
    container.appendChild(renderKeys(command.shortcut));
  }
}

// --- Cycle Time Setting ---

const cycleInput = document.getElementById("cycle-time");
const cycleValue = document.getElementById("cycle-value");
const saveBtn = document.getElementById("save-btn");
const saveStatus = document.getElementById("save-status");

// Update the displayed value as the slider moves
cycleInput.addEventListener("input", () => {
  cycleValue.textContent = cycleInput.value + " ms";
});

async function loadSettings() {
  const result = await browser.storage.local.get("cycleTimeoutMs");
  const val = result.cycleTimeoutMs ?? DEFAULT_CYCLE_TIME;
  cycleInput.value = val;
  cycleValue.textContent = val + " ms";
}

saveBtn.addEventListener("click", async () => {
  const value = parseInt(cycleInput.value, 10);
  await browser.storage.local.set({ cycleTimeoutMs: value });

  // Notify background script to pick up the new value
  browser.runtime.sendMessage({ action: "reload_settings" });

  // Show confirmation
  saveStatus.textContent = "Saved ✓";
  setTimeout(() => { saveStatus.textContent = ""; }, 1500);
});

// --- Init ---
loadShortcuts();
loadSettings();
