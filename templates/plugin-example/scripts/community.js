/* Plugin-owned community card. Host only supplies its bounded iframe. */
const translations = {
  "zh-TW": ["Hello Cluster", "標準插件開發範例；含 PMU、PRMU、Router 與自訂 UI。", "安裝範例"],
  en: ["Hello Cluster", "Standard PMU, PRMU, Router and custom UI example.", "Install example"],
  fr: ["Hello Cluster", "Exemple PMU, PRMU, Router et interface personnalisée.", "Installer"],
  ja: ["Hello Cluster", "PMU、PRMU、Router と独自 UI の標準サンプル。", "インストール"],
  es: ["Hello Cluster", "Ejemplo estándar de PMU, PRMU, Router y UI propia.", "Instalar"],
  hi: ["Hello Cluster", "PMU, PRMU, Router और कस्टम UI का मानक उदाहरण।", "स्थापित करें"]
};
Cluster.onContext(context => {
  const labels = translations[context.language] || translations.en;
  ["cardTitle","cardDescription","cardAction"].forEach((id, i) => {
    document.getElementById(id).textContent = labels[i];
  });
});
document.getElementById("cardAction").addEventListener("click", () => {
  parent.postMessage({
    protocol: "cluster.community.v1",
    type: "install-example"
  }, "*");
});
