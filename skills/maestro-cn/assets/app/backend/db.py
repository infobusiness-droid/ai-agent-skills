"""maestro-cn 数据层：SQLite 初始化、建表、默认种子与设置读写。"""
import json
import sqlite3
import threading
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "maestro.db"

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT 'ark',
    model TEXT NOT NULL DEFAULT '',
    temperature REAL NOT NULL DEFAULT 0.7,
    max_tokens INTEGER NOT NULL DEFAULT 4096,
    kind TEXT NOT NULL DEFAULT 'llm',            -- llm | cli
    cli_config TEXT,                              -- JSON：workbuddy 等外部工具适配
    workdir TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '新对话',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,                           -- user | assistant
    content TEXT NOT NULL DEFAULT '',
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS group_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT '新群聊',
    moderator_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS group_members (
    group_chat_id INTEGER NOT NULL,
    agent_id INTEGER NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_chat_id INTEGER NOT NULL,
    role TEXT NOT NULL,                           -- user | turn | synthesis
    sender TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS autoruns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'checklist',       -- checklist | goal
    goal TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',       -- pending | running | done | error
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS autorun_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    autorun_id INTEGER NOT NULL,
    idx INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',       -- pending | running | done | error
    result TEXT NOT NULL DEFAULT '',
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS playbooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'checklist',
    goal TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
"""

DEFAULT_SETTINGS = {
    "providers": {
        "ark": {
            "name": "火山方舟·豆包",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "api_key": "",
            "models": ["doubao-seed-1.6-flash", "doubao-seed-1.6-thinking", "doubao-1.5-pro-32k"],
            "default_model": "doubao-seed-1.6-flash",
        },
        "deepseek": {
            "name": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "",
            "models": ["deepseek-chat", "deepseek-reasoner"],
            "default_model": "deepseek-chat",
        },
        "qwen": {
            "name": "通义千问（阿里云百炼）",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "api_key": "",
            "models": ["qwen-plus", "qwen-max", "qwen-turbo"],
            "default_model": "qwen-plus",
        },
        "glm": {
            "name": "智谱 GLM",
            "base_url": "https://open.bigmodel.cn/api/paas/v4",
            "api_key": "",
            "models": ["glm-4-plus", "glm-4-flash"],
            "default_model": "glm-4-flash",
        },
        "kimi": {
            "name": "月之暗面 Kimi",
            "base_url": "https://api.moonshot.cn/v1",
            "api_key": "",
            "models": ["moonshot-v1-32k", "kimi-k2-0711-preview"],
            "default_model": "moonshot-v1-32k",
        },
        "mock": {
            "name": "离线演示（mock）",
            "base_url": "",
            "api_key": "",
            "models": ["mock-echo"],
            "default_model": "mock-echo",
        },
    },
    "pricing": {
        # 每 100 万 token 价格（元，输入/输出）。以下为示例价，可在「设置」中修改。
        "doubao-seed-1.6-flash": {"in": 0.8, "out": 2.0},
        "doubao-seed-1.6-thinking": {"in": 4.0, "out": 12.0},
        "doubao-1.5-pro-32k": {"in": 5.0, "out": 9.0},
        "deepseek-chat": {"in": 2.0, "out": 8.0},
        "deepseek-reasoner": {"in": 4.0, "out": 16.0},
        "qwen-plus": {"in": 0.8, "out": 2.0},
        "qwen-max": {"in": 2.4, "out": 9.6},
        "qwen-turbo": {"in": 0.3, "out": 1.2},
        "glm-4-plus": {"in": 50.0, "out": 50.0},
        "glm-4-flash": {"in": 0.0, "out": 0.0},
        "moonshot-v1-32k": {"in": 24.0, "out": 24.0},
        "kimi-k2-0711-preview": {"in": 4.0, "out": 16.0},
    },
    "defaults": {"temperature": 0.7, "max_tokens": 4096},
    "workbuddy": {
        "enabled": False,
        "command_template": "",
        "workdir": "",
        "note": "workbuddy 适配器（预留）：在此配置命令模板，{prompt} 为任务内容占位符。待提供 API/CLI 接口文档后接通。",
    },
}

SAMPLE_AGENTS = [
    {
        "name": "主持助手",
        "role": "群聊主持人",
        "system_prompt": "你是智能体群聊的主持人：负责理解问题、把问题分派给合适的成员、在回答薄弱时追问、汇总各方观点并输出清晰结论。",
        "provider": "ark",
        "model": "doubao-seed-1.6-flash",
    },
    {
        "name": "项目规划师",
        "role": "项目与运营规划",
        "system_prompt": "你是资深项目规划师，擅长把模糊目标拆解为可执行的计划、里程碑、资源与风险清单。回答具体、分点、可落地。",
        "provider": "ark",
        "model": "doubao-seed-1.6-flash",
    },
    {
        "name": "文案写手",
        "role": "中文内容创作",
        "system_prompt": "你是中文文案专家，擅长营销文案、公众号文章、小红书笔记与品牌表达。语言生动、结构清晰、贴近目标读者。",
        "provider": "ark",
        "model": "doubao-seed-1.6-flash",
    },
    {
        "name": "代码专家",
        "role": "软件工程",
        "system_prompt": "你是资深软件工程师，擅长需求分析、架构设计、代码实现与排错。给出可直接使用的代码与清晰解释。",
        "provider": "ark",
        "model": "doubao-seed-1.6-flash",
    },
]


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def query(sql: str, params=()):
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()


def query_one(sql: str, params=()):
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()


def execute(sql: str, params=()):
    with _lock:
        conn = get_conn()
        try:
            cur = conn.execute(sql, params)
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()


def executemany(sql: str, seq):
    with _lock:
        conn = get_conn()
        try:
            conn.executemany(sql, seq)
            conn.commit()
        finally:
            conn.close()


def init_db():
    with _lock:
        conn = get_conn()
        try:
            conn.executescript(SCHEMA)
            conn.commit()
            _seed(conn)
        finally:
            conn.close()


def _seed(conn):
    if conn.execute("SELECT COUNT(*) c FROM settings").fetchone()["c"] == 0:
        conn.execute("INSERT INTO settings (key, value) VALUES ('app', ?)",
                     (json.dumps(DEFAULT_SETTINGS, ensure_ascii=False),))
    if conn.execute("SELECT COUNT(*) c FROM agents").fetchone()["c"] == 0:
        for a in SAMPLE_AGENTS:
            conn.execute(
                "INSERT INTO agents (name, role, system_prompt, provider, model, temperature, max_tokens, kind, workdir) "
                "VALUES (:name, :role, :system_prompt, :provider, :model, 0.7, 4096, 'llm', '')",
                a,
            )
    conn.commit()


# ---------- 设置 ----------

def get_app_settings() -> dict:
    row = query_one("SELECT value FROM settings WHERE key='app'")
    if not row:
        return dict(DEFAULT_SETTINGS)
    try:
        return json.loads(row["value"])
    except Exception:
        return dict(DEFAULT_SETTINGS)


def put_app_settings(settings: dict) -> dict:
    merged = get_app_settings()
    merged.update(settings)
    execute("UPDATE settings SET value=? WHERE key='app'", (json.dumps(merged, ensure_ascii=False),))
    return merged


def provider_config(provider_id: str) -> dict:
    s = get_app_settings()
    p = (s.get("providers") or {}).get(provider_id)
    if not p:
        raise ValueError(f"未知的模型提供商：{provider_id}")
    cfg = dict(p)
    cfg["id"] = provider_id
    return cfg
