/* Plugin-owned preview only; download and install belong to Host actions. */
const previewText = {
  "zh-TW": "支援 PMU、PRMU、Router 與獨立設定頁面。",
  en: "PMU, PRMU, Router and independent plugin settings.",
  fr: "PMU, PRMU, Router et paramètres indépendants.",
  ja: "PMU、PRMU、Router、独立設定画面に対応。",
  es: "PMU, PRMU, Router y ajustes independientes.",
  hi: "PMU, PRMU, Router और स्वतंत्र प्लगइन सेटिंग्स।"
};
Cluster.onContext(context => {
  document.getElementById("cardDescription").textContent =
    previewText[context.language] || previewText.en;
});
