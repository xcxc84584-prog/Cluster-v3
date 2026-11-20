/**
 * Assemble local plugin assets into an opaque-origin iframe document.
 * Chrome does not route subresource loads through the Host SW after CSP
 * changes a document to an opaque origin. Inline local JS/CSS/images as
 * data URLs instead. This preserves plugin isolation without allow-same-origin.
 */
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const binary = value => value instanceof Uint8Array ? value :
  new Uint8Array(value);
function base64(bytes) {
  const parts = [];
  const data = binary(bytes);
  for (let at = 0; at < data.length; at += 8192) {
    parts.push(String.fromCharCode(...data.subarray(at, at + 8192)));
  }
  return btoa(parts.join(""));
}
const mime = {
  js:"text/javascript", mjs:"text/javascript", css:"text/css",
  json:"application/json", svg:"image/svg+xml", png:"image/png",
  jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",
  woff:"font/woff",woff2:"font/woff2",txt:"text/plain"
};
function relativePath(ref, file) {
  if (typeof ref !== "string" || !ref ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref) ||
      ref.startsWith("//") || ref.startsWith("#")) return null;
  const root = new URL("https://plugin.invalid/" + file);
  const next = new URL(ref, root);
  if (next.origin !== root.origin) return null;
  const path = decodeURIComponent(next.pathname.slice(1));
  if (path.split("/").some(part => !part || part === "." || part === ".."))
    return null;
  return path;
}
function dataURL(path, content) {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return "data:" + (mime[extension] || "application/octet-stream") +
    ";base64," + base64(content);
}
function cssWithAssets(source, path, files) {
  const css = decoder.decode(binary(source));
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi,
    (match, quote, ref) => {
      const item = relativePath(ref, path);
      return item && files[item] ?
        "url('" + dataURL(item, files[item]) + "')" : match;
    });
}
function compileSource(path, files, stack = new Set()) {
  if (!files[path]) throw Error("Plugin resource missing: " + path);
  if (stack.has(path)) throw Error("Circular module import: " + path);
  const nextStack = new Set([...stack, path]);
  let js = decoder.decode(binary(files[path]));
  // Static local imports are rewritten recursively; external imports stay
  // unmodified and remain subject to the sandbox/CORS restrictions.
  js = js.replace(/(from\s*|import\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,
    (match, keyword, quote, specifier) => {
      const name = relativePath(specifier, path);
      return name && files[name] ? keyword + quote +
        dataURL(name, encoder.encode(compileSource(name, files, nextStack))) +
        quote : match;
    });
  return js;
}
export function buildPluginDocument(files, path) {
  if (typeof DOMParser === "undefined")
    throw Error("DOMParser is required for browser plugin documents");
  if (!files[path]) throw Error("Missing HTML entry: " + path);
  const html = decoder.decode(binary(files[path]));
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const item of doc.querySelectorAll("base")) item.remove();
  for (const item of doc.querySelectorAll("script[src]")) {
    const ref = relativePath(item.getAttribute("src"), path);
    if (!ref || !files[ref]) continue;
    const executable = compileSource(ref, files);
    item.setAttribute("src", dataURL(ref, encoder.encode(executable)));
    item.removeAttribute("integrity");
    item.removeAttribute("crossorigin");
  }
  for (const item of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const ref = relativePath(item.getAttribute("href"), path);
    if (!ref || !files[ref]) continue;
    const style = doc.createElement("style");
    style.textContent = cssWithAssets(files[ref], ref, files);
    item.replaceWith(style);
  }
  for (const item of doc.querySelectorAll(
      "img[src],video[src],audio[src],source[src],link[rel~=icon][href]")) {
    const key = item.hasAttribute("src") ? "src" : "href";
    const ref = relativePath(item.getAttribute(key), path);
    if (ref && files[ref]) item.setAttribute(key, dataURL(ref, files[ref]));
  }
  // Drop author-defined CSP meta entries; Host owns the iframe sandbox.
  // Plugin scripts still operate independently within the opaque origin.
  for (const item of doc.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy" i]')) item.remove();
  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}
