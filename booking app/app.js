const appearanceKey = "soundslotAppearanceSettings";
const defaultAppearance = {
  theme: "light",
  accent: "#9a5cff",
  accentDark: "#07164a",
  textScale: "1",
  density: "comfortable",
  imageStyle: "rounded",
  motion: "on"
};
const defaultInstruments = ["DJ", "Drums", "Guitar", "Piano", "Singing", "Violin"];
const instrumentKey = "soundslotInstruments";

function savedAppearance() {
  return {
    ...defaultAppearance,
    ...JSON.parse(localStorage.getItem(appearanceKey) || "{}")
  };
}

function applyAppearance(settings = savedAppearance()) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.dataset.imageStyle = settings.imageStyle;
  root.dataset.motion = settings.motion;
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--accent-dark", settings.accentDark);
  root.style.setProperty("--text-scale", settings.textScale);
}

applyAppearance();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations()
      .then(registrations => registrations.forEach(registration => registration.unregister()))
      .catch(() => {});
    if ("caches" in window) {
      caches.keys()
        .then(keys => keys.filter(key => key.startsWith("soundslot-")).forEach(key => caches.delete(key)))
        .catch(() => {});
    }
  });
}

window.soundslotAppearance = {
  defaultAppearance,
  savedAppearance,
  applyAppearance,
  save(settings) {
    const next = { ...savedAppearance(), ...settings };
    localStorage.setItem(appearanceKey, JSON.stringify(next));
    applyAppearance(next);
    return next;
  },
  reset() {
    localStorage.removeItem(appearanceKey);
    applyAppearance(defaultAppearance);
    return defaultAppearance;
  }
};

function sortInstruments(items) {
  return [...new Set(items.map(item => String(item).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

function localInstruments() {
  return sortInstruments([
    ...defaultInstruments,
    ...JSON.parse(localStorage.getItem(instrumentKey) || "[]")
  ]);
}

async function fetchInstruments() {
  try {
    const response = await fetch("/api/instruments");
    if (!response.ok) throw new Error("No instrument API");
    const data = await response.json();
    const instruments = sortInstruments(data.instruments || []);
    localStorage.setItem(instrumentKey, JSON.stringify(instruments));
    return instruments;
  } catch {
    return localInstruments();
  }
}

async function addInstrument(instrument) {
  const cleanInstrument = String(instrument || "").trim();
  if (!cleanInstrument) return localInstruments();

  try {
    const response = await fetch("/api/instruments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instrument: cleanInstrument })
    });
    if (!response.ok) throw new Error("No instrument API");
    const data = await response.json();
    const instruments = sortInstruments(data.instruments || []);
    localStorage.setItem(instrumentKey, JSON.stringify(instruments));
    window.dispatchEvent(new CustomEvent("soundslot:instruments-updated", { detail: instruments }));
    return instruments;
  } catch {
    const instruments = sortInstruments([...localInstruments(), cleanInstrument]);
    localStorage.setItem(instrumentKey, JSON.stringify(instruments));
    window.dispatchEvent(new CustomEvent("soundslot:instruments-updated", { detail: instruments }));
    return instruments;
  }
}

window.soundslotInstruments = {
  defaults: defaultInstruments,
  list: fetchInstruments,
  add: addInstrument,
  sort: sortInstruments
};
