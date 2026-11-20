/** Host-only lifecycle facade. Never exposed to sandbox plugin frames. */
export function createHostPMU({ kernel, runtime }) {
  if (!kernel || !runtime) throw TypeError("kernel and runtime are required");
  const ok = data => ({ ok:true, status:200, data, error:null });
  return Object.freeze({
    async install(source, options = {}) {
      if (options.format === "folder") return ok(await runtime.installFolder(source));
      return ok(await runtime.installZip(source));
    },
    async uninstall(pluginId) {
      await runtime.remove(pluginId);
      return ok(true);
    },
    async load(pluginId) { return ok((await runtime.load(pluginId)).id); },
    async unload(pluginId) { await runtime.unload(pluginId); return ok(true); },
    async reload(pluginId) { return ok((await runtime.reload(pluginId)).id); },
    async configure(pluginId, config) {
      await runtime.configure(pluginId, config);
      return ok(true);
    },
    get(pluginId) { return ok(runtime.get(pluginId)); },
    list() { return ok(runtime.list()); },
    inspect(pluginId) {
      return ok({ runtime: runtime.get(pluginId),
        loaded: runtime.isLoaded(pluginId), router: kernel.inspect(pluginId),
        logs: kernel.pluginLogs(pluginId) });
    }
  });
}
