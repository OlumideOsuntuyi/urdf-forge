/**
 * Checks the remote sample catalogue against the real servers. Network access is required, so
 * this only runs with NETWORK=1:  NETWORK=1 npx vitest run tests/samples.network.test.ts
 * It downloads every URDF, checks that every mesh it references exists (1-byte range requests)
 * and fully parses one mesh per robot. Environments: small Fuel zips are opened and parsed.
 */
import { describe, expect, it } from "vitest";
import { REMOTE_ENVIRONMENTS, REMOTE_ROBOTS } from "../src/samples/remote";
import { resolveUri } from "../src/samples/robot";
import { fuelZipUrl } from "../src/samples/environment";
import { loadMesh } from "../src/core/mesh/loaders";
import { unzipSync } from "fflate";
import { Window } from "happy-dom";

// Node's own fetch (no browser CORS rules, like the app's HTTP plugin); the DOM pieces the mesh
// loaders use come from happy-dom: DOMParser, plus document (textured Collada files) and Node
// (Collada parse errors).
const win = new Window();
Object.assign(globalThis, { DOMParser: win.DOMParser, document: win.document, Node: win.Node });

const run = !!process.env.NETWORK;

// Valid XML that happy-dom's parser rejects ("Comment not terminated" on a comment containing
// "</matrix-->"); browser engines, and so the app, read them. Another mesh is checked instead.
const HAPPY_DOM_UNPARSABLE = new Set([
  "package://val_description/model/meshes/multisense/head_camera.dae",
]);

async function exists(url: string): Promise<number> {
  const r = await fetch(url, { headers: { Range: "bytes=0-0" } });
  await r.arrayBuffer().catch(() => {});
  return r.status;
}

describe.skipIf(!run)("remote robots", () => {
  for (const s of REMOTE_ROBOTS) {
    it(
      s.name,
      async () => {
        if (s.source.kind !== "urdf") return;
        const { urdf, packages } = s.source;
        const r = await fetch(urdf);
        expect(r.status, urdf).toBe(200);
        const xml = await r.text();
        expect(xml).toMatch(/<robot[\s>]/);
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        const uris = [
          ...new Set(
            [...doc.getElementsByTagName("mesh")].map((m) => m.getAttribute("filename") ?? ""),
          ),
        ].filter(Boolean);
        const urls = uris.map((u) => [u, resolveUri(u, urdf, packages)] as const);
        const unresolved = urls.filter(([, url]) => !url).map(([u]) => u);
        expect(unresolved, "unresolvable mesh paths").toEqual([]);
        const statuses = await Promise.all(
          urls.map(async ([u, url]) => [u, await exists(url!)] as const),
        );
        const missing = statuses
          .filter(([, st]) => st !== 200 && st !== 206)
          .map(([u, st]) => `${u} -> ${st}`);
        expect(missing, "missing meshes").toEqual([]);
        const parsable = urls.filter(([u]) => !HAPPY_DOM_UNPARSABLE.has(u));
        if (parsable.length) {
          const first = parsable[0][1]!;
          const mesh = loadMesh(first, new Uint8Array(await (await fetch(first)).arrayBuffer()));
          expect(mesh.positions.length, first).toBeGreaterThan(0);
        }
        console.log(`${s.name}: ${uris.length} meshes OK`);
      },
      120_000,
    );
  }
});

describe.skipIf(!run)("remote environments", () => {
  for (const s of REMOTE_ENVIRONMENTS) {
    it(
      s.name,
      async () => {
        if (s.source.kind === "fuel") {
          const url = fuelZipUrl(s.source.url);
          if ((s.sizeMB ?? 0) > 5) {
            expect([200, 206], url).toContain(await exists(url));
            return;
          }
          const r = await fetch(url);
          expect(r.status, url).toBe(200);
          const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
          const names = Object.keys(files);
          expect(
            names.some((n) => /\.(sdf|world)$/i.test(n)),
            names.join(", "),
          ).toBe(true);
          console.log(`${s.name}: ${names.length} files`);
        } else if (s.source.kind === "sdf") {
          const r = await fetch(s.source.sdf);
          expect(r.status, s.source.sdf).toBe(200);
          const text = await r.text();
          const models = [
            ...new Set([...text.matchAll(/model:\/\/([^/<\s]+)/g)].map((m) => m[1])),
          ].filter((m) => m !== "sun" && m !== "ground_plane");
          const base = s.source.modelsBase;
          // Models missing from the repository fall back to Gazebo Fuel (as the app does).
          const statuses = await Promise.all(
            models.map(async (m) => {
              const st = await exists(`${base}/${m}/model.sdf`);
              if (st === 200 || st === 206) return [m, st] as const;
              const fuelSt = (
                await fetch(`https://fuel.gazebosim.org/1.0/OpenRobotics/models/${m}`)
              ).status;
              return [m, fuelSt] as const;
            }),
          );
          const missing = statuses
            .filter(([, st]) => st !== 200 && st !== 206)
            .map(([m, st]) => `${m} -> ${st}`);
          expect(missing).toEqual([]);
          console.log(`${s.name}: ${models.length} models OK`);
        }
      },
      180_000,
    );
  }
});
