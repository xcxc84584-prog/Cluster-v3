/** Produce and verify static API JSON from the authoritative JS catalog. */
import { readFileSync, writeFileSync } from "node:fs";
import { catalogJSON } from "../src/core/api-catalog.js";
const path = new URL("../plugin/api-catalog.json", import.meta.url);
const expected = catalogJSON() + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path, "utf8") !== expected) {
    console.error("API catalog JSON is stale; run npm run api:generate");
    process.exitCode = 1;
  }
} else {
  writeFileSync(path, expected);
}
