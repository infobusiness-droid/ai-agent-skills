"""maestro-cn 启动入口。

用法：
    python run.py                # 启动服务并自动打开浏览器（默认端口 8090）
    python run.py --port 9000    # 指定端口
    python run.py --no-browser   # 仅启动服务（供 Electron 调用）
"""
import argparse
import threading
import time
import webbrowser

import uvicorn


def main():
    parser = argparse.ArgumentParser(description="maestro-cn 本地启动器")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    args = parser.parse_args()

    if not args.no_browser:
        def _open():
            time.sleep(1.2)
            webbrowser.open(f"http://{args.host}:{args.port}")
        threading.Thread(target=_open, daemon=True).start()

    print(f"maestro-cn 已启动：http://{args.host}:{args.port}")
    uvicorn.run("backend.main:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
