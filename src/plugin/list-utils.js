/** Pure list selectors shared by UI and tests; never mutates recorded data. */
export function filterLogEntries(entries, { search = "", type = "all",
  status = "all", pluginId = "cluster.pmu" } = {}) {
  const needle = String(search).trim().toLocaleLowerCase();
  return entries.filter(entry => {
    if (type !== "all" && entry.type !== type) return false;
    if (status !== "all" && Number(entry.status) !== Number(status)) return false;
    if (pluginId !== "cluster.pmu" &&
        entry.source !== pluginId && entry.target !== pluginId) return false;
    if (!needle) return true;
    return [entry.id, entry.timestamp, entry.source, entry.target,
      entry.action, entry.status, entry.note, entry.error?.code,
      entry.error?.message, entry.requestId, entry.traceId]
      .some(value => String(value ?? "").toLocaleLowerCase().includes(needle));
  });
}

export function exportListJSON(kind, entries, filters = {}) {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    type: kind,
    exportedAt: new Date().toISOString(),
    count: entries.length,
    filters,
    entries
  }, null, 2);
}

export function resolveSettingsURL(entry, origin) {
  if (typeof entry !== "string" || !entry.trim()) return null;
  try {
    const url = new URL(entry, origin);
    // Browsers enforce the iframe sandbox; never allow executable URL schemes.
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
