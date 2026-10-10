(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
      catch (_) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
    }
  };

  const root = document.documentElement;
  root.dataset.theme = store.get("lna.theme", matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light");
  $("theme").onclick = () => {
    const n = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = n;
    store.set("lna.theme", n);
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = n === "dark" ? "#1B1A18" : "#FAF9F5";
  };

  let toastTimer;
  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("on"), 2600);
  }

  const messagesEl = $("messages");
  const welcome = $("welcome");
  const input = $("input");
  const sendBtn = $("send");
  const diag = $("diag");
  let history = store.get("lna.hist", []);
  let busy = false;

  $("hint").textContent = location.protocol === "file:"
    ? "Открыто с диска · нужен интернет"
    : "Онлайн · " + location.host;

  function showChat() { welcome.hidden = true; messagesEl.hidden = false; }
  function esc(s) {
    return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function scrollBottom() {
    requestAnimationFrame(() => { $("chatMain").scrollTop = $("chatMain").scrollHeight; });
  }

  function renderAll() {
    if (!history.length) {
      welcome.hidden = false;
      messagesEl.hidden = true;
      messagesEl.innerHTML = "";
      return;
    }
    showChat();
    messagesEl.innerHTML = history.map((m, i) => {
      const cls = m.role === "user" ? "user" : "bot" + (m.err ? " err" : "");
      const actions = m.role === "assistant" && !m.err
        ? `<div class="meta"><button type="button" data-copy="${i}">Копировать</button></div>`
        : "";
      return `<div class="msg ${cls}">${esc(m.content)}${actions}</div>`;
    }).join("");
    scrollBottom();
  }

  const SYSTEM_PROMPT = [
    "You are Lingo AI, a capable, careful, friendly general-purpose assistant.",
    "Reply in the same language as the user's latest message unless they ask for another language.",
    "Use the conversation history to understand follow-up questions; do not make the user repeat context they already gave.",
    "Be accurate and practical. For calculations, check the result. For complex tasks, reason carefully before answering and present clear conclusions.",
    "Never invent facts, citations, tool use, or live web access. When unsure, say so and explain what would need checking.",
    "Use readable formatting. Match the user's requested level of detail; for school help, explain simply and show the necessary steps."
  ].join(" ");

  // Keep recent turns and always include the current message only once.
  function buildPayload(prompt, previousMessages) {
    const list = [{ role: "system", content: SYSTEM_PROMPT }];
    (previousMessages || [])
      .filter(m => (m.role === "user" || m.role === "assistant") && !m.err && typeof m.content === "string")
      .slice(-12)
      .forEach(m => list.push({ role: m.role, content: m.content }));
    list.push({ role: "user", content: prompt });
    return list;
  }

  function extractText(result) {
    if (typeof result === "string") return result.trim();
    const content = result && result.message && result.message.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      const text = content.map(part => typeof part === "string" ? part : (part && part.text) || "").join("").trim();
      if (text) return text;
    }
    if (result && typeof result.text === "string") return result.text.trim();
    if (result && typeof result.content === "string") return result.content.trim();
    throw new Error("Модель вернула ответ в неизвестном формате");
  }

  async function viaPuter(messages, model) {
    if (typeof puter === "undefined" || !puter.ai || typeof puter.ai.chat !== "function") {
      throw new Error("Puter.js не загрузился");
    }
    // For message arrays, Puter.js supports (messages, testMode, options).
    const result = await puter.ai.chat(messages, false, {
      model,
      normalize: true,
      reasoning_effort: "medium"
    });
    const answer = extractText(result);
    if (!answer) throw new Error("Модель вернула пустой ответ");
    return answer;
  }

  async function viaIndex(messages) {
    const response = await fetch("https://index-translate.bilibili.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "Index-Translate-35B-A3B", temperature: 0.5, messages })
    });
    if (!response.ok) throw new Error("Index HTTP " + response.status);
    const data = await response.json();
    const answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
    if (!answer) throw new Error("Index вернул пустой ответ");
    return answer;
  }

  async function viaPoll(messages) {
    const response = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai", messages })
    });
    if (!response.ok) throw new Error("Pollinations HTTP " + response.status);
    const data = await response.json();
    const answer = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
    if (!answer) throw new Error("Pollinations вернул пустой ответ");
    return answer;
  }

  async function askNeural(prompt, previousMessages) {
    const messages = buildPayload(prompt, previousMessages);
    const errors = [];

    // Try newer, more capable models first. If one is unavailable, continue automatically.
    const puterModels = ["gpt-5.6-luna", "gpt-5.5", "gpt-4o-mini"];
    for (const model of puterModels) {
      try {
        const answer = await viaPuter(messages, model);
        console.info("Lingo AI model:", model);
        return answer;
      } catch (error) {
        errors.push(model + ": " + (error.message || String(error)));
      }
    }

    // Last-resort providers kept for resilience; they also receive the system prompt/history.
    try { return await viaIndex(messages); }
    catch (error) { errors.push("Index: " + (error.message || String(error))); }
    try { return await viaPoll(messages); }
    catch (error) { errors.push("Pollinations: " + (error.message || String(error))); }

    console.warn("Lingo AI providers failed:", errors);
    throw new Error("Не удалось подключиться к ИИ. Проверь интернет и нажми «Проверить связь».\n" + errors.join("\n"));
  }

  async function testConn() {
    diag.hidden = false;
    diag.className = "diag";
    diag.textContent = "Проверяю…";
    const lines = ["Протокол: " + location.protocol + " // " + location.host];

    for (const model of ["gpt-5.6-luna", "gpt-5.5", "gpt-4o-mini"]) {
      try {
        const answer = await viaPuter([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "Say only: OK" }], model);
        lines.push("✓ Puter / " + model + ": " + answer.slice(0, 40));
        break;
      } catch (error) {
        lines.push("✗ Puter / " + model + ": " + (error.message || String(error)));
      }
    }
    try {
      const answer = await viaIndex([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "Say only: OK" }]);
      lines.push("✓ Index-Translate: " + answer.slice(0, 40));
    } catch (error) { lines.push("✗ Index-Translate: " + (error.message || String(error))); }
    try {
      const answer = await viaPoll([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "Say only: OK" }]);
      lines.push("✓ Pollinations: " + answer.slice(0, 40));
    } catch (error) { lines.push("✗ Pollinations: " + (error.message || String(error))); }

    const ok = lines.some(line => line.startsWith("✓"));
    diag.className = "diag " + (ok ? "ok" : "bad");
    diag.innerHTML = lines.map(esc).join("<br>");
    toast(ok ? "Связь есть — можно писать" : "Сервисы недоступны с этой сети");
  }

  async function send(text) {
    text = (text || input.value).trim();
    if (!text || busy) return;

    busy = true;
    sendBtn.disabled = true;
    input.value = "";
    autoSize();
    history.push({ role: "user", content: text });
    store.set("lna.hist", history);
    showChat();
    messagesEl.innerHTML += `<div class="msg user">${esc(text)}</div><div class="msg bot typing">Думаю</div>`;
    scrollBottom();

    try {
      // The current turn is already in history; pass earlier turns separately to avoid duplication.
      const previous = history.filter(m => !m.err).slice(0, -1);
      const answer = await askNeural(text, previous);
      history.push({ role: "assistant", content: answer });
      store.set("lna.hist", history);
      renderAll();
    } catch (error) {
      history.push({ role: "assistant", content: String(error.message || error), err: true });
      store.set("lna.hist", history);
      renderAll();
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function autoSize() {
    input.style.height = "auto";
    input.style.height = Math.min(140, Math.max(44, input.scrollHeight)) + "px";
  }
  input.addEventListener("input", autoSize);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
  });
  sendBtn.onclick = () => send();
  $("suggestions").onclick = event => {
    if (event.target.id === "btnTest") { testConn(); return; }
    const button = event.target.closest("button[data-q]");
    if (button) send(button.dataset.q);
  };
  $("btnNew").onclick = () => {
    if (busy) return;
    history = [];
    store.set("lna.hist", []);
    renderAll();
    toast("Новый чат");
  };
  messagesEl.addEventListener("click", async event => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const message = history[+button.dataset.copy];
    if (!message) return;
    try { await navigator.clipboard.writeText(message.content); toast("Скопировано"); } catch (_) {}
  });

  renderAll();
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
