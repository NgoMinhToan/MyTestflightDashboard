import "./styles.css";
import "./theme.css";
import "./app.css";

import { state } from "./store.js";
import { renderShell, startHealthPolling } from "./render.js";
import { handleRoute } from "./router.js";
import {
  handleChange,
  handleClick,
  handleDragLeave,
  handleDragOver,
  handleDrop,
  handleHashChange,
  handleInput,
  handleKeydown,
  handleStorage,
  handleSubmit,
  handleUnhandled,
} from "./actions.js";

function boot() {
  const root = document.getElementById("root");
  if (!root) return;

  document.documentElement.dataset.theme = state.theme;
  renderShell(root);

  document.addEventListener("click", handleClick);
  document.addEventListener("input", handleInput);
  document.addEventListener("change", handleChange);
  document.addEventListener("submit", handleSubmit);
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("dragover", handleDragOver);
  document.addEventListener("dragleave", handleDragLeave);
  document.addEventListener("drop", handleDrop);

  window.addEventListener("hashchange", handleHashChange);
  window.addEventListener("storage", handleStorage);
  window.addEventListener("unhandledrejection", (event) => handleUnhandled(event.reason));
  window.addEventListener("beforeunload", (event) => {
    if (state.modal?.type === "upload" && state.modal.upload.running) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  startHealthPolling();
  handleRoute();
}

boot();
