import { readFileSync } from "node:fs";
import { SYSTEM_MANIFEST } from "../src/core/system-manifest.js";
import { API_CATALOG_VERSION } from "../src/core/api-catalog.js";
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (pkg.version !== SYSTEM_MANIFEST.version ||
    API_CATALOG_VERSION !== SYSTEM_MANIFEST.apiCatalogVersion) {
  throw Error("System or API catalog version differs from the authoritative manifest");
}
