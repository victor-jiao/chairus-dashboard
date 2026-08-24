/* TikTok 双店铺看板 app v9 (轻量纯净版 - 无重复与卡顿) */
(function () {
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  
  var DATA = window.DASH_DATA || { shops: [], total: {}, shop: {}, monthly_gmv: [], quarters: [] };
  var DETAIL = window.DETAIL_DATA || { shops: {} };
  var SHOPS = (DATA.shops && DATA.shops.length) ? DATA.shops : ["CHAIRUS", "PLUS"];

  function ctx(name) { return name === "TOTAL" ? DATA.total : (DATA.shop[name] || {}); }

  var DEFAULT_CONFIG = { ctrWarn: 3, addWarn: 4, ctorWarn: 0.4, refundWarn: 10, dayDropWarn: 25, dayRiseWarn: 40, weekDeclineWarn: 20, minWeekGmv: 200 };
  var CONFIG = Object.assign({}, DEFAULT_CONFIG);
  try { CONFIG = Object.assign(CONFIG, JSON.parse(lsGet("dash_config", "{}"))); } catch (e) {}

  var ROI = Object.assign({}, window.DEFAULT_ROI || {});
  try { var saved = JSON.parse(lsGet("dash_roi", "{}")); Object.assign(ROI, saved); } catch (e) {}

  var DISMISSED_WARNS = {};
  try { DISMISSED_WARNS = JSON.parse(lsGet("dash_dismissed_warns", "{}")); } catch (e) {}

  var TARGET_OVERRIDES = {};
  try { TARGET_OVERRIDES = JSON.parse(lsGet("dash_target_overrides", "{}")); } catch (e) {}

  function checkGate() {
    if (window.__unlocked) { var g = $("#gate"); if (g) g.style.display = "none"; return true; }
    return false;
  }

  var T0 = ctx("TOTAL");
  var state = {
    from: (T0.days && T0.days.length) ? T0.days[0].date : "2026-07-01",
    to: (T0.days && T0.days.length) ? T0.days[T0.days.length - 1].date : "2026-08-22"
  };
  
  var salesState = {};
  SHOPS.forEach(function (s) {
    var c = ctx(s);
    salesState[s] = {
      from: (c.sales_range && c.sales_range.from) || "2026-06-01",
      to: (c.sales_range && c.sales_range.to) || "2026-08-16"
    };
  });

  var view = "overview", activeShop = SHOPS[0] || "CHAIRUS", shopPage = "dash";

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(v) { return "$" + Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function int(v) { return Number(v || 0).toLocaleString("en-US"); }
  function pct1(v) { return Number(v || 0).toFixed(1) + "%"; }
  function num2(v) { return Number(v || 0).toFixed(2); }

  function filteredDays(c) { return (c.days || []).filter(function (d) { return d.date >= state.from && d.date <= state.to; }); }
  function filteredWeeks(c) { return (c.weeks || []).filter(function (w) { return w.monday >= state.from && w.sunday <= state.to; }); }

  function chart(id) { var el = $(id); return echarts.getInstanceByDom(el) || echarts.init(el); }
  function setOpt(id, opt) { chart(id).setOption(opt, true); }
  var AXIS = { axisLine: { lineStyle: { color: "#cbd5e1" } }, axisLabel: { color: "#64748b" }, splitLine: { lineStyle: { color: "#f1f5f9" } } };
  
  function lbl(moneyLbl, pctLbl, force2) {
    return { show: true, fontSize: 9, formatter: function (v) {
      if (v == null || isNaN(v)) return "";
      if (pctLbl) return Number(v).toFixed(2) + "%";
      if (moneyLbl) return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (force2) return Number(v).toFixed(2);
      return Number(v).toLocaleString("en-US");
    } };
  }

  function makeMarkPoint() {
    return {
      symbolSize: 32,
      label: { fontSize: 8, color: "#fff", offset: [0, -1] },
      data: [
        { type: "max", name: "峰值", itemStyle: { color: "#ef4444" } },
        { type: "min", name: "谷值", itemStyle: { color: "#10b981" } }
      ]
    };
  }

  function makeMarkLine(title) {
    return {
      symbol: ["none", "none"],
      lineStyle: { type: "dashed", color: "#94a3b8", width: 1.5 },
      label: { show: true, position: "end", formatter: (title || "均值") + ": {c}", fontSize: 10, color: "#64748b" },
      data: [{ type: "average", name: title || "平均值" }]
    };
  }

  var COLORS = ["#2563eb", "#10b981", "#ea580c", "#8b5cf6", "#0d9488", "#e11d48", "#ca8a04", "#4f46e5", "#65a30d", "#db2777", "#0284c7", "#9333ea", "#06b6d4", "#84cc16", "#f97316"];

  document.querySelectorAll(".sidebar .item").forEach(function (el) {
    el.addEventListener("click", function () {
      document.querySelectorAll(".sidebar .item").forEach(function (x) { x.classList.remove("active"); });
      document.querySelectorAll(".page").forEach(function (x) { x.classList.remove("active"); });
      el.classList.add("active");
      view = el.dataset.view;
      if (view === "shop") activeShop = el.dataset.shop;
      $("#page-" + view).classList.add("active");
      renderAll();
    });
  });
  
  document.querySelectorAll(".shop-tabs .stab").forEach(function (el) {
    el.addEventListener("click", function () {
      document.querySelectorAll(".shop-tabs .stab").forEach(function (x) { x.classList.remove("active"); });
      el.classList.add("active");
      shopPage = el.dataset.spage;
      renderAll();
    });
  });

  var selMap = {};
  function ensureToggles(containerId, items, onToggle, forceRebuild) {
    var c = $("#" + containerId);
    if (!c) return;
    if (c.dataset.built && !forceRebuild) return;
    c.dataset.built = "1";
    c.innerHTML = "";
    var sel = {};
    items.forEach(function (it) { sel[it] = true; });
    selMap[containerId] = sel;
    var all = document.createElement("label"); all.className = "all";
    all.innerHTML = '<input type="checkbox" checked> 全部';
    all.querySelector("input").addEventListener("change", function () {
      var v = this.checked;
      items.forEach(function (it) { sel[it] = v; });
      c.querySelectorAll("input[data-k]").forEach(function (i) { i.checked = v; });
      onToggle();
    });
    c.appendChild(all);
    items.forEach(function (it) {
      var lb = document.createElement("label");
      lb.innerHTML = '<input type="checkbox" data-k="' + esc(it) + '" checked> ' + esc(it);
      lb.querySelector("input").addEventListener("change", function () {
        sel[it] = this.checked;
        var allChk = c.querySelector("label.all input");
        if (allChk) allChk.checked = items.every(function (x) { return sel[x]; });
        onToggle();
      });
      c.appendChild(lb);
    });
  }

  function getAutoWeeklyRoi(shop, weekObj) {
    if (!weekObj || !weekObj.days || !weekObj.days.length) return null;
    var vals = [];
    weekObj.days.forEach(function (dStr) {
      if (shop === "TOTAL") {
        var sVals = [];
        SHOPS.forEach(function (s) {
          var rv = ROI[s + "|" + dStr];
          if (rv !== undefined && rv !== null && rv !== "") sVals.push(Number(rv));
        });
        if (sVals.length) vals.push(sVals.reduce(function (a, b) { return a + b; }, 0) / sVals.length);
      } else {
        var v = ROI[shop + "|" + dStr];
        if (v !== undefined && v !== null && v !== "") vals.push(Number(v));
      }
    });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function getEffectiveWeeklyRoi(shop, weekObj) {
    var manual = ROI[shop + "|w|" + weekObj.key];
    if (manual !== undefined && manual !== null && manual !== "") return Number(manual);
    return getAutoWeeklyRoi(shop, weekObj);
  }

  function renderKPI(c, kpiId, metaId, extra) {
    var ds = filteredDays(c);
    var gmv = ds.reduce(function (s, d) { return s + d.gmv; }, 0);
    var orders = ds.reduce(function (s, d) { return s + d.orders; }, 0);
    var refund = ds.reduce(function (s, d) { return s + d.refund; }, 0);
    var clicks = ds.reduce(function (s, d) { return s + d.clicks; }, 0);
    var expo = ds.reduce(function (s, d) { return s + d.exposure; }, 0);
    var ac = ds.reduce(function (s, d) { return s + d.add_cart; }, 0);
    var ctr = expo ? clicks / expo * 100 : 0, addr = clicks ? ac / clicks * 100 : 0, ctor = clicks ? orders / clicks * 100 : 0;
    
    var lastD = ds.length ? ds[ds.length - 1] : null;
    var prevD = ds.length > 1 ? ds[ds.length - 2] : null;
    var gmvDiff = (lastD && prevD && prevD.gmv) ? ((lastD.gmv - prevD.gmv) / prevD.gmv * 100) : 0;
    var gmvBadge = (lastD && prevD) ? (gmvDiff >= 0 ? '<span style="color:#10b981;font-weight:700"> ▲ +' + gmvDiff.toFixed(1) + '%</span>' : '<span style="color:#ef4444;font-weight:700"> ▼ ' + gmvDiff.toFixed(1) + '%</span>') : '';

    var cards = [
      { label: "区间 GMV", value: money(gmv), hint: ds.length + " 天 " + gmvBadge },
      { label: "订单数", value: int(orders), hint: "客单价 " + money(orders ? gmv / orders : 0) },
      { label: "点击率 (CTR)", value: pct1(ctr), hint: "点击 " + int(clicks) + " / 曝光 " + int(expo) },
      { label: "加购率", value: pct1(addr), hint: "加购 " + int(ac) },
      { label: "CTOR 转化率", value: pct1(ctor), hint: "订单 " + int(orders) },
      { label: "退款金额", value: money(refund), hint: "退款率 " + pct1(gmv ? refund / gmv * 100 : 0) },
      { label: "日均 GMV", value: money(ds.length ? gmv / ds.length : 0), hint: "最高 " + money(ds.length ? Math.max.apply(null, ds.map(function (x) { return x.gmv; })) : 0) }
    ];
    if (extra === "ov") {
      var last = (DATA.monthly_gmv || []).slice().reverse().find(function (m) { return m.actual > 0; }) || {};
      cards.splice(2, 0, { label: "当前月完成度", value: pct1(last.completion), hint: (last.month || "") + " 实际 " + money(last.actual) + " / 目标 " + money(last.target), cls: (last.completion || 0) < 60 ? "bad" : "" });
    }
    if (extra === "shop") {
      var other = SHOPS.filter(function (s) { return s !== c.name; })[0];
      var oc = ctx(other);
      var totGmv = gmv + filteredDays(oc).reduce(function (s, d) { return s + d.gmv; }, 0);
      cards.push({ label: "占两店 GMV 比", value: pct1(totGmv ? gmv / totGmv * 100 : 0), hint: "另一店 " + other });
    }
    $(kpiId).innerHTML = cards.map(function (c2) {
      return '<div class="card"><div class="label">' + c2.label + '</div><div class="value' + (c2.cls ? '" style="color:var(--danger)' : '') + '">' + c2.value + '</div><div class="hint">' + c2.hint + '</div></div>';
    }).join("");
    if (metaId) $(metaId).textContent = (c.name || "TOTAL") + " · " + state.from + " ~ " + state.to;
  }

  // SKU 周销量
  var catSelectState = {};
  function renderSkuWeek(c, chartId, togglesId, catSelectId) {
    var ws = c.week_sku || { weeks: [], skus: [], series: {}, categories: [], cat_skus: {}, cat_series: {}, all_sku_series: {} };
    var cats = ws.categories || [];
    var catSelEl = $(catSelectId);
    
    if (catSelEl && !catSelEl.dataset.inited) {
      catSelEl.dataset.inited = "1";
      var optHtml = '<option value="__ALL__">全部品类 (Top10 SKU)</option><option value="__CAT_ALL__">【按各大品类总销量对比】</option>';
      cats.forEach(function (cat) {
        optHtml += '<option value="' + esc(cat) + '">' + esc(cat) + ' (' + ((ws.cat_skus && ws.cat_skus[cat]) ? ws.cat_skus[cat].length : 0) + '款产品)</option>';
      });
      catSelEl.innerHTML = optHtml;
      catSelEl.addEventListener("change", function () {
        catSelectState[catSelectId] = this.value;
        renderSkuWeek(c, chartId, togglesId, catSelectId);
      });
    }

    var curCat = (catSelEl && catSelEl.value) || catSelectState[catSelectId] || "__ALL__";
    var displayItems = [];

    if (curCat === "__ALL__") {
      displayItems = (ws.skus || []).slice(0, 10);
    } else if (curCat === "__CAT_ALL__") {
      displayItems = cats.slice(0, 10);
    } else {
      displayItems = (ws.cat_skus && ws.cat_skus[curCat]) ? ws.cat_skus[curCat] : [];
      if (!displayItems.length) displayItems = ["该品类暂无具体SKU"];
    }

    ensureToggles(togglesId, displayItems, function () { renderSkuWeekChart(c, chartId, togglesId, curCat); }, true);
    renderSkuWeekChart(c, chartId, togglesId, curCat);
  }

  function renderSkuWeekChart(c, chartId, togglesId, curCat) {
    var ws = c.week_sku || { weeks: [], skus: [], series: {}, categories: [], cat_skus: {}, cat_series: {}, all_sku_series: {} };
    var sel = selMap[togglesId] || {};
    var series = [];

    if (curCat === "__ALL__") {
      var skus = (ws.skus || []).filter(function (s) { return sel[s]; });
      series = skus.map(function (code, idx) {
        var sdata = (ws.all_sku_series && ws.all_sku_series[code]) ? ws.all_sku_series[code] : (ws.series[code] || []);
        var item = { name: code, type: "line", smooth: true, symbolSize: 6, label: lbl(false, false, false), labelLayout: { hideOverlap: true }, data: sdata.slice() };
        if (idx === 0) item.markPoint = makeMarkPoint();
        return item;
      });
    } else if (curCat === "__CAT_ALL__") {
      var chosenCats = (ws.categories || []).filter(function (cat) { return sel[cat]; });
      series = chosenCats.map(function (cat, idx) {
        var sdata = (ws.cat_series && ws.cat_series[cat]) ? ws.cat_series[cat] : [];
        var item = { name: cat, type: "line", smooth: true, symbolSize: 6, label: lbl(false, false, false), labelLayout: { hideOverlap: true }, data: sdata.slice() };
        if (idx === 0) item.markPoint = makeMarkPoint();
        return item;
      });
    } else {
      var cskus = ((ws.cat_skus && ws.cat_skus[curCat]) || []).filter(function (code) { return sel[code]; });
      series = cskus.map(function (code, idx) {
        var sdata = (ws.all_sku_series && ws.all_sku_series[code]) ? ws.all_sku_series[code] : [];
        var item = { name: code, type: "line", smooth: true, symbolSize: 6, label: lbl(false, false, false), labelLayout: { hideOverlap: true }, data: sdata.slice() };
        if (idx === 0) item.markPoint = makeMarkPoint();
        return item;
      });
    }

    setOpt(chartId, {
      color: COLORS, tooltip: { trigger: "axis" }, legend: { type: "scroll", bottom: 0 },
      grid: { left: 50, right: 16, top: 30, bottom: 46 },
      xAxis: Object.assign({ type: "category", name: "周", data: ws.weeks || [] }, AXIS),
      yAxis: Object.assign({ type: "value", name: "销量（件）" }, AXIS),
      series: series
    });
  }

  // GMV 渠道来源
  var sourceDimState = {};
  function renderSource(c, chartId, togglesId, dimSelectId) {
    var dimEl = $(dimSelectId);
    if (dimEl && !dimEl.dataset.inited) {
      dimEl.dataset.inited = "1";
      dimEl.addEventListener("change", function () {
        sourceDimState[dimSelectId] = this.value;
        renderSource(c, chartId, togglesId, dimSelectId);
      });
    }

    var dim = (dimEl && dimEl.value) || sourceDimState[dimSelectId] || "daily";
    var keys = [["mall", "商城页"], ["video", "商家视频"], ["affil", "达人"], ["card", "商品卡"], ["live", "商家直播"]];
    var all = keys.map(function (k) { return k[1]; });

    ensureToggles(togglesId, all, function () { renderSourceChart(c, chartId, togglesId, dim); });
    renderSourceChart(c, chartId, togglesId, dim);
  }

  function renderSourceChart(c, chartId, togglesId, dim) {
    var keys = [["mall", "商城页"], ["video", "商家视频"], ["affil", "达人"], ["card", "商品卡"], ["live", "商家直播"]];
    var sel = selMap[togglesId] || {};
    var chosen = keys.filter(function (k) { return sel[k[1]]; });

    if (dim === "weekly") {
      var wks = filteredWeeks(c);
      var series = chosen.map(function (k) {
        var arr = wks.map(function (w) {
          var sumVal = 0;
          (w.days || []).forEach(function (dStr) {
            var foundD = (c.days || []).find(function (x) { return x.date === dStr; });
            if (foundD && foundD.sources && foundD.sources[k[0]]) sumVal += foundD.sources[k[0]];
          });
          return Math.round(sumVal);
        });
        return { name: k[1], type: "bar", stack: "total", label: lbl(true, false, false), labelLayout: { hideOverlap: true }, data: arr };
      });
      setOpt(chartId, {
        color: COLORS.slice(0, 5), tooltip: { trigger: "axis" }, legend: { bottom: 0 },
        grid: { left: 60, right: 16, top: 30, bottom: 46 },
        xAxis: Object.assign({ type: "category", name: "周", data: wks.map(function (w) { return w.key; }) }, AXIS),
        yAxis: Object.assign({ type: "value", name: "周 GMV ($)" }, AXIS),
        series: series
      });
    } else {
      var ds = filteredDays(c);
      setOpt(chartId, {
        color: COLORS.slice(0, 5), tooltip: { trigger: "axis" }, legend: { bottom: 0 },
        grid: { left: 60, right: 16, top: 30, bottom: 46 },
        xAxis: Object.assign({ type: "category", data: ds.map(function (d) { return d.label; }) }, AXIS),
        yAxis: Object.assign({ type: "value", name: "GMV ($)" }, AXIS),
        series: chosen.map(function (k) {
          return { name: k[1], type: "line", smooth: true, symbolSize: 5, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, data: ds.map(function (d) { return Math.round(d.sources[k[0]] || 0); }) };
        })
      });
    }
  }

  // 季度 / 年度 GMV 仪表盘
  var currentQuarterSel = "Q3";
  function renderQuarter(chartId) {
    var qs = DATA.quarters || [];
    var ms = DATA.monthly_gmv || [];
    var qSelEl = $("#quarter-ov-sel");
    var targetIn = $("#quarter-target-in");
    var gapHint = $("#quarter-gap-hint");

    if (qSelEl && !qSelEl.dataset.inited) {
      qSelEl.dataset.inited = "1";
      qSelEl.addEventListener("change", function () {
        currentQuarterSel = this.value;
        renderQuarter(chartId);
      });
    }

    if (targetIn && !targetIn.dataset.inited) {
      targetIn.dataset.inited = "1";
      targetIn.addEventListener("input", function () {
        var v = parseFloat(this.value);
        if (!isNaN(v) && v >= 0) {
          TARGET_OVERRIDES[currentQuarterSel] = v;
          lsSet("dash_target_overrides", JSON.stringify(TARGET_OVERRIDES));
          renderQuarter(chartId);
        }
      });
    }

    var qKey = (qSelEl && qSelEl.value) || currentQuarterSel || "Q3";
    var title = qKey + " GMV 完成度";
    var actual = 0, defaultTarget = 0;

    if (qKey === "YEAR") {
      title = "2026 全年 GMV 完成度";
      actual = ms.reduce(function (s, m) { return s + (m.actual || 0); }, 0);
      defaultTarget = ms.reduce(function (s, m) { return s + (m.target || 0); }, 0) || 2200000;
    } else {
      var foundQ = qs.find(function (x) { return x.quarter === qKey; });
      if (foundQ) {
        actual = foundQ.actual;
        defaultTarget = foundQ.target;
      }
    }

    var target = (TARGET_OVERRIDES[qKey] !== undefined && TARGET_OVERRIDES[qKey] !== null) ? TARGET_OVERRIDES[qKey] : defaultTarget;
    if (targetIn && document.activeElement !== targetIn) {
      targetIn.value = target;
    }

    var comp = target ? (actual / target * 100) : 0;
    var gap = target - actual;
    if (gapHint) {
      if (gap > 0) {
        gapHint.innerHTML = '缺口：<span style="color:#ef4444">-$' + Math.round(gap).toLocaleString("en-US") + '</span>';
      } else {
        gapHint.innerHTML = '<span style="color:#10b981">✓ 已超额完成 $' + Math.round(-gap).toLocaleString("en-US") + '</span>';
      }
    }

    setOpt(chartId, {
      graphic: [{
        type: "text", left: "center", top: "82%",
        style: {
          text: "实际 " + money(actual) + " / 目标 " + money(target),
          fill: "#64748b", fontSize: 12, fontWeight: "bold"
        }
      }],
      series: [{
        type: "gauge", startAngle: 180, endAngle: 0, min: 0, max: Math.max(100, Math.ceil(comp / 10) * 10),
        radius: "95%", center: ["50%", "72%"],
        splitNumber: 5,
        axisLine: { lineStyle: { width: 14, color: [[0.6, "#ef4444"], [0.85, "#f59e0b"], [1, "#10b981"]] } },
        pointer: { length: "60%", width: 5, itemStyle: { color: "#1e293b" } },
        axisTick: { distance: -18, length: 5, lineStyle: { color: "#fff", width: 1 } },
        splitLine: { distance: -20, length: 10, lineStyle: { color: "#fff", width: 2 } },
        axisLabel: { color: "#64748b", distance: -20, fontSize: 10, formatter: "{value}%" },
        detail: { valueAnimation: true, offsetCenter: [0, "-15%"], fontSize: 22, fontWeight: "bold", formatter: "{value}%", color: "#0f172a" },
        title: { offsetCenter: [0, "-40%"], fontSize: 13, color: "#64748b" },
        data: [{ value: Number(comp.toFixed(1)), name: title }]
      }]
    });
  }

  function renderVideo(c, chartId) {
    var ws = filteredWeeks(c);
    setOpt(chartId, {
      tooltip: { trigger: "axis" },
      grid: { left: 55, right: 16, top: 24, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: ws.map(function (w) { return w.key; }) }, AXIS),
      yAxis: Object.assign({ type: "value", name: "GMV ($)" }, AXIS),
      series: [{
        name: "商家视频 GMV", type: "bar", barWidth: "40%",
        label: lbl(true, false, false), labelLayout: { hideOverlap: true },
        markPoint: makeMarkPoint(),
        itemStyle: { color: "#10b981" },
        data: ws.map(function (w) { return Math.round(w.video_gmv || 0); })
      }]
    });
  }

  function renderFunnel(c, chartId) {
    var ds = filteredDays(c);
    var expo = ds.reduce(function (s, d) { return s + d.exposure; }, 0);
    var clicks = ds.reduce(function (s, d) { return s + d.clicks; }, 0);
    var cart = ds.reduce(function (s, d) { return s + d.add_cart; }, 0);
    var orders = ds.reduce(function (s, d) { return s + d.orders; }, 0);
    var ctr = expo ? (clicks / expo * 100).toFixed(2) : "0.00";
    var addr = clicks ? (cart / clicks * 100).toFixed(2) : "0.00";
    var ctor = clicks ? (orders / clicks * 100).toFixed(2) : "0.00";

    var data = [
      { value: 100, name: "1. 曝光量 (" + int(expo) + ")" },
      { value: 75, name: "2. 点击率 (" + ctr + "%)" },
      { value: 50, name: "3. 加购率 (" + addr + "%)" },
      { value: 25, name: "4. CTOR (" + ctor + "%)" }
    ];

    setOpt(chartId, {
      tooltip: { trigger: "item", formatter: "{b}" },
      color: ["#2563eb", "#0d9488", "#ea580c", "#10b981"],
      series: [{
        type: "funnel", left: "10%", top: 20, bottom: 20, width: "80%", minSize: "20%", maxSize: "100%",
        sort: "descending", gap: 4,
        label: { show: true, position: "inside", color: "#fff", fontSize: 11, fontWeight: "bold", formatter: "{b}" },
        data: data
      }]
    });
  }

  function renderRoi(shop, chartId) {
    var ds = filteredDays(ctx(shop));
    setOpt(chartId, {
      tooltip: { trigger: "axis" },
      grid: { left: 45, right: 16, top: 24, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: ds.map(function (d) { return d.label; }) }, AXIS),
      yAxis: Object.assign({ type: "value", name: "ROI" }, AXIS),
      series: [{
        name: "ROI", type: "line", smooth: true, symbolSize: 6, connectNulls: false,
        label: lbl(false, false, true), labelLayout: { hideOverlap: true },
        markPoint: makeMarkPoint(), markLine: makeMarkLine("平均ROI"),
        itemStyle: { color: "#ea580c" }, lineStyle: { color: "#ea580c", width: 2 },
        data: ds.map(function (d) { var v = ROI[shop + "|" + d.date]; return (v !== undefined && v !== null && v !== "") ? Number(v) : null; })
      }]
    });
  }

  function renderRoiWeek(shop, chartId) {
    var ws = filteredWeeks(ctx(shop));
    setOpt(chartId, {
      tooltip: { trigger: "axis" },
      grid: { left: 45, right: 16, top: 24, bottom: 28 },
      xAxis: Object.assign({ type: "category", data: ws.map(function (w) { return w.key; }) }, AXIS),
      yAxis: Object.assign({ type: "value", name: "周 ROI" }, AXIS),
      series: [{
        name: "周 ROI (自动聚合)", type: "line", smooth: true, symbolSize: 6, connectNulls: false,
        label: lbl(false, false, true), labelLayout: { hideOverlap: true },
        markPoint: makeMarkPoint(), markLine: makeMarkLine("均值周ROI"),
        itemStyle: { color: "#8b5cf6" }, lineStyle: { color: "#8b5cf6", width: 2 },
        data: ws.map(function (w) { var v = getEffectiveWeeklyRoi(shop, w); return v !== null ? Number(v.toFixed(2)) : null; })
      }]
    });
  }

  function renderRoiWeekOv(chartId) {
    var ws0 = filteredWeeks(ctx("TOTAL"));
    setOpt(chartId, {
      tooltip: { trigger: "axis" }, legend: { bottom: 0 },
      grid: { left: 45, right: 16, top: 24, bottom: 46 },
      xAxis: Object.assign({ type: "category", data: ws0.map(function (w) { return w.key; }) }, AXIS),
      yAxis: Object.assign({ type: "value", name: "周 ROI" }, AXIS),
      series: SHOPS.map(function (s, si) {
        return {
          name: s + " 周ROI", type: "line", smooth: true, symbolSize: 6, connectNulls: false,
          label: lbl(false, false, true), labelLayout: { hideOverlap: true },
          data: ws0.map(function (w) { var v = getEffectiveWeeklyRoi(s, w); return v !== null ? Number(v.toFixed(2)) : null; }),
          lineStyle: { color: ["#2563eb", "#ea580c"][si] }, itemStyle: { color: ["#2563eb", "#ea580c"][si] }
        };
      })
    });
  }

  // GMV 与订单趋势
  var trendState = {};
  function renderTrend(c, chartId, dimSelectId, subSelectId) {
    var dimEl = $(dimSelectId);
    var subEl = $(subSelectId);
    var ws = c.week_sku || { weeks: [], categories: [], skus: [], cat_gmv_series: {}, cat_orders_series: {}, all_sku_gmv_series: {}, all_sku_orders_series: {} };
    
    if (dimEl && !dimEl.dataset.inited) {
      dimEl.dataset.inited = "1";
      dimEl.addEventListener("change", function () {
        trendState[dimSelectId] = this.value;
        updateSubOptions(c, dimSelectId, subSelectId);
        renderTrend(c, chartId, dimSelectId, subSelectId);
      });
    }

    if (subEl && !subEl.dataset.inited) {
      subEl.dataset.inited = "1";
      subEl.addEventListener("change", function () {
        trendState[subSelectId] = this.value;
        renderTrend(c, chartId, dimSelectId, subSelectId);
      });
    }

    updateSubOptions(c, dimSelectId, subSelectId);

    var dim = (dimEl && dimEl.value) || trendState[dimSelectId] || "daily";
    var subVal = (subEl && subEl.value) || trendState[subSelectId];

    if (dim === "daily") {
      var ds = filteredDays(c);
      setOpt(chartId, {
        tooltip: { trigger: "axis" }, legend: { bottom: 0 },
        grid: { left: 60, right: 60, top: 30, bottom: 46 },
        xAxis: Object.assign({ type: "category", data: ds.map(function (d) { return d.label; }) }, AXIS),
        yAxis: [Object.assign({ type: "value", name: "GMV ($)" }, AXIS), Object.assign({ type: "value", name: "订单" }, AXIS)],
        series: [
          { name: "GMV", type: "line", smooth: true, itemStyle: { color: "#2563eb" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, markPoint: makeMarkPoint(), markLine: makeMarkLine("日均GMV"), data: ds.map(function (d) { return Math.round(d.gmv); }) },
          { name: "订单数", type: "bar", yAxisIndex: 1, itemStyle: { color: "#93c5fd" }, data: ds.map(function (d) { return d.orders; }) }
        ]
      });
    } else if (dim === "weekly") {
      var wks = filteredWeeks(c);
      setOpt(chartId, {
        tooltip: { trigger: "axis" }, legend: { bottom: 0 },
        grid: { left: 60, right: 60, top: 30, bottom: 46 },
        xAxis: Object.assign({ type: "category", data: wks.map(function (w) { return w.key; }) }, AXIS),
        yAxis: [Object.assign({ type: "value", name: "周 GMV ($)" }, AXIS), Object.assign({ type: "value", name: "周订单" }, AXIS)],
        series: [
          { name: "周 GMV", type: "line", smooth: true, itemStyle: { color: "#2563eb" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, markPoint: makeMarkPoint(), markLine: makeMarkLine("周均GMV"), data: wks.map(function (w) { return Math.round(w.tot.gmv); }) },
          { name: "周订单数", type: "bar", barWidth: "35%", itemStyle: { color: "#86efac" }, yAxisIndex: 1, data: wks.map(function (w) { return w.tot.orders; }) }
        ]
      });
    } else if (dim === "category") {
      var cat = subVal || (ws.categories && ws.categories[0]) || "";
      var gmvArr = (ws.cat_gmv_series && ws.cat_gmv_series[cat]) ? ws.cat_gmv_series[cat] : [];
      var ordArr = (ws.cat_orders_series && ws.cat_orders_series[cat]) ? ws.cat_orders_series[cat] : [];
      setOpt(chartId, {
        tooltip: { trigger: "axis" }, legend: { bottom: 0 },
        grid: { left: 60, right: 60, top: 30, bottom: 46 },
        xAxis: Object.assign({ type: "category", name: "周", data: ws.weeks || [] }, AXIS),
        yAxis: [Object.assign({ type: "value", name: "品类周GMV ($)" }, AXIS), Object.assign({ type: "value", name: "品类订单" }, AXIS)],
        series: [
          { name: cat + " 周GMV", type: "line", smooth: true, itemStyle: { color: "#ea580c" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, markPoint: makeMarkPoint(), markLine: makeMarkLine("品类均GMV"), data: gmvArr.map(function (v) { return Math.round(v); }) },
          { name: cat + " 订单数", type: "bar", barWidth: "35%", itemStyle: { color: "#c4b5fd" }, yAxisIndex: 1, data: ordArr.slice() }
        ]
      });
    } else if (dim === "product") {
      var sku = subVal || (ws.skus && ws.skus[0]) || "";
      var gmvArr2 = (ws.all_sku_gmv_series && ws.all_sku_gmv_series[sku]) ? ws.all_sku_gmv_series[sku] : [];
      var ordArr2 = (ws.all_sku_orders_series && ws.all_sku_orders_series[sku]) ? ws.all_sku_orders_series[sku] : [];
      setOpt(chartId, {
        tooltip: { trigger: "axis" }, legend: { bottom: 0 },
        grid: { left: 60, right: 60, top: 30, bottom: 46 },
        xAxis: Object.assign({ type: "category", name: "周", data: ws.weeks || [] }, AXIS),
        yAxis: [Object.assign({ type: "value", name: "产品周GMV ($)" }, AXIS), Object.assign({ type: "value", name: "产品订单" }, AXIS)],
        series: [
          { name: sku + " 周GMV", type: "line", smooth: true, itemStyle: { color: "#0d9488" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, markPoint: makeMarkPoint(), markLine: makeMarkLine("单品均GMV"), data: gmvArr2.map(function (v) { return Math.round(v); }) },
          { name: sku + " 订单数", type: "bar", barWidth: "35%", itemStyle: { color: "#fde68a" }, yAxisIndex: 1, data: ordArr2.slice() }
        ]
      });
    }
  }

  function updateSubOptions(c, dimSelectId, subSelectId) {
    var dimEl = $(dimSelectId);
    var subEl = $(subSelectId);
    if (!dimEl || !subEl) return;
    var ws = c.week_sku || {};
    var dim = dimEl.value;
    if (dim === "category") {
      subEl.style.display = "inline-block";
      var cats = ws.categories || [];
      var prevVal = subEl.value || trendState[subSelectId];
      subEl.innerHTML = cats.map(function (k) { return '<option value="' + esc(k) + '"' + (k === prevVal ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join("");
      if (!subEl.value && cats.length) subEl.value = cats[0];
    } else if (dim === "product") {
      subEl.style.display = "inline-block";
      var skus = (ws.all_skus && ws.all_skus.length) ? ws.all_skus : (ws.skus || []);
      var prevVal = subEl.value || trendState[subSelectId];
      subEl.innerHTML = skus.map(function (k) { return '<option value="' + esc(k) + '"' + (k === prevVal ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join("");
      if (!subEl.value && skus.length) subEl.value = skus[0];
    } else {
      subEl.style.display = "none";
    }
  }

  function renderMonthly(chartId) {
    var ms = DATA.monthly_gmv || [];
    setOpt(chartId, {
      tooltip: { trigger: "axis" }, legend: { bottom: 0 },
      grid: { left: 70, right: 50, top: 30, bottom: 46 },
      xAxis: Object.assign({ type: "category", data: ms.map(function (m) { return m.month; }) }, AXIS),
      yAxis: [Object.assign({ type: "value", name: "GMV ($)" }, AXIS), Object.assign({ type: "value", name: "完成度 %", max: 150 }, AXIS)],
      series: [
        { name: "月度目标", type: "bar", barGap: "-100%", barWidth: "55%", z: 1, data: ms.map(function (m) { return Math.round(m.target); }), itemStyle: { color: "#e2e8f0", borderColor: "#94a3b8", borderWidth: 1 } },
        { name: "两店实际GMV", type: "bar", barGap: "-100%", barWidth: "35%", z: 2, data: ms.map(function (m) { return Math.round(m.actual); }), itemStyle: { color: "#2563eb" } },
        { name: "完成度", type: "line", yAxisIndex: 1, data: ms.map(function (m) { return m.completion; }), label: lbl(false, true, false), lineStyle: { color: "#ea580c", width: 2 }, itemStyle: { color: "#ea580c" }, symbolSize: 6 }
      ]
    });
  }

  function filteredOrders(c, shop) {
    var st = salesState[shop];
    return (c.order_rows || []).filter(function (o) { return o.date && o.date >= st.from && o.date <= st.to; });
  }
  function rankRows(rows, key) {
    var agg = {};
    rows.forEach(function (o) { var k = o[key]; if (k) agg[k] = (agg[k] || 0) + o.qty; });
    return Object.keys(agg).map(function (k) { return { name: k, qty: agg[k] }; }).sort(function (a, b) { return b.qty - a.qty; });
  }
  function rankTable(tbl, rows) {
    var total = rows.reduce(function (s, r) { return s + r.qty; }, 0);
    var html = "<tr><th>排名</th><th>名称</th><th>销量</th><th>占比</th></tr>" + rows.map(function (r, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + esc(r.name) + "</td><td>" + int(r.qty) + "</td><td>" + pct1(total ? r.qty / total * 100 : 0) + "</td></tr>";
    }).join("");
    $(tbl).innerHTML = html;
  }
  function renderSales(shop) {
    var c = ctx(shop);
    var rows = filteredOrders(c, shop);
    rankTable("#tbl-sku-shop", rankRows(rows, "code"));
    rankTable("#tbl-cat-shop", rankRows(rows, "category"));
    rankTable("#tbl-channel-shop", rankRows(rows, "channel"));
    $("#shop-meta").textContent = shop + " · 订单 " + int(rows.length) + " 行 / 日期 " + salesState[shop].from + " ~ " + salesState[shop].to + "（已剔除取消/退款）";
  }

  function renderDaily(shop) {
    var c = ctx(shop);
    var rows = filteredDays(c).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var tot = { gmv: 0, orders: 0, qty: 0, exposure: 0, clicks: 0, add_cart: 0, refund: 0 };
    rows.forEach(function (d) { ["gmv", "orders", "qty", "exposure", "clicks", "add_cart", "refund"].forEach(function (k) { tot[k] += d[k]; }); });
    var html = "<tr><th>日期</th><th>GMV</th><th>订单数</th><th>成交件数</th><th>曝光</th><th>点击</th><th>点击率</th><th>自制视频曝光</th><th>自制视频点击</th><th>加购</th><th>加购率</th><th>CTOR</th><th>ROI</th><th>退款金额</th><th>退款率</th></tr>";
    var roiSum = 0, roiN = 0;
    html += rows.map(function (d) {
      var ctr = d.exposure ? d.clicks / d.exposure * 100 : 0, addr = d.clicks ? d.add_cart / d.clicks * 100 : 0, ctor = d.clicks ? d.orders / d.clicks * 100 : 0;
      var rr = d.gmv ? d.refund / d.gmv * 100 : 0;
      var rv = ROI[shop + "|" + d.date];
      if (rv !== undefined && rv !== null && rv !== "") { roiSum += Number(rv); roiN++; }
      return "<tr><td>" + d.label + "</td><td>" + money(d.gmv) + "</td><td>" + int(d.orders) + "</td><td>" + int(d.qty) + "</td><td>" + int(d.exposure) + "</td><td>" + int(d.clicks) + "</td><td>" + pct1(ctr) + "</td><td>" + int(d.video_exposure || 0) + "</td><td>" + int(d.video_clicks || 0) + "</td><td>" + int(d.add_cart) + "</td><td>" + pct1(addr) + "</td><td>" + pct1(ctor) + "</td><td><input type='number' step='0.01' class='roi-in' data-shop='" + shop + "' data-date='" + d.date + "' value='" + (rv !== undefined ? esc(rv) : "") + "' placeholder='填ROI' style='width:80px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;text-align:right'></td><td>" + money(d.refund) + "</td><td>" + pct1(rr) + "</td></tr>";
    }).join("");
    var ctr = tot.exposure ? tot.clicks / tot.exposure * 100 : 0, addr = tot.clicks ? tot.add_cart / tot.clicks * 100 : 0, ctor = tot.clicks ? tot.orders / tot.clicks * 100 : 0;
    var rr = tot.gmv ? tot.refund / tot.gmv * 100 : 0;
    html += '<tr class="tr-total"><td>合计</td><td>' + money(tot.gmv) + '</td><td>' + int(tot.orders) + '</td><td>' + int(tot.qty) + '</td><td>' + int(tot.exposure) + '</td><td>' + int(tot.clicks) + '</td><td>' + pct1(ctr) + '</td><td>' + int(tot.add_cart) + '</td><td>' + pct1(addr) + '</td><td>' + pct1(ctor) + '</td><td>' + (roiN ? num2(roiSum / roiN) : "") + '</td><td>' + money(tot.refund) + '</td><td>' + pct1(rr) + '</td></tr>';
    $("#tbl-daily-shop").innerHTML = html;
    $("#shop-meta").textContent = shop + " · " + rows.length + " 天（" + state.from + " ~ " + state.to + "）";
  }

  function renderWeekly(shop, chartId, togglesId) {
    var c = ctx(shop);
    var rows = filteredWeeks(c);
    var html = "<tr><th>周</th><th>区间</th><th>GMV</th><th>订单数</th><th>成交件数</th><th>曝光</th><th>点击</th><th>自制视频曝光</th><th>自制视频点击</th><th>加购</th><th>点击率</th><th>加购率</th><th>CTOR</th><th>ROI (自动)</th></tr>";
    var tot = { gmv: 0, orders: 0, qty: 0, exposure: 0, clicks: 0, add_cart: 0 };
    var roiSum = 0, roiN = 0;
    html += rows.map(function (w) {
      ["gmv", "orders", "qty", "exposure", "clicks", "add_cart"].forEach(function (k) { tot[k] += w.tot[k]; });
      var ctr = w.tot.exposure ? w.tot.clicks / w.tot.exposure * 100 : 0, addr = w.tot.clicks ? w.tot.add_cart / w.tot.clicks * 100 : 0, ctor = w.tot.clicks ? w.tot.orders / w.tot.clicks * 100 : 0;
      var effRoi = getEffectiveWeeklyRoi(shop, w);
      if (effRoi !== null) { roiSum += effRoi; roiN++; }
      var manual = ROI[shop + "|w|" + w.key];
      return "<tr><td>" + w.key + "</td><td>" + w.monday.slice(5) + "~" + w.sunday.slice(5) + "</td><td>" + money(w.tot.gmv) + "</td><td>" + int(w.tot.orders) + "</td><td>" + int(w.tot.qty) + "</td><td>" + int(w.tot.exposure) + "</td><td>" + int(w.tot.clicks) + "</td><td>" + int(w.tot.add_cart) + "</td><td>" + pct1(ctr) + "</td><td>" + pct1(addr) + "</td><td>" + pct1(ctor) + "</td><td><input type='number' step='0.01' class='roi-in-week' data-shop='" + shop + "' data-week='" + w.key + "' value='" + (manual !== undefined && manual !== null && manual !== "" ? esc(manual) : (effRoi !== null ? effRoi.toFixed(2) : "")) + "' placeholder='自动' style='width:80px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;text-align:right'></td></tr>";
    }).join("");
    var ctr = tot.exposure ? tot.clicks / tot.exposure * 100 : 0, addr = tot.clicks ? tot.add_cart / tot.clicks * 100 : 0, ctor = tot.clicks ? tot.orders / tot.clicks * 100 : 0;
    html += '<tr class="tr-total"><td>合计</td><td></td><td>' + money(tot.gmv) + '</td><td>' + int(tot.orders) + '</td><td>' + int(tot.qty) + '</td><td>' + int(tot.exposure) + '</td><td>' + int(tot.clicks) + '</td><td>' + int(tot.add_cart) + '</td><td>' + pct1(ctr) + '</td><td>' + pct1(addr) + '</td><td>' + pct1(ctor) + '</td><td>' + (roiN ? num2(roiSum / roiN) : "") + '</td></tr>';
    $("#tbl-weekly-shop").innerHTML = html;
    renderSkuWeekGmv(shop, chartId, togglesId);
  }

  function renderSkuWeekGmv(shop, chartId, togglesId) {
    var ws = ctx(shop).week_sku || {};
    var weeks = ws.gmv_weeks || [];
    var dates = ws.gmv_dates || {};
    var filtered = weeks.filter(function (k) { var dd = dates[k]; return dd && dd[0] >= state.from && dd[1] <= state.to; });
    var allSkus = (ws.gmv_skus || []).slice(0, 10);
    ensureToggles(togglesId, allSkus, function () { renderSkuWeekGmv(shop, chartId, togglesId); });
    var sel = selMap[togglesId] || {};
    var skus = allSkus.filter(function (s) { return sel[s]; });
    var idxs = filtered.map(function (k) { return weeks.indexOf(k); });
    setOpt(chartId, {
      color: COLORS, tooltip: { trigger: "axis" }, legend: { type: "scroll", bottom: 0 },
      grid: { left: 60, right: 16, top: 30, bottom: 46 },
      xAxis: Object.assign({ type: "category", name: "周", data: filtered }, AXIS),
      yAxis: Object.assign({ type: "value", name: "GMV ($)" }, AXIS),
      series: skus.map(function (code, idx) {
        var arr = ws.gmv_series[code] || [];
        var item = { name: code, type: "line", smooth: true, symbolSize: 6, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, data: idxs.map(function (i) { return arr[i] || 0; }) };
        if (idx === 0) item.markPoint = makeMarkPoint();
        return item;
      })
    });
  }

  function isMoneyHeader(h) { return /GMV|金额|价格|税费|运费|退款|AOV|客单|交易总额/.test(h); }
  function isRateHeader(h) { return /率|%/.test(h); }
  function fmtCell(h, v) {
    if (v === null || v === undefined || v === "") return "-";
    if (typeof v === "number") {
      if (isRateHeader(h)) return v.toFixed(2) + "%";
      if (isMoneyHeader(h)) return money(v);
      return Math.abs(v - Math.round(v)) < 0.001 ? int(v) : num2(v);
    }
    return esc(v);
  }

  function renderDetail(shop) {
    var shopData = (DETAIL.shops && DETAIL.shops[shop]) || { days: [] };
    var days = shopData.days || [];
    var sel = $("#detail-date-shop");
    if (!sel.dataset.built && days.length) {
      sel.dataset.built = "1";
      sel.innerHTML = days.map(function (d) { return '<option value="' + esc(d.date) + '">' + esc(d.label) + ' (' + esc(d.date) + ')</option>'; }).join("");
      sel.value = days[days.length - 1].date;
    }
    var targetDate = sel.value || (days[days.length - 1] && days[days.length - 1].date);
    var cur = days.find(function (d) { return d.date === targetDate; }) || days[0];
    if (!cur) { $("#tbl-detail-shop").innerHTML = "<tr><td>暂无数据</td></tr>"; return; }
    var headers = cur.headers || [];
    var rows = cur.rows || [];
    var html = "<tr>" + headers.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") + "</tr>";
    html += rows.map(function (r) {
      return "<tr>" + r.map(function (c2, idx) { return "<td>" + fmtCell(headers[idx] || "", c2) + "</td>"; }).join("") + "</tr>";
    }).join("");
    $("#tbl-detail-shop").innerHTML = html;
    $("#shop-meta").textContent = shop + " · " + cur.label + " · 共 " + rows.length + " 个商品";
  }

  function generateWarns(c) {
    var ws = filteredWeeks(c);
    var warns = [];
    var shopPrefix = c.name || "TOTAL";

    ws.forEach(function (w) {
      var gmv = w.tot.gmv || 0;
      var orders = w.tot.orders || 0;
      var exp = w.tot.exposure || 0;
      var clk = w.tot.clicks || 0;
      var ac = w.tot.add_cart || 0;
      var ref = w.tot.refund || 0;

      var ctr = exp ? clk / exp * 100 : 0;
      var addr = clk ? ac / clk * 100 : 0;
      var ctor = clk ? orders / clk * 100 : 0;
      var rr = gmv ? ref / gmv * 100 : 0;

      if (ctr < CONFIG.ctrWarn && exp > 2000) {
        warns.push({ id: shopPrefix + "|wctr|" + w.key, chart: "funnel", chartName: "【转化漏斗】", level: "warn", title: w.key + " 周 点击率偏低 (" + pct1(ctr) + ")", text: "该周总曝光 " + int(exp) + " 次，点击转化率低于阈值 " + CONFIG.ctrWarn + "%，建议优化主图与视频开头。" });
      }
      if (addr < CONFIG.addWarn && clk > 500) {
        warns.push({ id: shopPrefix + "|waddr|" + w.key, chart: "funnel", chartName: "【转化漏斗】", level: "warn", title: w.key + " 周 加购率偏低 (" + pct1(addr) + ")", text: "该周总点击 " + int(clk) + " 次，加购转化不足（低于阈值 " + CONFIG.addWarn + "%），建议检查商品价格与促销券。" });
      }
      if (ctor < CONFIG.ctorWarn && clk > 500) {
        warns.push({ id: shopPrefix + "|wctor|" + w.key, chart: "funnel", chartName: "【转化漏斗】", level: "crit", title: w.key + " 周 CTOR异常偏低 (" + pct1(ctor) + ")", text: "该周点击转化成订单率过低（低于阈值 " + CONFIG.ctorWarn + "%），请排查SKU缺货或运费异常。" });
      }
      if (rr > CONFIG.refundWarn && gmv > 5000) {
        warns.push({ id: shopPrefix + "|wref|" + w.key, chart: "trend", chartName: "【GMV趋势】", level: "crit", title: w.key + " 周 退款率偏高 (" + pct1(rr) + ")", text: "该周累计退款 " + money(ref) + "，退款率高达 " + pct1(rr) + "（高于阈值 " + CONFIG.refundWarn + "%），建议排查退款主力SKU。" });
      }
    });

    for (var j = 1; j < ws.length; j++) {
      var pw = ws[j - 1], cw = ws[j];
      if (pw.tot.gmv > 1000) {
        var wdrop = (pw.tot.gmv - cw.tot.gmv) / pw.tot.gmv * 100;
        if (wdrop >= CONFIG.weekDeclineWarn) {
          warns.push({ id: shopPrefix + "|wdrop|" + cw.key, chart: "skuweek", chartName: "【周销量/周GMV】", level: "crit", title: cw.key + " 周 GMV 环比下滑 " + pct1(wdrop), text: "周 GMV 从 " + money(pw.tot.gmv) + " 下降至 " + money(cw.tot.gmv) + "，请关注核心品类走势。" });
        }
        var wrise = (cw.tot.gmv - pw.tot.gmv) / pw.tot.gmv * 100;
        if (wrise >= CONFIG.dayRiseWarn) {
          warns.push({ id: shopPrefix + "|wrise|" + cw.key, chart: "skuweek", chartName: "【周销量/周GMV】", level: "info", title: cw.key + " 周 GMV 环比增长 " + pct1(wrise), text: "周 GMV 达 " + money(cw.tot.gmv) + "，表现强劲！" });
        }
      }
    }

    return warns;
  }

  function renderInlineAlerts(c, slotPrefix) {
    var allWarns = generateWarns(c);
    var activeWarns = allWarns.filter(function (w) { return !DISMISSED_WARNS[w.id]; });

    ["skuweek", "trend", "funnel"].forEach(function (chartKey) {
      var slotEl = $("#alert-slot-" + chartKey + "-" + slotPrefix);
      if (!slotEl) return;
      var matches = activeWarns.filter(function (w) { return w.chart === chartKey; });
      if (!matches.length) {
        slotEl.innerHTML = "";
        return;
      }
      slotEl.innerHTML = matches.map(function (w) {
        return '<div class="inline-alert ' + w.level + '">' +
               '<div class="alert-body"><div class="alert-title">⚠️ ' + esc(w.title) + '</div><div>' + esc(w.text) + '</div></div>' +
               '<button class="btn-close-alert" data-wid="' + esc(w.id) + '" title="忽略/删除预警">✕</button>' +
               '</div>';
      }).join("");

      slotEl.querySelectorAll(".btn-close-alert").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var wid = this.getAttribute("data-wid");
          if (wid) {
            DISMISSED_WARNS[wid] = true;
            lsSet("dash_dismissed_warns", JSON.stringify(DISMISSED_WARNS));
            renderAll();
          }
        });
      });
    });
  }

  function renderInsights(c, containerId, monthlyPara) {
    var allWarns = generateWarns(c);
    var activeWarns = allWarns.filter(function (w) { return !DISMISSED_WARNS[w.id]; });
    var dismissedCount = allWarns.length - activeWarns.length;

    var html = '<div class="chart-box full" style="margin-top:10px">';
    html += '<div class="chart-header-row">';
    html += '<h3>🛡️ 全局风险监控与诊断中心（当前待处理 ' + activeWarns.length + ' 条' + (dismissedCount > 0 ? '，已忽略 ' + dismissedCount + ' 条' : '') + '）</h3>';
    html += '<div style="display:flex;gap:8px">';
    if (activeWarns.length > 0) {
      html += '<button id="btn-dismiss-all-' + containerId.replace("#","") + '" class="btn-primary" style="background:#475569;padding:5px 12px;font-size:12px">全部标记为已处理</button>';
    }
    if (dismissedCount > 0) {
      html += '<button id="btn-restore-warns-' + containerId.replace("#","") + '" style="padding:5px 12px;font-size:12px;border:1px solid var(--primary);color:var(--primary);border-radius:6px;background:#fff;cursor:pointer;font-weight:600">恢复已删除预警 (' + dismissedCount + ')</button>';
    }
    html += '</div></div>';

    if (!activeWarns.length) {
      html += '<p style="color:var(--success);font-size:13.5px;padding:12px 0;font-weight:500">✓ 当前区间内无未处理的风险预警，各项运营与转化指标平稳。</p>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:8px">';
      activeWarns.slice(0, 16).forEach(function (w) {
        var border = w.level === "crit" ? "#ef4444" : (w.level === "warn" ? "#f59e0b" : "#3b82f6");
        var bg = w.level === "crit" ? "#fef2f2" : (w.level === "warn" ? "#fffbeb" : "#eff6ff");
        var tagBg = w.level === "crit" ? "#fee2e2" : (w.level === "warn" ? "#fef3c7" : "#dbeafe");
        var tagColor = w.level === "crit" ? "#dc2626" : (w.level === "warn" ? "#d97706" : "#2563eb");
        html += '<div style="border-left:4px solid ' + border + ';background:' + bg + ';padding:12px 14px;border-radius:8px;position:relative">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
        html += '<span style="font-size:11px;font-weight:700;background:' + tagBg + ';color:' + tagColor + ';padding:2px 6px;border-radius:4px">' + esc(w.chartName) + '</span>';
        html += '<button class="btn-del-warn" data-wid="' + esc(w.id) + '" title="删除/标记为已处理" style="border:none;background:transparent;color:#94a3b8;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px">✕</button>';
        html += '</div>';
        html += '<div style="font-weight:700;font-size:13.5px;color:#0f172a">' + esc(w.title) + '</div>';
        html += '<div style="font-size:12.5px;color:#475569;margin-top:4px;line-height:1.5">' + esc(w.text) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
    $(containerId).innerHTML = html;

    var containerEl = $(containerId);
    containerEl.querySelectorAll(".btn-del-warn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var wid = this.getAttribute("data-wid");
        if (wid) {
          DISMISSED_WARNS[wid] = true;
          lsSet("dash_dismissed_warns", JSON.stringify(DISMISSED_WARNS));
          renderAll();
        }
      });
    });

    var dismissAllBtn = containerEl.querySelector("#btn-dismiss-all-" + containerId.replace("#",""));
    if (dismissAllBtn) {
      dismissAllBtn.addEventListener("click", function () {
        activeWarns.forEach(function (w) { DISMISSED_WARNS[w.id] = true; });
        lsSet("dash_dismissed_warns", JSON.stringify(DISMISSED_WARNS));
        renderAll();
      });
    }

    var restoreBtn = containerEl.querySelector("#btn-restore-warns-" + containerId.replace("#",""));
    if (restoreBtn) {
      restoreBtn.addEventListener("click", function () {
        DISMISSED_WARNS = {};
        lsSet("dash_dismissed_warns", JSON.stringify(DISMISSED_WARNS));
        renderAll();
      });
    }
  }

  function aggDays(c) {
    var ds = filteredDays(c);
    var gmv = ds.reduce(function (s, d) { return s + d.gmv; }, 0);
    var orders = ds.reduce(function (s, d) { return s + d.orders; }, 0);
    var clicks = ds.reduce(function (s, d) { return s + d.clicks; }, 0);
    var expo = ds.reduce(function (s, d) { return s + d.exposure; }, 0);
    var ac = ds.reduce(function (s, d) { return s + d.add_cart; }, 0);
    var refund = ds.reduce(function (s, d) { return s + d.refund; }, 0);
    var video = ds.reduce(function (s, d) { return s + (d.sources.video || 0); }, 0);
    var mall = ds.reduce(function (s, d) { return s + (d.sources.mall || 0); }, 0);
    var affil = ds.reduce(function (s, d) { return s + (d.sources.affil || 0); }, 0);
    var card = ds.reduce(function (s, d) { return s + (d.sources.card || 0); }, 0);
    return { gmv: gmv, orders: orders, clicks: clicks, expo: expo, ac: ac, refund: refund, video: video, mall: mall, affil: affil, card: card, days: ds.length };
  }

  function renderCompare() {
    var c1 = ctx("CHAIRUS"), c2 = ctx("PLUS");
    var a1 = aggDays(c1), a2 = aggDays(c2);
    var totGmv = a1.gmv + a2.gmv;
    var totOrd = a1.orders + a2.orders;
    var totRef = a1.refund + a2.refund;
    var ctr1 = a1.expo ? a1.clicks / a1.expo * 100 : 0, ctr2 = a2.expo ? a2.clicks / a2.expo * 100 : 0;
    var add1 = a1.clicks ? a1.ac / a1.clicks * 100 : 0, add2 = a2.clicks ? a2.ac / a2.clicks * 100 : 0;
    var ctor1 = a1.clicks ? a1.orders / a1.clicks * 100 : 0, ctor2 = a2.clicks ? a2.orders / a2.clicks * 100 : 0;
    var ref1 = a1.gmv ? a1.refund / a1.gmv * 100 : 0, ref2 = a2.gmv ? a2.refund / a2.gmv * 100 : 0;
    var aov1 = a1.orders ? a1.gmv / a1.orders : 0, aov2 = a2.orders ? a2.gmv / a2.orders : 0;
    var davg1 = a1.days ? a1.gmv / a1.days : 0, davg2 = a2.days ? a2.gmv / a2.days : 0;

    var metrics = [
      { name: "区间 GMV", v1: money(a1.gmv), v2: money(a2.gmv), tot: money(totGmv), winner: a1.gmv >= a2.gmv ? "CHAIRUS" : "PLUS" },
      { name: "GMV 贡献占比", v1: pct1(totGmv ? a1.gmv / totGmv * 100 : 0), v2: pct1(totGmv ? a2.gmv / totGmv * 100 : 0), tot: "100.0%", winner: a1.gmv >= a2.gmv ? "CHAIRUS" : "PLUS" },
      { name: "日均 GMV", v1: money(davg1), v2: money(davg2), tot: money(a1.days ? totGmv / a1.days : 0), winner: davg1 >= davg2 ? "CHAIRUS" : "PLUS" },
      { name: "订单数", v1: int(a1.orders), v2: int(a2.orders), tot: int(totOrd), winner: a1.orders >= a2.orders ? "CHAIRUS" : "PLUS" },
      { name: "订单占比", v1: pct1(totOrd ? a1.orders / totOrd * 100 : 0), v2: pct1(totOrd ? a2.orders / totOrd * 100 : 0), tot: "100.0%", winner: a1.orders >= a2.orders ? "CHAIRUS" : "PLUS" },
      { name: "客单价 (AOV)", v1: money(aov1), v2: money(aov2), tot: money(totOrd ? totGmv / totOrd : 0), winner: aov1 >= aov2 ? "CHAIRUS" : "PLUS" },
      { name: "曝光量", v1: int(a1.expo), v2: int(a2.expo), tot: int(a1.expo + a2.expo), winner: a1.expo >= a2.expo ? "CHAIRUS" : "PLUS" },
      { name: "点击量", v1: int(a1.clicks), v2: int(a2.clicks), tot: int(a1.clicks + a2.clicks), winner: a1.clicks >= a2.clicks ? "CHAIRUS" : "PLUS" },
      { name: "点击率 (CTR)", v1: pct1(ctr1), v2: pct1(ctr2), tot: pct1((a1.expo + a2.expo) ? (a1.clicks + a2.clicks) / (a1.expo + a2.expo) * 100 : 0), winner: ctr1 >= ctr2 ? "CHAIRUS" : "PLUS" },
      { name: "加购量", v1: int(a1.ac), v2: int(a2.ac), tot: int(a1.ac + a2.ac), winner: a1.ac >= a2.ac ? "CHAIRUS" : "PLUS" },
      { name: "加购率", v1: pct1(add1), v2: pct1(add2), tot: pct1((a1.clicks + a2.clicks) ? (a1.ac + a2.ac) / (a1.clicks + a2.clicks) * 100 : 0), winner: add1 >= add2 ? "CHAIRUS" : "PLUS" },
      { name: "CTOR 转化率", v1: pct1(ctor1), v2: pct1(ctor2), tot: pct1((a1.clicks + a2.clicks) ? totOrd / (a1.clicks + a2.clicks) * 100 : 0), winner: ctor1 >= ctor2 ? "CHAIRUS" : "PLUS" },
      { name: "商家视频 GMV", v1: money(a1.video), v2: money(a2.video), tot: money(a1.video + a2.video), winner: a1.video >= a2.video ? "CHAIRUS" : "PLUS" },
      { name: "商城页 GMV", v1: money(a1.mall), v2: money(a2.mall), tot: money(a1.mall + a2.mall), winner: a1.mall >= a2.mall ? "CHAIRUS" : "PLUS" },
      { name: "达人推广 GMV", v1: money(a1.affil), v2: money(a2.affil), tot: money(a1.affil + a2.affil), winner: a1.affil >= a2.affil ? "CHAIRUS" : "PLUS" },
    ];

    var html = '<thead><tr><th style="width:20%">对比指标</th><th style="width:22%;color:#2563eb">CHAIRUS</th><th style="width:22%;color:#ea580c">CHAIRUS PLUS</th><th style="width:20%;background:#f8fafc">两店合计 / 平均</th><th style="width:16%">优势方</th></tr></thead><tbody>';
    html += metrics.map(function (m) {
      return '<tr><td style="font-weight:700">' + esc(m.name) + '</td><td>' + m.v1 + '</td><td>' + m.v2 + '</td><td style="background:#fafafa;font-weight:700">' + m.tot + '</td><td style="color:' + (m.winner.indexOf("CHAIRUS") >= 0 ? "#2563eb" : "#ea580c") + ';font-weight:700">' + m.winner + '</td></tr>';
    }).join("");
    html += '</tbody>';
    $("#tbl-compare").innerHTML = html;
    $("#cmp-meta").textContent = "两店对比 · " + state.from + " ~ " + state.to;

    var w1 = filteredWeeks(c1), w2 = filteredWeeks(c2);
    var allWeekKeys = Array.from(new Set(w1.map(function (w) { return w.key; }).concat(w2.map(function (w) { return w.key; })))).sort();
    var wmap1 = {}, wmap2 = {};
    w1.forEach(function (w) { wmap1[w.key] = w.tot.gmv; });
    w2.forEach(function (w) { wmap2[w.key] = w.tot.gmv; });
    setOpt("#ch-cmp-week", {
      tooltip: { trigger: "axis" }, legend: { bottom: 0 },
      grid: { left: 60, right: 16, top: 30, bottom: 46 },
      xAxis: Object.assign({ type: "category", data: allWeekKeys }, AXIS),
      yAxis: Object.assign({ type: "value", name: "GMV ($)" }, AXIS),
      series: [
        { name: "CHAIRUS", type: "bar", itemStyle: { color: "#2563eb" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, data: allWeekKeys.map(function (k) { return Math.round(wmap1[k] || 0); }) },
        { name: "CHAIRUS PLUS", type: "bar", itemStyle: { color: "#ea580c" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, data: allWeekKeys.map(function (k) { return Math.round(wmap2[k] || 0); }) }
      ]
    });

    setOpt("#ch-cmp-kpi", {
      tooltip: { trigger: "axis" }, legend: { bottom: 0 },
      radar: {
        indicator: [
          { name: "CTR 点击率", max: Math.max(ctr1, ctr2, 5) * 1.2 },
          { name: "加购率", max: Math.max(add1, add2, 8) * 1.2 },
          { name: "CTOR 转化率", max: Math.max(ctor1, ctor2, 1) * 1.2 },
          { name: "客单价/10", max: Math.max(aov1, aov2, 200) / 10 * 1.2 },
          { name: "日均GMV/100", max: Math.max(davg1, davg2, 2000) / 100 * 1.2 }
        ],
        radius: "65%"
      },
      series: [{
        type: "radar",
        data: [
          { value: [num2(ctr1), num2(add1), num2(ctor1), num2(aov1 / 10), num2(davg1 / 100)], name: "CHAIRUS", itemStyle: { color: "#2563eb" }, areaStyle: { color: "rgba(37,99,235,0.2)" } },
          { value: [num2(ctr2), num2(add2), num2(ctor2), num2(aov2 / 10), num2(davg2 / 100)], name: "CHAIRUS PLUS", itemStyle: { color: "#ea580c" }, areaStyle: { color: "rgba(234,88,12,0.2)" } }
        ]
      }]
    });

    var r1 = c1.sales_rank_sku || [], r2 = c2.sales_rank_sku || [];
    var skuSet = new Set();
    r1.slice(0, 8).forEach(function (r) { skuSet.add(r.name); });
    r2.slice(0, 8).forEach(function (r) { skuSet.add(r.name); });
    var cmpSkus = Array.from(skuSet);
    var skumap1 = {}, skumap2 = {};
    r1.forEach(function (r) { skumap1[r.name] = r.qty; });
    r2.forEach(function (r) { skumap2[r.name] = r.qty; });
    setOpt("#ch-cmp-sku", {
      tooltip: { trigger: "axis" }, legend: { bottom: 0 },
      grid: { left: 80, right: 20, top: 20, bottom: 46 },
      xAxis: Object.assign({ type: "value", name: "销量（件）" }, AXIS),
      yAxis: Object.assign({ type: "category", data: cmpSkus }, AXIS),
      series: [
        { name: "CHAIRUS", type: "bar", itemStyle: { color: "#2563eb" }, label: lbl(false, false, false), labelLayout: { hideOverlap: true }, data: cmpSkus.map(function (k) { return skumap1[k] || 0; }) },
        { name: "CHAIRUS PLUS", type: "bar", itemStyle: { color: "#ea580c" }, label: lbl(false, false, false), labelLayout: { hideOverlap: true }, data: cmpSkus.map(function (k) { return skumap2[k] || 0; }) }
      ]
    });

    var t10_1 = r1.slice(0, 10).reverse();
    setOpt("#ch-t10-chairus", {
      tooltip: { trigger: "axis" },
      grid: { left: 85, right: 30, top: 20, bottom: 25 },
      xAxis: Object.assign({ type: "value" }, AXIS),
      yAxis: Object.assign({ type: "category", data: t10_1.map(function (x) { return x.name; }) }, AXIS),
      series: [{ name: "销量", type: "bar", itemStyle: { color: "#2563eb" }, label: lbl(false, false, false), data: t10_1.map(function (x) { return x.qty; }) }]
    });

    var t10_2 = r2.slice(0, 10).reverse();
    setOpt("#ch-t10-plus", {
      tooltip: { trigger: "axis" },
      grid: { left: 85, right: 30, top: 20, bottom: 25 },
      xAxis: Object.assign({ type: "value" }, AXIS),
      yAxis: Object.assign({ type: "category", data: t10_2.map(function (x) { return x.name; }) }, AXIS),
      series: [{ name: "销量", type: "bar", itemStyle: { color: "#ea580c" }, label: lbl(false, false, false), data: t10_2.map(function (x) { return x.qty; }) }]
    });

    var ds1 = filteredDays(c1), ds2 = filteredDays(c2);
    var dkeys = Array.from(new Set(ds1.map(function (d) { return d.date; }).concat(ds2.map(function (d) { return d.date; })))).sort();
    var dmap1 = {}, dmap2 = {};
    ds1.forEach(function (d) { dmap1[d.date] = d.gmv; });
    ds2.forEach(function (d) { dmap2[d.date] = d.gmv; });
    setOpt("#ch-cmp-day", {
      tooltip: { trigger: "axis" }, legend: { bottom: 0 },
      grid: { left: 60, right: 16, top: 30, bottom: 46 },
      xAxis: Object.assign({ type: "category", data: dkeys.map(function (k) { return k.slice(5); }) }, AXIS),
      yAxis: Object.assign({ type: "value", name: "GMV ($)" }, AXIS),
      series: [
        { name: "CHAIRUS", type: "line", smooth: true, itemStyle: { color: "#2563eb" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, data: dkeys.map(function (k) { return Math.round(dmap1[k] || 0); }) },
        { name: "CHAIRUS PLUS", type: "line", smooth: true, itemStyle: { color: "#ea580c" }, label: lbl(true, false, false), labelLayout: { hideOverlap: true }, data: dkeys.map(function (k) { return Math.round(dmap2[k] || 0); }) }
      ]
    });
  }

  function renderConfig() {
    var f = $("#config-fields");
    var map = [
      ["ctrWarn", "点击率预警阈值 (%)", CONFIG.ctrWarn],
      ["addWarn", "加购率预警阈值 (%)", CONFIG.addWarn],
      ["ctorWarn", "CTOR预警阈值 (%)", CONFIG.ctorWarn],
      ["refundWarn", "退款率预警阈值 (%)", CONFIG.refundWarn],
      ["dayDropWarn", "日GMV跌幅预警 (%)", CONFIG.dayDropWarn],
      ["dayRiseWarn", "日GMV爆发提示 (%)", CONFIG.dayRiseWarn],
      ["weekDeclineWarn", "周GMV环比预警 (%)", CONFIG.weekDeclineWarn],
      ["minWeekGmv", "周维度有效GMV下限 ($)", CONFIG.minWeekGmv]
    ];
    f.innerHTML = map.map(function (m) {
      return '<label style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px"><span>' + m[1] + '</span><input type="number" step="0.1" id="cfg-' + m[0] + '" value="' + m[2] + '" style="width:100px;padding:6px 10px;border:1px solid var(--line);border-radius:6px;text-align:right"></label>';
    }).join("");
    var pass = lsGet("dash_pass", "tiktok2026");
    var pi = $("#cfg-pass"); if (pi) pi.value = pass;

    var btnExp = $("#btn-export-roi");
    if (btnExp && !btnExp.dataset.inited) {
      btnExp.dataset.inited = "1";
      btnExp.addEventListener("click", function () {
        var jsonStr = JSON.stringify(ROI, null, 2);
        var blob = new Blob([jsonStr], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        var nowStr = new Date().toISOString().slice(0, 10);
        a.href = url; a.download = "TikTok_ROI_备份_" + nowStr + ".json";
        a.click();
        URL.revokeObjectURL(url);
        $("#roi-sync-status").textContent = "✓ 导出成功！";
        setTimeout(function () { $("#roi-sync-status").textContent = ""; }, 3000);
      });
    }

    var fileImp = $("#file-import-roi");
    if (fileImp && !fileImp.dataset.inited) {
      fileImp.dataset.inited = "1";
      fileImp.addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (evt) {
          try {
            var imported = JSON.parse(evt.target.result);
            Object.assign(ROI, imported);
            lsSet("dash_roi", JSON.stringify(ROI));
            $("#roi-sync-status").textContent = "✓ 成功恢复 " + Object.keys(imported).length + " 条 ROI 数据！";
            renderAll();
            setTimeout(function () { $("#roi-sync-status").textContent = ""; }, 3500);
          } catch (err) {
            alert("文件格式不正确，请上传有效的 JSON 备份文件！");
          }
        };
        reader.readAsText(file);
      });
    }
  }

  function saveConfig() {
    Object.keys(DEFAULT_CONFIG).forEach(function (k) {
      var el = $("#cfg-" + k);
      if (el) CONFIG[k] = parseFloat(el.value) || DEFAULT_CONFIG[k];
    });
    lsSet("dash_config", JSON.stringify(CONFIG));
    var pi = $("#cfg-pass");
    if (pi && pi.value.trim()) lsSet("dash_pass", pi.value.trim());
    $("#cfg-msg").textContent = "✓ 配置已保存生效！";
    setTimeout(function () { $("#cfg-msg").textContent = ""; }, 2500);
  }

  function resetConfig() {
    CONFIG = Object.assign({}, DEFAULT_CONFIG);
    lsSet("dash_config", JSON.stringify(CONFIG));
    lsSet("dash_pass", "tiktok2026");
    renderConfig();
    $("#cfg-msg").textContent = "✓ 已恢复默认设置！";
    setTimeout(function () { $("#cfg-msg").textContent = ""; }, 2500);
  }

  function renderOverview() {
    var T = ctx("TOTAL");
    renderKPI(T, "#kpi-ov", "#ov-meta", "ov");
    renderInlineAlerts(T, "ov");
    renderSkuWeek(T, "#ch-skuweek-ov", "skuweek-ov-toggles", "#skuweek-ov-cat");
    renderSource(T, "#ch-source-ov", "source-ov-toggles", "#source-ov-dim");
    renderQuarter("#ch-quarter-ov");
    renderVideo(T, "#ch-video-ov");
    renderRoiWeekOv("#ch-roi-week-ov");
    renderFunnel(T, "#ch-funnel-ov");
    renderTrend(T, "#ch-trend-ov", "#trend-ov-dim", "#trend-ov-sub");
    renderMonthly("#ch-monthly-ov");
    renderInsights(T, "#insights-ov", true);
  }

  function renderShop() {
    var c = ctx(activeShop);
    $("#shop-title").textContent = activeShop + " 店铺";
    ["dash", "sales", "daily", "weekly", "detail", "risk"].forEach(function (p) {
      $("#sp-" + p).style.display = (p === shopPage) ? "" : "none";
    });
    if (shopPage === "dash") {
      renderKPI(c, "#kpi-shop", "#shop-meta", "shop");
      renderInlineAlerts(c, "shop");
      renderSkuWeek(c, "#ch-skuweek-shop", "skuweek-shop-toggles", "#skuweek-shop-cat");
      renderSource(c, "#ch-source-shop", "source-shop-toggles", "#source-shop-dim");
      renderVideo(c, "#ch-video-shop");
      renderRoiWeek(activeShop, "#ch-roi-week-shop");
      renderFunnel(c, "#ch-funnel-shop");
      renderRoi(activeShop, "#ch-roi-shop");
      renderTrend(c, "#ch-trend-shop", "#trend-shop-dim", "#trend-shop-sub");
    } else if (shopPage === "sales") renderSales(activeShop);
    else if (shopPage === "daily") renderDaily(activeShop);
    else if (shopPage === "weekly") renderWeekly(activeShop, "#ch-skuweekgmv-shop", "skuweekgmv-shop-toggles");
    else if (shopPage === "detail") renderDetail(activeShop);
    else if (shopPage === "risk") { renderInsights(c, "#insights-shop", false); $("#shop-meta").textContent = activeShop + " · 风险分析（规则预警 + 诊断）"; }
  }

  function renderAll() {
    if (view === "overview") renderOverview();
    else if (view === "compare") renderCompare();
    else if (view === "shop") renderShop();
    else if (view === "config") renderConfig();
  }

  $("#f-from").value = state.from; $("#f-to").value = state.to;
  $("#f-apply").addEventListener("click", function () {
    state.from = $("#f-from").value || state.from; state.to = $("#f-to").value || state.to;
    if (state.from > state.to) { var t = state.from; state.from = state.to; state.to = t; }
    renderAll();
  });
  $("#s-apply").addEventListener("click", function () {
    var st = salesState[activeShop];
    st.from = $("#s-from").value || st.from; st.to = $("#s-to").value || st.to;
    if (st.from > st.to) { var t = st.from; st.from = st.to; st.to = t; }
    renderSales(activeShop);
  });
  $("#detail-date-shop").addEventListener("change", function () { renderDetail(activeShop); });
  $("#cfg-save").addEventListener("click", saveConfig);
  $("#cfg-reset").addEventListener("click", resetConfig);

  $("#tbl-weekly-shop").addEventListener("input", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("roi-in-week")) {
      var key = e.target.getAttribute("data-shop") + "|w|" + e.target.getAttribute("data-week");
      ROI[key] = e.target.value;
      lsSet("dash_roi", JSON.stringify(ROI));
    }
  });

  $("#tbl-daily-shop").addEventListener("input", function (e) {
    if (e.target && e.target.classList && e.target.classList.contains("roi-in")) {
      var key = e.target.getAttribute("data-shop") + "|" + e.target.getAttribute("data-date");
      ROI[key] = e.target.value;
      lsSet("dash_roi", JSON.stringify(ROI));
    }
  });

  window.addEventListener("resize", function () { document.querySelectorAll(".chart").forEach(function (el) { var i = echarts.getInstanceByDom(el); if (i) i.resize(); }); });
  window.__afterUnlock = function () { renderAll(); };
  if (checkGate()) renderAll();
})();
