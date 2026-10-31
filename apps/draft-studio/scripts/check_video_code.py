"""Reject filesystem/process/network access before generated ManimGL code runs."""
import ast
import sys

source = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(source)
allowed = {"manimlib", "numpy", "math", "random", "itertools"}
blocked = {"open", "exec", "eval", "compile", "getattr", "setattr", "delattr", "globals", "locals", "vars", "__import__", "breakpoint", "input", "type", "help", "dir", "os", "sys", "builtins", "subprocess", "signal"}
for node in ast.walk(tree):
    if isinstance(node, ast.Import):
        if any(alias.name.split(".")[0] not in allowed for alias in node.names):
            raise ValueError("Only ManimGL, numpy and math utility imports are allowed")
    if isinstance(node, ast.ImportFrom) and (node.level or (node.module or "").split(".")[0] not in allowed):
        raise ValueError("Import outside animation libraries")
    if isinstance(node, ast.Name) and (node.id.startswith("_") or node.id in blocked):
        raise ValueError("Unsafe name: " + node.id)
    if isinstance(node, ast.Attribute) and (node.attr.startswith("_") or any(part in node.attr.lower() for part in ("file", "load", "read", "write", "system", "exec", "spawn", "socket", "ctypes", "embed", "subprocess", "sound", "window", "context"))):
        raise ValueError("Unsafe attribute: " + node.attr)
print("Animation code syntax and restricted API checks passed")
