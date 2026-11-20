import { ApiClient } from "./api.js";
import { loadSettings, loadTheme } from "./settings.js";

export function makeApi(settings) {
  return new ApiClient({
    baseUrl: settings?.baseUrl || "",
    token: settings?.token || "",
  });
}

export const state = {
  settings: loadSettings(),
  theme: loadTheme(),
  api: null,
  catalog: [],
  catalogLoaded: false,
  degraded: false,
  loading: false,
  error: null,
  health: { status: "unknown", latency: null, checkedAt: null },
  route: { name: "apps", id: null },
  authError: "",
  ui: {
    listQuery: "",
    listFilter: "all",
    listAbi: "all",
    sort: "recent",
    vQuery: "",
    vFilter: "all",
    vAbi: "all",
  },
  modal: null,
  toast: null,
};

state.api = makeApi(state.settings);
