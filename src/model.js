import { appColor, sortedVersions } from "./format.js";

export function normalizeVersion(raw) {
  const artifacts = (Array.isArray(raw?.artifacts) ? raw.artifacts : []).map((artifact) => ({
    abi: String(artifact.abi || ""),
    sizeBytes: Number(artifact.sizeBytes) || 0,
    sha256: artifact.sha256 || null,
    downloadPath: artifact.downloadPath || null,
  }));
  return {
    name: String(raw?.versionName ?? ""),
    code: Number(raw?.versionCode) || 0,
    minSdk: raw?.minSdk ?? null,
    notes: raw?.releaseNotes || "",
    publishedAt: raw?.publishedAt || null,
    draft: raw?.draft === true || artifacts.length === 0,
    artifacts,
    universal: artifacts.some((artifact) => artifact.abi === "universal"),
  };
}

export function normalizeApp(summary, adminVersions, api, revision) {
  const versions =
    adminVersions === null
      ? summary?.latestVersion
        ? [normalizeVersion(summary.latestVersion)]
        : []
      : (adminVersions || []).map(normalizeVersion);

  return {
    id: String(summary?.id || ""),
    name: summary?.name || summary?.id || "",
    packageName: summary?.packageName || summary?.id || "",
    description: summary?.description || "",
    developer: summary?.developer || "",
    iconPath: summary?.iconPath || null,
    iconUrl: summary?.iconPath ? api.iconUrl(summary.id, revision) : null,
    color: appColor(summary?.id),
    versions: sortedVersions(versions),
    adminVersionsAvailable: adminVersions !== null,
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Loads the catalog and, per app, the admin version list (which includes
 * drafts). A failed per-app admin read degrades that card to its published
 * summary instead of failing the whole dashboard.
 */
export async function loadCatalog(api) {
  const summaries = await api.listApps();
  const revision = Date.now();
  const apps = await mapLimit(summaries, 6, async (summary) => {
    let versions = null;
    try {
      versions = await api.listVersions(summary.id);
    } catch {
      versions = null;
    }
    return normalizeApp(summary, versions, api, revision);
  });
  return {
    apps,
    degraded: apps.some((app) => !app.adminVersionsAvailable),
  };
}

export function findApp(catalog, id) {
  return (catalog || []).find((app) => app.id === id) || null;
}
