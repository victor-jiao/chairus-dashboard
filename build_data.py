# -*- coding: utf-8 -*-
"""TikTok 数据看板 - 双店铺数据管道：Excel -> data.json / data.js / detail-data.js"""
import os, re, json, datetime
import openpyxl

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- 路径统一从 配置/paths.json 读取（找不到就用内置默认值，保证单文件也能跑）----
def _load_cfg():
    p = os.path.abspath(os.path.join(OUT_DIR, "..", "配置", "paths.json"))
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

_CFG = _load_cfg()

_DEFAULT_SHOPS = [
    ("CHAIRUS", r"C:\Users\Admin\Downloads\易得客下载目录\Tiktok-Chairus-焦文浩"),
    ("PLUS", r"C:\Users\Admin\Downloads\易得客下载目录\Tiktok-ChairusPlus-焦文浩"),
    ("HOME", r"C:\Users\Admin\Downloads\易得客下载目录\ChairusHome子账号-焦文浩"),
]
SHOP_DIRS = list(_CFG.get("店铺", {}).items()) or _DEFAULT_SHOPS

_GMV_CANDS = _CFG.get("月度目标候选路径") or [
    r"C:\Users\Admin\Downloads\月度GMV完成度.xlsx",
    r"C:\Users\Admin\Desktop\月度GMV完成度.xlsx",
    r"D:\codex-钉钉\月度GMV完成度.xlsx",
]
GMV_PATH = next((p for p in _GMV_CANDS if os.path.exists(p)), _GMV_CANDS[0])
DEFAULT_GMV_PATH = os.path.abspath(os.path.join(OUT_DIR, "..", "月度GMV完成度_提取.json"))

def num(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip()
    if s == "" or s.lower() in ("-", "n/a"): return 0.0
    s = s.replace("$", "").replace(",", "").replace("¥", "").replace(" ", "").replace("USD", "")
    try: return float(s)
    except Exception: return 0.0

def date_from_daily_name(fn):
    m = re.search(r"(\d+)月(\d+)日", fn)
    if m: return datetime.date(2026, int(m.group(1)), int(m.group(2)))
    m2 = re.match(r"product_list_(\d{4})(\d{2})(\d{2})", fn)
    if m2: return datetime.date(int(m2.group(1)), int(m2.group(2)), int(m2.group(3)))
    return None

def sku_extract(sku):
    s = str(sku).strip()
    for pre in ("TKYJ-", "TKJN-"):
        if s.startswith(pre):
            s = s[len(pre):]; break
    if not s: return ""
    if s[0] == "A":
        m = re.match(r"^A[A-Za-z]{3,6}", s)
        if m:
            n = len(m.group(0))
            if n == 4: return s[3:10] if len(s) >= 10 else s[3:]
            if n >= 5: return s[4:10] if len(s) >= 10 else s[4:]
    return s

def month_first_monday(M):
    d1 = datetime.date(2026, M, 1)
    mon = d1 - datetime.timedelta(days=d1.weekday())
    inM = sum(1 for i in range(7) if (mon + datetime.timedelta(days=i)).month == M)
    if inM < 4: mon = mon + datetime.timedelta(days=7)
    return mon

def week_of_date(d):
    mon = d - datetime.timedelta(days=d.weekday())
    sunday = mon + datetime.timedelta(days=6)
    cnt = {}
    for i in range(7):
        m = (mon + datetime.timedelta(days=i)).month
        cnt[m] = cnt.get(m, 0) + 1
    owner = max(cnt, key=lambda m: cnt[m])
    fmon = month_first_monday(owner)
    wn = (mon - fmon).days // 7 + 1
    return owner, wn, mon, sunday

def find_latest_product_info(shop_path):
    candidates = []
    for f in os.listdir(shop_path):
        if not f.endswith(".xlsx") or f.startswith("~$"): continue
        if "商品信息" in f:
            full = os.path.join(shop_path, f)
            m = re.search(r"(\d+)\.(\d+)", f)
            score = int(m.group(1)) * 100 + int(m.group(2)) if m else 0
            mtime = os.path.getmtime(full)
            candidates.append((score, mtime, full))
    if not candidates:
        return os.path.join(shop_path, "商品信息.xlsx")
    candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return candidates[0][2]

def load_product_map(path):
    """商品ID -> {category, skus[], code}
    一个商品常有多个 SKU（变体），这里全部收集；款号 code 取「出现次数最多的 sku_extract 结果」，
    这样同一商品的多变体会并成一条，而 8684 / 8684AB 这种真不同款仍然是两个 code。
    """
    pm = {}
    if not os.path.exists(path): return pm
    wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    ws = wb["Template"] if "Template" in wb.sheetnames else wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    hdr_idx, hdr = None, None
    for i, r in enumerate(rows):
        vals = [str(x).strip() if x is not None else "" for x in r]
        if "商品 ID" in vals:
            hdr_idx, hdr = i, vals
            break
    if hdr is None: return pm
    def col(name):
        for j, h in enumerate(hdr):
            if h == name: return j
        return None
    i_pid, i_cat, i_sku = col("商品 ID"), col("类目"), col("商家 SKU")
    if i_pid is None: return pm
    for r in rows[hdr_idx + 3:]:
        if r[i_pid] is None: continue
        pid_s = str(r[i_pid]).strip()
        if not pid_s or not pid_s.isdigit(): continue
        cat_s = str(r[i_cat]).strip() if i_cat is not None and r[i_cat] is not None else ""
        clean = re.sub(r"\s*\(\d+\)\s*$", "", cat_s).strip()
        sku_s = str(r[i_sku]).strip() if i_sku is not None and r[i_sku] is not None else ""
        e = pm.setdefault(pid_s, {"category": "", "category_raw": "", "skus": []})
        if clean and not e["category"]:
            e["category"] = clean
            e["category_raw"] = cat_s
        if sku_s and sku_s not in e["skus"]:
            e["skus"].append(sku_s)
    wb.close()

    # 每个商品算「主款号」+ 全部款号集合
    for pid, e in pm.items():
        codes = [sku_extract(s) for s in e["skus"]]
        codes = [c for c in codes if c]
        cnt = {}
        for c in codes: cnt[c] = cnt.get(c, 0) + 1
        order = sorted(cnt.items(), key=lambda kv: (-kv[1], -len(kv[0])))
        e["code"] = order[0][0] if order else ""
        e["code_all"] = [c for c, _ in order]
        e["multi_model"] = len(order) > 1
        e["sku"] = e["skus"][0] if e["skus"] else ""
    return pm

# ---------------------------------------------------------------------------
# 表头按名取值
#   不再依赖固定列号：先定位表头行，再用「分组带 + 字段名」精确匹配。
#   易得客以后换模板、插列、挪列、加指标，只要字段名还在，就能自动命中。
# ---------------------------------------------------------------------------
VALUE_FIELDS = ("gmv", "live", "video", "affil", "card", "mall", "orders", "qty",
                "customers", "exposure", "clicks", "add_cart",
                "refund", "refund_qty", "mall_exposure", "mall_clicks")


def _norm(s):
    s = str(s or "").strip()
    for a, b in ((" ", ""), ("\u3000", ""), ("（", "("), ("）", ")"),
                 ("～", "~"), ("－", "-"), ("—", "-"), ("–", "-")):
        s = s.replace(a, b)
    return s


def build_colmap(ws):
    """定位表头：同时含『GMV』和『商品 ID』的那一行；它的上一行是分组带（全部/商家直播…）。
    返回 (列信息列表, 表头行号 1-based)。找不到返回 ([], None)。"""
    head = [(i, r) for i, r in enumerate(ws.iter_rows(max_row=15, values_only=True), start=1)]
    hdr_row = None
    for i, r in head:
        vals = set(_norm(c) for c in r)
        if "GMV" in vals and "商品ID" in vals:
            hdr_row = i
            break
    if hdr_row is None:
        return [], None
    band_vals = next((r for i, r in head if i == hdr_row - 1), None)
    hdr_vals = next(r for i, r in head if i == hdr_row)
    n = max(len(hdr_vals), len(band_vals) if band_vals is not None else 0)
    cols = []
    for i in range(n):
        band_raw = (str(band_vals[i]).strip()
                    if band_vals is not None and i < len(band_vals) and band_vals[i] is not None else "")
        name_raw = str(hdr_vals[i]).strip() if i < len(hdr_vals) and hdr_vals[i] is not None else ""
        cols.append({"i": i, "band": _norm(band_raw), "name": _norm(name_raw),
                     "full_raw": (band_raw + name_raw) if band_raw else name_raw})
    return cols, hdr_row


def _find(cols, band, name):
    for c in cols:
        if c["band"] == band and c["name"] == name:
            return c["i"]
    if band != "全部":
        for c in cols:
            if c["band"] == "全部" and c["name"] == name:
                return c["i"]
    return None


def resolve_daily(cols):
    """业务字段 -> 列号列表（可能是复合字段，例如新模板的达人归因=达人直播+达人视频）。
    返回 (字段->[列号], 缺失字段列表)。"""
    out, missing = {}, []

    def one(key, *cands):
        for band, name in cands:
            i = _find(cols, band, name)
            if i is not None:
                out[key] = [i]
                return True
        missing.append(key)
        return False

    one("gmv", ("全部", "GMV"))
    one("live", ("全部", "商家直播归因GMV"))
    one("video", ("全部", "商家视频归因GMV"))
    one("orders", ("全部", "订单数"))
    one("qty", ("全部", "商品成交件数"))
    one("customers", ("全部", "预计客户数"))
    one("exposure", ("全部", "商品曝光次数"))
    one("clicks", ("全部", "商品点击量"))
    one("add_cart", ("全部", "加购次数"))
    one("refund", ("全部", "退款金额"))
    one("refund_qty", ("全部", "已退款的商品件数"))
    one("mall_exposure", ("全部", "商城页商品曝光次数"), ("商城页和搜索", "商品曝光次数"))
    one("mall_clicks", ("全部", "商城页商品点击量"), ("商城页和搜索", "商品点击量"))

    # 达人联盟 GMV：老模板有合计列；新模板拆成 达人直播归因 + 联盟视频归因
    i = _find(cols, "全部", "达人归因GMV")
    if i is not None:
        out["affil"] = [i]
    else:
        parts = [p for p in (_find(cols, "全部", "达人直播归因GMV"),
                             _find(cols, "全部", "联盟视频归因GMV")) if p is not None]
        if parts:
            out["affil"] = parts
        else:
            missing.append("affil")

    # 商家商品卡 GMV：新模板整列取消，缺则记 0（口径变化见更新说明）
    i = _find(cols, "全部", "商家商品卡GMV")
    out["card"] = [i] if i is not None else []

    # 商城页：老模板『商城页 GMV』；新模板并入『商城页和搜索归因 GMV』
    i = _find(cols, "全部", "商城页GMV")
    if i is None:
        i = _find(cols, "全部", "商城页和搜索归因GMV")
    if i is not None:
        out["mall"] = [i]
    else:
        missing.append("mall")
    return out, missing


def detail_canonical(ws):
    """明细表『标准列』：从 GMV 列起，剔除直播类/含税/税费/去重。
    用最早一天（老模板）算一次，全期沿用 —— 保证 6~11 月明细表头形状完全一致。"""
    cols, _ = build_colmap(ws)
    if not cols:
        return []
    gmv_i = _find(cols, "全部", "GMV")
    if gmv_i is None:
        gmv_i = 0
    out = []
    for c in cols:
        if c["i"] < gmv_i:
            continue
        full_raw, band, name = c["full_raw"], c["band"], c["name"]
        if not full_raw:
            continue
        if "直播" in band or "直播" in name:
            continue
        norm = _norm(full_raw)
        if "含税GMV" in norm or "税费" in norm or "去重" in norm:
            continue
        out.append((band, name, full_raw))
    return out


def match_canonical(cols, canonical):
    """把标准列映射到当前文件的真实列号；当前模板没有该列时给 None（取值按 0 处理）。"""
    pools = {}
    for c in cols:
        pools.setdefault((c["band"], c["name"]), []).append(c["i"])
    out = []
    for band, name, _full in canonical:
        pool = pools.get((band, name), [])
        out.append(pool.pop(0) if pool else None)
    return out

def fmt_detail_val(v):
    if v is None: return 0
    if isinstance(v, (int, float)): return v
    s = str(v).strip()
    if s == "": return 0
    if s.endswith("%"):
        try: return round(float(s[:-1].replace(",", "")), 4)
        except Exception: return 0
    if re.match(r"^[\d,.]+$", s):
        try: return float(s.replace(",", ""))
        except Exception: return s
    if "$" in s:
        try: return round(float(s.replace("$", "").replace(",", "")), 2)
        except Exception: return s
    return s

def parse_order_time(v):
    if v is None: return None
    s = str(v).strip()
    for f in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try: return datetime.datetime.strptime(s, f).date()
        except Exception: pass
    return None

def load_orders(path):
    wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    hdr = [str(c).strip() if c is not None else "" for c in rows[0]]
    def idx(name):
        for i, h in enumerate(hdr):
            if h.lower() == name.lower(): return i
        return None
    i_status, i_cancel = idx("Order Status"), idx("Cancelation/Return Type")
    i_sku, i_qty, i_cat, i_channel, i_time = idx("Seller SKU"), idx("Quantity"), idx("Product Category"), idx("Order Channel"), idx("Created Time")
    i_gmv = idx("SKU Subtotal After Discount")
    out = []
    for r in rows[2:]:
        if i_sku is None or r[i_sku] is None: continue
        status = str(r[i_status]).strip() if i_status is not None and r[i_status] else ""
        cancel = str(r[i_cancel]).strip() if i_cancel is not None and r[i_cancel] else ""
        if cancel: continue
        if any(k in status for k in ("取消", "退货", "退款", "Cancel", "Return", "Refund")): continue
        out.append({
            "date": parse_order_time(r[i_time]).isoformat() if (i_time is not None and parse_order_time(r[i_time])) else None,
            "sku": str(r[i_sku]).strip(), "qty": int(num(r[i_qty])),
            "gmv": round(num(r[i_gmv]), 2) if i_gmv is not None else 0.0,
            "code": sku_extract(str(r[i_sku]).strip()),
            "category": str(r[i_cat]).strip() if i_cat is not None and r[i_cat] else "",
            "channel": str(r[i_channel]).strip() if i_channel is not None and r[i_channel] else "",
        })
    return out

def process_shop(name, path):
    pm = load_product_map(find_latest_product_info(path))
    daily_files = []
    for fn in os.listdir(path):
        if not fn.endswith(".xlsx") or fn.startswith("~$") or "视频" in fn: continue
        if "订单" in fn: continue
        d = date_from_daily_name(fn)
        if d: daily_files.append((d, os.path.join(path, fn)))
    daily_files.sort(key=lambda x: x[0])

    # 明细标准列：用最早一天（老模板）算一次，全期沿用，保证 6~11 月表头形状一致
    canonical = []
    try:
        _wb0 = openpyxl.load_workbook(daily_files[0][1], data_only=True)
        canonical = detail_canonical(_wb0.worksheets[0])
        _wb0.close()
    except Exception as e:
        print(f"[{name}] 计算标准明细列失败: {e}")

    days, day_cat = [], {}
    detail_days = []
    unresolved = {}
    # 销量改为「按商品」从日宽表直接汇总（不依赖订单表）
    #   spu_qty[款号] / spu_gmv / spu_orders  —— 全期累计
    #   week_spu[周][款号] = {qty, orders, gmv} —— 周维度
    #   cat_qty / cat_gmv —— 按品类
    spu_qty, spu_gmv, spu_orders = {}, {}, {}
    cat_qty, cat_gmv = {}, {}
    week_spu = {}
    multi_model_pids = []
    for d, fp in daily_files:
        wb = openpyxl.load_workbook(fp, data_only=True, read_only=False)
        ws = wb.worksheets[0]
        cols, hdr_row = build_colmap(ws)
        if not cols:
            print(f"[{name}] {os.path.basename(fp)}: 找不到表头，已跳过")
            wb.close()
            continue
        fields, missing = resolve_daily(cols)
        if missing:
            unresolved[os.path.basename(fp)] = missing
        canon_idx = match_canonical(cols, canonical)
        headers = ["品类"] + [f for _, _, f in canonical]
        raw = [r for r in ws.iter_rows(min_row=hdr_row + 1, values_only=True)
               if len(r) > 1 and (r[1] is not None or r[0] is not None)]
        rows = []
        tot = {k: 0.0 for k in VALUE_FIELDS}
        cat_agg = {}
        ds = d.strftime("%Y-%m-%d")
        _om, _wn, _, _ = week_of_date(d)
        wk_key = f"{_om}-{_wn}"
        for r in raw:
            if len(r) < 30: continue
            pid = str(r[1]).strip() if r[1] is not None else ""
            if not pid: continue
            info = pm.get(pid)
            code = info["code"] if info and info.get("code") else ""
            cat = info["category"] if info else "未分类"
            g = {k: sum(num(r[i]) for i in v if i < len(r)) for k, v in fields.items()}
            for k in tot: tot[k] += g.get(k, 0.0)
            ca = cat_agg.setdefault(cat, {k: 0.0 for k in ("gmv","orders","qty","exposure","clicks","add_cart","refund")})
            for k in ca: ca[k] += g.get(k, 0.0)

            # 按款号累计（同一商品多变体并成一条；不同款号不合并）
            if code:
                spu_qty[code] = spu_qty.get(code, 0.0) + g.get("qty", 0.0)
                spu_gmv[code] = round(spu_gmv.get(code, 0.0) + g.get("gmv", 0.0), 2)
                spu_orders[code] = spu_orders.get(code, 0) + int(g.get("orders", 0))
                wm = week_spu.setdefault(wk_key, {}).setdefault(
                    code, {"qty": 0.0, "orders": 0, "gmv": 0.0})
                wm["qty"] += g.get("qty", 0.0)
                wm["orders"] += int(g.get("orders", 0))
                wm["gmv"] = round(wm["gmv"] + g.get("gmv", 0.0), 2)
                cat_qty[cat] = cat_qty.get(cat, 0.0) + g.get("qty", 0.0)
                cat_gmv[cat] = round(cat_gmv.get(cat, 0.0) + g.get("gmv", 0.0), 2)
                if info.get("multi_model") and pid not in multi_model_pids:
                    multi_model_pids.append(pid)

            if not code: continue
            row = [code] + [fmt_detail_val(r[i] if i is not None and i < len(r) else None) for i in canon_idx]
            rows.append(row)
        days.append({
            "date": ds, "label": f"{d.month}月{d.day}日",
            "gmv": round(tot["gmv"], 2),
            "sources": {"mall": round(tot["mall"],2), "video": round(tot["video"],2),
                        "affil": round(tot["affil"],2), "card": round(tot["card"],2),
                        "live": round(tot["live"],2)},
            "orders": int(tot["orders"]), "qty": int(tot["qty"]), "customers": int(tot["customers"]),
            "exposure": int(tot["exposure"]), "clicks": int(tot["clicks"]), "add_cart": int(tot["add_cart"]),
            "refund": round(tot["refund"],2), "refund_qty": int(tot["refund_qty"]),
            "categories": sorted(cat_agg.keys()),
        })
        for cat, m in cat_agg.items():
            day_cat[(ds, cat)] = m
        detail_days.append({"date": ds, "label": f"{d.month}月{d.day}日", "headers": headers, "rows": rows})
        wb.close()

    if unresolved:
        print(f"[{name}] 有 {len(unresolved)} 个文件的字段没匹配到（按 0 处理）:")
        for fn, miss in list(unresolved.items())[:10]:
            print(f"    {fn}: {','.join(miss)}")

    # 读取自制视频数据
    self_video_map = {}
    self_video_file = os.path.join(path, "6.22-8.16自制视频.xlsx")
    if os.path.exists(self_video_file):
        try:
            vwb = openpyxl.load_workbook(self_video_file, data_only=True, read_only=False)
            vws = vwb.worksheets[0]
            for vrow in vws.iter_rows(min_row=4, values_only=True):
                if not vrow or vrow[0] is None: continue
                vdate_str = str(vrow[0]).strip()
                if not vdate_str or vdate_str == "nan": continue
                vexp = int(num(vrow[11])) if len(vrow) > 11 else 0
                vclk = int(num(vrow[12])) if len(vrow) > 12 else 0
                self_video_map[vdate_str] = {"exposure": vexp, "clicks": vclk}
            vwb.close()
        except Exception as ve:
            print("Self video load error:", ve)

    for x in days:
        sv = self_video_map.get(x["date"], {"exposure": 0, "clicks": 0})
        x["video_exposure"] = sv["exposure"]
        x["video_clicks"] = sv["clicks"]

    week_map = {}
    for x in days:
        d = datetime.date.fromisoformat(x["date"])
        om, wn, mon, sun = week_of_date(d)
        key = f"{om}-{wn}"
        wk = week_map.setdefault(key, {"key": key, "month": om, "week": wn,
            "monday": mon.strftime("%Y-%m-%d"), "sunday": sun.strftime("%Y-%m-%d"),
            "days": [], "tot": {k: 0.0 for k in ("gmv","orders","qty","exposure","clicks","add_cart","refund","video_exposure","video_clicks")},
            "cat": {}, "video_gmv": 0.0})
        wk["days"].append(x["date"])
        for k in wk["tot"]:
            wk["tot"][k] += x.get(k, 0.0) if k in ("gmv","refund") else float(x.get(k, 0))
        wk["video_gmv"] = round(wk.get("video_gmv", 0.0) + x["sources"]["video"], 2)
        for cat in x["categories"]:
            cm = day_cat.get((x["date"], cat))
            if cm is None: continue
            cc = wk["cat"].setdefault(cat, {"gmv":0.0,"orders":0,"qty":0,"exposure":0,"clicks":0,"add_cart":0})
            for k in cc: cc[k] += cm[k]
    weeks = sorted([w for w in week_map.values() if len(w["days"]) == 7], key=lambda w: (w["month"], w["week"]))

    # ---- 订单表：只保留「渠道销量」和订单明细，不再用于销量榜 ----
    order_files = [os.path.join(path, fn) for fn in os.listdir(path) if fn.endswith(".xlsx") and "订单" in fn]
    order_rows = []
    for p in order_files:
        order_rows.extend(load_orders(p))

    channel_qty = {}
    for o in order_rows:
        if o["channel"]:
            channel_qty[o["channel"]] = channel_qty.get(o["channel"], 0) + o["qty"]

    # ---- 销量榜：全部来自日宽表，按款号（商品）汇总 ----
    sku_qty = {k: round(v, 2) for k, v in spu_qty.items()}
    sku_gmv = dict(spu_gmv)
    sku_cat_map, cat_sku_map = {}, {}
    for pid, info in pm.items():
        code = info.get("code")
        if not code: continue
        cat = info.get("category") or "未分类"
        sku_cat_map[code] = cat
        cat_sku_map.setdefault(cat, set()).add(code)

    # 周维度：各款号 & 各品类的周销量 / 周 GMV / 周订单数
    week_sku, week_sku_gmv, week_sku_orders = {}, {}, {}
    week_cat_qty, week_cat_gmv, week_cat_orders = {}, {}, {}
    week_info = {}
    for wk in weeks:
        key = wk["key"]
        week_info[key] = {"monday": wk["monday"], "sunday": wk["sunday"]}
    for key, codes in week_spu.items():
        for code, m in codes.items():
            week_sku.setdefault(key, {})[code] = round(m["qty"], 2)
            week_sku_gmv.setdefault(key, {})[code] = m["gmv"]
            week_sku_orders.setdefault(key, {})[code] = m["orders"]
            cat = sku_cat_map.get(code, "未分类")
            week_cat_qty.setdefault(key, {})[cat] = round(
                week_cat_qty.setdefault(key, {}).get(cat, 0.0) + m["qty"], 2)
            week_cat_gmv.setdefault(key, {})[cat] = round(
                week_cat_gmv.setdefault(key, {}).get(cat, 0.0) + m["gmv"], 2)
            week_cat_orders.setdefault(key, {})[cat] = week_cat_orders.setdefault(key, {}).get(cat, 0) + m["orders"]

    sorted_weeks = sorted(week_info.keys())
    top_skus = [k for k, _ in sorted(sku_qty.items(), key=lambda x: x[1], reverse=True)[:10]]
    top_gmv_skus = [k for k, _ in sorted(sku_gmv.items(), key=lambda x: x[1], reverse=True)[:10]]
    sorted_cats = [k for k, _ in sorted(cat_qty.items(), key=lambda x: x[1], reverse=True)]

    # 构建结构化的品类下 SKU 列表（按销量排）
    cat_skus_dict = {}
    for c in sorted_cats:
        c_skus = list(cat_sku_map.get(c, []))
        c_skus.sort(key=lambda x: sku_qty.get(x, 0), reverse=True)
        cat_skus_dict[c] = c_skus

    all_skus = list(sku_qty.keys())
    all_sku_series = {code: [week_sku.get(w, {}).get(code, 0) for w in sorted_weeks] for code in all_skus}
    all_sku_gmv_series = {code: [week_sku_gmv.get(w, {}).get(code, 0.0) for w in sorted_weeks] for code in all_skus}
    all_sku_orders_series = {code: [week_sku_orders.get(w, {}).get(code, 0) for w in sorted_weeks] for code in all_skus}

    cat_series = {c: [week_cat_qty.get(w, {}).get(c, 0) for w in sorted_weeks] for c in sorted_cats}
    cat_gmv_series = {c: [week_cat_gmv.get(w, {}).get(c, 0.0) for w in sorted_weeks] for c in sorted_cats}
    cat_orders_series = {c: [week_cat_orders.get(w, {}).get(c, 0) for w in sorted_weeks] for c in sorted_cats}

    week_sku_data = {
        "weeks": sorted_weeks,
        "week_dates": week_info,
        "skus": top_skus,
        "series": {code: all_sku_series[code] for code in top_skus},
        "all_skus": all_skus,
        "all_sku_series": all_sku_series,
        "all_sku_gmv_series": all_sku_gmv_series,
        "all_sku_orders_series": all_sku_orders_series,
        "categories": sorted_cats,
        "cat_skus": cat_skus_dict,
        "cat_series": cat_series,
        "cat_gmv_series": cat_gmv_series,
        "cat_orders_series": cat_orders_series,
        "sku_cat_map": sku_cat_map,
        "gmv_weeks": sorted_weeks,
        "gmv_dates": {k: [v["monday"], v["sunday"]] for k, v in week_info.items()},
        "gmv_skus": top_gmv_skus,
        "gmv_series": {code: all_sku_gmv_series[code] for code in top_gmv_skus},
    }

    # 销量现在来自日宽表，销量区间就用日宽表的范围（订单表不再是销量来源）
    sales_dates = {x["date"] for x in days}
    return {
        "name": name,
        "range": {"from": days[0]["date"] if days else "", "to": days[-1]["date"] if days else ""},
        "sales_range": {"from": min(sales_dates) if sales_dates else "", "to": max(sales_dates) if sales_dates else ""},
        "days": days, "weeks": weeks,
        "sales_rank_sku": sorted([{"name": k, "qty": v} for k, v in sku_qty.items()], key=lambda x: x["qty"], reverse=True),
        "sales_rank_category": sorted([{"name": k, "qty": v} for k, v in cat_qty.items()], key=lambda x: x["qty"], reverse=True),
        "sales_rank_channel": sorted([{"name": k, "qty": v} for k, v in channel_qty.items()], key=lambda x: x["qty"], reverse=True),
        "order_rows": order_rows,
        "week_sku": week_sku_data,
        "funnel": {"exposure": sum(int(x["exposure"]) for x in days), "clicks": sum(int(x["clicks"]) for x in days),
                   "add_cart": sum(int(x["add_cart"]) for x in days), "orders": sum(int(x["orders"]) for x in days),
                   "qty": sum(int(x["qty"]) for x in days)},
        "detail_days": detail_days,
        "insights": [],
    }

def merge_total(shops):
    dmap = {}
    for s in shops:
        for d in s["days"]:
            t = dmap.setdefault(d["date"], {"date": d["date"], "label": d["label"], "sources": {k: 0.0 for k in ("mall","video","affil","card","live")},
                "orders": 0, "qty": 0, "customers": 0, "exposure": 0, "clicks": 0, "add_cart": 0,
                "refund": 0.0, "refund_qty": 0, "video_exposure": 0, "video_clicks": 0, "categories": set()})
            t["gmv"] = round(t.get("gmv", 0.0) + d["gmv"], 2)
            for k in t["sources"]: t["sources"][k] = round(t["sources"][k] + d["sources"][k], 2)
            t["orders"] += d["orders"]; t["qty"] += d["qty"]; t["customers"] += d["customers"]
            t["exposure"] += d["exposure"]; t["clicks"] += d["clicks"]; t["add_cart"] += d["add_cart"]; t["video_exposure"] += d.get("video_exposure", 0); t["video_clicks"] += d.get("video_clicks", 0)
            t["refund"] = round(t["refund"] + d["refund"], 2); t["refund_qty"] += d["refund_qty"]
            t["categories"].update(d["categories"])
    days = []
    for k in sorted(dmap):
        x = dmap[k]; x["categories"] = sorted(x["categories"]); days.append(x)

    # 总览周维度取【并集】：HOME 等店铺没更新时，合计的周数据不能被截断在个别店铺的最后一周
    all_keys = set()
    for s in shops:
        all_keys.update(w["key"] for w in s["weeks"])
    common = all_keys
    wmap = {}
    for s in shops:
        for w in s["weeks"]:
            if w["key"] not in common: continue
            t = wmap.setdefault(w["key"], {"key": w["key"], "month": w["month"], "week": w["week"],
                "monday": w["monday"], "sunday": w["sunday"], "days": w["days"][:],
                "tot": {k: 0.0 for k in ("gmv","orders","qty","exposure","clicks","add_cart","refund","video_exposure","video_clicks")}, "cat": {}, "video_gmv": 0.0})
            for k in t["tot"]: t["tot"][k] += w["tot"][k]
            t["video_gmv"] = round(t["video_gmv"] + w["video_gmv"], 2)
            for c, m in w["cat"].items():
                cc = t["cat"].setdefault(c, {"gmv":0.0,"orders":0,"qty":0,"exposure":0,"clicks":0,"add_cart":0})
                for k in cc: cc[k] += m[k]
    # 按 (月, 周序号) 排序，不能按字符串排 —— 否则 '10-1' 会排到 '6-1' 前面
    weeks = [wmap[k] for k in sorted(wmap, key=lambda k: (wmap[k]["month"], wmap[k]["week"]))]

    def merge_rank(shops, key, with_shop=False):
        """with_shop=True 时保留店铺维度（跨店同款不合并，便于两店对比）"""
        agg = {}
        for s in shops:
            for r in s[key]:
                nm = f"{r['name']}（{s['name']}）" if with_shop else r["name"]
                agg[nm] = agg.get(nm, 0) + r["qty"]
        return sorted([{"name": k, "qty": v} for k, v in agg.items()], key=lambda x: x["qty"], reverse=True)

    all_weeks_set = set()
    week_info = {}
    for s in shops:
        ws = s["week_sku"]
        all_weeks_set.update(ws["weeks"])
        for k, v in ws.get("week_dates", {}).items():
            week_info.setdefault(k, v)
    def _wk_key(k):
        m = week_info.get(k) or {}
        return (str(m.get("monday", "")), k)
    sorted_weeks = sorted(all_weeks_set, key=_wk_key)

    sku_tot_qty = {}
    sku_tot_gmv = {}
    cat_tot_qty = {}
    cat_tot_gmv = {}
    sku_cat_map = {}
    cat_sku_map = {}

    all_sku_series = {}
    all_sku_gmv_series = {}
    all_sku_orders_series = {}

    all_skus_set = set()
    for s in shops:
        all_skus_set.update(s["week_sku"].get("all_skus", []))
        for k, v in s["week_sku"].get("sku_cat_map", {}).items():
            sku_cat_map.setdefault(k, v)

    for code in all_skus_set:
        q_list = [0] * len(sorted_weeks)
        g_list = [0.0] * len(sorted_weeks)
        o_list = [0] * len(sorted_weeks)
        for s in shops:
            ws = s["week_sku"]
            w_idx_map = {w: i for i, w in enumerate(ws["weeks"])}
            sq = ws.get("all_sku_series", {}).get(code)
            sg = ws.get("all_sku_gmv_series", {}).get(code)
            so = ws.get("all_sku_orders_series", {}).get(code)
            for i, w in enumerate(sorted_weeks):
                if w in w_idx_map:
                    idx = w_idx_map[w]
                    if sq and idx < len(sq): q_list[i] += sq[idx]
                    if sg and idx < len(sg): g_list[i] = round(g_list[i] + sg[idx], 2)
                    if so and idx < len(so): o_list[i] += so[idx]
        all_sku_series[code] = q_list
        all_sku_gmv_series[code] = g_list
        all_sku_orders_series[code] = o_list
        sku_tot_qty[code] = sum(q_list)
        sku_tot_gmv[code] = round(sum(g_list), 2)
        cat = sku_cat_map.get(code, "未分类")
        cat_sku_map.setdefault(cat, set()).add(code)

    all_cats_set = set()
    for s in shops:
        all_cats_set.update(s["week_sku"].get("categories", []))

    cat_series = {}
    cat_gmv_series = {}
    cat_orders_series = {}
    for c in all_cats_set:
        q_list = [0] * len(sorted_weeks)
        g_list = [0.0] * len(sorted_weeks)
        o_list = [0] * len(sorted_weeks)
        for s in shops:
            ws = s["week_sku"]
            w_idx_map = {w: i for i, w in enumerate(ws["weeks"])}
            cq = ws.get("cat_series", {}).get(c)
            cg = ws.get("cat_gmv_series", {}).get(c)
            co = ws.get("cat_orders_series", {}).get(c)
            for i, w in enumerate(sorted_weeks):
                if w in w_idx_map:
                    idx = w_idx_map[w]
                    if cq and idx < len(cq): q_list[i] += cq[idx]
                    if cg and idx < len(cg): g_list[i] = round(g_list[i] + cg[idx], 2)
                    if co and idx < len(co): o_list[i] += co[idx]
        cat_series[c] = q_list
        cat_gmv_series[c] = g_list
        cat_orders_series[c] = o_list
        cat_tot_qty[c] = sum(q_list)
        cat_tot_gmv[c] = round(sum(g_list), 2)

    sorted_cats = sorted(all_cats_set, key=lambda c: cat_tot_qty.get(c, 0), reverse=True)
    top_skus = [k for k, _ in sorted(sku_tot_qty.items(), key=lambda x: x[1], reverse=True)[:10]]
    top_gmv_skus = [k for k, _ in sorted(sku_tot_gmv.items(), key=lambda x: x[1], reverse=True)[:10]]

    cat_skus_dict = {}
    for c in sorted_cats:
        c_skus = list(cat_sku_map.get(c, []))
        c_skus.sort(key=lambda x: sku_tot_qty.get(x, 0), reverse=True)
        cat_skus_dict[c] = c_skus

    week_sku_data = {
        "weeks": sorted_weeks,
        "week_dates": week_info,
        "skus": top_skus,
        "series": {code: all_sku_series[code] for code in top_skus},
        "all_skus": list(all_skus_set),
        "all_sku_series": all_sku_series,
        "all_sku_gmv_series": all_sku_gmv_series,
        "all_sku_orders_series": all_sku_orders_series,
        "categories": sorted_cats,
        "cat_skus": cat_skus_dict,
        "cat_series": cat_series,
        "cat_gmv_series": cat_gmv_series,
        "cat_orders_series": cat_orders_series,
        "sku_cat_map": sku_cat_map,
        "gmv_weeks": sorted_weeks,
        "gmv_dates": {k: [v.get("monday",""), v.get("sunday","")] for k, v in week_info.items()},
        "gmv_skus": top_gmv_skus,
        "gmv_series": {code: all_sku_gmv_series[code] for code in top_gmv_skus},
    }

    funnel = {"exposure": 0, "clicks": 0, "add_cart": 0, "orders": 0, "qty": 0}
    for s in shops:
        for k in funnel: funnel[k] += s["funnel"][k]
    sales_dates = set()
    for s in shops:
        sales_dates.update({d["date"] for d in s["days"]})

    return {
        "name": "TOTAL", "range": {"from": days[0]["date"] if days else "", "to": days[-1]["date"] if days else ""},
        "sales_range": {"from": min(sales_dates) if sales_dates else "", "to": max(sales_dates) if sales_dates else ""},
        "days": days, "weeks": weeks,
        "sales_rank_sku": merge_rank(shops, "sales_rank_sku", with_shop=True),
        "sales_rank_category": merge_rank(shops, "sales_rank_category"),
        "sales_rank_channel": merge_rank(shops, "sales_rank_channel"),
        "order_rows": [o for s in shops for o in s["order_rows"]],
        "week_sku": week_sku_data,
        "funnel": funnel,
        "insights": [],
    }

def load_monthly_targets(path):
    monthly = []
    possible_paths = [
        path,
        r"C:\Users\Admin\Desktop\月度GMV完成度.xlsx",
        r"D:\codex-钉钉\月度GMV完成度.xlsx",
        r"C:\Users\Admin\Downloads\易得客下载目录\月度GMV完成度.xlsx"
    ]
    target_file = None
    for p in possible_paths:
        if os.path.exists(p):
            target_file = p
            break
            
    if target_file:
        try:
            wb = openpyxl.load_workbook(target_file, data_only=True, read_only=False)
            ws = wb.worksheets[0]
            for r in ws.iter_rows(min_row=2, values_only=True):
                if r[0] is None: continue
                actual, target = num(r[1]), num(r[2])
                monthly.append({"month": str(r[0]).strip(), "actual": actual, "target": target,
                                "completion": round(actual / target * 100, 1) if target else 0})
            wb.close()
        except Exception as e:
            print("Error loading GMV targets excel:", e)
            
    if not monthly:
        # Fallback preset targets
        targets = [
            ("1月", 0, 50000), ("2月", 0, 50000), ("3月", 0, 60000),
            ("4月", 0, 80000), ("5月", 0, 100000), ("6月", 0, 150000),
            ("7月", 0, 180000), ("8月", 0, 200000), ("9月", 0, 220000),
            ("10月", 0, 250000), ("11月", 0, 300000), ("12月", 0, 350000)
        ]
        monthly = [{"month": m, "actual": a, "target": t, "completion": 0} for m, a, t in targets]
    return monthly

def compute_monthly_and_quarters(total, base_monthly):
    # 计算所有店铺各月的每日 GMV 实际求和
    month_sums = {}
    for d in total.get("days", []):
        m_num = int(d["date"].split("-")[1])
        m_key = f"{m_num}月"
        month_sums[m_key] = round(month_sums.get(m_key, 0.0) + d["gmv"], 2)
    
    monthly = []
    for m in base_monthly:
        m_key = m["month"]
        # 如果两店每日数据里有该月的实际 GMV，以所有店铺实际每日 GMV 之和为准
        actual = month_sums[m_key] if m_key in month_sums else m["actual"]
        target = m["target"]
        comp = round(actual / target * 100, 1) if target else 0
        monthly.append({"month": m_key, "actual": round(actual, 2), "target": round(target, 2), "completion": comp})

    quarters = []
    q_map = [("Q1", ["1月", "2月", "3月"]), ("Q2", ["4月", "5月", "6月"]), ("Q3", ["7月", "8月", "9月"]), ("Q4", ["10月", "11月", "12月"])]
    for qname, q_months in q_map:
        ms = [m for m in monthly if m["month"] in q_months]
        actual = sum(m["actual"] for m in ms)
        target = sum(m["target"] for m in ms)
        quarters.append({"quarter": qname, "actual": round(actual, 2), "target": round(target, 2),
                         "completion": round(actual / target * 100, 1) if target else 0, "months": [m["month"] for m in ms]})
    return monthly, quarters

def main():
    shops = [process_shop(n, p) for n, p in SHOP_DIRS]
    total = merge_total(shops)
    base_monthly = load_monthly_targets(GMV_PATH)
    monthly, quarters = compute_monthly_and_quarters(total, base_monthly)
    for s in shops:
        print(s["name"], "days", len(s["days"]), "weeks", [w["key"] for w in s["weeks"]], "orders", len(s["order_rows"]), "detail", len(s["detail_days"]))
    print("TOTAL days", len(total["days"]), "weeks", [w["key"] for w in total["weeks"]])

    data = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "shops": [s["name"] for s in shops],
        "total": total,
        "shop": {s["name"]: s for s in shops},
        "monthly_gmv": monthly,
        "quarters": quarters,
        "insights": [],
    }

    def write_js(path, var, obj):
        with open(path, "w", encoding="utf-8") as f:
            f.write("window." + var + " = " + json.dumps(obj, ensure_ascii=False) + ";")

    with open(os.path.join(OUT_DIR, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    write_js(os.path.join(OUT_DIR, "data.js"), "DASH_DATA", data)
    write_js(os.path.join(OUT_DIR, "detail-data.js"), "DETAIL_DATA", {"shops": {s["name"]: {"days": s["detail_days"]} for s in shops}})
    print("OUTPUT ok")

if __name__ == "__main__":
    main()
