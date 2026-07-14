# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path


RENDERER = Path(
    r"C:\Users\Lordg\.codex\plugins\cache\openai-primary-runtime\documents\26.630.12135\skills\documents\render_docx.py"
)
DOCX = Path(r"D:\Pulse Hub\courseforge\reportes\2026-07-10-remotion-desktop-architecture-analysis.docx")
OUT_DIR = Path(r"D:\Pulse Hub\courseforge\reportes\_render_remotion_desktop_docx")
BASE_TMP = Path(r"D:\Pulse Hub\courseforge\.tmp_docx_render_fixed")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    profile = BASE_TMP / "profile"
    convert = BASE_TMP / "convert"
    for path in (profile, convert):
        path.mkdir(parents=True, exist_ok=True)
    for child in OUT_DIR.glob("*"):
        if child.is_file():
            child.unlink()

    spec = importlib.util.spec_from_file_location("render_docx_skill", RENDERER)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load render_docx.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["render_docx_skill"] = module
    spec.loader.exec_module(module)

    stem = DOCX.stem
    pdf_path, debug = module.convert_to_pdf(
        str(DOCX.resolve()),
        str(profile.resolve()),
        str(convert.resolve()),
        stem,
        verbose=True,
    )
    if not pdf_path or not Path(pdf_path).exists():
        raise RuntimeError("Failed to convert DOCX to PDF\n" + debug)

    shutil.copy2(pdf_path, OUT_DIR / f"{stem}.pdf")

    paths_raw = module.convert_from_path(
        pdf_path,
        dpi=160,
        fmt="png",
        thread_count=4,
        output_folder=str(OUT_DIR),
        paths_only=True,
        output_file="page",
    )
    pages = []
    for src in paths_raw:
        src_path = Path(src)
        page_num = int(src_path.stem.split("-")[-1])
        dst = OUT_DIR / f"page-{page_num}.png"
        if dst.exists():
            dst.unlink()
        src_path.replace(dst)
        pages.append(dst)
    print("\n".join(str(p) for p in sorted(pages)))


if __name__ == "__main__":
    main()
