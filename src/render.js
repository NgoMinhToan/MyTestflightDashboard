import { state } from "./store.js";
import { esc } from "./format.js";
import { hasToken } from "./settings.js";
import { loadCatalog, findApp } from "./model.js";
import {
  healthPillHTML,
  shellHTML,
  updateHealthDOM,
  updateRail,
  updateThemeControls,
} from "./shell.js";
import { listPageHTML, renderListResults } from "./views/list.js";
import { detailPageHTML, renderMatrix, renderVersionList } from "./views/detail.js";
import { renderSettingsStats, settingsPageHTML } from "./views/settings.js";
import { modalHTML } from "./modals.js";

let toastTimer = null;
let healthPromise = null;
let catalogPromise = null;
let healthTimer = null;
let lastModalKey = null;

export function renderShell(root) {
  root.innerHTML = shellHTML();
}

function captureSettingsDraft() {
  const form = document.getElementById("settingsForm");
  if (!form) return;
  const baseUrl = document.getElementById("setBaseUrl");
  const token = document.getElementById("setToken");
  if (!baseUrl || !token) return;
  state.ui.settingsDraft = { baseUrl: baseUrl.value, token: token.value };
}

export function renderCurrent() {
  if (!document.getElementById("page")) return;
  if (state.route.name === "settings") captureSettingsDraft();

  updateRail(state);
  updateThemeControls(state);

  const page = document.getElementById("page");
  if (state.route.name === "settings") {
    page.innerHTML = settingsPageHTML(state);
    renderSettingsStats(state);
  } else if (state.route.name === "detail") {
    const app = findApp(state.catalog, state.route.id);
    page.innerHTML = detailPageHTML(state, app);
    if (app) {
      renderVersionList(state, app);
      renderMatrix(state, app);
    }
  } else {
    page.innerHTML = listPageHTML(state);
    renderListResults(state);
  }

  updateHealthDOM(state);
  renderModal();
  renderToast();
}

export function renderModal() {
  const root = document.getElementById("modalRoot");
  if (!root) return;
  const key = state.modal
    ? `${state.modal.type}:${state.modal.type === "confirm" ? state.modal.confirm.kind : ""}`
    : null;
  const reopening = key !== null && key === lastModalKey;
  root.innerHTML = modalHTML(state);
  if (reopening) {
    // File add/remove re-renders the dialog; do not replay the pop animation.
    root.querySelector(".dialog")?.classList.add("no-anim");
  }
  if (state.modal && key !== lastModalKey) {
    const dialog = root.querySelector(".dialog");
    dialog?.focus();
  }
  lastModalKey = key;
}

export function renderToast() {
  const root = document.getElementById("toastRoot");
  if (!root) return;
  root.innerHTML = state.toast
    ? `<div class="toast ${state.toast.kind === "error" ? "err" : ""}" role="status"><i></i>${esc(state.toast.message)}</div>`
    : "";
}

export function toast(message, kind = "info") {
  state.toast = { message, kind };
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    renderToast();
  }, 4200);
}

export async function checkHealth() {
  if (!state.api?.configured || !hasToken(state.settings)) {
    state.health = { status: "unconfigured", latency: null, checkedAt: Date.now() };
    updateHealthDOM(state);
    renderSettingsStats(state);
    return;
  }
  if (healthPromise) return healthPromise;
  healthPromise = (async () => {
    const started = performance.now();
    try {
      await state.api.health();
      const latency = Math.max(1, Math.round(performance.now() - started));
      state.health = { status: "ok", latency, checkedAt: Date.now() };
    } catch {
      state.health = { status: "down", latency: null, checkedAt: Date.now() };
    }
    updateHealthDOM(state);
    renderSettingsStats(state);
  })().finally(() => {
    healthPromise = null;
  });
  return healthPromise;
}

export function startHealthPolling() {
  if (healthTimer) return;
  void checkHealth();
  healthTimer = setInterval(() => {
    void checkHealth();
  }, 30000);
}

export async function refreshCatalog({ silent = false } = {}) {
  if (catalogPromise) return catalogPromise;
  state.loading = true;
  state.error = null;
  if (!silent) renderCurrent();

  catalogPromise = (async () => {
    try {
      const { apps, degraded } = await loadCatalog(state.api);
      state.catalog = apps;
      state.degraded = degraded;
      state.catalogLoaded = true;
      state.error = null;
      return true;
    } catch (error) {
      state.error = error;
      return false;
    } finally {
      state.loading = false;
      renderCurrent();
      void checkHealth();
    }
  })();

  try {
    return await catalogPromise;
  } finally {
    catalogPromise = null;
  }
}

export function renderBootError(error) {
  const page = document.getElementById("page");
  if (!page) return;
  page.innerHTML = `
    <header class="mast">
      <div class="mnav">
        <div class="mword"><b>My TestFlight</b><span>Quản trị nội bộ</span></div>
        <div class="sp"></div>
        <span class="mhealth">${healthPillHTML(state)}</span>
      </div>
      <div class="mhero">
        <div><div class="kick">Khởi động</div><h1>Chưa mở được<br><em>thư viện.</em></h1></div>
      </div>
    </header>
    <main class="msheet">
      <div class="statecard" style="margin-top:8px">
        <div class="ic">${esc("!")}</div>
        <div class="t">Không khởi động được dashboard</div>
        <p>${esc(error?.message || error)}</p>
        <div class="acts"><button class="btn btn-primary" data-act="reloadApp">Tải lại</button></div>
      </div>
    </main>`;
}
