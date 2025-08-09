// === SVG要素とボタン ===
const svg = document.getElementById("overlay");
const rotateBtn = document.getElementById("rotate-btn");
const moveModeBtn = document.getElementById("move-mode-btn");

// === モーダル要素 ===
const modal = document.getElementById("info-modal");
const backdrop = document.getElementById("modal-backdrop");
const modalClose = document.getElementById("modal-close");
const modalOk = document.getElementById("modal-ok");

// === モーダル表示フィールド ===
const mLabel = document.getElementById("m-label");
const mBoothId = document.getElementById("m-booth-id");
const mPrize = document.getElementById("m-prize");
const mSales = document.getElementById("m-sales");
const mPrice = document.getElementById("m-price");
const mCount = document.getElementById("m-count");
const mCost = document.getElementById("m-cost");
const mGpr = document.getElementById("m-gpr");

// === 状態 ===
let selectedGroup = null; // g選択
let selectedRect = null;  // rect選択
let isMoveMode = false;   // 移動モード
let labelToBooths = {};   // ラベルID -> ブース配列

// ===== ユーティリティ =====
function toNumber(v) {
  if (v === null || v === undefined) return NaN;
  let s = String(v);
  s = s.replace(/[０-９．－]/g, ch => {
    const map = { '．':'.', '－':'-' };
    return map[ch] ?? String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  });
  s = s.replace(/[^\d.\-]/g, '');
  return s ? Number(s) : NaN;
}
const fmt0 = (n) => Number(Math.round(n)).toLocaleString("ja-JP");
const yen0 = (n) => isFinite(n) ? "¥" + fmt0(n) : "-";
const int0 = (n) => isFinite(n) ? fmt0(n) : "-";
const pct1 = (v) => isFinite(v) ? (v * 100).toFixed(1) + "%" : "-";

// ===== UI状態 =====
const updateButtons = () => {
  moveModeBtn.textContent = isMoveMode ? "✋ 移動モード ON" : "✋ 移動モード OFF";
  rotateBtn.disabled = !(isMoveMode && selectedGroup);
};

// ===== モーダル制御（display + .activeで確実表示）=====
const openModal = () => {
  if (isMoveMode) return; // 移動モード中は表示しない
  backdrop.style.display = 'block';
  modal.style.display = 'flex'; // CSSがflex前提
  // 次フレームでアニメ開始
  requestAnimationFrame(() => {
    backdrop.classList.add('active');
    modal.classList.add('active');
  });
};
const closeModal = () => {
  backdrop.classList.remove('active');
  modal.classList.remove('active');
  setTimeout(() => {
    backdrop.style.display = 'none';
    modal.style.display = 'none';
  }, 300); // CSSのtransitionと合わせる
};
// 閉じる操作
modalClose?.addEventListener('click', closeModal);
modalOk?.addEventListener('click', closeModal);
backdrop?.addEventListener('click', closeModal);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// ===== 移動モード切替 =====
moveModeBtn.addEventListener("click", () => {
  isMoveMode = !isMoveMode;
  if (isMoveMode) closeModal();
  updateButtons();
});

// ===== CSV読み込み & 初期描画 =====
Papa.parse("https://docs.google.com/spreadsheets/d/e/2PACX-1vSYAO0VSIbTG2fa-9W2Jl1NuG9smC4BOfqNZWiwsb5IHEIYWgcUWgCe_SZTWBPrnFiodfIGdxvKe7Up/pub?gid=1317014562&single=true&output=csv", {
  download: true, header: true,
  complete: (results) => {
    const data = results.data.filter(r => r["ラベルID"]);
    labelToBooths = {};
    data.forEach(row => {
      const key = row["ラベルID"];
      if (!labelToBooths[key]) labelToBooths[key] = [];
      labelToBooths[key].push(row);
    });

    // レイアウト設定
    const scale = 0.3, spacingX = 300, spacingY = 250, startX = 100, startY = 100;
    let count = 0;

    for (const [labelID, booths] of Object.entries(labelToBooths)) {
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("class", "booth-group");
      group.setAttribute("data-rotate", "0");
      group.dataset.labelId = labelID;

      // gクリック：選択のみ
      group.addEventListener("click", (e) => {
        document.querySelectorAll(".booth-group").forEach(g => g.classList.remove("selected"));
        document.querySelectorAll("rect.booth").forEach(r => r.classList.remove("selected-rect"));
        group.classList.add("selected");
        selectedGroup = group;
        selectedRect = null;
        updateButtons();
        e.stopPropagation();
      });

      const n = booths.length;
      const isFour = (n === 4);
      const cols = isFour ? 2 : n;
      const rows = isFour ? 2 : 1;

      const rawWidth  = toNumber(booths[0]["幅"]);
      const rawHeight = toNumber(booths[0]["奥行き"]);
      const boothWidth  = (rawWidth  * scale) / cols;
      const boothHeight = (rawHeight * scale) / rows;

      // 各ブースrect
      booths.forEach((b, i) => {
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("width",  boothWidth);
        rect.setAttribute("height", boothHeight);
        rect.setAttribute("x", (i % cols) * boothWidth);
        rect.setAttribute("y", Math.floor(i / cols) * boothHeight);
        rect.setAttribute("rx", 6);
        rect.setAttribute("ry", 6);
        rect.setAttribute("class", "booth");

        // 必要データ
        rect.dataset.labelId = labelID;
        rect.dataset.boothId = b["ブースID"] || "";
        rect.dataset.prize   = b["景品名"] || "";
        rect.dataset.sales   = b["総売上"] || "";
        rect.dataset.count   = b["消化数"] || "";
        rect.dataset.cost    = b["消化額"] || "";

        rect.addEventListener("click", (e) => {
          // g選択
          document.querySelectorAll(".booth-group").forEach(g => g.classList.remove("selected"));
          group.classList.add("selected"); selectedGroup = group;

          // rect選択
          document.querySelectorAll("rect.booth").forEach(r => r.classList.remove("selected-rect"));
          rect.classList.add("selected-rect"); selectedRect = rect;

          updateButtons();
          e.stopPropagation();

          if (!isMoveMode) showBoothModalFromRect(rect);
        });

        group.appendChild(rect);
      });

      // 中央ラベル
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", (cols * boothWidth) / 2);
      label.setAttribute("y", (rows * boothHeight) / 2);
      label.setAttribute("class", "label-text");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.textContent = labelID;
      group.appendChild(label);

      // 初期位置
      const groupX = startX + (count % 3) * spacingX;
      const groupY = startY + Math.floor(count / 3) * spacingY;
      group.setAttribute("transform", `translate(${groupX}, ${groupY})`);
      group.setAttribute("data-x", String(groupX));
      group.setAttribute("data-y", String(groupY));

      svg.appendChild(group);
      count++;
    }
  }
});

// === 背景クリックで選択解除 ===
svg.addEventListener("click", () => {
  document.querySelectorAll(".booth-group").forEach(g => g.classList.remove("selected"));
  document.querySelectorAll("rect.booth").forEach(r => r.classList.remove("selected-rect"));
  selectedGroup = null; selectedRect = null; updateButtons();
  closeModal();
});

// === 回転（移動モード時のみ） ===
rotateBtn.addEventListener("click", () => {
  if (!isMoveMode || !selectedGroup) return;
  const current = parseInt(selectedGroup.getAttribute("data-rotate") || "0", 10);
  const next = (current + 90) % 360;
  selectedGroup.setAttribute("data-rotate", String(next));
  const tx = parseFloat(selectedGroup.getAttribute("data-x"));
  const ty = parseFloat(selectedGroup.getAttribute("data-y"));
  selectedGroup.setAttribute("transform", `translate(${tx}, ${ty}) rotate(${next})`);
  // ラベルは正立
  const text = selectedGroup.querySelector("text");
  if (text) {
    const cx = text.getAttribute("x"); const cy = text.getAttribute("y");
    text.setAttribute("transform", `rotate(${-next}, ${cx}, ${cy})`);
  }
});

// === ドラッグ移動（移動モードのみ / 画面座標版） ===
let isDragging = false; let offsetX = 0, offsetY = 0;
svg.addEventListener("mousedown", (e) => {
  if (!isMoveMode || !selectedGroup) return;
  const transform = selectedGroup.getAttribute("transform") || "";
  const m = /translate\(([^,]+),\s*([^)]+)\)/.exec(transform);
  if (!m) return;
  const tx = parseFloat(m[1]); const ty = parseFloat(m[2]);
  offsetX = e.clientX - tx; offsetY = e.clientY - ty; isDragging = true;
  closeModal();
});
svg.addEventListener("mousemove", (e) => {
  if (!isMoveMode || !isDragging || !selectedGroup) return;
  const newX = e.clientX - offsetX; const newY = e.clientY - offsetY;
  const rotate = selectedGroup.getAttribute("data-rotate") || "0";
  selectedGroup.setAttribute("transform", `translate(${newX}, ${newY}) rotate(${rotate})`);
  selectedGroup.setAttribute("data-x", String(newX));
  selectedGroup.setAttribute("data-y", String(newY));
});
const stopDrag = () => { isDragging = false; };
svg.addEventListener("mouseup", stopDrag);
svg.addEventListener("mouseleave", stopDrag);

// 初期
updateButtons();

/* === クリック時のみ表示するブース情報 ===
   表示項目：ラベルID、ブースID、景品名、売り上げ、単価、消化数、消化額、原価率
   単価は「総売上 / 消化数」、原価率は「消化額 × 1.1 ÷ 総売上」
*/
function showBoothModalFromRect(rect) {
  const labelID = rect.dataset.labelId || "-";
  const boothId = rect.dataset.boothId || "-";
  const prize   = rect.dataset.prize   || "-";
  const sales   = toNumber(rect.dataset.sales);
  const count   = toNumber(rect.dataset.count);
  const cost    = toNumber(rect.dataset.cost);

  const unitPrice = (isFinite(sales) && isFinite(count) && count > 0) ? (sales / count) : NaN;
  const gpr = (isFinite(sales) && sales > 0) ? (cost * 1.1) / sales : NaN;

  mLabel.textContent   = labelID;
  mBoothId.textContent = boothId;
  mPrize.textContent   = prize;
  mSales.textContent   = yen0(sales);
  mPrice.textContent   = yen0(unitPrice);
  mCount.textContent   = int0(count);
  mCost.textContent    = yen0(cost);
  mGpr.textContent     = pct1(gpr);

  openModal();
}
