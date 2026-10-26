#!/usr/bin/env python3
"""maestro-cn 一键安装：安装 Python 依赖，可选安装 Electron 桌面版依赖。"""
import argparse
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "assets" / "app"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--desktop", action="store_true", help="同时安装 Electron 桌面版依赖（需要 Node.js）")
    args = parser.parse_args()

    if not APP.is_dir():
        print(f"[setup] 找不到应用目录：{APP}（技能包不完整）", file=sys.stderr)
        return 1

    if sys.version_info < (3, 11):
        print(f"[setup] 需要 Python 3.11+，当前 {sys.version_info.major}.{sys.version_info.minor}", file=sys.stderr)
        return 1

    print("[setup] 安装 Python 依赖（fastapi/uvicorn/httpx）…")
    r = subprocess.run([sys.executable, "-m", "pip", "install", "-r", str(APP / "requirements.txt")])
    if r.returncode != 0:
        print("[setup] pip 安装失败", file=sys.stderr)
        return r.returncode

    if args.desktop:
        print("[setup] 安装 Electron 桌面版依赖（npm install）…")
        r = subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=APP)
        if r.returncode != 0:
            print("[setup] npm install 失败（可跳过桌面版，网页版不受影响）", file=sys.stderr)
            return r.returncode

    print("[setup] 完成。下一步：python scripts/start.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
