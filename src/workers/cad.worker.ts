/// <reference lib="webworker" />
/** Runs OpenCascade off the UI thread. Request: { id, bytes, format, quality }. */
import occtimportjs from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";
import {
  occtParams,
  partsFromOcct,
  type CadFormat,
  type CadQuality,
  type OcctResult,
} from "../core/mesh/cad";

interface Occt {
  ReadStepFile(content: Uint8Array, params: unknown): OcctResult;
  ReadIgesFile(content: Uint8Array, params: unknown): OcctResult;
  ReadBrepFile(content: Uint8Array, params: unknown): OcctResult;
}

let occt: Promise<Occt> | null = null;
const load = () =>
  (occt ??= (occtimportjs as unknown as (o: object) => Promise<Occt>)({
    locateFile: () => wasmUrl,
  }));

self.onmessage = async (
  e: MessageEvent<{
    id: number;
    bytes: Uint8Array;
    format: CadFormat;
    name: string;
    quality: CadQuality;
  }>,
) => {
  const { id, bytes, format, name, quality } = e.data;
  try {
    const o = await load();
    const params = occtParams(quality);
    const result =
      format === "step"
        ? o.ReadStepFile(bytes, params)
        : format === "iges"
          ? o.ReadIgesFile(bytes, params)
          : o.ReadBrepFile(bytes, params);
    // BREP has no units; OpenCascade treats it as millimetres.
    const parts = partsFromOcct(result, name, format === "brep" ? 0.001 : 1);
    (self as unknown as Worker).postMessage(
      { id, parts },
      parts.map((p) => p.positions.buffer),
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
