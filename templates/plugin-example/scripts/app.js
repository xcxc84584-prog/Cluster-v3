/* A real, functional plugin app using only the documented bridge. */
const ui = id => document.getElementById(id);
const words = {
  "zh-TW": ["範例插件", "透過 Router 和 PRMU 與 Cluster 溝通。",
    "讀取系統版本", "呼叫 Echo API", "寫入 LOG",
    "完全獨立的插件網頁，不接觸 Host DOM。"],
  en: ["Example Plugin", "Communicate with Cluster via Router and PRMU.",
    "Read System Version", "Call Echo API", "Write LOG",
    "Independent plugin page; no direct access to Host DOM."],
  fr: ["Plugin exemple", "Communication via Router et PRMU.",
    "Version système", "Appeler Echo", "Écrire LOG",
    "Page de plugin autonome sans accès au DOM hôte."],
  ja: ["サンプルプラグイン", "Router と PRMU で Cluster と通信します。",
    "システム版数", "Echo API", "LOG 記録",
    "Host DOM にアクセスしない独立したプラグインです。"],
  es: ["Plugin de ejemplo", "Comunicación vía Router y PRMU.",
    "Versión del sistema", "Llamar Echo", "Guardar LOG",
    "Página independiente sin acceso al DOM del Host."],
  hi: ["उदाहरण प्लगइन", "Router और PRMU से Cluster के साथ संवाद।",
    "सिस्टम संस्करण", "Echo API", "LOG लिखें",
    "Host DOM के बिना स्वतंत्र प्लगइन पृष्ठ।"]
};
Cluster.onContext(context => {
  const row = words[context.language] || words.en;
  ["heading","description","version","echo","record","footer"]
    .forEach((id, index) => ui(id).textContent = row[index]);
});
function show(response) { ui("output").textContent = JSON.stringify(response, null, 2); }
ui("version").addEventListener("click", async () => {
  show(await Cluster.PRMU.get("parameters", "system.version"));
});
ui("echo").addEventListener("click", async () => {
  show(await Cluster.Router.request("example.hello", "demo.echo",
    { text: "Hello from Cluster" }));
});
ui("record").addEventListener("click", async () => {
  show(await Cluster.PMU.log("log", {
    target: "cluster.pmu", action: "demo.button.click", status: 200,
    note: "Hello Cluster example log"
  }));
});
void Cluster.Router.register("demo.echo", payload =>
  ({ echoed: payload.text, at: new Date().toISOString() }), {
    contract: {
      version: "1.0.0",
      request: { type: "object", required: ["text"],
        properties: { text: { type: "string" } } },
      response: { type: "object", required: ["echoed", "at"],
        properties: { echoed: { type: "string" }, at: { type: "string" } } }
    }
  });
// The API List is sourced from the live service registry.

