"""제출용 ZIP을 만든다: 문서 3종(.docx, .md), 장치(engine/), 제출문.

사용법: python tools/make_zip.py
결과: dist/하태형_T12_제출.zip
"""

import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "dist" / "하태형_T12_제출.zip"
FIXED_TIME = (2026, 10, 14, 0, 0, 0)  # 같은 내용이면 같은 ZIP이 나오도록 시각을 고정한다

entries = []
for name in ["이력서", "자기소개서", "경력기술서"]:
    for ext in [".docx", ".md"]:
        entries.append((ROOT / "docs" / f"{name}{ext}", f"문서/{name}{ext}"))
for path in sorted((ROOT / "engine").rglob("*")):
    if path.is_file():
        entries.append((path, path.relative_to(ROOT).as_posix()))
entries.append((ROOT / "제출문.md", "제출문.md"))

OUT.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
    for src, arc in entries:
        info = zipfile.ZipInfo(arc, FIXED_TIME)
        info.compress_type = zipfile.ZIP_DEFLATED
        info.flag_bits |= 0x800  # 한글 파일 이름을 UTF-8로 기록
        zf.writestr(info, src.read_bytes())

print(f"{OUT.relative_to(ROOT)} ({len(entries)}개 파일)")
