/* maestro-cn UI 工具：转义、markdown 渲染、弹窗、Toast、DOM 助手 */
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* 轻量 Markdown 渲染（安全：先转义再结构化） */
function renderMd(text) {
  let html = esc(text);
  // 代码块
  html = html.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code}</code></pre>`);
  // 行内代码
  html = html.replace(/`([^`\n]+)`/g, (m, c) => `<code>${c}</code>`);
  // 标题
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>")
             .replace(/^## (.*)$/gm, "<h2>$1</h2>")
             .replace(/^# (.*)$/gm, "<h1>$1</h1>");
  // 引用
  html = html.replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>");
  // 粗体 / 斜体
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/(^|[\s>])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  // 列表
  const lines = html.split("\n");
  let out = [], inUl = false, inOl = false;
  for (const line of lines) {
    const ul = line.match(/^[-*] (.*)$/);
    const ol = line.match(/^\d+\. (.*)$/);
    if (ul) {
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${ul[1]}</li>`);
    } else if (ol) {
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${ol[1]}</li>`);
    } else {
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (inOl) { out.push("</ol>"); inOl = false; }
      out.push(line);
    }
  }
  if (inUl) out.push("</ul>");
  if (inOl) out.push("</ol>");
  html = out.join("\n");
  // 空行转段落分隔
  html = html.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  const div = document.createElement("div");
  div.className = "md";
  div.innerHTML = html;
  return div;
}

/* ---- 弹窗 ---- */
function openModal(html, onMount) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-mask" id="modal-mask"><div class="modal">${html}</div></div>`;
  const mask = root.querySelector("#modal-mask");
  mask.addEventListener("mousedown", (e) => {
    if (e.target === mask) closeModal();
  });
  if (onMount) onMount(mask.querySelector(".modal"));
  return mask.querySelector(".modal");
}
function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

/* ---- Toast ---- */
function toast(msg, type = "info", ms = 2600) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, ms);
  setTimeout(() => el.remove(), ms + 350);
}

/* ---- DOM 助手 ---- */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (typeof v === "boolean") { if (v) node.setAttribute(k, ""); }
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function fmtCost(c) { return (Number(c) || 0).toFixed(4) + " 元"; }
function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
