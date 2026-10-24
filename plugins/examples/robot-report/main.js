// Example URDF Forge plugin showing the three main extension points:
// a command (palette + menus), an exporter (Export dialog) and an MCP tool (AI assistants).

function report(model) {
  const links = model.links.map((l) => ({
    link: l.name,
    joint: l.parentId ? l.joint.type : "root",
    mass_kg: l.inertial.mass,
    volume_cm3: l.inertial.volume * 1e6,
    watertight: l.inertial.watertight,
  }));
  const total = links.reduce((a, l) => a + l.mass_kg, 0);
  return { robot: model.robot, total_mass_kg: total, links };
}

/** @param {import("../../../src/plugins/api").ForgePluginApi} api */
export function activate(api) {
  api.commands.register({
    id: "massSummary",
    title: "Show mass summary",
    keywords: "weight report",
    run() {
      const r = report(api.model.get());
      const heaviest = [...r.links].sort((a, b) => b.mass_kg - a.mass_kg)[0];
      api.ui.toast(
        `${r.robot}: ${r.total_mass_kg.toFixed(3)} kg in ${r.links.length} links` +
          (heaviest ? `; heaviest is ${heaviest.link} (${heaviest.mass_kg.toFixed(3)} kg)` : ""),
        "success",
      );
    },
  });

  api.exporters.register({
    id: "mass-csv",
    label: "Mass report (CSV)",
    extension: "csv",
    async export(model) {
      const r = report(model);
      const rows = [["link", "joint", "mass_kg", "volume_cm3", "watertight"]];
      for (const l of r.links)
        rows.push([
          l.link,
          l.joint,
          l.mass_kg.toFixed(6),
          l.volume_cm3.toFixed(3),
          String(l.watertight),
        ]);
      rows.push(["total", "", r.total_mass_kg.toFixed(6), "", ""]);
      return rows.map((r) => r.join(",")).join("\n") + "\n";
    },
  });

  api.mcp.registerTool({
    name: "mass_report",
    description: "Mass, volume and closed-mesh status of every link, plus the total mass.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: () => report(api.model.get()),
  });
}
