"""模型提供商层：OpenAI 兼容接口、离线 mock、token 估算与成本计算、主持决策。"""
import asyncio
import json
import math

import httpx


class LLMError(Exception):
    pass


def estimate_tokens(text: str) -> int:
    return max(1, int(math.ceil(len(text or "") * 0.6)))


def compute_cost(model: str, tin: int, tout: int, pricing: dict) -> float:
    p = (pricing or {}).get(model)
    if not p:
        return 0.0
    return round(tin / 1_000_000 * p.get("in", 0) + tout / 1_000_000 * p.get("out", 0), 6)


def mask_key(key: str) -> str:
    if not key:
        return ""
    return "****" + key[-4:] if len(key) > 4 else "****"


def _messages_text(messages) -> str:
    return "".join(str(m.get("content", "")) for m in messages)


async def _mock_chat(messages, on_delta=None):
    last = ""
    for m in reversed(messages):
        if m.get("role") == "user" and m.get("content"):
            last = str(m["content"])
            break
    reply = (
        "【离线演示 · mock】已收到你的消息（当前未配置真实模型 Key，回答为演示内容）。\n\n"
        "你发送的内容：\n" + (last[:600] or "（空）") + "\n\n"
        "提示：前往「设置」填写火山方舟 / DeepSeek / 通义千问等 API Key，"
        "或在智能体设置中把 Provider 切回真实模型即可获得真实回答。"
    )
    if on_delta:
        for chunk in _chunk_text(reply, 12):
            await on_delta(chunk)
    return reply, estimate_tokens(_messages_text(messages)), estimate_tokens(reply)


def _chunk_text(text: str, size: int):
    for i in range(0, len(text), size):
        yield text[i : i + size]


async def llm_chat(provider: dict, model: str, messages: list, temperature: float,
                   max_tokens: int, pricing: dict, on_delta=None):
    """调用 OpenAI 兼容接口（流式）。返回 (text, tokens_in, tokens_out)。"""
    if provider.get("id") == "mock" or model == "mock-echo":
        return await _mock_chat(messages, on_delta)

    base = (provider.get("base_url") or "").rstrip("/")
    key = provider.get("api_key") or ""
    if not base or not key:
        raise LLMError(
            f"提供商「{provider.get('name','')}」未配置 API 地址或 Key。"
            "请在「设置」中填写，或将智能体切换到「离线演示（mock）」。"
        )
    url = base + "/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    parts = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode("utf-8", "replace")[:500]
                raise LLMError(f"模型接口返回 {resp.status_code}：{body}")
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                    delta = obj["choices"][0]["delta"].get("content")
                except Exception:
                    delta = None
                if delta:
                    parts.append(delta)
                    if on_delta:
                        await on_delta(delta)
    text = "".join(parts).strip()
    if not text:
        raise LLMError("模型返回为空（可能是模型名未开通或接入点错误）。")
    return text, estimate_tokens(_messages_text(messages)), estimate_tokens(text)


async def reply_for(agent: dict, prompt: str, pricing: dict, temperature=None, max_tokens=None, on_delta=None):
    """按智能体类型调用（llm 或 cli），返回 (text, tokens_in, tokens_out)。"""
    if agent.get("kind") == "cli":
        from . import workbuddy
        cfg = json.loads(agent.get("cli_config") or "{}")
        workdir = agent.get("workdir") or cfg.get("workdir") or ""
        text = await workbuddy.run_cli(cfg.get("command_template", ""), workdir, prompt)
        return text, estimate_tokens(prompt), estimate_tokens(text)
    from . import db
    provider = db.provider_config(agent["provider"])
    msgs = [
        {"role": "system", "content": agent.get("system_prompt") or agent.get("role") or ""},
        {"role": "user", "content": prompt},
    ]
    return await llm_chat(
        provider, agent["model"], msgs,
        temperature if temperature is not None else agent.get("temperature") or 0.7,
        max_tokens if max_tokens is not None else agent.get("max_tokens") or 4096,
        pricing, on_delta)


async def moderator_decision(provider: dict, model: str, temperature: float, max_tokens: int,
                             question: str, history: list, round_no: int):
    """群聊主持决策：返回 {"action": "continue"|"summarize", "focus": str}。"""
    if provider.get("id") == "mock" or model == "mock-echo":
        if round_no < 2:
            return {"action": "continue", "focus": "请各成员针对上述问题补充更具体的数据、案例或可落地的建议。"}
        return {"action": "summarize", "focus": ""}

    prompt = (
        "你是群聊主持人。请根据讨论进展决定下一轮动作。\n"
        "讨论问题：" + question + "\n"
        "已有讨论：\n" + "\n".join(f"- {h.get('name','')}：{h.get('text','')}" for h in history[-6:]) + "\n"
        "输出严格 JSON（不要输出其他内容）：{\"action\": \"continue\" 或 \"summarize\", \"focus\": \"下一轮需要追问/深挖的问题（continue 时必填，summarize 时为空字符串）\"}"
    )
    messages = [
        {"role": "system", "content": "你是群聊主持人，负责判断讨论是否需要继续。只输出 JSON。"},
        {"role": "user", "content": prompt},
    ]
    try:
        text, _, _ = await llm_chat(provider, model, messages, min(temperature, 0.3), 200,
                                    {}, None)
        obj = json.loads(text)
        action = "continue" if obj.get("action") == "continue" else "summarize"
        focus = str(obj.get("focus", "")).strip()
        return {"action": action, "focus": focus}
    except Exception:
        # 决策失败时保守起见继续追问一轮后再总结，避免无限循环
        if round_no < 2:
            return {"action": "continue", "focus": "请进一步补充论证，使结论更扎实。"}
        return {"action": "summarize", "focus": ""}
