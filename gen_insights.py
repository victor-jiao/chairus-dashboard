# -*- coding: utf-8 -*-
"""生成 data.js 并写入双店铺智能分析结论"""
import json, datetime, os

P = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
d = json.load(open(P, encoding="utf-8"))
total = d["total"]
monthly = d["monthly_gmv"]

def build_insights(ctx, monthly_para=True):
    days, weeks = ctx["days"], ctx["weeks"]
    lines = []
    if not days: return lines
    gmv = sum(x["gmv"] for x in days); orders = sum(x["orders"] for x in days)
    exp = sum(x["exposure"] for x in days); clk = sum(x["clicks"] for x in days)
    ac = sum(x["add_cart"] for x in days); ref = sum(x["refund"] for x in days)
    ctr = clk/exp*100 if exp else 0; addr = ac/clk*100 if clk else 0
    ctor = orders/clk*100 if clk else 0; rr = ref/gmv*100 if gmv else 0
    lines.append(f"整体节奏：{len(days)}天累计GMV ${gmv:,.0f}、订单{orders:,}单，日均GMV约${gmv/len(days):,.0f}；完整周GMV在${min(w['tot']['gmv'] for w in weeks):,.0f}~${max(w['tot']['gmv'] for w in weeks):,.0f}之间（{weeks[0]['key']}周~{weeks[-1]['key']}周）。")
    if monthly_para:
        cur = next((m for m in reversed(monthly) if m["actual"] > 0), None)
        if cur and cur["target"]:
            gap = cur["target"] - cur["actual"]
            end = datetime.date(2026, int(cur["month"].replace("月","")), 31)
            remain = max(0, (end - datetime.date.fromisoformat(days[-1]["date"])).days)
            need = gap / remain if remain else gap
            lines.append(f"月度目标：{cur['month']}实际 ${cur['actual']:,.0f}，目标 ${cur['target']:,.0f}，完成度 {cur['completion']:.1f}%。缺口 ${gap:,.0f}，剩余{remain}天需日均 ${need:,.0f} 才能达标（当前日均 ${gmv/len(days):,.0f}）。")
    lines.append(f"转化链路：曝光→点击率 {ctr:.2f}%，点击→加购率 {addr:.2f}%，点击→成交(CTOR) {ctor:.2f}%。")
    if rr >= 10:
        lines.append(f"退款风险：退款金额 ${ref:,.0f}，退款率 {rr:.1f}%，明显偏高，建议排查高退款SKU的材质/尺寸/物流问题。")
    ranks = ctx["sales_rank_sku"]
    if ranks:
        lines.append(f"SKU主力：销量榜第一 {ranks[0]['name']}（{ranks[0]['qty']:,}件）" + (f"，第二 {ranks[1]['name']}（{ranks[1]['qty']:,}件）。" if len(ranks) > 1 else "。"))
    return lines

for key in ("total",):
    ctx = d[key]
    ctx["insights"] = build_insights(ctx, monthly_para=True)
for sname, ctx in d["shop"].items():
    ctx["insights"] = build_insights(ctx, monthly_para=False)

with open(P, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=1)
js = "window.DASH_DATA = " + json.dumps(d, ensure_ascii=False) + ";"
with open(os.path.join(os.path.dirname(P), "data.js"), "w", encoding="utf-8") as f:
    f.write(js)
print("insights:", "TOTAL", len(d["total"]["insights"]), {k: len(v["insights"]) for k, v in d["shop"].items()})