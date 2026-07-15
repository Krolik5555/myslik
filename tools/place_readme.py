# -*- coding: utf-8 -*-
"""Кладёт packaging/ЧИТАТЬ.txt в release/Myslik/ЧИТАТЬ.txt после сборки.
Вынесено из release.ps1, т.к. PowerShell 5.1 не умеет юникод-имена в ASCII-скрипте,
а Python работает с кириллическими путями штатно. Запуск: python tools/place_readme.py"""
import os
import shutil

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, "packaging", "ЧИТАТЬ.txt")
dst_dir = os.path.join(root, "release", "Myslik")
dst = os.path.join(dst_dir, "ЧИТАТЬ.txt")

if not os.path.isfile(src):
    raise SystemExit("source readme not found: %s" % src.encode("ascii", "replace").decode("ascii"))
if not os.path.isdir(dst_dir):
    raise SystemExit("build dir not found: %s" % dst_dir)
shutil.copyfile(src, dst)
print("readme placed OK")   # только ASCII: перенаправленный stdout тут cp1252
