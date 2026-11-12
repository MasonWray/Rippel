// Turns a panel scene exported from ArkViz (`node scripts/panel-scene.mjs` in the ArkViz repo) into C tables for the
// house view widget.
//
//   node scripts/scene-to-c.mjs scenes/linden.json firmware/widgets/house_scene.c
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/scene-to-c.mjs <scene.json> <out.c>");
  process.exit(1);
}
const scene = JSON.parse(readFileSync(input, "utf8"));
if (scene.version !== 1) throw new Error(`${input}: panel scene version ${scene.version}, expected 1`);

const out = [];
const emit = (s) => out.push(s);

const coord = (v) => {
  if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new Error(`${input}: ${v} mm doesn't fit an int16_t`);
  return v;
};
const pts = (flat) => {
  const items = [];
  for (let i = 0; i < flat.length; i += 2) items.push(`{${coord(flat[i])},${coord(flat[i + 1])}}`);
  return items;
};
const str = (s) => JSON.stringify(s);
const color = (hex) => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) throw new Error(`${input}: can't read color ${hex}`);
  return `0x${(m[2] ?? "ff").toLowerCase()}${m[1].toLowerCase()}`;
};
/** Wraps a list of C items onto lines */
const list = (items, per = 12) => {
  if (!items.length) return "{0}";
  const lines = [];
  for (let i = 0; i < items.length; i += per) lines.push("    " + items.slice(i, i + per).join(", "));
  return `{\n${lines.join(",\n")}\n}`;
};
const area = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    a += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  return a / 2;
};

/**
 * Winds the outline one way and holes the other, so the widget can tell a side's outward face from the direction of
 * its edge alone: positive area for the outline, negative for holes. Reversing a ring renumbers its points, so the
 * top's triangles follow.
 */
function wind(prism) {
  const remap = [];
  const rings = prism.rings.map((ring, r) => {
    const n = ring.length / 2;
    const base = remap.length;
    const flip = r === 0 ? area(ring) < 0 : area(ring) > 0;
    for (let k = 0; k < n; k++) remap.push(base + (flip ? n - 1 - k : k));
    if (!flip) return ring;
    const rev = [];
    for (let k = n - 1; k >= 0; k--) rev.push(ring[2 * k], ring[2 * k + 1]);
    return rev;
  });
  return { ...prism, rings, tris: prism.tris.map((t) => remap[t]) };
}

const KIND = { slab: "HS_SLAB", wall: "HS_WALL", sill: "HS_SILL", step: "HS_STEP" };

emit(`/* Generated from ${basename(input)} by scripts/scene-to-c.mjs. Don't edit by hand: export the scene again. */`);
emit(`#include "house_scene.h"`);
emit("");

scene.floors.forEach((f, i) => {
  const p = `f${i}`;
  emit(`/* ${f.sheet} ${f.name} */`);
  emit(`static const hs_room_t ${p}_rooms[] = ${list(f.rooms.map((r) => `{${str(r.name.toUpperCase())}, {${coord(r.tag[0])},${coord(r.tag[1])}}, ${r.compact}}`), 1)};`);
  emit(`static const hs_pt_t ${p}_surface_pts[] = ${list(pts(f.surface.points))};`);
  emit(`static const uint16_t ${p}_surface_tris[] = ${list(f.surface.tris.map(String), 24)};`);
  emit(`static const uint8_t ${p}_surface_room[] = ${list(f.surface.room.map(String), 24)};`);

  const prisms = f.prisms.map(wind);
  prisms.forEach((pr, n) => {
    const ends = [];
    let at = 0;
    for (const r of pr.rings) ends.push((at += r.length / 2));
    emit(`static const hs_pt_t ${p}_p${n}_pts[] = ${list(pts(pr.rings.flat()))};`);
    emit(`static const uint16_t ${p}_p${n}_ends[] = {${ends.join(", ")}};`);
    emit(`static const uint16_t ${p}_p${n}_tris[] = ${list(pr.tris.map(String), 24)};`);
  });
  emit(
    `static const hs_prism_t ${p}_prisms[] = ${list(
      prisms.map((pr, n) => `{${p}_p${n}_pts, ${p}_p${n}_ends, ${p}_p${n}_tris, ${pr.tris.length / 3}, ${pr.rings.length}, ${KIND[pr.kind]}, ${pr.step ?? 0}}`),
      1,
    )};`,
  );
  for (const kind of ["furniture", "fine", "leaf"]) emit(`static const hs_pt_t ${p}_${kind}[] = ${list(pts(f.lines[kind]))};`);
  emit(
    `static const hs_device_t ${p}_devices[] = ${list(
      f.devices.map((d) => {
        const opa = d.glow ? Math.round(d.glow.opacity * 255) : 0;
        return `{{${coord(d.at[0])},${coord(d.at[1])}}, ${d.room}, ${+d.light}, ${+d.on}, ${+!!d.mount}, ${+d.wholeRoom}, ${d.level}, ${d.glow?.radius ?? 0}, ${opa}} /* ${d.name} */`;
      }),
      1,
    )};`,
  );
  emit("");
});

emit(
  `static const hs_floor_t floors[] = ${list(
    scene.floors.map((f, i) => {
      const p = `f${i}`;
      return `{${str(f.name)}, ${str(f.sheet)}, ${p}_rooms, ${f.rooms.length}, ${p}_surface_pts, ${p}_surface_tris, ${p}_surface_room, ${f.surface.tris.length / 3}, ${p}_prisms, ${f.prisms.length}, ${f.steps}, ${p}_furniture, ${f.lines.furniture.length / 4}, ${p}_fine, ${f.lines.fine.length / 4}, ${p}_leaf, ${f.lines.leaf.length / 4}, ${p}_devices, ${f.devices.length}}`;
    }),
    1,
  )};`,
);
emit("");
const c = scene.colors;
const d = scene.dims;
emit("const hs_scene_t house_scene = {");
emit(`    floors, ${scene.floors.length}, ${scene.span},`);
emit(`    ${d.level}, ${d.gap}, ${d.cut}, ${d.sill}, ${d.slab}, ${d.step},`);
emit(`    { ${["ground", "surface", "surface-sunk", "line-strong", "ink", "ink-muted", "poche", "floor", "lamp", "lamp-glow", "lamp-ink"].map((k) => color(c[k])).join(", ")} },`);
emit("};");

writeFileSync(output, out.join("\n") + "\n");
const prisms = scene.floors.reduce((n, f) => n + f.prisms.length, 0);
console.log(`Wrote ${output}: ${scene.floors.length} floors, ${prisms} solids`);
