"""maestro-cn 后端端到端冒烟测试（mock 模式，无需真实 Key）。"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

import httpx

_argp = argparse.ArgumentParser()
_argp.add_argument("--port", type=int, default=8095)
BASE = f"http://127.0.0.1:{_argp.parse_args().port}"
passed, failed = [], []


def check(name, cond, extra=""):
    (passed if cond else failed).append(name)
    print(("PASS " if cond else "FAIL ") + name + (f"  {extra}" if extra and not cond else ""))


async def consume_sse(client, url, payload):
    """POST 并消费 SSE，返回事件列表 [(event, data_dict)]。"""
    events = []
    async with client.stream("POST", url, json=payload) as resp:
        assert resp.status_code == 200, f"HTTP {resp.status_code}"
        event = None
        data_lines = []
        async for line in resp.aiter_lines():
            line = line.strip()
            if not line:
                if event is not None:
                    try:
                        data = json.loads("\n".join(data_lines))
                    except Exception:
                        data = {}
                    events.append((event, data))
                event, data_lines = None, []
            elif line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].strip())
    return events


async def main():
    async with httpx.AsyncClient(timeout=60) as c:
        # 健康检查
        r = await c.get(BASE + "/health")
        check("health", r.json().get("ok") is True)

        # 智能体列表（应有 4 个种子智能体）
        agents = (await c.get(BASE + "/api/agents")).json()
        check("agents seeded", len(agents) >= 4, str(len(agents)))
        # 全部切到 mock，便于无 Key 测试
        for a in agents:
            body = dict(a)
            body["provider"] = "mock"
            body["model"] = "mock-echo"
            await c.put(f"{BASE}/api/agents/{a['id']}", json=body)
        agents = (await c.get(BASE + "/api/agents")).json()

        # 单智能体聊天（SSE）
        evs = await consume_sse(c, f"{BASE}/api/agents/{agents[0]['id']}/chat/stream",
                                {"message": "你好，请做自我介绍", "conversation_id": None})
        names = [e for e, _ in evs]
        check("chat sse events", "done" in names and "chunk" in names, str(names))
        cid = next(d["conversation_id"] for e, d in evs if e == "meta")
        msgs = (await c.get(f"{BASE}/api/conversations/{cid}/messages")).json()
        check("chat saved", len(msgs) == 2 and msgs[0]["role"] == "user" and msgs[1]["role"] == "assistant")

        # @提及
        evs2 = await consume_sse(c, f"{BASE}/api/agents/{agents[0]['id']}/chat/stream",
                                 {"message": f"@{agents[1]['name']} 请补充意见", "conversation_id": cid})
        check("mention event", any(e == "mention" for e, _ in evs2), str([e for e, _ in evs2]))

        # 群聊
        gid = (await c.post(BASE + "/api/groupchats",
                            json={"title": "测试群", "moderator_id": agents[0]["id"],
                                  "member_ids": [a["id"] for a in agents[1:4]]})).json()["id"]
        evs3 = await consume_sse(c, f"{BASE}/api/groupchats/{gid}/run",
                                 {"question": "如何为一款新品制定上市计划？", "rounds_max": 2})
        names3 = [e for e, _ in evs3]
        check("groupchat events", "synthesis" in names3 and "done" in names3 and "turn" in names3, str(names3))
        detail = (await c.get(f"{BASE}/api/groupchats/{gid}")).json()
        check("groupchat saved", any(m["role"] == "synthesis" for m in detail["messages"]))

        # Auto Run（checklist）
        rid = (await c.post(BASE + "/api/autoruns", json={
            "agent_id": agents[2]["id"], "title": "测试自动执行", "mode": "checklist",
            "items": [{"title": "写一个标题", "detail": "为新品写 3 个备选标题"},
                      {"title": "写一段简介", "detail": "为新品写 80 字简介"}]})).json()["id"]
        evs4 = await consume_sse(c, f"{BASE}/api/autoruns/{rid}/run", {})
        names4 = [e for e, _ in evs4]
        check("autorun events", "item_done" in names4 and "done" in names4 and names4.count("item_done") == 2, str(names4))
        ar = (await c.get(f"{BASE}/api/autoruns/{rid}")).json()
        check("autorun saved", all(i["status"] == "done" for i in ar["items"]))

        # Auto Run（goal 模式）
        rid2 = (await c.post(BASE + "/api/autoruns", json={
            "agent_id": agents[3]["id"], "title": "测试目标模式", "mode": "goal",
            "goal": "写一份简短的市场分析"})).json()["id"]
        evs5 = await consume_sse(c, f"{BASE}/api/autoruns/{rid2}/run", {})
        names5 = [e for e, _ in evs5]
        check("autorun goal events", "item_done" in names5 and "done" in names5, str(names5))
        ar2 = (await c.get(f"{BASE}/api/autoruns/{rid2}")).json()
        check("autorun goal saved", ar2["status"] == "done" and len(ar2["items"]) == 1
              and ar2["items"][0]["status"] == "done")

        # Playbook + 用量
        pid = (await c.post(BASE + "/api/playbooks", json={
            "name": "日常清单", "mode": "checklist",
            "items": [{"title": "晨间任务", "detail": "查看邮件并回复"}]})).json()["id"]
        check("playbook created", pid > 0)
        usage = (await c.get(BASE + "/api/usage")).json()
        check("usage totals", usage["total"]["tokens_in"] > 0 and usage["total"]["tokens_out"] > 0,
              json.dumps(usage["total"], ensure_ascii=False))

        # 设置（Key 掩码）
        st = (await c.get(BASE + "/api/settings")).json()
        check("settings masked", "api_key" in st["providers"]["ark"] and st["providers"]["ark"]["api_key"] == "")

    print(f"\n结果：通过 {len(passed)} 项，失败 {len(failed)} 项")
    if failed:
        print("失败项：", failed)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
