// ===============================
// src/viz.js（モノリシック復旧版）
// 仕様（2025-08-12）
// - セルに文字は出さない
// - グループ中央に「ラベルID」を1つだけ表示（自動フィット）
// - 塗り＝売上（青→白→赤）/ 枠＝原価率（青→白→赤）
// - 強調：パネルの機種選択に一致 → 白の極太枠、その他は減光
// - Winsorize：上側%カット（panelState.winsorUpperPercent）
// - 移動モードONでグループドラッグ（panelState.moveMode が真のとき）
// - 依存：modal.js の showBoothModalFromRect（無ければ無視）
// ===============================

import { showBoothModalFromRect as _show } from "./modal.js";

export function buildViz({ svg, cfg, panelState }) {
  // ---- state ----
  let allRects = [];
  let salesVals = [];                 // 金額（昇順）
  let salesMinAuto = 0, salesMaxAuto = 0;

  // ---- helpers ----
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const isFn = (f)=> typeof f === "function";
  const PS  = () => { try { return isFn(panelState) ? (panelState() || {}) : {}; } catch { return {}; } };
  const inMove = () => !!PS().moveMode; // 未提供なら false

  function toNumberLoose(v){
    if (v == null) return NaN;
    let s = String(v).replace(/[０-９．－]/g, ch => ({ '．':'.', '－':'-' }[ch] ?? String.fromCharCode(ch.charCodeAt(0)-0xFEE0)));
    s = s.replace(/[^\d.\-]/g, '');
    return s ? Number(s) : NaN;
  }
  function unitPx(v){
    const n = toNumberLoose(v);
    if (!isFinite(n)) return NaN;
    const useMM = cfg.unitMode === "mm";
    const px = useMM ? n*cfg.pxPerMM : n*cfg.pxPerCM; // cm 既定
    return px * (cfg.scale ?? 1);
  }
  function rateFrom(cost, sales){
    const s = toNumberLoose(sales), c = toNumberLoose(cost);
    return (isFinite(s)&&s>0) ? (c*1.1)/s : NaN; // 0..∞
  }
  function percentile(arr, p){
    if (!arr?.length) return NaN;
    const idx = (p/100) * (arr.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return arr[lo];
    const t = idx - lo;
    return arr[lo]*(1-t) + arr[hi]*t;
  }
  function blueWhiteRed(t){
    t = clamp(t, 0, 1);
    const L = (a,b,x)=>Math.round(a+(b-a)*x);
    if (t <= 0.5){
      const u=t/0.5, c1=[59,130,246], c2=[255,255,255];
      return `rgb(${L(c1[0],c2[0],u)},${L(c1[1],c2[1],u)},${L(c1[2],c2[2],u)})`;
    }
    const u=(t-0.5)/0.5, c1=[255,255,255], c2=[239,68,68];
    return `rgb(${L(c1[0],c2[0],u)},${L(c1[1],c2[1],u)},${L(c1[2],c2[2],u)})`;
  }
  // 中央ラベル（ラベルID）を自動フィット
  function createAutoFitLabel(NS, parentG, text, x, y, maxW, maxH, {
    maxFont=22, minFont=12, padding=8, className="group-label",
    anchor="middle", baseline="middle"
  } = {}){
    const t = document.createElementNS(NS,"text");
    t.classList.add(className);
    t.setAttribute("text-anchor", anchor);
    t.setAttribute("dominant-baseline", baseline);
    t.textContent = text || "";
    parentG.appendChild(t);

    let fs = maxFont;
    t.style.fontSize = fs + "px";
    const fitW = Math.max(0, maxW - padding*2);
    for(; fs>=minFont; fs--){
      t.style.fontSize = fs + "px";
      if (t.getBBox().width <= fitW) break;
    }
    if (t.getBBox().width > fitW){
      let s = t.textContent;
      while(s.length>1 && t.getBBox().width>fitW){
        s = s.slice(0,-1); t.textContent = s + "…";
      }
    }
    while (t.getBBox().height > Math.max(0, maxH - padding*2) && fs>minFont){
      fs--; t.style.fontSize = fs + "px";
    }
    t.setAttribute("x", String(Math.round(x)));
    t.setAttribute("y", String(Math.round(y)));
    return t;
  }

  // ---- Winsor レンジ ----
  function salesRangeByState(st){
    const cut = clamp(toNumberLoose(st.winsorUpperPercent ?? cfg.winsorUpperPercent ?? 0), 0, 50);
    if (cut>0 && salesVals.length){
      const hi2 = percentile(salesVals, 100 - cut);
      if (isFinite(hi2) && hi2 > salesMinAuto) return [salesMinAuto, hi2];
    }
    return [salesMinAuto, salesMaxAuto];
  }
  function salesRangeForRects(rects, st){
    const vals = rects.map(r=>toNumberLoose(r.dataset.sales)).filter(x=>isFinite(x)&&x>=0).sort((a,b)=>a-b);
    if (!vals.length) return salesRangeByState(st);
    const cut = clamp(toNumberLoose(st.winsorUpperPercent ?? cfg.winsorUpperPercent ?? 0), 0, 50);
    if (cut>0){
      const hi2 = percentile(vals, 100 - cut);
      if (isFinite(hi2) && hi2 > vals[0]) return [vals[0], hi2];
    }
    return [vals[0], vals[vals.length-1]];
  }

  // ---- drag ----
  const DRAG = { active:false, g:null, start:{x:0,y:0}, origin:{x:0,y:0} };
  function attachDragHandlers(){
    svg.onpointerdown = svg.onpointermove = svg.onpointerup = svg.onpointerleave = null;

    svg.addEventListener("pointerdown",(e)=>{
      if (!inMove()) return;
      const targetG = e.composedPath().find(el => el instanceof SVGGElement && el.classList?.contains("booth-group"));
      if (!targetG) return;
      DRAG.active = true; DRAG.g = targetG;
      DRAG.start  = { x:e.clientX, y:e.clientY };
      DRAG.origin = { x:+targetG.dataset.tx||0, y:+targetG.dataset.ty||0 };
      targetG.setPointerCapture?.(e.pointerId);
    });
    svg.addEventListener("pointermove",(e)=>{
      if (!DRAG.active || !DRAG.g) return;
      const nx = DRAG.origin.x + (e.clientX - DRAG.start.x);
      const ny = DRAG.origin.y + (e.clientY - DRAG.start.y);
      DRAG.g.dataset.tx = String(Math.round(nx));
      DRAG.g.dataset.ty = String(Math.round(ny));
      DRAG.g.setAttribute("transform", `translate(${DRAG.g.dataset.tx}, ${DRAG.g.dataset.ty})`);
    });
    const end=(e)=>{
      if (DRAG.g?.releasePointerCapture && e?.pointerId!=null){ try{ DRAG.g.releasePointerCapture(e.pointerId); }catch{} }
      DRAG.active=false; DRAG.g=null;
    };
    svg.addEventListener("pointerup",end);
    svg.addEventListener("pointerleave",end);
  }

  // ---- render ----
  function render(rows){
    svg.innerHTML = "";
    allRects.length = 0;

    // ラベルIDでグループ化
    const groups = Object.entries(rows.reduce((acc,row)=>{
      const k = (row["ラベルID"]||"").toString();
      if(!k) return acc;
      (acc[k] ??= []).push(row);
      return acc;
    },{}));

    const NS="http://www.w3.org/2000/svg";
    let rowX=cfg.start.x, rowY=cfg.start.y, colCount=0, rowMaxH=0;
    let maxRight=0, maxBottom=0;

    for (const [labelId, booths] of groups){
      const base = booths[0] || {};
      const rawW = base["幅"] ?? base["横幅"] ?? base["W"] ?? base["Width"];
      const rawH = base["奥行き"] ?? base["奥行"] ?? base["D"] ?? base["Depth"];
      let W0 = unitPx(rawW), H0 = unitPx(rawH);
      if(!isFinite(W0)||W0<=0) W0 = 120*(cfg.scale??1);
      if(!isFinite(H0)||H0<=0) H0 = 120*(cfg.scale??1);

      // 分割数
      const n = booths.length;
      let cols, rowsGrid;
      if (n===2){ cols=2; rowsGrid=1; }
      else if(n===4){ cols=2; rowsGrid=2; }
      else {
        const ratio = W0>0&&H0>0 ? (W0/H0) : 1;
        cols = Math.max(1, Math.min(Math.ceil(Math.sqrt(n*ratio)), n));
        rowsGrid = Math.ceil(n/cols);
      }

      // 折返し
      if (colCount>=cfg.cols){
        rowY += rowMaxH + cfg.spacing.y;
        rowX  = cfg.start.x;
        colCount=0; rowMaxH=0;
      }

      // グループ
      const g = document.createElementNS(NS,"g");
      g.classList.add("booth-group");
      g.dataset.tx = String(Math.round(rowX));
      g.dataset.ty = String(Math.round(rowY));
      g.setAttribute("transform", `translate(${g.dataset.tx}, ${g.dataset.ty})`);
      svg.appendChild(g);

      const cellW = W0/cols, cellH = H0/rowsGrid;

      // 各セル（rectのみ）
      booths.forEach((rowB,i)=>{
        const cx=i%cols, ry=Math.floor(i/cols);
        const x = cx*cellW + (cfg.boothGap ? cfg.boothGap/2 : 0);
        const y = ry*cellH + (cfg.boothGap ? cfg.boothGap/2 : 0);
        const rectW = cellW - cfg.boothGap;
        const rectH = cellH - cfg.boothGap;

        const rect = document.createElementNS(NS,"rect");
        rect.classList.add("booth");
        rect.setAttribute("x", String(Math.round(x)));
        rect.setAttribute("y", String(Math.round(y)));
        rect.setAttribute("width",  String(Math.max(1, Math.round(rectW))));
        rect.setAttribute("height", String(Math.max(1, Math.round(rectH))));
        rect.dataset.labelId = (rowB["ラベルID"]||"").toString();
        rect.dataset.boothId = (rowB["ブースID"]||"").toString();
        rect.dataset.prize   = (rowB["景品名"]  ||"").toString();
        rect.dataset.sales   = (rowB["総売上"]  ||"").toString();
        rect.dataset.count   = (rowB["消化数"]  ||"").toString();
        rect.dataset.cost    = (rowB["消化額"]  ||"").toString();
        rect.dataset.machine = (rowB["対応マシン名"]||"").toString();

        rect.addEventListener("click",(ev)=>{
          if (inMove()) return; // 移動モード中はクリック無効
          ev.stopPropagation();
          try { if (isFn(_show)) _show(rect); } catch {}
        });

        g.appendChild(rect);
        allRects.push(rect);
      });

      // グループ中央に「ラベルID」を1回だけ表示
      createAutoFitLabel(
        NS, g, (labelId||"").replace(/\s+/g,""),
        Math.round(W0/2), Math.round(H0/2),
        W0, H0,
        { maxFont: 22, minFont: 12, padding: 8, className: "group-label" }
      );

      // 次の位置
      const groupRight  = rowX + Math.round(W0);
      const groupBottom = rowY + Math.round(H0);
      maxRight  = Math.max(maxRight, groupRight);
      maxBottom = Math.max(maxBottom, groupBottom);

      rowX += Math.round(W0) + cfg.spacing.x;
      rowMaxH = Math.max(rowMaxH, Math.round(H0));
      colCount++;
    }

    // viewBox
    const vbW = Math.max(800, Math.ceil(maxRight + cfg.start.x));
    const vbH = Math.max(600, Math.ceil(maxBottom + cfg.start.y));
    svg.setAttribute("viewBox", `0 0 ${vbW} ${vbH}`);

    // 集計（売上レンジの自動計算）
    salesVals = allRects.map(r=>toNumberLoose(r.dataset.sales)).filter(x=>isFinite(x)&&x>=0).sort((a,b)=>a-b);
    salesMinAuto = salesVals[0] ?? 0;
    salesMaxAuto = salesVals[salesVals.length-1] ?? 0;

    attachDragHandlers();
    applyVisuals(); // 初回色付け
  }

  // ---- applyVisuals ----
  function applyVisuals(){
    if (!allRects.length) return;

    const st = PS();
    const toggles = st.toggles || {};
    const fillOn   = (toggles.fill   ?? true);
    const strokeOn = (toggles.stroke ?? true);
    const emphasize= !!(toggles.emphasize);
    const chosen   = Array.isArray(st.machines) ? st.machines : [];

    // 原価率カラー：固定しきい値（30%→青、33%→赤）
    const blueAt = 0.30, redAt = 0.33;
    const baseStroke = 4;
    const deemph = 0.6; // 非強調の減光率

    // 売上レンジ（選択群がある場合はサブセットで再計算）
    let sMin = salesMinAuto, sMax = salesMaxAuto;
    if (chosen.length){
      const selRects = allRects.filter(r => chosen.includes(r.dataset.machine || ""));
      [sMin, sMax] = selRects.length ? salesRangeForRects(selRects, st) : salesRangeByState(st);
    } else {
      [sMin, sMax] = salesRangeByState(st);
    }

    // reset
    for (const rect of allRects){
      rect.style.opacity = "";
      rect.style.strokeWidth = "";
      rect.style.stroke = "";
    }

    for (const rect of allRects){
      const sales = toNumberLoose(rect.dataset.sales);
      const cost  = toNumberLoose(rect.dataset.cost);
      const rate  = rateFrom(cost, sales);

      // 塗り＝売上
      if (fillOn && isFinite(sales) && sMax>sMin){
        const t = clamp((sales - sMin)/(sMax - sMin), 0, 1);
        rect.style.fill = blueWhiteRed(t);
      } else {
        rect.style.fill = "rgba(255,255,255,0.05)";
      }

      // 枠＝原価率
      if (strokeOn && isFinite(rate)) {
        const lo = Math.min(blueAt, redAt);
        const hi = Math.max(blueAt, redAt);
        const tt = clamp((rate - lo) / Math.max(1e-9,(hi - lo)), 0, 1);
        rect.style.stroke = blueWhiteRed(tt);
        rect.style.strokeWidth = String(baseStroke);
      } else {
        rect.style.stroke = "#9ca3af";
        rect.style.strokeWidth = "2";
      }

      // 強調（選択機種）
      if (emphasize && chosen.length){
        const hit = chosen.includes(rect.dataset.machine || "");
        if (hit){
          rect.style.stroke = "#fff";
          rect.style.strokeWidth = "8";
          rect.style.opacity = "1";
        } else {
          rect.style.opacity = String(1 - deemph);
        }
      }
    }
  }

  // パネルからの反映
  document.addEventListener("panel:apply", applyVisuals);

  // ---- exports ----
  return { render, applyVisuals };
}
