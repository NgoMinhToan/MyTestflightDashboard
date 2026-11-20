import { state } from "./store.js";
import { hasToken } from "./settings.js";
import { refreshCatalog, renderCurrent } from "./render.js";

export function parseRoute() {
  const raw = location.hash.replace(/^#/, "").split("?")[0] || "/";
  const parts = raw.split("/").filter(Boolean).map(decodePart);
  if (parts[0] === "settings") return { name: "settings", id: null };
  if (parts[0] === "apps" && parts[1]) return { name: "detail", id: parts[1] };
  return { name: "apps", id: null };
}

function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasUsableSettings() {
  return hasToken(state.settings) && Boolean(state.api?.configured);
}

function goSettings() {
  history.replaceState(null, "", "#/settings");
  state.route = { name: "settings", id: null };
  renderCurrent();
}

export function handleRoute() {
  if (!hasUsableSettings()) {
    goSettings();
    return;
  }
  const route = parseRoute();
  state.route = route;
  const needsCatalog = route.name === "apps" || route.name === "detail";
  if (needsCatalog && !state.catalogLoaded && !state.error) {
    refreshCatalog();
    return;
  }
  renderCurrent();
}

export function go(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) {
    handleRoute();
    return;
  }
  if (replace) {
    history.replaceState(null, "", target);
    handleRoute();
    return;
  }
  location.hash = target;
}

export function reloadCatalog() {
  return refreshCatalog();
}
