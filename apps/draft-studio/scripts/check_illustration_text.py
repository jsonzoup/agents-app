"""Require literal Manim labels grounded in the current article's visual evidence."""
import ast
import json
import re
import sys

code = ast.parse(open(sys.argv[1], encoding="utf-8").read())
article = json.load(open(sys.argv[2], encoding="utf-8"))
for node in ast.walk(code):
    if isinstance(node, ast.ImportFrom):
        for alias in node.names:
            if alias.asname and alias.name in ("Text", "Tex", "TexText", "DecimalNumber", "Integer"):
                raise ValueError("Do not alias text constructors")
    if isinstance(node, ast.Attribute) and node.attr in ("Text", "Tex", "TexText", "DecimalNumber", "Integer", "add_coordinate_labels", "add_numbers", "add_labels", "get_number_mobject", "get_number_mobjects", "get_axis_labels"):
        raise ValueError("Automatic or indirect text/number labels are not permitted")
    if isinstance(node, (ast.Assign, ast.AnnAssign)):
        value = node.value
        if isinstance(value, ast.Name) and value.id in ("Text", "Tex", "TexText", "DecimalNumber", "Integer"):
            raise ValueError("Do not alias text constructors")
    if isinstance(node, ast.keyword) and node.arg in ("include_numbers", "include_tip_numbers", "decimal_number_config"):
        raise ValueError("Automatic numeric labels are not permitted")
scenes = [node for node in code.body if isinstance(node, ast.ClassDef) and node.name.startswith("DraftIllustration")]
for node in ast.walk(code):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("Text", "Tex", "TexText", "DecimalNumber", "Integer"):
        if node.func.id != "Text" or not any(node in list(ast.walk(scene)) for scene in scenes):
            raise ValueError("All labels must be literal Text calls inside the corresponding illustration scene")
for index, page in enumerate(article["pages"]):
    scene = next((node for node in code.body if isinstance(node, ast.ClassDef) and node.name == f"DraftIllustration{index}"), None)
    if scene is None:
        raise ValueError(f"Missing DraftIllustration{index}")
    allowed = " ".join([page["title"], page["lead"], page["source"], *page["points"], *page["evidenceQuotes"], *[str(value) for metric in page["metrics"] for value in metric.values()]])
    numbers = set(re.findall(r"\d+(?:\.\d+)?(?:%|％)?", " ".join(page["evidenceQuotes"])))
    labels = 0
    for node in ast.walk(scene):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name) or node.func.id != "Text":
            continue
        if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
            raise ValueError("Use Text with literal strings; do not compute or concatenate evidence labels")
        if any(keyword.arg == "color" for keyword in node.keywords):
            raise ValueError("ManimGL Text constructor color may be ignored: call Text(...).set_color(explicit_color) instead")
        text = node.args[0].value
        if text.strip() and text not in allowed:
            raise ValueError("Label is absent from this page's evidence: " + text)
        if any(number not in numbers for number in re.findall(r"\d+(?:\.\d+)?(?:%|％)?", text)):
            raise ValueError("Numeric label absent from evidence: " + text)
        labels += 1
    if labels < 2:
        raise ValueError("Each scene needs at least two grounded readable labels")
print("Illustration labels and numeric evidence checked")
