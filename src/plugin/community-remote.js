/** Dynamic GitHub community index. All deployment parameters come from PRMU. */
import { validatePluginPackage } from "./package-format.js";

function problem(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
const ensure = (valid, message) => {
  if (!valid) throw problem("COMMUNITY_INDEX_INVALID", message);
};
function source(config) {
  ensure(config && typeof config === "object", "Missing public community config");
  const url = new URL(config.repositoryUrl);
  ensure(url.protocol === "https:" && url.hostname === "github.com" &&
    !url.username && !url.password && !url.port, "Invalid public repository URL");
  const segments = url.pathname.split("/").filter(Boolean);
  ensure(segments.length === 2 && segments.every(x => /^[\w.-]+$/.test(x)),
    "Community repository must be owner/repo");
  ensure(typeof config.ref === "string" && /^[\w./-]+$/.test(config.ref) &&
    !config.ref.includes(".."), "Invalid community ref");
  for (const prop of ["indexPath", "pluginRoot"]) {
    ensure(typeof config[prop] === "string" &&
      config[prop].split("/").every(x => x && x !== "." && x !== ".."),
      "Invalid community path " + prop);
  }
  for (const prop of ["githubApiBase", "githubRawBase"]) {
    const endpoint = new URL(config[prop]);
    ensure(endpoint.protocol === "https:" &&
      !endpoint.username && !endpoint.password && !endpoint.port &&
      endpoint.pathname === "/", "Invalid GitHub endpoint");
  }
  return {
    owner: segments[0], repo: segments[1],
    raw: config.githubRawBase.replace(/\/$/, ""),
    api: config.githubApiBase.replace(/\/$/, ""),
    ref: config.ref
  };
}
function rawURL(root, remotePath) {
  return root.raw + "/" + [root.owner, root.repo, root.ref, ...remotePath.split("/")]
    .map(encodeURIComponent).join("/");
}
function checkEntry(entry, config, ids, folders) {
  ensure(entry && typeof entry === "object" && !Array.isArray(entry),
    "Invalid plugin entry");
  ensure(typeof entry.id === "string" &&
    /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(entry.id),
    "Invalid plugin ID");
  ensure(!ids.has(entry.id), "Duplicate plugin ID: " + entry.id);
  ids.add(entry.id);
  ensure(["name","version","description","directory"].every(key =>
    typeof entry[key] === "string"), "Incomplete plugin metadata");
  ensure(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version),
    "Invalid plugin version");
  ensure(entry.name.trim(), "Missing plugin name");
  const folder = config.pluginRoot + "/" + entry.id;
  ensure(entry.directory === folder && !folders.has(folder),
    "Plugin directory must match public root and plugin ID");
  folders.add(folder);
  return Object.freeze({ id: entry.id, name: entry.name,
    version: entry.version, description: entry.description,
    directory: entry.directory });
}
export function parseCommunityIndex(index, config) {
  ensure(index?.schemaVersion === config.indexSchemaVersion &&
    index?.type === config.indexType && Array.isArray(index.plugins),
    "Unsupported community index schema");
  ensure(index.plugins.length <= config.maxPlugins, "Too many community plugins");
  const ids = new Set(), folders = new Set();
  return index.plugins.map(entry => checkEntry(entry, config, ids, folders));
}
export async function fetchCommunityIndex(config, fetcher = fetch) {
  const root = source(config);
  const url = rawURL(root, config.indexPath);
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw problem("COMMUNITY_FETCH_FAILED",
    "Community index HTTP " + response.status);
  const length = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(length) && length > config.maxIndexBytes)
    throw problem("COMMUNITY_LIMIT", "Community index too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > config.maxIndexBytes)
    throw problem("COMMUNITY_LIMIT", "Community index too large");
  let index;
  try { index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw problem("COMMUNITY_INDEX_INVALID", "Invalid community index JSON"); }
  return parseCommunityIndex(index, config);
}
export async function fetchCommunityPlugin(entry, config, fetcher = fetch) {
  const root = source(config);
  const checked = checkEntry(entry, config, new Set(), new Set());
  const treeUrl = root.api + "/repos/" +
    [root.owner, root.repo].map(encodeURIComponent).join("/") +
    "/git/trees/" + encodeURIComponent(root.ref) + "?recursive=1";
  const response = await fetcher(treeUrl, {
    headers: { Accept: "application/vnd.github+json" }
  });
  if (!response.ok) throw problem("COMMUNITY_FETCH_FAILED",
    "GitHub tree HTTP " + response.status);
  const tree = await response.json();
  ensure(!tree.truncated && Array.isArray(tree.tree), "GitHub tree incomplete");
  const prefix = checked.directory + "/";
  const files = tree.tree.filter(file =>
    file.type === "blob" && file.path.startsWith(prefix));
  ensure(files.length && files.length <= config.maxFilesPerPlugin &&
    files.some(file => file.path === prefix + "manifest.json"),
    "Plugin manifest or files missing");
  let total = 0;
  for (const file of files) {
    ensure(Number.isInteger(file.size) && file.size >= 0 &&
      file.size <= config.maxFileBytes, "Invalid file size");
    total += file.size;
  }
  ensure(total <= config.maxPluginBytes, "Plugin exceeds public size limit");

  const contents = {};
  for (let i = 0; i < files.length; i += config.parallelDownloads) {
    const result = await Promise.all(
      files.slice(i, i + config.parallelDownloads).map(async file => {
        const relative = file.path.slice(prefix.length);
        ensure(relative && relative.split("/").every(x =>
          x && x !== "." && x !== ".."), "Unsafe plugin path");
        // A tree entry identifies a specific Git blob. Raw CDN responses can lag
        // behind a recent commit, so never accept bytes from a different revision.
        const expectedSha = file.sha;
        ensure(typeof expectedSha === "string" && /^[a-f0-9]{40}$/.test(expectedSha),
          "Missing Git blob SHA: " + relative);
        const raw = new URL(rawURL(root, file.path));
        raw.searchParams.set("sha", expectedSha);
        const fileResponse = await fetcher(raw.href, { cache: "no-store" });
        let bytes = fileResponse.ok ?
          new Uint8Array(await fileResponse.arrayBuffer()) : null;
        if (!bytes || bytes.byteLength !== file.size) {
          // The immutable blob endpoint avoids raw-content CDN cache skew.
          const blobUrl = root.api + "/repos/" +
            [root.owner, root.repo].map(encodeURIComponent).join("/") +
            "/git/blobs/" + encodeURIComponent(expectedSha);
          const blobResponse = await fetcher(blobUrl, {
            cache: "no-store",
            headers: { Accept: "application/vnd.github+json" }
          });
          if (!blobResponse.ok) throw problem("COMMUNITY_FETCH_FAILED",
            "Plugin blob HTTP " + blobResponse.status + ": " + relative);
          const blob = await blobResponse.json();
          if (blob.sha !== expectedSha || blob.encoding !== "base64" ||
              typeof blob.content !== "string")
            throw problem("COMMUNITY_FETCH_FAILED",
              "Invalid GitHub blob response: " + relative);
          const binary = atob(blob.content.replace(/\\s/g, ""));
          bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        }
        ensure(bytes.byteLength === file.size, "Truncated plugin file: " + relative);
        return [relative, bytes];
      })
    );
    for (const [path, bytes] of result) contents[path] = bytes;
  }
  const packageResult = validatePluginPackage(contents);
  ensure(packageResult.manifest.id === checked.id &&
    packageResult.manifest.version === checked.version,
    "Manifest differs from community index");
  return packageResult;
}
