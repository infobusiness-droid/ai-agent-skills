#!/usr/bin/env python3
"""maestro-cn 冒烟测试：要求服务已启动，把智能体切到 mock 后跑 14 项端到端测试。"""
import argparse
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "assets" / "app"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8095, help="后端端口（默认 8095）")
    args = parser.parse_args()

    tests = APP / "tests"
    if not (tests / "switch_mock.py").is_file():
        print(f"[smoke] 找不到测试目录 {tests}", file=sys.stderr)
        return 1

    base = f"http://127.0.0.1:{args.port}"
    try:
        import httpx
        httpx.get(f"{base}/health", timeout=3)
    except Exception as e:
        print(f"[smoke] 服务未就绪（{base}）：{e}\n请先运行 python scripts/start.py --port {args.port} --no-browser", file=sys.stderr)
        return 1

    print("[smoke] 把全部智能体切到 mock…")
    r1 = subprocess.run([sys.executable, str(tests / "switch_mock.py"), "--port", str(args.port)], cwd=APP)
    if r1.returncode != 0:
        return r1.returncode

    print("[smoke] 运行后端端到端冒烟测试…")
    return subprocess.call([sys.executable, str(tests / "smoke_test.py"), "--port", str(args.port)], cwd=APP)


if __name__ == "__main__":
    raise SystemExit(main())
