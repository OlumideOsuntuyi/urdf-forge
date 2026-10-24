// Example URDF Forge plugin: a Wavefront OBJ importer.
// Each `o` (object) or `g` (group) becomes a separate body in the import dialog.

/** @param {import("../../../src/plugins/api").ForgePluginApi} api */
export function activate(api) {
  return api.importers.register({
    extensions: ["obj"],
    label: "Wavefront OBJ",
    async import(bytes, fileName) {
      const text = new TextDecoder().decode(bytes);
      const verts = [];
      const bodies = [];
      let current = { name: fileName.replace(/\.[^.]+$/, ""), tris: [] };
      bodies.push(current);

      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith("v ")) {
          const [, x, y, z] = line.split(/\s+/);
          verts.push([+x, +y, +z]);
        } else if (line.startsWith("o ") || line.startsWith("g ")) {
          current = { name: line.slice(2).trim() || `body_${bodies.length + 1}`, tris: [] };
          bodies.push(current);
        } else if (line.startsWith("f ")) {
          // Faces may be polygons and may use v/vt/vn or negative (relative) indices.
          const idx = line
            .slice(2)
            .trim()
            .split(/\s+/)
            .map((t) => {
              const i = parseInt(t.split("/")[0], 10);
              return i < 0 ? verts.length + i : i - 1;
            });
          for (let k = 1; k + 1 < idx.length; k++) current.tris.push(idx[0], idx[k], idx[k + 1]);
        }
      }

      // OBJ has no units. Large models are usually millimetres.
      let max = 0;
      for (const v of verts) max = Math.max(max, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
      const scale = max > 20 ? 0.001 : 1;
      if (scale !== 1) api.ui.toast(`${fileName}: assumed millimetres`, "info");

      return bodies
        .filter((b) => b.tris.length)
        .map((b) => {
          const positions = new Float32Array(b.tris.length * 3);
          b.tris.forEach((vi, i) => {
            const v = verts[vi] ?? [0, 0, 0];
            positions[i * 3] = v[0] * scale;
            positions[i * 3 + 1] = v[1] * scale;
            positions[i * 3 + 2] = v[2] * scale;
          });
          return { name: b.name, positions, color: null };
        });
    },
  });
}
