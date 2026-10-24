import { useMemo, useState } from "react";
import { FileUp, Info } from "lucide-react";
import { app } from "@/store/app";
import { commitImport, type PendingImport } from "@/app/io";
import { bounds } from "@/core/mesh/massprops";
import { UNIT_SCALE, type LengthUnit } from "@/core/mesh/ops";
import type { ImportLayout } from "@/app/actions";
import { Dialog } from "./Dialog";
import { Field, Segmented, Select } from "../controls";

/** Review an import: which bodies to keep, units (STL), and how to lay them out as links. */
export function ImportDialog({ pending }: { pending: PendingImport }) {
  const [p, setP] = useState(pending);
  const [keep, setKeep] = useState<boolean[]>(() => pending.parts.map(() => true));
  const scale = p.kind === "stl" ? UNIT_SCALE[p.unit] : 1;
  const sizes = useMemo(
    () =>
      p.parts.map((x) => {
        const b = bounds(x.positions);
        return [0, 1, 2].map((i) => (b.max[i] - b.min[i]) * scale);
      }),
    [p.parts, scale],
  );
  const overall = useMemo(() => {
    const all = p.parts.map((x) => bounds(x.positions));
    const lo = [0, 1, 2].map((i) => Math.min(...all.map((b) => b.min[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...all.map((b) => b.max[i])));
    return hi.map((h, i) => (h - lo[i]) * scale);
  }, [p.parts, scale]);
  const count = keep.filter(Boolean).length;
  const mm = (v: number) => (v >= 1 ? `${v.toFixed(2)} m` : `${(v * 1000).toFixed(1)} mm`);

  return (
    <Dialog
      title={`Import ${p.fileName}`}
      icon={<FileUp size={18} />}
      wide
      footer={
        <>
          <span className="muted">
            {count} of {p.parts.length} bodies · overall {overall.map(mm).join(" × ")}
          </span>
          <span className="grow" />
          <button className="btn ghost" onClick={() => app().closeDialog()}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!count}
            onClick={() => {
              app().closeDialog();
              commitImport(p, keep);
            }}
          >
            Import {count} {count === 1 ? "body" : "bodies"}
          </button>
        </>
      }
    >
      <Field label="Create">
        <Segmented<ImportLayout>
          value={p.layout}
          onChange={(layout) => setP({ ...p, layout })}
          options={[
            {
              value: "links",
              label: "One link per body",
              title: "Each body becomes a link; the largest is the root",
            },
            {
              value: "single-link",
              label: "One rigid link",
              title: "All bodies welded into a single link",
            },
            {
              value: "library",
              label: "Parts only",
              title: "Add to the parts library; build links yourself",
            },
          ]}
        />
      </Field>
      {p.kind === "stl" ? (
        <Field
          label="File units"
          hint="STL files carry no units. The guess comes from the model's size; check the overall size below."
        >
          <Select<LengthUnit>
            value={p.unit}
            onChange={(unit) => setP({ ...p, unit })}
            options={[
              { value: "mm", label: "Millimetres" },
              { value: "cm", label: "Centimetres" },
              { value: "m", label: "Metres" },
              { value: "in", label: "Inches" },
            ]}
          />
        </Field>
      ) : (
        <div className="callout info">
          <Info size={14} />
          <span>
            Units come from the file and are converted to metres. Assembly names and colours are
            kept.
          </span>
        </div>
      )}
      {p.parts.length > 1 && (
        <div className="row">
          <span className="muted grow">
            {p.kind === "stl"
              ? "The STL contains several separate bodies."
              : "Bodies found in the assembly:"}
          </span>
          <button className="btn sm ghost" onClick={() => setKeep(p.parts.map(() => true))}>
            All
          </button>
          <button className="btn sm ghost" onClick={() => setKeep(p.parts.map(() => false))}>
            None
          </button>
          <button
            className="btn sm ghost"
            title="Skip fasteners and other tiny bodies"
            onClick={() => {
              const big = Math.max(...sizes.map((s) => Math.max(...s)));
              setKeep(sizes.map((s) => Math.max(...s) > big * 0.04));
            }}
          >
            Skip tiny parts
          </button>
        </div>
      )}
      <div
        style={{
          maxHeight: 340,
          overflow: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th>Body</th>
              <th>Assembly</th>
              <th style={{ textAlign: "right" }}>Triangles</th>
              <th style={{ textAlign: "right" }}>Size</th>
            </tr>
          </thead>
          <tbody>
            {p.parts.map((x, i) => (
              <tr key={i} style={{ opacity: keep[i] ? 1 : 0.5 }}>
                <td>
                  <input
                    type="checkbox"
                    checked={keep[i]}
                    aria-label={`Import ${x.name}`}
                    onChange={(e) => setKeep(keep.map((k, j) => (j === i ? e.target.checked : k)))}
                  />
                </td>
                <td>
                  <span className="row">
                    <span
                      className="swatch"
                      style={{
                        background: x.color
                          ? `rgb(${x.color
                              .slice(0, 3)
                              .map((c) => Math.round(c * 255))
                              .join(" ")})`
                          : "var(--bg-4)",
                      }}
                    />
                    {x.name}
                  </span>
                </td>
                <td className="muted">{x.path?.join(" / ") || "—"}</td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {(x.positions.length / 9).toLocaleString()}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {sizes[i].map((v) => (v * 1000).toFixed(0)).join("×")} mm
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
