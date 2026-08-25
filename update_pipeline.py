# -*- coding: utf-8 -*-
"""一键更新数据管道：自动重命名 PLUS 文件 -> 解析所有 Excel -> 聚合双店铺/自制与联盟视频 -> 生成 data.js 与 detail-data.js"""
import os, re, json, datetime
import subprocess

PLUS_DIR = r"C:\Users\Admin\Downloads\易得客下载目录\Tiktok-ChairusPlus-焦文浩"
DASH_DIR = r"D:\codex-钉钉\dashboard"

# 1. 自动检查并重命名 PLUS 目录下的 product_list 文件
if os.path.exists(PLUS_DIR):
    for f in os.listdir(PLUS_DIR):
        m = re.match(r"^product_list_(\d{4})(\d{2})(\d{2})\.xlsx$", f)
        if m:
            y, mo, d = m.groups()
            new_name = f"{int(mo)}月{int(d)}日.xlsx"
            try:
                os.rename(os.path.join(PLUS_DIR, f), os.path.join(PLUS_DIR, new_name))
                print(f"Auto renamed: {f} -> {new_name}")
            except Exception as e:
                print(f"Rename error: {e}")

# 2. 运行 build_data.py 与 gen_insights.py
python_exe = r"C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
subprocess.run([python_exe, os.path.join(DASH_DIR, "build_data.py")], check=True)
subprocess.run([python_exe, os.path.join(DASH_DIR, "gen_insights.py")], check=True)

# 3. 补充视频曝光与点击聚合
import openpyxl

def num(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().replace("$", "").replace(",", "").replace("¥", "").replace(" ", "").replace("USD", "")
    try: return float(s)
    except Exception: return 0.0

def parse_video_excel(path):
    res = {}
    if not os.path.exists(path): return res
    wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    ws = wb.worksheets[0]
    for r in ws.iter_rows(min_row=4, values_only=True):
        if not r or r[0] is None: continue
        d_str = str(r[0]).strip()
        if not d_str or d_str == "nan": continue
        exp = int(num(r[11])) if len(r) > 11 else 0
        clk = int(num(r[12])) if len(r) > 12 else 0
        res[d_str] = {"exposure": exp, "clicks": clk}
    wb.close()
    return res

data_path = os.path.join(DASH_DIR, "data.json")
with open(data_path, "r", encoding="utf-8") as f:
    data = json.load(f)

shop_dirs = [
    ("CHAIRUS", r"C:\Users\Admin\Downloads\易得客下载目录\Tiktok-Chairus-焦文浩"),
    ("PLUS", r"C:\Users\Admin\Downloads\易得客下载目录\Tiktok-ChairusPlus-焦文浩"),
]

for sname, spath in shop_dirs:
    self_v = parse_video_excel(os.path.join(spath, "6.22-8.16自制视频.xlsx"))
    affil_v = parse_video_excel(os.path.join(spath, "6.22-8.16联盟视频.xlsx"))
    shop_obj = data["shop"][sname]
    for d in shop_obj["days"]:
        ds = d["date"]
        sv = self_v.get(ds, {"exposure": 0, "clicks": 0})
        av = affil_v.get(ds, {"exposure": 0, "clicks": 0})
        d["self_video_exposure"] = sv["exposure"]
        d["self_video_clicks"] = sv["clicks"]
        d["affil_video_exposure"] = av["exposure"]
        d["affil_video_clicks"] = av["clicks"]
    for w in shop_obj["weeks"]:
        w["tot"]["self_video_exposure"] = sum(d.get("self_video_exposure", 0) for d in shop_obj["days"] if d["date"] in w["days"])
        w["tot"]["self_video_clicks"] = sum(d.get("self_video_clicks", 0) for d in shop_obj["days"] if d["date"] in w["days"])
        w["tot"]["affil_video_exposure"] = sum(d.get("affil_video_exposure", 0) for d in shop_obj["days"] if d["date"] in w["days"])
        w["tot"]["affil_video_clicks"] = sum(d.get("affil_video_clicks", 0) for d in shop_obj["days"] if d["date"] in w["days"])

total_obj = data["total"]
for d in total_obj["days"]:
    ds = d["date"]
    d["self_video_exposure"] = sum(data["shop"][s]["days"][i].get("self_video_exposure", 0) for s in ["CHAIRUS", "PLUS"] for i, sd in enumerate(data["shop"][s]["days"]) if sd["date"] == ds)
    d["self_video_clicks"] = sum(data["shop"][s]["days"][i].get("self_video_clicks", 0) for s in ["CHAIRUS", "PLUS"] for i, sd in enumerate(data["shop"][s]["days"]) if sd["date"] == ds)
    d["affil_video_exposure"] = sum(data["shop"][s]["days"][i].get("affil_video_exposure", 0) for s in ["CHAIRUS", "PLUS"] for i, sd in enumerate(data["shop"][s]["days"]) if sd["date"] == ds)
    d["affil_video_clicks"] = sum(data["shop"][s]["days"][i].get("affil_video_clicks", 0) for s in ["CHAIRUS", "PLUS"] for i, sd in enumerate(data["shop"][s]["days"]) if sd["date"] == ds)

for w in total_obj["weeks"]:
    w["tot"]["self_video_exposure"] = sum(data["shop"][s]["weeks"][i]["tot"].get("self_video_exposure", 0) for s in ["CHAIRUS", "PLUS"] for i, sw in enumerate(data["shop"][s]["weeks"]) if sw["key"] == w["key"])
    w["tot"]["self_video_clicks"] = sum(data["shop"][s]["weeks"][i]["tot"].get("self_video_clicks", 0) for s in ["CHAIRUS", "PLUS"] for i, sw in enumerate(data["shop"][s]["weeks"]) if sw["key"] == w["key"])
    w["tot"]["affil_video_exposure"] = sum(data["shop"][s]["weeks"][i]["tot"].get("affil_video_exposure", 0) for s in ["CHAIRUS", "PLUS"] for i, sw in enumerate(data["shop"][s]["weeks"]) if sw["key"] == w["key"])
    w["tot"]["affil_video_clicks"] = sum(data["shop"][s]["weeks"][i]["tot"].get("affil_video_clicks", 0) for s in ["CHAIRUS", "PLUS"] for i, sw in enumerate(data["shop"][s]["weeks"]) if sw["key"] == w["key"])

with open(data_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
with open(os.path.join(DASH_DIR, "data.js"), "w", encoding="utf-8") as f:
    f.write("window.DASH_DATA = " + json.dumps(data, ensure_ascii=False) + ";")

print("Pipeline finished successfully!")
