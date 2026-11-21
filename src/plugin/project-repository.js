/** Ephemeral project repository exchange; imports never write IndexedDB. */
import { createZip, readZip, validatePluginPackage, packageError,
  normalizePackagePath } from "./package-format.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_PROJECT_FILES = 480;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const MAX_GITHUB_REQUESTS = 55;

export function unpackProjectFiles(files) {
  const paths = Object.keys(files);
  if (!paths.length) throw packageError("EMPTY_PROJECT", "No package files");
  if (paths.includes("manifest.json") ||
      (paths.length && new Set(paths.map(p => p.split("/")[0])).size === 1 &&
       paths.some(p => p.endsWith("/manifest.json")) &&
       !paths.includes("cluster-project.json"))) {
    // A single plugin may be wrapped in one outer folder.
    try { return [validatePluginPackage(files)]; }
    catch (error) {
      if (paths.includes("manifest.json")) throw error;
    }
  }
  const metadata = files["cluster-project.json"];
  if (metadata) {
    let project;
    try { project = JSON.parse(textDecoder.decode(metadata)); }
    catch { throw packageError("BAD_PROJECT", "Invalid project metadata"); }
    if (project.schemaVersion !== "1.0.0" ||
        !Array.isArray(project.plugins))
      throw packageError("BAD_PROJECT", "Unsupported project schema");
  }
  const roots = new Set(paths.filter(p => p.endsWith("/manifest.json"))
    .map(p => p.slice(0, -"/manifest.json".length)));
  // Accept plugins/<id>/... or user-selected folder trees.
  if (!roots.size) throw packageError("MISSING_MANIFEST", "No plugin manifest found");
  const packages = [];
  const ids = new Set();
  for (const root of [...roots].sort()) {
    const prefix = root + "/";
    const group = {};
    for (const [path, bytes] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const relative = normalizePackagePath(path.slice(prefix.length));
      // Descendant nested plugin roots are never included in a parent's package.
      if ([...roots].some(other => other !== root &&
          other.startsWith(prefix) && path.startsWith(other + "/"))) continue;
      group[relative] = bytes;
    }
    const pkg = validatePluginPackage(group);
    if (ids.has(pkg.manifest.id))
      throw packageError("DUPLICATE_PLUGIN", pkg.manifest.id);
    ids.add(pkg.manifest.id);
    packages.push(pkg);
  }
  return packages;
}

export function createProjectArchive(packages) {
  const files = {};
  const manifest = { schemaVersion: "1.0.0", type: "cluster.plugin-project",
    exportedAt: new Date().toISOString(), plugins: [] };
  const seen = new Set();
  let bytes = 0;
  for (const pkg of packages) {
    const checked = validatePluginPackage(pkg.files);
    const id = checked.manifest.id;
    if (seen.has(id)) throw packageError("DUPLICATE_PLUGIN", id);
    seen.add(id);
    manifest.plugins.push({ id, version: checked.manifest.version,
      directory: "plugins/" + id });
    for (const [path, content] of Object.entries(checked.files)) {
      bytes += content.length;
      if (bytes > MAX_PROJECT_BYTES ||
          Object.keys(files).length >= MAX_PROJECT_FILES)
        throw packageError("LIMIT_EXCEEDED", "Project ZIP exceeds package limits");
      files["plugins/" + id + "/" + normalizePackagePath(path)] = content;
    }
  }
  files["cluster-project.json"] = textEncoder.encode(JSON.stringify(manifest, null, 2));
  return createZip(files);
}

export async function readProjectArchive(bytes) {
  return unpackProjectFiles(await readZip(bytes));
}

export function parseGitHubLocation(input) {
  let url;
  try { url = new URL(input); }
  catch { throw packageError("BAD_GITHUB_URL", "Enter a GitHub repository URL"); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" ||
      url.username || url.password || url.port)
    throw packageError("BAD_GITHUB_URL", "Only public github.com HTTPS links are supported");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || !parts.slice(0, 2).every(p => /^[\w.-]+$/.test(p)))
    throw packageError("BAD_GITHUB_URL", "Expected github.com/owner/repo");
  const owner = parts[0], repo = parts[1].replace(/\.git$/, "");
  if (!repo) throw packageError("BAD_GITHUB_URL", "Repository is missing");
  let ref = url.searchParams.get("ref") || "";
  let folder = "";
  if (["tree", "blob"].includes(parts[2]) && parts[3]) {
    ref ||= parts[3];
    folder = parts.slice(4).join("/");
  } else if (parts.length > 2) {
    throw packageError("BAD_GITHUB_URL", "Use a repository or /tree/<branch>/<folder> URL");
  }
  if (folder) normalizePackagePath(folder);
  if (ref && (!/^[\w./-]+$/.test(ref) || ref.includes("..")))
    throw packageError("BAD_GITHUB_REF", "Invalid Git ref");
  return { owner, repo, ref, folder, singleFile: parts[2] === "blob" };
}

export async function fetchGitHubProject(input, fetcher = fetch) {
  const location = parseGitHubLocation(input);
  const prefix = `https://api.github.com/repos/${location.owner}/${location.repo}/contents/`;
  const files = {};
  const archives = [];
  const queue = [location.folder];
  let total = 0, requests = 0;
  async function request(url) {
    if (++requests > MAX_GITHUB_REQUESTS)
      throw packageError("GITHUB_RATE_LIMIT", "GitHub file request limit exceeded");
    const response = await fetcher(url, { headers: {
      Accept: "application/vnd.github+json" } });
    if (!response.ok) throw packageError("GITHUB_FETCH_FAILED",
      `GitHub HTTP ${response.status}: verify public repository and rate limits`);
    return response.json();
  }
  while (queue.length) {
    const path = queue.shift();
    const apiPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const suffix = location.ref ? "?ref=" + encodeURIComponent(location.ref) : "";
    const listing = await request(prefix + apiPath + suffix);
    const entries = Array.isArray(listing) ? listing : [listing];
    for (const entry of entries) {
      if (entry.type === "dir") { queue.push(entry.path); continue; }
      if (entry.type !== "file") continue; // Skip submodules and symlinks.
      const relative = location.singleFile ? entry.name : location.folder ?
        entry.path.slice(location.folder.length + 1) : entry.path;
      normalizePackagePath(relative);
      if (Object.keys(files).length >= MAX_PROJECT_FILES ||
          total + (entry.size || 0) > MAX_PROJECT_BYTES)
        throw packageError("LIMIT_EXCEEDED", "GitHub repository exceeds project limits");
      const fileUrl = new URL(entry.url);
      if (fileUrl.protocol !== "https:" || fileUrl.hostname !== "api.github.com" ||
          !fileUrl.pathname.startsWith(`/repos/${location.owner}/${location.repo}/contents/`))
        throw packageError("GITHUB_UNTRUSTED_URL", "Unexpected GitHub file endpoint");
      const data = await request(fileUrl.href);
      if (data.encoding !== "base64" || typeof data.content !== "string")
        throw packageError("GITHUB_FILE_UNSUPPORTED", "GitHub file must be <1 MiB");
      const binary = atob(data.content.replace(/\s/g, ""));
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      total += bytes.length;
      if (total > MAX_PROJECT_BYTES)
        throw packageError("LIMIT_EXCEEDED", "GitHub project exceeds 16 MiB");
      if (relative.toLowerCase().endsWith(".zip")) {
        archives.push(...await readProjectArchive(bytes));
      } else {
        files[relative] = bytes;
      }
    }
  }
  const folderPlugins = Object.keys(files).some(path =>
    path.endsWith("manifest.json")) ? unpackProjectFiles(files) : [];
  const merged = [...folderPlugins, ...archives];
  if (!merged.length) throw packageError("MISSING_MANIFEST", "No plugin package found");
  const seen = new Set();
  for (const item of merged) {
    if (seen.has(item.manifest.id))
      throw packageError("DUPLICATE_PLUGIN", item.manifest.id);
    seen.add(item.manifest.id);
  }
  return merged;
}
