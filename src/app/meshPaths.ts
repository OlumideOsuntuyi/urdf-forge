/** Finding the mesh files a URDF refers to on disk. Pure string work, no file access. */

/** Every <mesh filename="..."> in a URDF, in document order, without duplicates. */
export function meshUris(xml: string): string[] {
  const out = new Set<string>();
  for (const m of xml.matchAll(/<mesh\b[^>]*\bfilename\s*=\s*"([^"]*)"/g)) if (m[1]) out.add(m[1]);
  return [...out];
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Paths where the mesh `uri` may be, given the URDF file it came from, most likely first:
 * `file://` URIs as they are, `package://pkg/...` under any folder named `pkg` above the URDF
 * (a source checkout), and plain paths relative to the URDF. Other schemes give nothing.
 */
export function meshPathCandidates(uri: string, urdfPath: string): string[] {
  const sep = urdfPath.includes("\\") && !urdfPath.includes("/") ? "\\" : "/";
  const dir = urdfPath.split(/[\\/]/).slice(0, -1);
  if (/^file:\/\//i.test(uri)) {
    const p = decode(uri.replace(/^file:\/\//i, ""));
    return [/^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p]; // file:///C:/... on Windows
  }
  const pkg = /^package:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (pkg) {
    const out: string[] = [];
    for (let i = dir.length; i > 0; i--)
      if (dir[i - 1] === pkg[1])
        out.push([...dir.slice(0, i), ...decode(pkg[2]).split("/")].join(sep));
    return out;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return [];
  if (uri.startsWith("/") || /^[A-Za-z]:[\\/]/.test(uri)) return [uri];
  return [[...dir, ...decode(uri).split("/")].join(sep)];
}
