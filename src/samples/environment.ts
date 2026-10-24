/** Load environment samples: generated, Gazebo Fuel models/worlds, or SDF worlds on GitHub. */
import { unzipSync } from "fflate";
import { PROCEDURAL_ENVS } from "@/core/env/procedural";
import { sdfToEnvironment, type SdfContext } from "@/core/env/sdfImport";
import { loadMesh, meshExtension } from "@/core/mesh/loaders";
import type { Environment } from "@/core/env/types";
import { fetchCached } from "./fetch";
import type { Sample } from "./catalog";
import type { Progress } from "./robot";

/**
 * A Fuel URL (https://fuel.gazebosim.org/1.0/<owner>/<models|worlds>/<name>[/<version>]) to its
 * zip download: <base>.zip for the latest version, <base>/<version>/<name>.zip for a pinned one.
 * The legacy fuel.ignitionrobotics.org host is rewritten.
 */
export function fuelZipUrl(url: string): string {
  const m =
    /^https:\/\/fuel\.(?:gazebosim|ignitionrobotics)\.org\/1\.0\/([^/]+)\/(models|worlds)\/([^/]+)(?:\/(\d+|tip))?/i.exec(
      url.trim(),
    );
  if (!m) throw new Error(`Not a Gazebo Fuel URL: ${url}`);
  const [, owner, kind, rawName, ver] = m;
  const name = encodeURIComponent(decodeURIComponent(rawName));
  const base = `https://fuel.gazebosim.org/1.0/${owner}/${kind.toLowerCase()}/${name}`;
  return ver && ver !== "tip" ? `${base}/${ver}/${name}.zip` : `${base}.zip`;
}

const sdfIn = (files: Record<string, Uint8Array>, prefer: string) => {
  const names = Object.keys(files).filter(
    (n) => n.toLowerCase().endsWith(".sdf") || n.toLowerCase().endsWith(".world"),
  );
  const pick =
    names.find((n) => n.split("/").pop() === prefer) ??
    names.sort((a, b) => a.length - b.length)[0];
  return pick ? { path: pick, text: new TextDecoder().decode(files[pick]) } : null;
};

/** Join a relative path onto a "zip:<key>/<dir>" or URL base. */
function joinBase(base: string, rel: string): string {
  const parts = base.split("/");
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

export async function loadEnvironmentSample(
  sample: Sample,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<{ env: Environment; skipped: string[] }> {
  const src = sample.source;
  const meta = {
    id: sample.id.replace(/^env\./, ""),
    name: sample.name,
    description: sample.description,
    attribution: `${sample.attribution} (${sample.license})`,
  };
  if (src.kind === "procedural") {
    const p = PROCEDURAL_ENVS.find((e) => e.id === src.envId);
    if (!p) throw new Error(`Unknown built-in environment ${src.envId}`);
    return { env: p.build(), skipped: [] };
  }

  // Zips are unpacked in memory and addressed as "zip:<n>/<path>".
  const zips: Record<string, Uint8Array>[] = [];
  const fuelModels = new Map<string, string>();
  let fetched = 0;
  const tick = (stage: string) =>
    onProgress({ stage, done: ++fetched, total: Math.max(fetched, 1) });

  const openFuel = async (url: string): Promise<{ sdf: string; base: string } | null> => {
    const zipUrl = fuelZipUrl(url);
    const key = fuelModels.get(zipUrl);
    let files: Record<string, Uint8Array>;
    let zi: number;
    if (key) {
      zi = +key;
      files = zips[zi];
    } else {
      tick(`Downloading ${decodeURIComponent(zipUrl.split("/").slice(-1)[0])}`);
      files = unzipSync(await fetchCached(sample.id, zipUrl, signal));
      zi = zips.push(files) - 1;
      fuelModels.set(zipUrl, String(zi));
    }
    const s = sdfIn(files, "model.sdf");
    if (!s) return null;
    const dir = s.path.includes("/") ? s.path.slice(0, s.path.lastIndexOf("/")) : "";
    return { sdf: s.text, base: `zip:${zi}${dir ? `/${dir}` : ""}` };
  };

  const readFrom = async (
    base: string,
    rel: string,
  ): Promise<{ name: string; bytes: Uint8Array } | null> => {
    if (base.startsWith("zip:")) {
      const [head, ...rest] = joinBase(base, rel).slice(4).split("/");
      const files = zips[+head];
      const want = rest.join("/");
      const hit = Object.keys(files).find(
        (k) => k === want || k.toLowerCase() === want.toLowerCase(),
      );
      return hit ? { name: hit, bytes: files[hit] } : null;
    }
    const url = joinBase(base, rel);
    tick("Downloading meshes");
    return { name: url, bytes: await fetchCached(sample.id, url, signal) };
  };

  /** Where model://<name> lives for SDF worlds on GitHub. */
  const modelBase = (name: string): string | null =>
    src.kind === "sdf"
      ? (src.models?.[name] ?? (src.modelsBase ? `${src.modelsBase}/${name}` : null))
      : null;

  const ctx: SdfContext = {
    async mesh(uri, base) {
      let target: { name: string; bytes: Uint8Array } | null = null;
      const model = /^model:\/\/([^/]+)\/(.+)$/.exec(uri);
      if (/^https:\/\/fuel\./i.test(uri)) {
        // https://fuel.../models/Name/<ver>/files/meshes/x.dae
        const m = /^(.*?\/models\/[^/]+)(?:\/[^/]+)?\/files\/(.+)$/.exec(uri);
        const inc = m && (await openFuel(m[1]));
        if (inc) target = await readFrom(inc.base, m![2]);
      } else if (model && base.startsWith("zip:")) {
        // Inside a Fuel zip, model://<this model>/... points at the zip's own folder.
        const root = base.split("/")[0];
        target =
          (await readFrom(base, model[2])) ?? (await readFrom(root, `${model[1]}/${model[2]}`));
      } else if (model && modelBase(model[1])) {
        target = await readFrom(modelBase(model[1])!, model[2]).catch(() => null);
      } else if (!/^[a-z]+:\/\//i.test(uri)) target = await readFrom(base, uri);
      if (!target || !meshExtension(target.name)) return null;
      return loadMesh(target.name, target.bytes);
    },
    async include(uri, base) {
      if (/^https:\/\/fuel\./i.test(uri)) return openFuel(uri);
      const model = /^model:\/\/([^/]+)\/?$/.exec(uri);
      // The sun and the ground plane are provided by the scene already.
      if (model && ["sun", "ground_plane"].includes(model[1]))
        return { sdf: "<sdf version='1.9'/>", base };
      if (model && modelBase(model[1])) {
        const b = modelBase(model[1])!;
        const got = await readFrom(b, "model.sdf").catch(() => null);
        if (got) return { sdf: new TextDecoder().decode(got.bytes), base: b };
        // Some worlds (e.g. AWS hospital) fetch their models from Gazebo Fuel at setup time.
        return openFuel(`https://fuel.gazebosim.org/1.0/OpenRobotics/models/${model[1]}`).catch(
          () => null,
        );
      }
      if (model && base.startsWith("zip:")) {
        const root = base.split("/")[0];
        const got = await readFrom(root, `${model[1]}/model.sdf`);
        return got
          ? { sdf: new TextDecoder().decode(got.bytes), base: `${root}/${model[1]}` }
          : null;
      }
      return null;
    },
  };

  if (src.kind === "fuel") {
    const top = await openFuel(src.url);
    if (!top) throw new Error("The Fuel download contains no SDF file.");
    onProgress({ stage: "Building the scene", done: 0, total: 1 });
    return sdfToEnvironment(top.sdf, top.base, ctx, meta);
  }
  if (src.kind === "sdf") {
    tick("Downloading the world");
    const text = new TextDecoder().decode(await fetchCached(sample.id, src.sdf, signal));
    onProgress({ stage: "Building the scene", done: 0, total: 1 });
    return sdfToEnvironment(text, src.sdf.slice(0, src.sdf.lastIndexOf("/")), ctx, meta);
  }
  throw new Error("This sample is not an environment.");
}
