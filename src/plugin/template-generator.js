/** Download an actually installable template with API docs from the live catalog. */
import { API_CATALOG, catalogJSON } from "../core/api-catalog.js";
import { createZip } from "./package-format.js";

export const TEMPLATE_FILES = Object.freeze([
  "manifest.json", "index.html", "settings.html",
  "scripts/cluster-client.js", "scripts/app.js", "scripts/settings.js",
  "styles/main.css", "README.md",
  "docs/Plugin-Standards.md", "docs/Public-Repository.md", "docs/PMU-API.md"
]);
export async function createExamplePackage() {
  const root = new URL("../../templates/plugin-example/", import.meta.url);
  const entries = await Promise.all(TEMPLATE_FILES.map(async name => {
    const response = await fetch(new URL(name, root), { cache: "no-store" });
    if (!response.ok) throw Error("Template file unavailable: " + name);
    return [name, new Uint8Array(await response.arrayBuffer())];
  }));
  const files = Object.fromEntries(entries);
  files["docs/Cluster-API-Catalog.json"] = catalogJSON();
  files["docs/PMU-API.json"] = JSON.stringify({
    schemaVersion: "1.0.0",
    source: "Cluster-v3 PMU",
    apis: API_CATALOG.filter(api => api.unit === "PMU" || api.unit === "Log")
  }, null, 2);
  return createZip(files);
}
