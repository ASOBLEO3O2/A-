// ===============================
// src/viz.index.js（復旧用・最小起動コード）
// ===============================
import Papa from "papaparse";
import { createPanel, readPanelState, setMachineOptions } from "./panel.js";
import { buildViz } from "./viz.js";

// ---- DOM ----
const overlay = document.getElementById("overlay");   // <svg id="overlay">
if (!overlay) console.error("[viz.index] #overlay が見つかりません");

// ---- 既定表示設定 ----
const cfg = {
  unitMode: "cm",
  pxPerCM: 1.0,
  pxPerMM: 0.10,
  scale: 0.22,
  cols: 3,
  start: { x: 80, y: 80 },
  spacing: { x: 260, y: 220 },
  boothGap: 0,
  winsorUpperPercent: 5,
};

// ---- パネル生成 ----
createPanel(cfg);

// ---- 可視化API ----
const api = buildViz({
  svg: overlay,
  cfg,
  panelState: readPanelState,
});

// ---- CSVロード（必要あれば差し替え）----
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSYAO0VSIbTG2fa-9W2Jl1NuG9smC4BOfqNZWiwsb5IHEIYWgcUWgCe_SZTWBPrnFiodfIGdxvKe7Up/pub?gid=1317014562&single=true&output=csv";

Papa.parse(CSV_URL, {
  download: true,
  header: true,
  complete: ({ data }) => {
    // 機種候補の注入
    const machines = Array.from(new Set(data.map(r => r["対応マシン名"]).filter(Boolean)))
      .sort((a,b)=> a.localeCompare(b, "ja"));
    setMachineOptions(machines);

    // 初回描画
    api.render(data);
    console.log("[viz.index] 初期描画完了 / booth数:", data.length);
  },
  error: (err) => {
    console.error("[viz.index] CSV load error:", err);
  }
});

// ---- パネル「反映」イベントで色・強調を再適用 ----
document.addEventListener("panel:apply", () => {
  api.applyVisuals();
});
