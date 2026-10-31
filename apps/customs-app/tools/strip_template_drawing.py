#!/usr/bin/env python3
"""去掉模板中的说明图片（不影响报关单版式、合并单元格与字段），
因为 exceljs 无法稳定写回该 drawing。构建期执行一次即可。"""
import re, shutil, zipfile
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
TARGET = APP / "assets" / "export-template.xlsx"
TMP = TARGET.with_suffix(".tmp.xlsx")

DROP = {
    "xl/drawings/drawing1.xml",
    "xl/drawings/_rels/drawing1.xml.rels",
    "xl/media/image1.png",
    "xl/worksheets/_rels/sheet1.xml.rels",
}

with zipfile.ZipFile(TARGET) as src, zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as dst:
    for item in src.infolist():
        if item.filename in DROP:
            continue
        data = src.read(item.filename)
        if item.filename == "xl/worksheets/sheet1.xml":
            data = re.sub(rb"<drawing[^>]*/>", b"", data)
        if item.filename == "[Content_Types].xml":
            data = re.sub(rb'<Override PartName="/xl/drawings/drawing1.xml"[^>]*/>', b"", data)
        dst.writestr(item, data)

shutil.move(TMP, TARGET)
print("stripped", TARGET)
