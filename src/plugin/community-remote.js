/** Published community plugins. The Host only downloads verified Folder packages. */
import { validatePluginPackage } from "./package-format.js";

export const COMMUNITY_PLUGINS = Object.freeze([
  Object.freeze({
    id: "cluster.explorer",
    name: "Cluster Explorer",
    version: "2.2.0",
    description: "File explorer with shared workspace, multilingual controls and authorized disk operations."
  }),
  Object.freeze({
    id: "cluster.text-editor",
    name: "Cluster BasicTextEditor",
    version: "2.7.0",
    description: "Multi-tab editor with Explorer synchronization, Host palette and direct-save support."
  })
]);

const OWNER = "xcxc84584-prog";
const REPO = "cluster-v3-initplugin";
const MAX_FILES = 100;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PER_FILE = 1024 * 1024;

function fail(message) {
  const error = new Error(message);
  error.code = "COMMUNITY_FETCH_FAILED";
  return error;
}

/** One GitHub tree call; file bytes are fetched from raw URLs, avoiding
 * GitHub Contents API rate limits on a per-file basis. */
export async function fetchCommunityPlugin(id, fetcher = fetch) {
  if (!COMMUNITY_PLUGINS.some(entry => entry.id === id)) {
    throw fail("Unknown published plugin: " + id);
  }
  const treeURL = `https://api.github.com/repos/${OWNER}/${REPO}/git/trees/main?recursive=1`;
  const listing = await fetcher(treeURL, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!listing.ok) {
    throw fail(`GitHub tree HTTP ${listing.status}`);
  }
  const tree = await listing.json();
  if (tree.truncated || !Array.isArray(tree.tree)) {
    throw fail("GitHub repository tree incomplete");
  }
  const prefix = `plugins/${id}/`;
  const entries = tree.tree.filter(entry =>
    entry.type === "blob" && entry.path.startsWith(prefix));
  if (!entries.length || entries.length > MAX_FILES ||
      !entries.some(entry => entry.path === prefix + "manifest.json")) {
    throw fail("Published plugin files or manifest are missing");
  }
  const total = entries.reduce((sum, entry) => {
    const size = entry.size;
    if (!Number.isInteger(size) || size < 0 || size > MAX_PER_FILE)
      throw fail("Published plugin contains an oversized file");
    return sum + size;
  }, 0);
  if (total > MAX_BYTES) throw fail("Published plugin exceeds size limit");

  const files = {};
  // Bounded parallel downloads keep the page responsive and protect servers.
  for (let offset = 0; offset < entries.length; offset += 5) {
    const slice = entries.slice(offset, offset + 5);
    const received = await Promise.all(slice.map(async entry => {
      const relative = entry.path.slice(prefix.length);
      if (!relative || relative.split("/").some(segment =>
        !segment || segment === "." || segment === "..")) {
        throw fail("Invalid published plugin path");
      }
      const encoded = entry.path.split("/").map(encodeURIComponent).join("/");
      const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${encoded}`;
      const response = await fetcher(url);
      if (!response.ok) throw fail(`GitHub file HTTP ${response.status}: ${relative}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== entry.size) throw fail("Incomplete file: " + relative);
      return [relative, bytes];
    }));
    for (const [path, bytes] of received) files[path] = bytes;
  }
  const checked = validatePluginPackage(files);
  if (checked.manifest.id !== id) throw fail("Published plugin ID mismatch");
  return checked;
}
