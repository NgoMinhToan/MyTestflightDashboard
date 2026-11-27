import test from "node:test";
import assert from "node:assert/strict";

import {
  argbToCss,
  attrOf,
  iconKindFromElement,
  parseBinaryXml,
  parseColor,
  parseResTable,
  rasterContentType,
  resolveIconDescriptor,
  resolveIconResource,
  resolveLabel,
  resolveResource,
  resolveVersionName,
} from "../src/apk-resources.js";
import {
  REAL_ADAPTIVE_XML,
  REAL_ICON_EXPECTED,
  REAL_RESOURCES_ARSC,
  REAL_VECTOR_XML,
  buildAdaptiveXml,
  buildResourcesTable,
  buildVectorXml,
} from "./fixtures.mjs";

/* ------------------------------------------------------------------ colours */

test("Android ARGB colours convert to CSS hex plus opacity", () => {
  assert.deepEqual(argbToCss(0xffff4f40), { hex: "#ff4f40", alpha: 1, css: "#ff4f40" });
  assert.equal(argbToCss(0x80000000).alpha, 128 / 255);
  assert.equal(parseColor("#abc").hex, "#aabbcc");
  assert.equal(parseColor("#ff4f40").hex, "#ff4f40");
  assert.equal(parseColor(0xff00ff00).hex, "#00ff00");
  assert.equal(parseColor("not-a-colour"), null);
});

/* ------------------------------------------------------------- real fixtures */

test("parses the real resources.arsc from the workspace APK", () => {
  const table = parseResTable(REAL_RESOURCES_ARSC);
  assert.equal(table.packages.length, 1);
  assert.equal(table.packages[0].name, "dev.minhtoan.mytestflight");
  assert.ok(table.byId.size > 100);

  const label = resolveResource(table, REAL_ICON_EXPECTED.labelResourceId);
  assert.equal(label.string, REAL_ICON_EXPECTED.label);
  assert.equal(resolveLabel(table, REAL_ICON_EXPECTED.labelResourceId), "My TestFlight");

  const background = resolveResource(table, REAL_ICON_EXPECTED.backgroundResourceId);
  assert.equal(background.color, REAL_ICON_EXPECTED.backgroundArgb);
});

test("resolves the real adaptive icon and its vector foreground", () => {
  const table = parseResTable(REAL_RESOURCES_ARSC);
  const adaptive = resolveIconResource(table, REAL_ICON_EXPECTED.adaptiveResourceId);
  assert.equal(adaptive.entry, REAL_ICON_EXPECTED.adaptiveEntry);
  assert.equal(adaptive.kind, "xml");

  const foreground = resolveIconResource(table, REAL_ICON_EXPECTED.foregroundResourceId);
  assert.equal(foreground.entry, REAL_ICON_EXPECTED.foregroundEntry);
  assert.equal(foreground.kind, "xml");

  const descriptor = resolveIconDescriptor(
    table,
    REAL_ICON_EXPECTED.adaptiveResourceId,
    { xmlKind: (entry) => (entry.endsWith("BW.xml") ? "adaptive" : "vector") },
  );
  assert.deepEqual(descriptor, {
    kind: "adaptive",
    entry: "res/BW.xml",
    resourceId: REAL_ICON_EXPECTED.adaptiveResourceId,
  });
});

test("parses the real adaptive-icon XML into a tree", () => {
  const root = parseBinaryXml(REAL_ADAPTIVE_XML);
  assert.equal(root.name, "adaptive-icon");
  assert.deepEqual(
    root.children.map((child) => child.name),
    ["background", "foreground", "monochrome"],
  );
  const background = attrOf(root.children[0], "drawable");
  const foreground = attrOf(root.children[1], "drawable");
  assert.equal(background.type, 0x01);
  assert.equal(background.value, REAL_ICON_EXPECTED.backgroundResourceId);
  assert.equal(foreground.value, REAL_ICON_EXPECTED.foregroundResourceId);
});

test("parses the real vector XML with two white paths", () => {
  const root = parseBinaryXml(REAL_VECTOR_XML);
  assert.equal(root.name, "vector");
  assert.equal(root.attrs.get("viewportWidth").value, 108);
  assert.equal(root.attrs.get("viewportHeight").value, 108);
  assert.equal(root.children.length, REAL_ICON_EXPECTED.vectorPaths);
  for (const path of root.children) {
    assert.equal(path.name, "path");
    assert.equal(path.attrs.get("fillColor").value, REAL_ICON_EXPECTED.vectorFill);
    assert.match(path.attrs.get("pathData").string, /^M/);
  }
});

test("iconKindFromElement classifies adaptive/vector roots", () => {
  assert.equal(iconKindFromElement({ name: "adaptive-icon" }), "adaptive");
  assert.equal(iconKindFromElement({ name: "vector" }), "vector");
  assert.equal(iconKindFromElement({ name: "shape" }), null);
});

test("rasterContentType follows the file extension", () => {
  assert.equal(rasterContentType("res/a.png"), "image/png");
  assert.equal(rasterContentType("res/a.webp"), "image/webp");
  assert.equal(rasterContentType("res/a.jpg"), "image/jpeg");
  assert.equal(rasterContentType("res/a.jpeg"), "image/jpeg");
  assert.equal(rasterContentType("res/a.xml"), null);
});

/* --------------------------------------------------------- synthesized matrix */

test("default locale wins over en and other locales", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "string",
          id: 14,
          entries: [
            {
              key: "title",
              configs: [
                { config: {}, value: { type: "string", value: "Default" } },
                { config: { language: "en" }, value: { type: "string", value: "English" } },
                { config: { language: "vi" }, value: { type: "string", value: "Tiếng Việt" } },
              ],
            },
          ],
        },
      ],
    }),
  );
  assert.equal(resolveResource(table, 0x7f0e0000).string, "Default");
});

test("en wins when there is no default entry", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "string",
          id: 14,
          entries: [
            {
              key: "title",
              configs: [
                { config: { language: "vi" }, value: { type: "string", value: "Tiếng Việt" } },
                { config: { language: "en" }, value: { type: "string", value: "English" } },
              ],
            },
          ],
        },
      ],
    }),
  );
  assert.equal(resolveResource(table, 0x7f0e0000).string, "English");
});

test("a reference chain resolves to the final string", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "string",
          id: 14,
          entries: [
            {
              key: "app_name",
              configs: [{ config: {}, value: { type: "string", value: "My App" } }],
            },
            {
              key: "label_ref",
              configs: [{ config: {}, value: { type: "reference", value: 0x7f0e0000 } }],
            },
          ],
        },
      ],
    }),
  );
  assert.equal(resolveLabel(table, 0x7f0e0001), "My App");
  assert.equal(resolveVersionName(table, 0x7f0e0001), "My App");
});

test("reference cycles resolve to null instead of looping", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "string",
          id: 14,
          entries: [
            {
              key: "a",
              configs: [{ config: {}, value: { type: "reference", value: 0x7f0e0001 } }],
            },
            {
              key: "b",
              configs: [{ config: {}, value: { type: "reference", value: 0x7f0e0000 } }],
            },
          ],
        },
      ],
    }),
  );
  assert.equal(resolveResource(table, 0x7f0e0000), null);
});

test("icon resolution prefers anydpi XML over density rasters", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "mipmap",
          id: 11,
          entries: [
            {
              key: "ic_launcher",
              configs: [
                { config: { density: 160 }, value: { type: "string", value: "res/mdpi.png" } },
                { config: { density: 320 }, value: { type: "string", value: "res/xhdpi.png" } },
                { config: { density: 0xfffe }, value: { type: "string", value: "res/adaptive.xml" } },
              ],
            },
          ],
        },
      ],
    }),
  );
  const xml = resolveIconResource(table, 0x7f0b0000, { prefer: "xml" });
  assert.equal(xml.entry, "res/adaptive.xml");
  const raster = resolveIconResource(table, 0x7f0b0000, { prefer: "raster" });
  assert.equal(raster.entry, "res/xhdpi.png");
  assert.equal(raster.density, 320);
});

test("raster-only icons use the highest density", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "mipmap",
          id: 11,
          entries: [
            {
              key: "ic_launcher",
              configs: [
                { config: { density: 160 }, value: { type: "string", value: "res/mdpi.png" } },
                { config: { density: 640 }, value: { type: "string", value: "res/xxxhdpi.webp" } },
                { config: { density: 320 }, value: { type: "string", value: "res/xhdpi.jpg" } },
              ],
            },
          ],
        },
      ],
    }),
  );
  const resource = resolveIconResource(table, 0x7f0b0000);
  assert.equal(resource.entry, "res/xxxhdpi.webp");
  assert.equal(resource.density, 640);
  const descriptor = resolveIconDescriptor(table, 0x7f0b0000);
  assert.equal(descriptor.kind, "raster");
  assert.equal(descriptor.contentType, "image/webp");
  assert.equal(descriptor.density, 640);
});

test("icon descriptor requires a classifier for XML entries", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "mipmap",
          id: 11,
          entries: [
            {
              key: "ic_launcher",
              configs: [
                { config: { density: 0xfffe }, value: { type: "string", value: "res/a.xml" } },
              ],
            },
          ],
        },
      ],
    }),
  );
  assert.equal(resolveIconDescriptor(table, 0x7f0b0000), null);
  assert.deepEqual(
    resolveIconDescriptor(table, 0x7f0b0000, { xmlKind: () => "vector" }),
    { kind: "vector", entry: "res/a.xml", resourceId: 0x7f0b0000 },
  );
});

test("missing resources resolve to null", () => {
  const table = parseResTable(
    buildResourcesTable({ types: [{ name: "string", id: 14, entries: [] }] }),
  );
  assert.equal(resolveResource(table, 0x7f0e0009), null);
  assert.equal(resolveIconResource(table, 0x7f0b0009), null);
  assert.equal(resolveLabel(table, 0x7f0e0009), null);
});

test("a resource reference can point at a nested drawable path", () => {
  const table = parseResTable(
    buildResourcesTable({
      types: [
        {
          name: "drawable",
          id: 6,
          entries: [
            {
              key: "real",
              configs: [{ config: {}, value: { type: "string", value: "res/Qr.xml" } }],
            },
            {
              key: "alias",
              configs: [{ config: {}, value: { type: "reference", value: 0x7f060000 } }],
            },
          ],
        },
      ],
    }),
  );
  const resource = resolveIconResource(table, 0x7f060001);
  assert.equal(resource.entry, "res/Qr.xml");
  assert.equal(resource.resourceId, 0x7f060001);
});

test("synthesized adaptive XML resolves colours and drawable references", () => {
  const root = parseBinaryXml(
    buildAdaptiveXml({
      background: { color: 0xffff4f40 },
      foreground: { ref: 0x7f060000 },
      monochrome: { ref: 0x7f060000 },
    }),
  );
  assert.equal(root.name, "adaptive-icon");
  assert.equal(attrOf(root.children[0], "drawable").type, 0x1c);
  assert.equal(attrOf(root.children[0], "drawable").value, 0xffff4f40);
  assert.equal(attrOf(root.children[1], "drawable").type, 0x01);
  assert.equal(root.children[2].name, "monochrome");
});

test("synthesized vector XML keeps viewport, groups and path attributes", () => {
  const root = parseBinaryXml(
    buildVectorXml({
      viewportWidth: 24,
      viewportHeight: 24,
      paths: [
        {
          pathData: "M0,0h24v24z",
          fillColor: 0xff112233,
          fillAlpha: 0.5,
          strokeColor: 0xff445566,
          strokeWidth: 2,
          fillType: "evenOdd",
        },
      ],
      groups: [{ rotation: 45, pivotX: 12, pivotY: 12, scaleX: 2, scaleY: 2 }],
    }),
  );
  assert.equal(root.name, "vector");
  assert.equal(root.attrs.get("viewportWidth").value, 24);
  assert.equal(root.children.length, 2);
  const path = root.children[0];
  assert.equal(path.attrs.get("pathData").string, "M0,0h24v24z");
  assert.equal(path.attrs.get("fillColor").value, 0xff112233);
  assert.equal(path.attrs.get("fillAlpha").value, 0.5);
  assert.equal(path.attrs.get("fillType").string, "evenOdd");
  const group = root.children[1];
  assert.equal(group.name, "group");
  assert.equal(group.children.length, 0);
  assert.equal(group.attrs.get("rotation").value, 45);
});

/* ---------------------------------------------------------------- errors */

test("rejects a byte array that is not a resource table", () => {
  assert.throws(() => parseResTable(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /resources\.arsc/);
});

test("rejects a byte array that is not binary XML", () => {
  assert.throws(() => parseBinaryXml(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /binary XML/);
});

test("rejects truncated binary XML", () => {
  assert.throws(() => parseBinaryXml(REAL_VECTOR_XML.subarray(0, 40)), /Chunk|Header|XML/);
});
