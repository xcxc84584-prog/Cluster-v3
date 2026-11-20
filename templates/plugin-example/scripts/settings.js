const ui = id => document.getElementById(id);
const words = {
  "zh-TW": ["範例插件設定", "此介面由插件自行設計；不會修改 Host DOM。",
    "公共語言", "全域介面色彩基準"],
  en: ["Example Plugin Settings", "Designed by the plugin; Host DOM stays isolated.",
    "Public language", "Global UI base color"],
  fr: ["Paramètres du plugin", "Interface propre au plugin, DOM hôte isolé.",
    "Langue publique", "Couleur d'interface"],
  ja: ["プラグイン設定", "プラグイン独自の UI。Host DOM とは分離されます。",
    "共有言語", "UI の基本色"],
  es: ["Ajustes del plugin", "El plugin diseña su UI, sin acceso al DOM Host.",
    "Idioma público", "Color base"],
  hi: ["प्लगइन सेटिंग्स", "प्लगइन की अपनी UI, Host DOM से अलग।",
    "साझा भाषा", "UI मूल रंग"]
};
Cluster.onContext(context => {
  const row = words[context.language] || words.en;
  ["settingsHeading","settingsHint","languageLabel","colorLabel"]
    .forEach((id, i) => ui(id).textContent = row[i]);
  ui("language").value = context.language;
  ui("color").value = context.baseColor;
});
async function change(source, item, value) {
  const response = await Cluster.PRMU.set(source, item, value);
  ui("settingsOutput").textContent = JSON.stringify(response, null, 2);
}
ui("language").addEventListener("change", event =>
  void change("properties", "system.language", event.target.value));
ui("color").addEventListener("change", event =>
  void change("ui", "palette.baseColor", event.target.value));
