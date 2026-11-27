/**
 * Launcher-icon rendering.
 *
 * Pure SVG builders (`buildVectorSvg`, `buildAdaptiveSvg`, `describeIcon`) are
 * covered by `node --test`. Browser-only helpers rasterise the SVG to a
 * 512×512 PNG for the preview and the `PUT /apps/:id/icon` upload; when the
 * platform lacks `Image`, canvas or `DecompressionStream` they return null and
 * the upload flow simply skips the icon.
 */

import {
  attrOf,
  argbToCss,
  iconKindFromElement,
  MAX_RASTER_ICON_BYTES,
  MAX_XML_COMPRESSED,
  MAX_XML_INFLATED,
  parseBinaryXml,
  parseColor,
  rasterContentType,
  resolveIconResource,
  resolveResource,
} from "./apk-resources.js";

/* ---------------------------------------------------------------- escape */

export function escapeXml(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char],
  );
}

function numberAttr(node, name, fallback = 0) {
  const attr = attrOf(node, name);
  if (!attr) return fallback;
  if (typeof attr.value === "number" && Number.isFinite(attr.value)) return attr.value;
  if (typeof attr.string === "string") {
    const parsed = Number.parseFloat(attr.string);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof attr.raw === "string") {
    const parsed = Number.parseFloat(attr.raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof attr.data === "number") {
    const raw = attr.data | 0;
    return raw / 256;
  }
  return fallback;
}

function stringAttr(node, name) {
  const attr = attrOf(node, name);
  if (!attr) return null;
  if (typeof attr.string === "string") return attr.string;
  if (typeof attr.raw === "string") return attr.raw;
  if (typeof attr.value === "string") return attr.value;
  return null;
}

/* ---------------------------------------------------------------- colours */

function defaultColorResolver(attr) {
  if (!attr) return null;
  if (attr.type >= 0x1c && attr.type <= 0x1f) {
    return parseColor(attr.data);
  }
  if (typeof attr.string === "string") return parseColor(attr.string);
  if (typeof attr.raw === "string") return parseColor(attr.raw);
  if (typeof attr.value === "string") return parseColor(attr.value);
  return null;
}

/**
 * Resolve a colour attribute to `{ hex, alpha }`. A caller-supplied resolver
 * may return either a CSS colour string or the same `{ hex, alpha }` object;
 * this is how resource references inside vector drawables are followed.
 */
export function colorOf(node, name, resolveColor) {
  const attr = attrOf(node, name);
  if (!attr) return null;
  if (resolveColor) {
    const resolved = resolveColor(attr);
    if (resolved) {
      if (typeof resolved === "string") {
        return parseColor(resolved) ?? { hex: resolved, alpha: 1 };
      }
      if (resolved.hex) return resolved;
    }
  }
  const fallback = defaultColorResolver(attr);
  return fallback || null;
}

function alphaOf(node, name, fallback = 1) {
  const attr = attrOf(node, name);
  if (!attr) return fallback;
  let value = Number.NaN;
  if (typeof attr.value === "number") value = attr.value;
  else if (typeof attr.string === "string") value = Number.parseFloat(attr.string);
  else if (typeof attr.raw === "string") value = Number.parseFloat(attr.raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

/* ----------------------------------------------------------------- vector */

function groupTransform(node) {
  const pivotX = numberAttr(node, "pivotX", 0);
  const pivotY = numberAttr(node, "pivotY", 0);
  const rotation = numberAttr(node, "rotation", 0);
  const scaleX = numberAttr(node, "scaleX", 1);
  const scaleY = numberAttr(node, "scaleY", 1);
  const translateX = numberAttr(node, "translateX", 0);
  const translateY = numberAttr(node, "translateY", 0);
  // AOSP composes translate(pivot + delta) · rotate · scale · translate(-pivot).
  const parts = [];
  const x = translateX + pivotX;
  const y = translateY + pivotY;
  if (x || y) parts.push(`translate(${x} ${y})`);
  if (rotation) parts.push(`rotate(${rotation})`);
  if (scaleX !== 1 || scaleY !== 1) parts.push(`scale(${scaleX} ${scaleY})`);
  if (pivotX || pivotY) parts.push(`translate(${-pivotX} ${-pivotY})`);
  return parts.join(" ");
}

function pathSvg(node, resolveColor) {
  const data = stringAttr(node, "pathData");
  if (!data) return "";
  const fill = colorOf(node, "fillColor", resolveColor);
  const stroke = colorOf(node, "strokeColor", resolveColor);
  const fillAlpha = alphaOf(node, "fillAlpha", 1);
  const strokeAlpha = alphaOf(node, "strokeAlpha", 1);
  const strokeWidth = numberAttr(node, "strokeWidth", 0);
  const lineCap = stringAttr(node, "strokeLineCap");
  const lineJoin = stringAttr(node, "strokeLineJoin");
  const fillType = stringAttr(node, "fillType");
  const attrs = [`d="${escapeXml(data)}"`];
  const fillOpacity = fill ? fill.alpha * fillAlpha : 0;
  if (fill && fillOpacity > 0) {
    attrs.push(`fill="${escapeXml(fill.hex)}"`);
    if (fillOpacity < 1) attrs.push(`fill-opacity="${fillOpacity}"`);
  } else {
    attrs.push(`fill="none"`);
  }
  if (stroke) {
    const strokeOpacity = stroke.alpha * strokeAlpha;
    attrs.push(`stroke="${escapeXml(stroke.hex)}"`);
    if (strokeOpacity < 1) attrs.push(`stroke-opacity="${strokeOpacity}"`);
    if (strokeWidth > 0) attrs.push(`stroke-width="${strokeWidth}"`);
    if (lineCap) attrs.push(`stroke-linecap="${escapeXml(lineCap.toLowerCase())}"`);
    if (lineJoin) attrs.push(`stroke-linejoin="${escapeXml(lineJoin.toLowerCase())}"`);
  }
  if (fillType === "evenOdd") attrs.push(`fill-rule="evenodd"`);
  return `<path ${attrs.join(" ")}/>`;
}

/** Render the children of a `<vector>`; returns the inner SVG markup. */
export function vectorBodySvg(node, { resolveColor } = {}) {
  if (!node) return "";
  return (node.children || [])
    .map((child) => {
      if (child.name === "path") return pathSvg(child, resolveColor);
      if (child.name === "group") {
        const transform = groupTransform(child);
        const body = vectorBodySvg(child, { resolveColor });
        if (!body) return "";
        return transform
          ? `<g transform="${escapeXml(transform)}">${body}</g>`
          : `<g>${body}</g>`;
      }
      // clip-path and unknown elements are ignored rather than guessed.
      return "";
    })
    .join("");
}

function viewportOf(node) {
  const width = numberAttr(node, "viewportWidth", 0) || 24;
  const height = numberAttr(node, "viewportHeight", 0) || width;
  return { width: width > 0 ? width : 24, height: height > 0 ? height : width };
}

/** Pure `<vector>` -> standalone SVG document. */
export function buildVectorSvg(node, { size = 108, resolveColor, background } = {}) {
  const viewport = viewportOf(node);
  const body = vectorBodySvg(node, { resolveColor });
  const rect = background
    ? `<rect width="${viewport.width}" height="${viewport.height}" fill="${escapeXml(background)}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${viewport.width} ${viewport.height}">${rect}${body}</svg>`;
}

function layerSvg(node, { resolveColor, viewport = 108 } = {}) {
  if (!node) return "";
  const own = viewportOf(node);
  const body = vectorBodySvg(node, { resolveColor });
  if (!body) return "";
  const scaleX = viewport / own.width;
  const scaleY = viewport / own.height;
  if (Math.abs(scaleX - 1) < 0.0001 && Math.abs(scaleY - 1) < 0.0001) {
    return `<g>${body}</g>`;
  }
  return `<g transform="scale(${scaleX} ${scaleY})">${body}</g>`;
}

/**
 * Compose an adaptive icon at 108×108. `background` is a CSS colour, a parsed
 * vector node, or `{ color }` / `{ node }`; `foreground` is a parsed vector
 * node. `monochrome` is intentionally ignored.
 */
export function buildAdaptiveSvg({
  background,
  foreground,
  size = 108,
  resolveColor,
} = {}) {
  const layers = [];
  let backgroundLayer = "";
  if (typeof background === "string") {
    backgroundLayer = `<rect width="108" height="108" fill="${escapeXml(background)}"/>`;
  } else if (background?.color) {
    backgroundLayer = `<rect width="108" height="108" fill="${escapeXml(background.color)}"/>`;
  } else {
    const node = background?.node ?? background;
    if (node?.children) {
      backgroundLayer = `<rect width="108" height="108" fill="#000000"/>${layerSvg(node, { resolveColor })}`;
    }
  }
  if (backgroundLayer) layers.push(backgroundLayer);
  if (foreground?.children) layers.push(layerSvg(foreground, { resolveColor }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108" style="background:transparent">${layers.join("")}</svg>`;
}

/** Human label for a descriptor (used in the read-only upload summary). */
export function describeIcon(descriptor) {
  if (!descriptor) return "";
  if (descriptor.kind === "adaptive") return "Adaptive XML";
  if (descriptor.kind === "vector") return "Vector XML";
  if (descriptor.kind === "raster") {
    const type = String(descriptor.contentType || "image").replace("image/", "").toUpperCase();
    const density = descriptor.density ? ` ${descriptor.density} dpi` : "";
    return `${type}${density}`;
  }
  return descriptor.kind;
}

/* --------------------------------------------------------------- browser */

function canRasterise() {
  return (
    typeof document !== "undefined" &&
    typeof Image !== "undefined" &&
    typeof Blob !== "undefined"
  );
}

export function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function objectUrlFor(blob) {
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      return URL.createObjectURL(blob);
    }
  } catch {
    /* private mode / blocked blob URLs */
  }
  return null;
}

/** Rasterise an SVG string to a PNG Blob, or null when unavailable. */
export async function svgToPngBlob(svg, size = 512) {
  if (!canRasterise() || !svg) return null;
  const url = objectUrlFor(new Blob([svg], { type: "image/svg+xml" }));
  if (!url) return null;
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Không đọc được SVG."));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob || null), "image/png");
    });
  } catch {
    return null;
  } finally {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
}

function resolvedColorValue(attr, table) {
  if (!attr) return null;
  if (attr.type >= 0x1c && attr.type <= 0x1f) return parseColor(attr.data);
  if (attr.type === 0x03) return parseColor(attr.string);
  if (attr.type === 0x01 && table) {
    const resource = resolveResource(table, attr.data);
    if (!resource) return null;
    if (resource.color != null) return argbToCss(resource.color);
    if (resource.string) return parseColor(resource.string);
    return null;
  }
  return defaultColorResolver(attr);
}

function makeColorResolver(table) {
  if (!table) return undefined;
  return (attr) => resolvedColorValue(attr, table);
}

async function resolveDrawable(attr, { table, readEntry }) {
  if (!attr) return null;
  if (attr.type >= 0x1c && attr.type <= 0x1f) {
    const color = parseColor(attr.data);
    return color ? { color: color.hex } : null;
  }
  if (attr.type === 0x03) {
    const text = attr.string || attr.raw;
    const color = parseColor(text);
    if (color) return { color: color.hex };
    if (/\.xml$/i.test(String(text || ""))) return readVector(text, readEntry);
    return null;
  }
  if (attr.type === 0x01 && table) {
    const resource = resolveResource(table, attr.data);
    if (resource?.color != null) {
      const color = argbToCss(resource.color);
      return { color: color.hex };
    }
    if (resource?.string) {
      const color = parseColor(resource.string);
      if (color) return { color: color.hex };
      if (/\.xml$/i.test(resource.string)) return readVector(resource.string, readEntry);
    }
    const icon = resolveIconResource(table, attr.data, { prefer: "xml" });
    if (icon) return readVector(icon.entry, readEntry);
  }
  return null;
}

async function readVector(entry, readEntry) {
  if (!entry || !readEntry) return null;
  try {
    const bytes = await readEntry(entry, {
      maxCompressed: MAX_XML_COMPRESSED,
      maxInflated: MAX_XML_INFLATED,
    });
    if (!bytes) return null;
    const node = parseBinaryXml(bytes);
    return { node };
  } catch {
    return null;
  }
}

/**
 * Prepare an APK icon for the upload dialog.
 *
 * Raster descriptors preview the original bytes. Adaptive/vector descriptors
 * are turned into an SVG and rasterised to a 512×512 PNG; that PNG is the only
 * thing the dashboard ever uploads as an app icon.
 */
export async function prepareIconPreview(
  descriptor,
  { table, readEntry, size = 512, rasterize = true } = {},
) {
  if (!descriptor?.entry) return null;
  const base = {
    kind: descriptor.kind,
    label: describeIcon(descriptor),
    svg: null,
    pngBlob: null,
    previewUrl: null,
    error: "",
  };
  try {
    if (descriptor.kind === "raster") {
      const bytes = readEntry
        ? await readEntry(descriptor.entry, {
            maxCompressed: MAX_RASTER_ICON_BYTES,
            maxInflated: MAX_RASTER_ICON_BYTES,
          })
        : null;
      if (!bytes) return { ...base, error: "Không đọc được icon raster." };
      const blob = new Blob([bytes], {
        type: descriptor.contentType || rasterContentType(descriptor.entry) || "image/png",
      });
      return { ...base, previewUrl: objectUrlFor(blob), blob };
    }

    const bytes = readEntry
      ? await readEntry(descriptor.entry, {
          maxCompressed: MAX_XML_COMPRESSED,
          maxInflated: MAX_XML_INFLATED,
        })
      : null;
    if (!bytes) return { ...base, error: "Không đọc được XML icon." };
    const node = parseBinaryXml(bytes);
    const resolveColor = makeColorResolver(table);
    let svg;
    if (iconKindFromElement(node) === "adaptive" || descriptor.kind === "adaptive") {
      const backgroundElement = node.children.find((child) => child.name === "background");
      const foregroundElement = node.children.find((child) => child.name === "foreground");
      const background = await resolveDrawable(attrOf(backgroundElement, "drawable"), {
        table,
        readEntry,
      });
      const foreground = await resolveDrawable(
        attrOf(foregroundElement, "drawable"),
        { table, readEntry },
      );
      if (!foreground?.node) {
        return { ...base, error: "Adaptive icon thiếu foreground vector." };
      }
      svg = buildAdaptiveSvg({
        background: background || "#000000",
        foreground: foreground.node,
        resolveColor,
      });
    } else if (iconKindFromElement(node) === "vector") {
      svg = buildVectorSvg(node, { size: 108, resolveColor });
    } else {
      return { ...base, error: "XML không phải vector/adaptive icon." };
    }
    const pngBlob = rasterize ? await svgToPngBlob(svg, size) : null;
    const previewUrl = pngBlob ? objectUrlFor(pngBlob) : svgDataUrl(svg);
    return { ...base, svg, pngBlob, previewUrl };
  } catch (error) {
    return { ...base, error: error?.message || "Không dựng được icon." };
  }
}

/** Release an object URL produced by `prepareIconPreview`. */
export function releaseIconPreview(preview) {
  if (!preview?.previewUrl) return;
  if (preview.previewUrl.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(preview.previewUrl);
    } catch {
      /* ignore */
    }
  }
}
