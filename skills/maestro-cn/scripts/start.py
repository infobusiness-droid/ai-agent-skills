#!/usr/bin/env python3
"""maestro-cn 启动器：在 assets/app 目录启动后端，可指定端口；Ctrl+C 停止。"""
import argparse
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "assets" / "app"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8090, help="后端端口（默认 8090）")
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    args = parser.parse_args()

    if not (APP / "run.py").is_file():
        print(f"[start] 找不到 {APP / 'run.py'}（技能包不完整）", file=sys.stderr)
        return 1

    cmd = [sys.executable, "run.py", "--port", str(args.port)]
    if args.no_browser:
        cmd.append("--no-browser")
    print(f"[start] 启动 maestro-cn 后端（端口 {args.port}）… Ctrl+C 停止")
    return subprocess.call(cmd, cwd=APP)


if __name__ == "__main__":
    raise SystemExit(main())
