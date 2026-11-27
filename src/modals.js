import {
  ABI_META,
  ABI_ORDER,
  esc,
  fmtSize,
  inferAbi,
  initialOf,
  shortSha,
  toDateInput,
  todayDateInput,
} from "./format.js";
import { svg } from "./icons.js";
import { inspectApk } from "./apk-inspect.js";
import { describeIcon, prepareIconPreview, releaseIconPreview } from "./icon-render.js";
import {
  applyInspection,
  applyInspectionError,
  effectiveVersionName,
  firstInspectedMetadata,
  refreshUploadValidation,
  resolveUploadTarget,
} from "./upload-plan.js";

function fileId() {
  return `f${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
}

function overlay(content, width) {
  return `
  <div class="overlay" data-act="overlay">
    <div class="dialog" style="width:min(${width}px,100%)" role="dialog" aria-modal="true" tabindex="-1">
      ${content}
    </div>
  </div>`;
}

function closeButton() {
  return `<button class="x" data-act="closeModal" title="Đóng">${svg("close", 16)}</button>`;
}

/* ------------------------------------------------------------------ upload */

function emptyConsistency() {
  return {
    fatal: [],
    warnings: [],
    inspecting: false,
    detected: null,
    target: resolveUploadTarget(null, [], null),
  };
}

export function openUpload(state, options = null) {
  const expectedAppId =
    typeof options === "string" ? options : options?.expectedAppId || null;
  if (expectedAppId && !state.catalog.some((candidate) => candidate.id === expectedAppId)) {
    return false;
  }
  const upload = {
    expectedAppId,
    date: todayDateInput(),
    notes: "",
    files: [],
    inspecting: false,
    consistency: emptyConsistency(),
    target: null,
    pendingReplace: null,
    running: false,
    done: false,
    error: "",
    iconWarning: "",
    allowReplace: false,
    progress: 0,
  };
  refreshUploadValidation(upload, state.catalog, expectedAppId);
  state.modal = { type: "upload", upload };
  return true;
}

function disposeFileIcon(file) {
  if (file?.iconPreview) releaseIconPreview(file.iconPreview);
  if (file) file.iconPreview = null;
}

async function inspectUploadEntry(state, upload, entry, onUpdate) {
  if (state.modal?.upload !== upload || !upload.files.includes(entry)) return;
  try {
    const result = await inspectApk(entry.file);
    if (state.modal?.upload !== upload || !upload.files.includes(entry)) return;
    applyInspection(upload, entry.id, result);
  } catch (error) {
    if (state.modal?.upload !== upload || !upload.files.includes(entry)) return;
    applyInspectionError(upload, entry.id, error);
  }
  if (state.modal?.upload !== upload || !upload.files.includes(entry)) return;
  refreshUploadValidation(upload, state.catalog, upload.expectedAppId);
  onUpdate?.();

  const descriptor = entry.metadata?.icon;
  if (descriptor) {
    entry.iconStatus = "loading";
    onUpdate?.();
    const resources = entry.metadata?.resources;
    const preview = await prepareIconPreview(descriptor, {
      table: resources?.table || null,
      readEntry: resources?.readEntry || null,
      size: 256,
    });
    if (state.modal?.upload !== upload || !upload.files.includes(entry)) {
      releaseIconPreview(preview);
      return;
    }
    disposeFileIcon(entry);
    entry.iconPreview = preview;
    entry.iconStatus = preview?.previewUrl ? "ready" : "error";
    onUpdate?.();
  }
}

/**
 * Add APKs and inspect each one in the browser. Entries appear immediately as
 * "inspecting" so the footer can block upload while the manifest is read; each
 * result triggers `onUpdate` (the caller re-renders the modal).
 */
export async function addFilesToUpload(state, fileList, { onUpdate } = {}) {
  const upload = state.modal?.upload;
  if (!upload || upload.running || upload.done) {
    return {
      added: 0,
      rejected: 0,
      inspecting: 0,
      failed: 0,
      fatal: 0,
      warnings: 0,
    };
  }
  let added = 0;
  let rejected = 0;
  const pending = [];
  Array.from(fileList || []).forEach((file) => {
    if (!/\.apk$/i.test(file.name)) {
      rejected += 1;
      return;
    }
    const duplicate = upload.files.some(
      (existing) =>
        existing.status !== "error" &&
        existing.name === file.name &&
        existing.sizeBytes === file.size,
    );
    if (duplicate) {
      rejected += 1;
      return;
    }
    const entry = {
      id: fileId(),
      file,
      name: file.name,
      sizeBytes: file.size,
      abi: inferAbi(file.name),
      detectedAbi: null,
      status: "inspecting",
      metadata: null,
      error: "",
      errorCode: "",
      previewUnavailable: false,
      previewMessage: "",
      iconPreview: null,
      iconStatus: "idle",
      progress: 0,
      sha256: null,
    };
    upload.files.push(entry);
    pending.push(entry);
    added += 1;
  });
  upload.error = "";
  upload.pendingReplace = null;
  upload.allowReplace = false;
  refreshUploadValidation(upload, state.catalog, upload.expectedAppId);
  onUpdate?.();

  if (pending.length) {
    await Promise.all(
      pending.map((entry) => inspectUploadEntry(state, upload, entry, onUpdate)),
    );
    if (state.modal?.upload === upload) {
      refreshUploadValidation(upload, state.catalog, upload.expectedAppId);
      onUpdate?.();
    }
  }
  const consistency = upload.consistency || emptyConsistency();
  return {
    added,
    rejected,
    inspecting: upload.files.filter((file) => file.status === "inspecting").length,
    failed: upload.files.filter((file) => file.status === "error").length,
    fatal: consistency.fatal.length,
    warnings: consistency.warnings.length,
  };
}

export function removeUploadFile(state, id) {
  const upload = state.modal?.upload;
  if (!upload || upload.running || upload.done) return;
  const file = upload.files.find((candidate) => candidate.id === id);
  disposeFileIcon(file);
  upload.files = upload.files.filter((candidate) => candidate.id !== id);
  upload.pendingReplace = null;
  upload.allowReplace = false;
  refreshUploadValidation(upload, state.catalog, upload.expectedAppId);
}

function fileIconHTML(file) {
  if (file.iconPreview?.previewUrl) {
    return `<span class="apkicon"><img src="${esc(file.iconPreview.previewUrl)}" alt=""></span>`;
  }
  if (
    file.iconStatus === "loading" ||
    (file.status === "ready" && file.metadata?.icon && !file.iconPreview)
  ) {
    return `<span class="apkicon loading"><span class="spinner"></span></span>`;
  }
  return `<span class="apkicon"><span class="letter">${initialOf({ name: file.name })}</span></span>`;
}

function fileMetadataHTML(file) {
  if (file.status === "inspecting") {
    return `<div class="apkprev inspecting"><span class="spinner"></span> Đang đọc AndroidManifest.xml…</div>`;
  }
  if (file.status === "error") {
    return `<div class="apkprev bad">${esc(file.error || "Không đọc được APK.")}</div>`;
  }
  if (file.previewUnavailable) {
    return `<div class="apkprev muted">${esc(file.previewMessage || "Không xem trước được APK trong trình duyệt này.")} Máy chủ sẽ xác minh.</div>`;
  }
  const metadata = file.metadata;
  if (!metadata) return "";
  const meta = ABI_META[metadata.artifactAbi] || {
    label: metadata.artifactAbi,
    cls: "more",
  };
  const flags = [
    metadata.debuggable ? `<span class="flag bad">debuggable</span>` : "",
    metadata.testOnly ? `<span class="flag bad">testOnly</span>` : "",
    metadata.configSplit ? `<span class="flag bad">config split</span>` : "",
  ].join("");
  const abiDetail = metadata.abis.length > 1 ? ` · ${metadata.abis.join(", ")}` : "";
  const targetLabel =
    metadata.targetSdk != null ? ` · targetSdk ${metadata.targetSdk}` : "";
  const iconLabel = metadata.icon
    ? `<span class="det">icon ${esc(file.iconPreview?.label || describeIcon(metadata.icon))}</span>`
    : "";
  const uploadError = file.uploadError
    ? `<div class="apkprev bad">${esc(file.uploadError)}</div>`
    : "";
  return `
    <div class="apkprev">
      <div class="pkline"><span class="pkg">${esc(metadata.packageName)}</span>${flags}</div>
      <div class="kvline">v${esc(effectiveVersionName(metadata) ?? "—")} · code ${metadata.versionCode} · minSdk ${metadata.minSdk ?? "—"}${targetLabel}</div>
      <div class="abiline"><span class="abi ${meta.cls}">${esc(meta.label)}</span><span class="det">ABI từ APK${esc(abiDetail)}</span>${iconLabel}</div>
    </div>${uploadError}`;
}

function uploadFileRows(upload) {
  if (!upload.files.length) return "";
  return upload.files
    .map((file) => {
      const percent = Math.round((file.progress || 0) * 100);
      const statusPill =
        file.status === "inspecting"
          ? `<span class="fstat">đang đọc…</span>`
          : file.status === "error"
            ? `<span class="fstat bad">lỗi</span>`
            : file.previewUnavailable
              ? `<span class="fstat muted">không xem trước</span>`
              : "";
      return `
      <div class="file ${percent >= 100 ? "done" : ""} ${esc(file.status)}" data-file="${esc(file.id)}">
        <div class="f1">
          ${fileIconHTML(file)}
          <span class="nm">${esc(file.name)}</span>
          <span class="sz">${fmtSize(file.sizeBytes)}</span>
          ${statusPill}
          ${
            upload.running || upload.done
              ? ""
              : `<button class="rm" data-act="rmFile" data-file="${esc(file.id)}" title="Bỏ tệp">${svg("close", 10)}</button>`
          }
        </div>
        ${fileMetadataHTML(file)}
        <div class="fab">
          <span class="pr">${percent}%</span>
          ${file.sha256 ? `<span class="hashok">${svg("check", 11)} sha ${esc(shortSha(file.sha256))}</span>` : ""}
        </div>
        <div class="pb"><i style="width:${percent}%"></i></div>
      </div>`;
    })
    .join("");
}

export function uploadBlocked(upload) {
  if (!upload) return true;
  if (upload.running || upload.done) return true;
  if (upload.pendingReplace) return true;
  if (upload.inspecting || upload.consistency?.inspecting) return true;
  if (!upload.files?.length) return true;
  return (upload.consistency?.fatal?.length || 0) > 0;
}

function alertItems(items) {
  return items.map((item) => `<li>${esc(item.message)}</li>`).join("");
}

function uploadAlertsHTML(upload) {
  const fatal = upload.consistency?.fatal || [];
  const warnings = upload.consistency?.warnings || [];
  const fatalHtml = fatal.length
    ? `<div class="upload-alert fatal"><b>Chưa thể tải lên</b><ul>${alertItems(fatal)}</ul></div>`
    : "";
  const warningHtml = warnings.length
    ? `<div class="upload-alert warn"><b>Cảnh báo</b><ul>${alertItems(warnings)}</ul></div>`
    : "";
  const replace = upload.pendingReplace
    ? `<div class="upload-alert warn"><b>Phiên bản ${esc(upload.pendingReplace.version)} đã có ABI</b>
        <div>${upload.pendingReplace.replacedAbis
          .map((abi) => `<span class="abi ${ABI_META[abi]?.cls || "more"}">${esc(ABI_META[abi]?.label || abi)}</span>`)
          .join(" ")} sẽ bị thay thế.</div>
        <button class="mini navy" data-act="confirmReplace" style="margin-top:8px">${svg("check", 12)} Thay thế ABI ${esc(upload.pendingReplace.replacedAbis.join(", "))}</button>
      </div>`
    : "";
  const iconWarning = upload.iconWarning
    ? `<div class="upload-alert warn">${esc(upload.iconWarning)}</div>`
    : "";
  return fatalHtml + warningHtml + replace + iconWarning;
}

/** Patch the alert block and button after the date/notes change (no re-render). */
export function updateUploadAlertsDOM(state) {
  const upload = state.modal?.upload;
  if (!upload) return;
  refreshUploadValidation(upload, state.catalog, upload.expectedAppId);
  const alerts = document.getElementById("upAlerts");
  if (alerts) alerts.innerHTML = uploadAlertsHTML(upload);
  const button = document.getElementById("uploadBtn");
  if (button) button.disabled = uploadBlocked(upload);
  const hint = document.getElementById("upFootHint");
  if (hint) hint.textContent = uploadFootHint(upload);
}

function uploadFootHint(upload) {
  if (upload.done) return "Hoàn tất.";
  if (upload.running) return "Đang tải lên…";
  if (upload.pendingReplace) return "Xác nhận thay thế ABI để tiếp tục.";
  if (upload.inspecting || upload.consistency?.inspecting) return "Đang đọc APK…";
  if (upload.consistency?.fatal?.length) return "Sửa lỗi trước khi tải lên.";
  return "";
}

function versionLine(metadata) {
  if (!metadata) return "—";
  const name = effectiveVersionName(metadata) ?? "—";
  return `v${name} · code ${metadata.versionCode}`;
}

function iconPairHTML(upload, target) {
  const file = upload.files.find((candidate) => candidate.iconPreview?.previewUrl);
  const apkIcon = file
    ? `<img src="${esc(file.iconPreview.previewUrl)}" alt="">`
    : `<span class="letter">${svg("image", 18)}</span>`;
  const app = target?.app;
  const appIcon = app?.iconUrl
    ? `<img src="${esc(app.iconUrl)}" alt="">`
    : `<span class="letter">${esc(initialOf(app || { name: "?" }))}</span>`;
  return `
    <div class="iconpair">
      <div class="icbox"><div class="icbig" style="background:${app?.color || "#FFF1ED"}">${apkIcon}</div><span class="iclabel">APK</span></div>
      ${
        app
          ? `<div class="icbox"><div class="icbig" style="background:${app.color}">${appIcon}</div><span class="iclabel">Hiện tại</span></div>`
          : ""
      }
    </div>`;
}

function uploadSummaryHTML(state, upload) {
  const target = upload.target || upload.consistency?.target || resolveUploadTarget(upload, state.catalog, upload.expectedAppId);
  const metadata = upload.consistency?.detected || firstInspectedMetadata(upload);
  const targetName = target?.app?.name || target?.name || (target?.create ? "Ứng dụng mới" : "—");
  const targetId = target?.app?.id || target?.appId || target?.idHint || "";
  const packageName = metadata?.packageName || target?.packageName || "";
  const abis = metadata ? (metadata.abis.length ? metadata.abis : ["universal"]) : [];
  const flags = metadata
    ? [
        metadata.debuggable ? "debuggable" : "",
        metadata.testOnly ? "testOnly" : "",
        metadata.configSplit ? "config split" : "",
      ]
        .filter(Boolean)
        .join(", ")
    : "";
  return `
    <div class="upsummary">
      ${iconPairHTML(upload, target)}
      <div class="field"><label>Ứng dụng</label>
        <div class="readbox"><b>${esc(targetName)}</b>${targetId ? `<span class="mono">${esc(targetId)}</span>` : ""}</div>
      </div>
      <div class="kv"><span>Package</span><b class="mono-ellipsis">${esc(packageName || "—")}</b></div>
      <div class="kv"><span>Phiên bản</span><b>${esc(versionLine(metadata))}</b></div>
      <div class="kv"><span>minSdk / targetSdk</span><b>${metadata?.minSdk ?? "—"} / ${metadata?.targetSdk ?? "—"}</b></div>
      <div class="kv"><span>ABI</span><b>${abis.map((abi) => `<span class="abi ${ABI_META[abi]?.cls || "more"}">${esc(ABI_META[abi]?.label || abi)}</span>`).join(" ") || "—"}</b></div>
      ${
        metadata?.icon
          ? `<div class="kv"><span>Icon APK</span><b>${esc(upload.files.find((file) => file.iconPreview?.label)?.iconPreview?.label || describeIcon(metadata.icon))}</b></div>`
          : ""
      }
      ${flags ? `<div class="kv"><span>Cờ</span><b>${esc(flags)}</b></div>` : ""}
    </div>`;
}

function uploadModal(state) {
  const upload = state.modal.upload;
  const blocked = uploadBlocked(upload);
  const overallText = upload.done
    ? "Hoàn tất"
    : upload.running
      ? "Đang tải lên…"
      : upload.inspecting || upload.consistency?.inspecting
        ? "Đang đọc APK…"
        : "Sẵn sàng";
  const percent = Math.round((upload.progress || 0) * 100);
  const uploadLabel = upload.running
    ? `<span class="spinner"></span> Đang tải lên…`
    : upload.inspecting || upload.consistency?.inspecting
      ? `<span class="spinner"></span> Đang đọc APK…`
      : `Tải lên${upload.files.length ? ` ${upload.files.length} tệp` : ""}`;
  const disabled = upload.running || upload.done ? "disabled" : "";

  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">Phát hành</div><h2>Tải bản dựng lên</h2></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="uploadgrid">
        <div>
          <div class="drop ${upload.files.length ? "has" : ""}" id="dropzone" data-act="pickFiles" style="${upload.files.length ? "min-height:130px" : ""}">
            <div class="up">${svg("upload", 24)}</div>
            <h3>${upload.files.length ? "Thả thêm APK" : "Thả APK vào đây"}</h3>
            <button class="btn btn-ghost pick" data-act="pickFiles">Chọn tệp</button>
          </div>
          <div class="files" id="fileList">${uploadFileRows(upload)}</div>
          <div id="upAlerts">${uploadAlertsHTML(upload)}</div>
          ${
            upload.files.length
              ? `<div class="overall" id="overall"><span id="ovText">${overallText}</span><div class="pb"><i id="ovBar" style="width:${percent}%"></i></div><span id="ovPct">${percent}%</span></div>`
              : ""
          }
          <div class="upload-error" id="upError">${esc(upload.error || "")}</div>
          <input type="file" id="fileInput" multiple accept=".apk,application/vnd.android.package-archive" class="sr">
        </div>
        <div class="form">
          ${uploadSummaryHTML(state, upload)}
          <div class="field"><label for="upDate">Ngày phát hành</label>
            <input id="upDate" type="date" value="${esc(upload.date)}" ${disabled}>
          </div>
          <div class="field"><label for="upNotes">Ghi chú phát hành</label>
            <textarea id="upNotes" placeholder="Điều gì thay đổi trong bản này?" ${disabled}>${esc(upload.notes)}</textarea>
          </div>
        </div>
      </div>
    </div>
    <div class="dfoot">
      <span class="hint" id="upFootHint">${esc(uploadFootHint(upload))}</span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${upload.running ? "disabled" : ""}>${upload.done ? "Đóng" : "Huỷ"}</button>
      ${
        upload.done
          ? `<button class="btn btn-dark" data-act="goUploadVersion">Xem phiên bản</button>`
          : `<button class="btn btn-primary" id="uploadBtn" data-act="startUpload" ${blocked ? "disabled" : ""}>${uploadLabel}</button>`
      }
    </div>`,
    920,
  );
}

export function updateUploadProgressDOM(state) {
  const upload = state.modal?.upload;
  if (!upload) return;
  let loaded = 0;
  let total = 0;
  upload.files.forEach((file) => {
    total += file.sizeBytes || 0;
    loaded += (file.progress || 0) * (file.sizeBytes || 0);
    const element = document.querySelector(`.file[data-file="${CSS.escape(file.id)}"]`);
    if (element) {
      const bar = element.querySelector(".pb i");
      const percent = Math.round((file.progress || 0) * 100);
      if (bar) bar.style.width = `${percent}%`;
      const label = element.querySelector(".pr");
      if (label) label.textContent = `${percent}%`;
      if (percent >= 100) element.classList.add("done");
    }
  });
  const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
  upload.progress = percent / 100;
  const overallBar = document.getElementById("ovBar");
  const overallPct = document.getElementById("ovPct");
  const overallText = document.getElementById("ovText");
  if (overallBar) overallBar.style.width = `${percent}%`;
  if (overallPct) overallPct.textContent = `${percent}%`;
  if (overallText) {
    overallText.textContent = upload.done
      ? "Hoàn tất"
      : percent >= 100
        ? "Đang ghi manifest…"
        : upload.running
          ? "Đang tải lên…"
          : "Sẵn sàng";
  }
}

export function disposeUploadPreviews(upload) {
  for (const file of upload?.files || []) disposeFileIcon(file);
}

/* -------------------------------------------------------------------- icon */

export function openIcon(state, appId) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  if (!app) return false;
  state.modal = {
    type: "icon",
    icon: { appId, dataUrl: null, file: null, error: "", busy: false, remove: false },
  };
  return true;
}

function iconPreviewHTML(app, icon) {
  if (icon.dataUrl) return `<img src="${esc(icon.dataUrl)}" alt="">`;
  if (app.iconUrl && !icon.remove) {
    return `<span aria-hidden="true">${initialOf(app)}</span><img src="${esc(app.iconUrl)}" alt="" onerror="this.remove()">`;
  }
  return `<span aria-hidden="true">${initialOf(app)}</span>`;
}

function iconModal(state) {
  const icon = state.modal.icon;
  const app = state.catalog.find((candidate) => candidate.id === icon.appId);
  if (!app) return overlay(`<div class="dbody">Không còn ứng dụng này.</div>`, 620);
  const preview = iconPreviewHTML(app, icon);
  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">Nhận diện</div><h2>Đổi icon ứng dụng</h2><p>${esc(app.name)}, ${esc(app.packageName)}</p></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="icongrid">
        <div class="icprev">
          <div class="icbig" id="icLight" style="background:${app.color}">${preview}</div>
          <div class="iclabel">Nền pastel</div>
          <div class="icbig dark" id="icDark">${preview}</div>
          <div class="iclabel">Nền tối</div>
        </div>
        <div>
          <div class="icdrop" id="iconDrop">
            <div class="up" style="width:44px;height:44px;border-radius:15px;background:var(--coral);color:#fff;display:grid;place-items:center;margin:0 auto">${svg("image", 20)}</div>
            <h4 style="margin-top:10px">Thả ảnh icon vào đây</h4>
            <p>PNG, JPG hoặc WebP, tối đa 2 MB, khuyến nghị 512 × 512.</p>
            <button class="btn btn-ghost" data-act="pickIcon" ${icon.busy ? "disabled" : ""}>Chọn ảnh</button>
            <input type="file" id="iconInput" accept="image/png,image/jpeg,image/webp" class="sr">
          </div>
          <div class="icrow">
            <button class="mini ghost" data-act="letterIcon" ${icon.busy ? "disabled" : ""}>${svg("file", 12)} Dùng chữ cái đầu</button>
            ${app.iconUrl ? `<button class="mini danger" data-act="removeIcon" ${icon.busy ? "disabled" : ""}>${svg("trash", 12)} Xoá icon hiện tại</button>` : ""}
          </div>
          <div class="inline-error" id="iconErr">${esc(icon.error || "")}</div>
        </div>
      </div>
    </div>
    <div class="dfoot">
      <span class="hint">${icon.busy ? "Đang lưu icon…" : ""}</span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${icon.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" data-act="saveIcon" ${icon.busy ? "disabled" : ""}>${icon.busy ? `<span class="spinner"></span> Đang lưu…` : "Lưu icon"}</button>
    </div>`,
    700,
  );
}

export function updateIconPreview(state) {
  const icon = state.modal?.icon;
  if (!icon) return;
  const app = state.catalog.find((candidate) => candidate.id === icon.appId);
  if (!app) return;
  const html = iconPreviewHTML(app, icon);
  const light = document.getElementById("icLight");
  const dark = document.getElementById("icDark");
  if (light) light.innerHTML = html;
  if (dark) dark.innerHTML = html;
}

/* ---------------------------------------------------------------- app form */

export function openAppForm(state, appId = null) {
  const editing = Boolean(appId);
  const app = editing ? state.catalog.find((candidate) => candidate.id === appId) : null;
  state.modal = {
    type: "app",
    form: {
      mode: editing ? "edit" : "new",
      id: app?.id || "",
      name: app?.name || "",
      packageName: app?.packageName || "",
      developer: app?.developer || "",
      description: app?.description || "",
      error: "",
      busy: false,
    },
  };
  return true;
}

function appFormModal(state) {
  const form = state.modal.form;
  const editing = form.mode === "edit";
  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">${editing ? "Thông tin" : "Ứng dụng mới"}</div><h2>${editing ? "Sửa thông tin ứng dụng" : "Tạo ứng dụng"}</h2></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="newgrid">
        <div class="field"><label for="fId">App ID</label>
          <input id="fId" value="${esc(form.id)}" placeholder="crm" spellcheck="false" ${editing || form.busy ? "disabled" : ""}>
          <div class="hint">Chữ, số, dấu chấm, gạch. Không đổi sau khi tạo.</div>
        </div>
        <div class="field"><label for="fName">Tên hiển thị</label>
          <input id="fName" value="${esc(form.name)}" placeholder="CRM Nội bộ" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field"><label for="fPkg">Package name</label>
          <input id="fPkg" value="${esc(form.packageName)}" placeholder="com.acme.crm" spellcheck="false" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field"><label for="fDev">Nhà phát triển</label>
          <input id="fDev" value="${esc(form.developer)}" placeholder="Platform Team" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field wide"><label for="fDesc">Mô tả</label>
          <textarea id="fDesc" placeholder="Ứng dụng này dùng để làm gì?" ${form.busy ? "disabled" : ""}>${esc(form.description)}</textarea>
        </div>
      </div>
      <div class="inline-error" id="formErr">${esc(form.error || "")}</div>
    </div>
    <div class="dfoot">
      <span class="hint"></span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${form.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" data-act="saveApp" ${form.busy ? "disabled" : ""}>${form.busy ? `<span class="spinner"></span> Đang lưu…` : editing ? "Lưu thay đổi" : "Tạo ứng dụng"}</button>
    </div>`,
    620,
  );
}

/* ------------------------------------------------------------ version form */

export function openVersionForm(state, appId, versionName) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  const version = app?.versions.find((candidate) => candidate.name === versionName);
  if (!app || !version) return false;
  state.modal = {
    type: "version",
    form: {
      appId,
      versionName,
      versionCode: String(version.code || 1),
      minSdk: version.minSdk == null ? "" : String(version.minSdk),
      notes: version.notes || "",
      date: version.publishedAt ? toDateInput(version.publishedAt) : "",
      error: "",
      busy: false,
    },
  };
  return true;
}

function versionFormModal(state) {
  const form = state.modal.form;
  const app = state.catalog.find((candidate) => candidate.id === form.appId);
  return overlay(
    `
    <div class="dhead">
      <div><div class="kick">Metadata</div><h2>Sửa phiên bản ${esc(form.versionName)}</h2><p>${esc(app?.name || form.appId)}. versionName không đổi được.</p></div>
      ${closeButton()}
    </div>
    <div class="dbody">
      <div class="newgrid">
        <div class="field"><label for="vfCode">Version code</label>
          <input id="vfCode" type="number" min="1" value="${esc(form.versionCode)}" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field"><label for="vfMinSdk">minSdk</label>
          <input id="vfMinSdk" type="number" min="1" value="${esc(form.minSdk)}" placeholder="để trống nếu không đặt" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field wide"><label for="vfDate">Ngày phát hành</label>
          <input id="vfDate" type="date" value="${esc(form.date)}" ${form.busy ? "disabled" : ""}>
        </div>
        <div class="field wide"><label for="vfNotes">Ghi chú phát hành</label>
          <textarea id="vfNotes" placeholder="Điều gì thay đổi trong bản này?" ${form.busy ? "disabled" : ""}>${esc(form.notes)}</textarea>
        </div>
      </div>
      <div class="inline-error" id="formErr">${esc(form.error || "")}</div>
    </div>
    <div class="dfoot">
      <span class="hint"></span>
      <span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${form.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" data-act="saveVersion" ${form.busy ? "disabled" : ""}>${form.busy ? `<span class="spinner"></span> Đang lưu…` : "Lưu thay đổi"}</button>
    </div>`,
    620,
  );
}

/* ---------------------------------------------------------------- confirm */

export function openConfirm(state, kind, appId, versionName = null) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  if (!app) return false;
  state.modal = {
    type: "confirm",
    confirm: { kind, appId, versionName, busy: false, error: "" },
  };
  return true;
}

function confirmModal(state) {
  const confirm = state.modal.confirm;
  const app = state.catalog.find((candidate) => candidate.id === confirm.appId);
  const isApp = confirm.kind === "app";
  const title = isApp ? "Xoá ứng dụng?" : "Xoá phiên bản?";
  const body = isApp
    ? `Xoá <b>${esc(app?.name || confirm.appId)}</b> cùng toàn bộ thư mục <span class="mono">apps/${esc(confirm.appId)}/</span>. Không thể hoàn tác.`
    : `Xoá phiên bản <b>v${esc(confirm.versionName)}</b> của <b>${esc(app?.name || confirm.appId)}</b> cùng mọi APK bên trong. Không thể hoàn tác.`;
  return overlay(
    `
    <div class="dhead"><div><div class="kick" style="color:var(--danger)">Xác nhận</div><h2>${title}</h2></div>${closeButton()}</div>
    <div class="dbody">
      <div class="warn">${body}</div>
      <div class="inline-error" id="formErr">${esc(confirm.error || "")}</div>
    </div>
    <div class="dfoot"><span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal" ${confirm.busy ? "disabled" : ""}>Huỷ</button>
      <button class="btn btn-primary" style="background:#B23A2B" data-act="confirmDelete" ${confirm.busy ? "disabled" : ""}>${confirm.busy ? `<span class="spinner"></span> Đang xoá…` : "Xoá"}</button>
    </div>`,
    520,
  );
}

/* ------------------------------------------------------------------- curl */

export function openCurl(state, appId, versionName = null) {
  const app = state.catalog.find((candidate) => candidate.id === appId);
  if (!app) return false;
  state.modal = { type: "curl", curl: { appId, versionName } };
  return true;
}

export function curlCode(state, app, versionName) {
  const base = state.settings.baseUrl || "http://localhost:8080";
  const version = versionName
    ? app.versions.find((candidate) => candidate.name === versionName)
    : null;
  const name = versionName || app.versions[0]?.name || "1.0.0";
  const encodedName = encodeURIComponent(name);
  const code = version?.code || (app.versions[0]?.code || 0) + 1 || 1;
  const minSdk = version?.minSdk ?? app.versions[0]?.minSdk ?? 26;
  const abis = version?.artifacts?.length
    ? version.artifacts.map((artifact) => artifact.abi)
    : ["arm64-v8a", "armeabi-v7a"];
  const artifactCmds = abis
    .map(
      (abi) => `curl -X PUT "$MTF_URL/api/v1/apps/${app.id}/versions/${encodedName}/artifacts/${abi}" \\
  -H 'content-type: application/vnd.android.package-archive' \\
  -H "X-Management-Key: $MTF_KEY" \\
  --data-binary @app-${abi}.apk`,
    )
    .join("\n\n");
  const payload = JSON.stringify({ versionName: name, versionCode: code, minSdk });
  return `export MTF_URL='${base}'
export MTF_KEY='<management_key>'

# 1. Tạo phiên bản (bản nháp)
curl -X POST "$MTF_URL/api/v1/apps/${app.id}/versions" \\
  -H 'content-type: application/json' \\
  -H "X-Management-Key: $MTF_KEY" \\
  -d '${payload}'

# 2. Đẩy APK cho từng ABI
${artifactCmds}

# CLI
npx my-testflight-cli@latest login "$MTF_URL"
npx my-testflight-cli@latest apk inspect app-arm64-v8a.apk --json
npx my-testflight-cli@latest publish app-arm64-v8a.apk --app-id ${app.id}`;
}

function curlModal(state) {
  const curl = state.modal.curl;
  const app = state.catalog.find((candidate) => candidate.id === curl.appId);
  if (!app) return overlay(`<div class="dbody">Không còn ứng dụng này.</div>`, 620);
  const code = curlCode(state, app, curl.versionName);
  return overlay(
    `
    <div class="dhead"><div><div class="kick">CI / terminal</div><h2>Lệnh phát hành</h2>
      <p>${esc(app.name)}${curl.versionName ? `, v${esc(curl.versionName)}` : ""}</p></div>
      ${closeButton()}</div>
    <div class="dbody"><pre class="curl">${esc(code)}</pre>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-primary" data-act="copyCurl">${svg("copy", 14)} Sao chép lệnh</button>
        <span style="font-size:12px;color:var(--mute);align-self:center">Thay <span class="mono">&lt;management_key&gt;</span> bằng token trong Cài đặt.</span>
      </div>
    </div>
    <div class="dfoot"><span class="sp"></span>
      <button class="btn btn-ghost" data-act="closeModal">Đóng</button></div>`,
    720,
  );
}

/* ------------------------------------------------------------------- root */

export function modalHTML(state) {
  if (!state.modal) return "";
  switch (state.modal.type) {
    case "upload":
      return uploadModal(state);
    case "icon":
      return iconModal(state);
    case "app":
      return appFormModal(state);
    case "version":
      return versionFormModal(state);
    case "confirm":
      return confirmModal(state);
    case "curl":
      return curlModal(state);
    default:
      return "";
  }
}

export function closeModal(state, force = false) {
  if (state.modal?.type === "upload" && state.modal.upload.running && !force) return false;
  if (state.modal?.type === "upload") disposeUploadPreviews(state.modal.upload);
  state.modal = null;
  return true;
}
