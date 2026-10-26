"""将全部智能体切到 mock 提供商（临时测试用）。"""
import argparse
import httpx

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=8095)
args = parser.parse_args()
base = f"http://127.0.0.1:{args.port}"
agents = httpx.get(base + "/api/agents").json()
for a in agents:
    b = dict(a)
    b["provider"] = "mock"
    b["model"] = "mock-echo"
    httpx.put(f"{base}/api/agents/{a['id']}", json=b)
print("switched", len(agents))
