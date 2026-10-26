/* maestro-cn API 客户端：fetch 封装 + SSE 消费 */
const API = {
  base: "",

  async req(method, path, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers["Content-Type"] = "application/json";
      opt.body = JSON.stringify(body);
    }
    const resp = await fetch(this.base + path, opt);
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); msg = j.detail || msg; } catch (e) {}
      throw new Error(msg);
    }
    return resp.json();
  },
  get(p) { return this.req("GET", p); },
  post(p, b) { return this.req("POST", p, b || {}); },
  put(p, b) { return this.req("PUT", p, b); },
  del(p) { return this.req("DELETE", p); },
};

/* POST 并消费 SSE 流。onEvent(event, data)，返回 Promise（流结束 resolve）。 */
async function ssePost(path, payload, onEvent) {
  const resp = await fetch(API.base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const j = await resp.json(); msg = j.detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let event = null;
  let dataLines = [];

  function flush() {
    if (event !== null) {
      let data = {};
      try { data = JSON.parse(dataLines.join("\n")); } catch (e) {}
      onEvent(event, data);
    }
    event = null; dataLines = [];
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split("\n")) {
        const l = line.trim();
        if (l.startsWith("event:")) event = l.slice(6).trim();
        else if (l.startsWith("data:")) dataLines.push(l.slice(5).trim());
      }
      flush();
    }
  }
  flush();
}
