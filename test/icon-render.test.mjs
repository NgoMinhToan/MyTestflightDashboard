import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdaptiveSvg,
  buildVectorSvg,
  describeIcon,
  escapeXml,
  prepareIconPreview,
  releaseIconPreview,
  svgToPngBlob,
  vectorBodySvg,
} from "../src/icon-render.js";
import {
  parseBinaryXml,
  parseResTable,
} from "../src/apk-resources.js";
import {
  REAL_ADAPTIVE_XML,
  REAL_ICON_EXPECTED,
  REAL_RESOURCES_ARSC,
  REAL_VECTOR_XML,
  buildVectorXml,
} from "./fixtures.mjs";

function realReadEntry(files = {}) {
  const table = {
    "res/BW.xml": REAL_ADAPTIVE_XML,
    "res/Qr.xml": REAL_VECTOR_XML,
    ...files,
  };
  return async (name) => table[name] || null;
}

test("builds an SVG from the real vector fixture", () => {
  const root = parseBinaryXml(REAL_VECTOR_XML);
  const svg = buildVectorSvg(root, { size: 256 });
  assert.match(svg, /viewBox="0 0 108 108"/);
  assert.match(svg, /width="256" height="256"/);
  assert.equal((svg.match(/<path /g) || []).length, REAL_ICON_EXPECTED.vectorPaths);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /M50,24h8v24h10L54,70 40,48h10z/);
});

test("vectorBodySvg renders nested groups with AOSP transform order", () => {
  const root = parseBinaryXml(
    buildVectorXml({
      viewportWidth: 24,
      viewportHeight: 24,
      groups: [
        {
          rotation: 45,
          pivotX: 12,
          pivotY: 12,
          scaleX: 2,
          scaleY: 2,
          translateX: 3,
          translateY: 4,
          paths: [{ pathData: "M0,0h1v1z", fillColor: 0xff112233 }],
        },
      ],
    }),
  );
  const body = vectorBodySvg(root);
  assert.match(
    body,
    /transform="translate\(15 16\) rotate\(45\) scale\(2 2\) translate\(-12 -12\)"/,
  );
  assert.match(body, /fill="#112233"/);
});

test("fillAlpha becomes fill-opacity and evenOdd becomes fill-rule", () => {
  const root = parseBinaryXml(
    buildVectorXml({
      paths: [
        {
          pathData: "M0,0h10v10z",
          fillColor: 0x80ff0000,
          fillAlpha: 0.5,
          fillType: "evenOdd",
        },
      ],
    }),
  );
  const svg = buildVectorSvg(root);
  assert.match(svg, /fill="#ff0000"/);
  assert.match(svg, /fill-opacity="0\.25098/);
  assert.match(svg, /fill-rule="evenodd"/);
});

test("stroke attributes survive the SVG conversion", () => {
  const root = parseBinaryXml(
    buildVectorXml({
      paths: [
        {
          pathData: "M0,0L10,10",
          strokeColor: 0xff00ff00,
          strokeWidth: 3,
        },
      ],
    }),
  );
  const svg = buildVectorSvg(root);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke="#00ff00"/);
  assert.match(svg, /stroke-width="3"/);
});

test("a path without a colour is transparent rather than black", () => {
  const root = parseBinaryXml(buildVectorXml({ paths: [{ pathData: "M0,0h1v1z" }] }));
  const svg = buildVectorSvg(root);
  assert.match(svg, /fill="none"/);
  assert.doesNotMatch(svg, /fill="#000000"/);
});

test("builds the adaptive icon from the real coral background and white vector", () => {
  const foreground = parseBinaryXml(REAL_VECTOR_XML);
  const svg = buildAdaptiveSvg({ background: "#ff4f40", foreground });
  assert.match(svg, /viewBox="0 0 108 108"/);
  assert.match(svg, /<rect width="108" height="108" fill="#ff4f40"\/>/);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.match(svg, /fill="#ffffff"/);
});

test("adaptive layers with a different viewport are scaled to 108", () => {
  const foreground = parseBinaryXml(
    buildVectorXml({
      viewportWidth: 24,
      viewportHeight: 48,
      paths: [{ pathData: "M0,0h1v1z", fillColor: 0xffffffff }],
    }),
  );
  const svg = buildAdaptiveSvg({ background: { color: "#000000" }, foreground });
  assert.match(svg, /scale\(4\.5 2\.25\)/);
});

test("XML escaping protects path data and colours", () => {
  assert.equal(escapeXml('a&b<c>"d"'), "a&amp;b&lt;c&gt;&quot;d&quot;");
});

test("describeIcon labels every descriptor kind", () => {
  assert.equal(describeIcon({ kind: "adaptive" }), "Adaptive XML");
  assert.equal(describeIcon({ kind: "vector" }), "Vector XML");
  assert.equal(
    describeIcon({ kind: "raster", contentType: "image/png", density: 640 }),
    "PNG 640 dpi",
  );
  assert.equal(describeIcon(null), "");
});

test("prepareIconPreview renders the real adaptive icon without rasterisation", async () => {
  const table = parseResTable(REAL_RESOURCES_ARSC);
  const preview = await prepareIconPreview(
    { kind: "adaptive", entry: "res/BW.xml", resourceId: 0x7f0b0000 },
    { table, readEntry: realReadEntry(), size: 512, rasterize: false },
  );
  assert.equal(preview.kind, "adaptive");
  assert.equal(preview.label, "Adaptive XML");
  assert.equal(preview.error, "");
  assert.match(preview.svg, /fill="#ff4f40"/);
  assert.match(preview.svg, /fill="#ffffff"/);
  assert.ok(preview.previewUrl.startsWith("data:image/svg+xml"));
  releaseIconPreview(preview);
});

test("prepareIconPreview renders a vector descriptor", async () => {
  const table = parseResTable(REAL_RESOURCES_ARSC);
  const preview = await prepareIconPreview(
    { kind: "vector", entry: "res/Qr.xml", resourceId: 0x7f060007 },
    { table, readEntry: realReadEntry(), rasterize: false },
  );
  assert.equal(preview.kind, "vector");
  assert.match(preview.svg, /<path /);
  assert.equal(preview.pngBlob, null);
});

test("prepareIconPreview returns the original raster bytes", async () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const preview = await prepareIconPreview(
    {
      kind: "raster",
      entry: "res/icon.png",
      contentType: "image/png",
      resourceId: 0x7f0b0000,
      density: 640,
    },
    { readEntry: realReadEntry({ "res/icon.png": png }), rasterize: false },
  );
  assert.equal(preview.error, "");
  assert.equal(preview.blob.type, "image/png");
  assert.ok(preview.previewUrl.startsWith("blob:"));
  releaseIconPreview(preview);
});

test("prepareIconPreview reports a missing entry", async () => {
  const preview = await prepareIconPreview(
    { kind: "adaptive", entry: "res/missing.xml", resourceId: 1 },
    { table: null, readEntry: async () => null },
  );
  assert.match(preview.error, /Không đọc được/);
  assert.equal(preview.svg, null);
});

test("svgToPngBlob returns null without a browser canvas", async () => {
  assert.equal(await svgToPngBlob("<svg/>", 32), null);
});
