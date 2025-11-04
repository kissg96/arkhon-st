/* Arkhon Memory — SillyTavern Extension v0.9-beta */
if (window.__arkhon_disable) { console.log("[Arkhon] disabled"); }
if (window.__arkhon_loaded)  { console.log("[Arkhon] already loaded"); }
if (window.__arkhon_disable || window.__arkhon_loaded) { /* stop double-load */ }
else { window.__arkhon_loaded = true;

console.log("Arkhon extension loaded!");

// NAS base for identity (/whoami). Allow override via window or localStorage; strip trailing slash.
const NAS_BASE = (
  (window.ARKHON_NAS_BASE) ||
  localStorage.getItem("arkhon_nas_base") ||
  "https://arkhon.app"
).replace(/\/+$/, "");

// Local memory server (user’s own rig/notebook)
const MEMORY_BASE = (
  (window.ARKHON_MEMORY_BASE) ||
  localStorage.getItem("arkhon_memory_base") ||
  "http://127.0.0.1:9000"
).replace(/\/+$/, "");

/* ===== Version & Debug ===== */
const ARKHON_VERSION = "v0.9-beta";
const ARKHON_DEBUG = new URLSearchParams(location.search).get("arkhon_debug") === "1";
const d = (...a) => ARKHON_DEBUG && console.log("[Arkhon]", ...a);
console.log(`[Arkhon] ${ARKHON_VERSION} loaded`);

/* ===== Arkhon → inject memory into LLM payload (messages OR prompt) ===== */

// Non-echoable header the model should not repeat
const HEADER = '[Arkhon Context — for the assistant’s private use only. ' +
               'Incorporate silently; do NOT quote, reveal, or mention this block.]';

function insertAfterSystemPrelude(fullPrompt, block) {
  const markers = [
    /<<SYS>>[\s\S]*?<<\/SYS>>\s*/i,
    /<\|system\|>[\s\S]*?(?=<\|user\|>)/i,
    /###\s*System[\s\S]*?(?:\n{2,}|###\s*User)/i,
    /(?:^|\n){2}System:\s[\s\S]*?(?:\n{2,}|User:)/i
  ];
  for (const rx of markers) {
    const m = fullPrompt.match(rx);
    if (m && m.index != null) {
      const end = m.index + m[0].length;
      return fullPrompt.slice(0, end) + block + fullPrompt.slice(end);
    }
  }
  return block + fullPrompt; // fallback: prepend
}

(() => {
  if (window.__arkhon_fetch_patched) return;
  window.__arkhon_fetch_patched = true;

  const MAX_LINES = 8;
  const MAX_CHARS = 2000;

  const origFetch = window.fetch;
  window.fetch = async function(url, opts) {
    try {
      // [PATCH] ——— begin ———
      const u = (typeof url === 'string') ? url : (url && url.url) || '';

      // If calling the local memory server, forward FE token and bypass injection.
      if ((typeof url === 'string' ? url : (url && url.url) || '').startsWith(MEMORY_BASE)) {
        const t = localStorage.getItem("arkhon_user_token") || "";
        if (t) {
          if (opts && opts.headers && typeof opts.headers.set === "function") {
            // make sure the name is correct:
            opts.headers.set("Authorization", "Bearer " + t);
          } else {
            // when opts is undefined, create one AND pass it through
            opts = Object.assign({}, opts || {}, {
              headers: Object.assign({}, (opts && opts.headers) || {}, {
                Authorization: "Bearer " + t
              })
            });
          }
          // optional debug
          console.debug("[Arkhon] forwarded FE token", (typeof url === 'string' ? url : url.url));
        }
        // IMPORTANT: call with the modified opts (not ...apply(this, arguments))
        return origFetch(url, opts);
      }


      // NAS calls: attach FE token if present (safe before we enforce it server-side)
      if (u.startsWith(NAS_BASE)) {
        const t = localStorage.getItem("arkhon_user_token") || "";
        if (t) {
          if (opts && opts.headers && typeof opts.headers.set === "function") {
            opts.headers.set("Authorization", "Bearer " + t);
          } else {
            opts = Object.assign({}, opts || {}, {
              headers: Object.assign({}, (opts && opts.headers) || {}, {
                Authorization: "Bearer " + t
              })
            });
          }
          console.debug("[Arkhon] forwarded FE token to NAS");
        }
        // IMPORTANT: use modified opts so the header actually goes out
        return origFetch(url, opts);
      }

      if (opts && typeof opts.body === 'string') {
        const body = JSON.parse(opts.body);
        if (!body || body.__arkhonInjected) {
          return origFetch.apply(this, arguments);
        }

        // Fresh recalled lines?
        const fresh = typeof window.__arkhon_memory_ttl === 'number' && Date.now() < window.__arkhon_memory_ttl;
        const lines = fresh ? (window.__arkhon_memory || []).filter(Boolean) : [];
        if (lines.length > 0) {
          let text = lines.slice(0, MAX_LINES).join('\n');
          if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '…';

          let injected = false;

          // A) Chat mode
          if (Array.isArray(body.messages)) {
            const sysBlock = { role: 'system', content: `${HEADER}\n${text}` };
            const roles = body.messages.map(m => m && m.role);
            let idx = roles.lastIndexOf('user');
            if (idx < 0) idx = Math.max(0, body.messages.length - 1);
            body.messages.splice(idx, 0, sysBlock);
            injected = true;
          } else {
            // B) Prompt mode (string or array)
            const key = ['prompt','input','inputs','text','query'].find(k => body.hasOwnProperty(k));
            if (key) {
              const block = `${HEADER}\n${text}\n\n`;
              if (typeof body[key] === 'string') {
                body[key] = insertAfterSystemPrelude(body[key], block);
                injected = true;
              } else if (Array.isArray(body[key])) { // optional upgrade
                body[key] = body[key].map(v => typeof v === 'string' ? insertAfterSystemPrelude(v, block) : v);
                injected = true;
              }
            }
          }

          if (injected) {
            body.__arkhonInjected = true;
            opts.body = JSON.stringify(body);

            // one-shot reset
            window.__arkhon_memory = [];
            window.__arkhon_memory_ttl = 0;

            console.log('[Arkhon] injected memory into payload (' + (body.messages ? 'messages' : 'prompt') + ' mode)');
          }
        }
      }
    } catch (_) { /* ignore non-JSON / streams */ }

    return origFetch.apply(this, arguments);
  };

  console.log('[Arkhon] fetch monkey-patch active (dual-mode)');
})();


/* ===== State ===== */
let autoSaveTurns = 20; // default: save every 20 turns
let turnCounter = 0;
let __autosaving = false;
let __lastAutoSaveTs = 0;
let __sending = false;
let __inlineMounted = false;
let __inlineObs = null;

/* ===== AutoSave Counter State ===== */
let turnsSinceLastSave = 0;

/* ===== NAS (whoami) ===== */
// Global identity; ensure async init is awaited where needed
 let ARKHON_USER_ID = null;
 const __arkhonUserReady = ensureUserId().then(id => (ARKHON_USER_ID = id));

async function ensureUserId() {
  // 1) local cache fast-path
  let uid = localStorage.getItem("arkhon_user_id");
  if (uid) {
    // If we’re on a temp alias, always re-show the banner
    if (localStorage.getItem("arkhon_temp_alias") === "1") showTempBanner();
    return uid;
  }

  // 2) alias bootstrap
  let alias = localStorage.getItem("arkhon_alias");
  if (!alias) {
    injectAliasModal();

    return new Promise(resolve => {
      const input = document.getElementById("arkhon-alias-input");
      const errorBox = document.getElementById("arkhon-alias-error");

      document.getElementById("arkhon-save-alias").onclick = () => {
        const val = (input.value || "").trim();
        const tokenInput = document.getElementById("arkhon-token-input");
        const token = (tokenInput?.value || "").trim();

        // Validate alias
        if (!/^[A-Za-z0-9_]{3,32}$/.test(val)) {
          errorBox.textContent = "Alias must be 3–32 chars, only letters/numbers/underscores.";
          errorBox.style.display = "block";
          return;
        }

        // Validate token format (optional but helpful for beta users)
        if (token && !token.startsWith("tkn_")) {
          errorBox.textContent = "Invalid token format. Should start with 'tkn_'";
          errorBox.style.display = "block";
          return;
        }

        // Save alias
        alias = val;
        localStorage.setItem("arkhon_alias", alias);
        localStorage.removeItem("arkhon_temp_alias");

        // Save token if provided
        if (token) {
          localStorage.setItem("arkhon_user_token", token);
          console.log("[Arkhon] ✅ Token saved!");
        } else {
          console.log("[Arkhon] ℹ️ No token provided - using free tier");
        }

        document.getElementById("arkhon-alias-modal").remove();
        resolve(fetchUserId(alias));
      };

      document.getElementById("arkhon-temp-alias").onclick = () => {
        alias = "tester_" + Math.random().toString(36).slice(2, 8);
        localStorage.setItem("arkhon_alias", alias);
        localStorage.setItem("arkhon_temp_alias", "1"); // mark temp
        document.getElementById("arkhon-alias-modal").remove();
        resolve(fetchUserId(alias, true));
      };
    });
  }

  // 3) NAS identity issuance
  return fetchUserId(alias, localStorage.getItem("arkhon_temp_alias") === "1");
}

async function fetchUserId(alias, isTemp = false) {
  try {
    const res = await fetch(`${NAS_BASE}/whoami?alias=${encodeURIComponent(alias)}`, {
      // Some NAS deployments don’t need auth — keep our default headers but tolerate 401/403 fallbacks below
      headers: authHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.user_id) {
      localStorage.setItem("arkhon_user_id", data.user_id);
      console.log("[Arkhon] whoami:", data);
      if (isTemp) showTempBanner();
      return data.user_id;
    }
  } catch (err) {
    console.warn("[Arkhon] whoami failed; falling back to local UUID", err);
  }

  // 4) last-resort local UUID
  const uid = generateUUID();
  localStorage.setItem("arkhon_user_id", uid);
  if (isTemp) showTempBanner();
  return uid;
}

function injectAliasModal() {
  if (document.getElementById("arkhon-alias-modal")) return; // don’t double inject

  const modal = document.createElement("div");
  modal.id = "arkhon-alias-modal";
  modal.innerHTML = `
    <div class="arkhon-modal-backdrop">
      <div class="arkhon-modal">
        <h2>Welcome to Arkhon Beta! 🎉</h2>
        <p>Choose your alias to link memories across devices.</p>
        
        <label for="arkhon-alias-input" style="display:block; margin-top:10px; font-size:0.9em;">
          Alias (3-32 chars, letters/numbers/underscores)
        </label>
        <input id="arkhon-alias-input" type="text" placeholder="my_cool_alias" />
        
        <label for="arkhon-token-input" style="display:block; margin-top:15px; font-size:0.9em;">
          Beta Token (provided by email) 🔑
        </label>
        <input id="arkhon-token-input" type="text" placeholder="tkn_abc123..." />
        
        <div id="arkhon-alias-error" class="arkhon-error" style="display:none;"></div>
        <div class="arkhon-buttons">
          <button id="arkhon-save-alias">Get Started</button>
          <button id="arkhon-temp-alias">Try Without Token</button>
        </div>
        <p style="font-size:0.8em; color:#888; margin-top:10px;">
          No token? Register for early access: https://forms.gle/p8SgvhXtCvcC8WJG9
        </p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Inject CSS if not already present
  if (!document.getElementById("arkhon-alias-style")) {
    const style = document.createElement("style");
    style.id = "arkhon-alias-style";
    style.textContent = `
      .arkhon-modal-backdrop {
        position: fixed; 
        top: 0; 
        left: 0; 
        width: 100%; 
        height: 100%;
        background: rgba(0,0,0,0.6); 
        display: flex;
        align-items: flex-start;      /* ← CHANGED from 'center' to 'flex-start' */
        justify-content: center; 
        z-index: 9999;
        padding-top: 50px;             /* ← ADD THIS - gives top padding */
        overflow-y: auto;               /* ← ADD THIS - allows scrolling if needed */
      }
      .arkhon-modal {
        background: #1e1e1e; 
        color: #fff; 
        padding: 20px; 
        border-radius: 12px;
        max-width: 400px; 
        width: 90%; 
        box-shadow: 0 0 20px rgba(0,0,0,0.8);
        max-height: calc(100vh - 100px);  /* ← ADD THIS - prevents overflow */
        overflow-y: auto;                  /* ← ADD THIS - scroll if content too tall */
        margin-bottom: 50px;               /* ← ADD THIS - bottom spacing */
      }
      .arkhon-modal h2 { 
        margin-top: 0; 
      }
      .arkhon-modal input {
        width: 100%; 
        padding: 8px; 
        margin: 10px 0; 
        border-radius: 6px; 
        border: 1px solid #555;
        background: #2a2a2a; 
        color: #fff;
        box-sizing: border-box;  /* ← Important! */
      }
      .arkhon-error { 
        color: #ff6b6b; 
        margin-bottom: 8px; 
        font-size: 0.9em; 
      }
      .arkhon-buttons { 
        display: flex; 
        justify-content: space-between; 
        gap: 10px; 
        margin-top: 15px;
      }
      .arkhon-buttons button {
        flex: 1; 
        padding: 8px; 
        border: none; 
        border-radius: 6px; 
        cursor: pointer;
      }
      #arkhon-save-alias { 
        background: #4caf50; 
        color: white; 
      }
      #arkhon-temp-alias { 
        background: #ff9800; 
        color: white; 
      }
    `;
    document.head.appendChild(style);
  }
}

function showTempBanner() {
  if (document.getElementById("arkhon-temp-banner")) return;

  const banner = document.createElement("div");
  banner.id = "arkhon-temp-banner";
  banner.innerHTML = `
    ⚠️ Using temporary alias. Memories will not sync across devices. 
    <button id="arkhon-reset-alias">Reset alias</button>
  `;
  Object.assign(banner.style, {
    background: "#ff9800", color: "black", padding: "8px",
    position: "fixed", bottom: "0", left: "0", right: "0",
    textAlign: "center", fontWeight: "bold", zIndex: "9999"
  });
  document.body.appendChild(banner);

  document.getElementById("arkhon-reset-alias").onclick = () => {
    localStorage.removeItem("arkhon_alias");
    localStorage.removeItem("arkhon_user_id");
    localStorage.removeItem("arkhon_temp_alias");
    banner.remove();
    location.reload();
  };
}

/* ===== Utils ===== */
const jNAS     = (p) => `${NAS_BASE}${p}`;
const jMemory  = (p) => `${MEMORY_BASE}${p}`;
function authHeaders(extra = {}) {
  // No secrets in FE. Use only JSON content-type and allow per-call extras.
  return Object.assign({ "Content-Type": "application/json" }, extra);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function cleanTextForMemory(s = "", { gentle = false } = {}) {
  let out = String(s);

  // A) remove exact prelude only if it’s the *prefix*
  if (window.__arkhon_lastPrelude) {
    const prelude = String(window.__arkhon_lastPrelude).trim();
    if (prelude) {
      const norm = (t) => t.replace(/\r/g,"").replace(/[ \t]+\n/g,"\n");
      const nOut = norm(out), nPre = norm(prelude);
      if (nOut.startsWith(nPre)) out = nOut.slice(nPre.length);
    }
  }

  // B) normalize tag variants
  out = out.replace(/\[\s*\[\s*memory\s+context\s+start\s*\]\s*\]/gi, "[[MEMORY CONTEXT START]]")
           .replace(/\[\s*\[\s*memory\s+context\s+end\s*\]\s*\]/gi,   "[[MEMORY CONTEXT END]]");

  // remove a *single leading* tagged block only (don’t scrub mid-message)
  out = out.replace(/^(\s*\[\[MEMORY CONTEXT START\]\][\s\S]*?\[\[MEMORY CONTEXT END\]\]\s*)/, "");

  if (!gentle) {
    // C) aggressive header strip (keep as opt-in)
    out = out.replace(
      /^(?:\s*(?:-\s.*|\s{2,}.*)(?:\r?\n|$)){1,40}(?=(?:\s*\r?\n){1,}|You:|[A-Z][A-Za-z0-9_]{1,24}:\s|\*)/m,
      ""
    );
  }

  return out.trim();
}

function showToast(message, opts = {}) {
  let existing = document.getElementById("arkhon-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "arkhon-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed", bottom: "80px", right: "30px", zIndex: 9999,
    background: opts.success ? "var(--success-color, #43a047)" : "var(--bg-color, #444)",
    color: "var(--fg-color, #fff)", padding: "12px 18px", borderRadius: "8px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.2)", fontSize: "16px", opacity: "0.95",
    pointerEvents: "none"
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "opacity 0.7s";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 700);
  }, opts.duration || 1900);
}

// ultra-light toast; non-blocking
function toast(msg, kind="info") {
  const el = document.createElement("div");
  el.className = `arkhon-toast arkhon-${kind}`;
  el.textContent = msg;
  Object.assign(el.style, {
    position:"fixed", right:"12px", bottom:"12px",
    padding:"8px 10px", borderRadius:"8px",
    background: kind==="error" ? "#4b1b1b" : "#1b3b1b",
    color:"#fff", zIndex: 99999, fontSize:"12px"
  });
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 1800);
}

function qsAny(selCSV) {
  for (const s of selCSV.split(",").map(s=>s.trim())) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

/* ===== Status pill ===== */
let pill = null;
function ensurePill() {
  if (pill) return pill;
  pill = document.createElement("div");
  pill.id = "arkhon-pill";
  pill.textContent = "Idle";
  Object.assign(pill.style, {
    position:"fixed", top:"10px", right:"10px",
    padding:"4px 8px", borderRadius:"999px",
    background:"#222", color:"#ddd", fontSize:"11px",
    boxShadow:"0 1px 4px rgba(0,0,0,.3)", zIndex:99998
  });
  document.body.appendChild(pill);
  return pill;
}
function updateStatusPill(state) {
  const p = ensurePill();
  p.textContent = state;
}
updateStatusPill("Idle");

/* ===== AutoSave UI updater ===== */
function updateAutoSaveStatus() {
  const el = document.getElementById("arkhon-autosave-status");
  if (!el) return;
  if (autoSaveTurns === "off") {
    el.textContent = "Off";
    el.title = "Auto-save is disabled";
    return;
  }
  const n = Number(autoSaveTurns) || 0;
  const progress = Math.min(turnsSinceLastSave, n);
  el.textContent = `${progress} / ${n}`;
  el.title = `Auto-save every ${n} turns • ${n - progress} turn(s) to next save`;
}

/* ===== Chat & Memory Helpers ===== */
function getRecentChatMessages(limit = 50) {
  const all = Array.from(document.querySelectorAll('.mes'));
  return all.slice(-limit).map(el => {
    const isUser = el.getAttribute('is_user') === "true";
    const role = isUser ? "user" : (el.getAttribute('ch_name') || "assistant");
    const textNode = el.querySelector('.mes_text');
    const text = textNode ? (textNode.innerText || '').trim() : '';
    return { role, text, _el: el };
  });
}

function getLastExchanges(history, n) {
  const exchanges = [];
  let i = history.length - 1;
  while (i > 0 && exchanges.length < n) {
    while (i >= 0 && history[i].role === "user") i--;
    if (i <= 0) break;
    const assistantMsg = history[i];
    let j = i - 1;
    while (j >= 0 && history[j].role !== "user") j--;
    if (j < 0) break;
    const userMsg = history[j];
    if (j < i) {
      exchanges.unshift({ user: userMsg, assistant: assistantMsg });
      i = j - 1;
    } else i = j - 1;
  }
  return exchanges;
}

/* ===== Network helpers ===== */
async function postJSONWithRetry(url, body, {tries=3, backoff=600} = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const text = await r.text().catch(()=> "");
        throw new Error(`HTTP ${r.status}${text ? ` — ${text.slice(0,300)}` : ""}`);
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(res => setTimeout(res, backoff * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/* ===== Recall & injection ===== */
async function recallMemories(characterName, userMsg, topK = 5) {
  const uid = ARKHON_USER_ID || await ensureUserId();
  const res = await fetch(jMemory("/memories/recall"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ user_id: uid, character: characterName, query: userMsg, top_k: topK })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`recall failed: HTTP ${res.status}${t ? ` — ${t.slice(0,200)}` : ""}`);
  }
  return res.json();
}

function memoriesToPrelude(hits) {
  if (!Array.isArray(hits) || hits.length === 0) return "";
  const seen = new Set();
  const lines = hits
    .map(h => (h.text || h.message || [h.user_message, h.character_message].filter(Boolean).join(" / ") || "").trim())
    .filter(Boolean)
    .filter(line => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!lines.length) return "";
  return `[[MEMORY CONTEXT START]]\n${lines.join("\n")}\n[[MEMORY CONTEXT END]]\n\n`;
}

async function injectMemoriesBeforeSend(originalText, characterName) {
  // If the user already pasted a prelude, don’t recall/inject again.
  if (/\[\[\s*MEMORY\s+CONTEXT\s+START\s*\]\]/i.test(originalText)) return originalText;

  try {
    const t0 = performance.now();
    const hits = await recallMemories(characterName, originalText, 5);
    const dt = Math.round(performance.now() - t0);

    // 🔍 Debug raw recall hits
    console.log("[Arkhon DEBUG] Raw recall hits:", hits);

    d(`[Arkhon] Recalled ${hits?.length || 0} memories for "${characterName}" in ${dt}ms`);
    if (ARKHON_DEBUG && hits?.length) {
      console.table(
        hits.map((h, i) => ({
          idx: i + 1,
          id: h.id || h.memory_id || "(no id)",
          score: typeof h.score === "number" ? +h.score.toFixed(3) : null,
          preview: (h.text || h.message || h.user_message || "").replace(/\s+/g, " ").slice(0, 100) +
                   ((h.text || h.message || h.user_message || "").length > 100 ? "…" : "")
        }))
      );
    }

    window.__arkhon_lastRecall = {
      character: characterName,
      queryPreview: originalText.slice(0, 200),
      hitCount: hits?.length || 0,
      hits
    };

    const prelude = memoriesToPrelude(hits);

    // 🔍 Debug final prelude string
    console.log("[Arkhon DEBUG] Final prelude:", prelude);

    window.__arkhon_lastPrelude = prelude;
    d(`[Arkhon] injected ${prelude ? "YES" : "NO"} (${hits?.length || 0} items, +${prelude.length} chars)`);

    return prelude + originalText;
  } catch (e) {
    console.warn("Memory recall failed; sending original text.", e);
    return originalText;
  }
}

function hitsToLines(hits) {
  if (!Array.isArray(hits)) return [];
  const seen = new Set();
  const pick = (h) => (h.text || h.message || [h.user_message, h.character_message].filter(Boolean).join(' / ') || '').trim();
  return hits.map(pick)
             .filter(Boolean)
             .filter(line => { const k = line.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

async function prepareMemoriesForContext(userText, characterName) {
  try {
    const hits = await recallMemories(characterName, userText, 5);
    const lines = hitsToLines(hits);
    window.__arkhon_memory = lines;

    // ✅ TTL (freshness window for the next send)
    window.__arkhon_memory_ttl = Date.now() + 8000; // 8s

    // keep for cleaners; but since we no longer paste, clear prelude
    window.__arkhon_lastPrelude = '';
    console.log('[Arkhon] prepared', lines.length, 'memory lines for context');
  } catch (e) {
    console.warn('[Arkhon] prepareMemoriesForContext failed', e);
    window.__arkhon_memory = [];
    window.__arkhon_memory_ttl = 0;
  }
}

/* ===== Counters ===== */
function resetCountersAfterSave() {
  turnsSinceLastSave = 0;
  turnCounter = 0;
  updateAutoSaveStatus();
  updateStatusPill("Saved");
}

/* ===== Backend Ops (manual buttons) ===== */
function buildMemoryPayload({ userText, assistantText, char_name, important }) {
  const rawUser = String(userText || "");
  const rawAsst = String(assistantText || "");

  // gentle clean for saves (don’t over-trim bullets)
  const user = cleanTextForMemory(rawUser, { gentle: true });
  const assistant = cleanTextForMemory(rawAsst, { gentle: true });

  // combine; if cleaning produced empty, fall back to raw
  let combined = `${user}\n${assistant}`.trim();
  if (!combined) combined = `${rawUser}\n${rawAsst}`.trim();

  // final guard: if still empty, abort early
  if (!combined) {
    throw new Error("Empty memory after cleaning; not saving.");
  }

  return {
    memory_id: generateUUID(),
    char_name,
    user: "You",
    character: char_name,
    text: combined,
    message: combined,
    user_message: user,
    character_message: assistant,
    timestamp: new Date().toISOString(),
    important: !!important
  };
}

async function storeMemory() {
  const hist = getRecentChatMessages(50);
  const ex = getLastExchanges(hist, 1);
  if (!ex.length) return;
  const last = ex[0];
  const char_name = last.assistant?.role || "unknown";
  const payload = buildMemoryPayload({
    userText: last.user?.text,
    assistantText: last.assistant?.text,
    char_name,
    important: true
  });
  const uid = ARKHON_USER_ID || await ensureUserId();
  payload.user_id = uid;
  try {
    await postJSONWithRetry(jMemory("/memories"), payload, {tries:3, backoff:700});
    resetCountersAfterSave();
    showToast(`✅ Memory stored for ${char_name}`, {success:true});
  } catch (e) {
    showToast(`❌ Failed to store memory: ${e}`, {success:false, duration:3500});
  }
}

async function storeMemoryFromBubble(mesEl, { important = false } = {}) {
  try {
    const all = Array.from(document.querySelectorAll('#chat .mes'));
    const idx = all.indexOf(mesEl);
    if (idx < 0) throw new Error('bubble not in chat');

    const assistantText = cleanTextForMemory(mesEl.querySelector('.mes_text')?.innerText.trim() || '');
    const char_name = mesEl.getAttribute('ch_name') || 'unknown';

    let jIdx = idx - 1, userText = '';
    while (jIdx >= 0) {
      const isUser = all[jIdx].getAttribute('is_user') === 'true';
      if (isUser) { userText = cleanTextForMemory(all[jIdx].querySelector('.mes_text')?.innerText.trim() || ''); break; }
      jIdx--;
    }

    const payload = buildMemoryPayload({
      userText,
      assistantText,
      char_name,
      important
    });
    const uid = ARKHON_USER_ID || await ensureUserId();
    payload.user_id = uid;
    await postJSONWithRetry(jMemory('/memories'), payload, {tries:3, backoff:700});
    resetCountersAfterSave();
    showToast(`${important ? '⭐' : '✅'} Saved ${important ? 'Important ' : ''}memory for ${char_name}`, { success:true });
  } catch (err) {
    showToast(`❌ Save failed: ${err.message || err}`, { success:false, duration:3500 });
  }
}

async function fetchMemories() {
  const history = getRecentChatMessages(50);
  const lastExchange = getLastExchanges(history, 1)[0];
  const char_name = lastExchange?.assistant?.role || "unknown";
  const uid = ARKHON_USER_ID || await ensureUserId();
  try {
    const res = await fetch(
      jMemory(`/memories?user_id=${encodeURIComponent(uid)}&char_name=${encodeURIComponent(char_name)}`),
      { headers: authHeaders() }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showToast(`✅ ${data.length} memories for ${char_name}`, {success:true});
  } catch (e) {
    showToast(`❌ Fetch failed: ${e}`, {success:false, duration:3500});
  }
}
/* ===== AutoSave ===== */
function setAutoSaveTurns(n) {
  autoSaveTurns = n === "off" ? "off" : Number(n);
  localStorage.setItem("arkhon_autosave_turns", n);
  turnsSinceLastSave = 0;
  updateAutoSaveStatus();
}

function setupAutoSave() {
  const saved = localStorage.getItem("arkhon_autosave_turns");
  autoSaveTurns = saved === "off" ? "off" : Number(saved || 20);

  const chatNode = document.querySelector("#chat");
  if (!chatNode) return;

  const observer = new MutationObserver((muts) => {
    if (autoSaveTurns === "off") return;

    // count only when a *new assistant bubble* is added
    let assistantAdded = false;
    for (const m of muts) {
      m.addedNodes?.forEach(n => {
        if (
          n.nodeType === 1 &&
          n.classList?.contains("mes") &&
          n.getAttribute("is_user") !== "true"
        ) {
          assistantAdded = true;
        }
      });
    }
    if (!assistantAdded) return;

    // one new exchange completed
    turnsSinceLastSave++;
    updateAutoSaveStatus();

    turnCounter++;
    if (turnCounter % autoSaveTurns !== 0) return;

    // debounce duplicate bursts
    if (__autosaving || (Date.now() - __lastAutoSaveTs) < 300) return;
    __autosaving = true;

    // snapshot the last N exchanges
    const history   = getRecentChatMessages(autoSaveTurns * 4);
    const exchanges = getLastExchanges(history, autoSaveTurns);

    const posts = exchanges.map(async (ex) => {
      const char_name = ex.assistant?.role || "unknown";
      const payload = buildMemoryPayload({
        userText: ex.user?.text,
        assistantText: ex.assistant?.text,
        char_name,
        important: false
      });
      const uid = ARKHON_USER_ID || await ensureUserId();
      payload.user_id = uid;
      return postJSONWithRetry(jMemory("/memories"), payload, {tries:3, backoff:700});
    });

    Promise.all(posts)
      .then(() => {
        turnsSinceLastSave = 0;
        turnCounter = 0;
        updateAutoSaveStatus();
        updateStatusPill("Saved");
        showToast(`🔁 Auto-saved ${posts.length} turn(s)`, { success: true });
      })
      .catch((err) => {
        updateStatusPill("Error");
        showToast(`❌ Auto-save batch failed: ${err}`, { success: false, duration: 3500 });
      })
      .finally(() => {
        __autosaving = false;
        __lastAutoSaveTs = Date.now();
      });
  });

  observer.observe(chatNode, { childList: true, subtree: true });
}


/* ===== Send Intercept (hardened) ===== */
let input = null, sendButton = null;
let __sendClickHandler = null;
let __keyHandler = null;

function getActiveCharacterName() {
  const nodes = Array.from(document.querySelectorAll("#chat .mes")).reverse();
  const lastChar = nodes.find(n => n.getAttribute("is_user") !== "true");
  return lastChar?.getAttribute("ch_name") || "unknown";
}

function triggerSillyTavernSend() {
  if (typeof window.sendMessage === "function") {
    try { return window.sendMessage(); }
    catch (e) { console.warn("[Arkhon] sendMessage() failed, falling back:", e); }
  }
  if (sendButton && __sendClickHandler) {
    sendButton.removeEventListener("click", __sendClickHandler, { capture: true });
    sendButton.click();
    setTimeout(() => {
      try { sendButton.addEventListener("click", __sendClickHandler, { capture: true }); } catch {}
    }, 0);
  } else if (sendButton) {
    sendButton.click();
  }
}

function attachSendIntercept() {
  if (!input)  input  = qsAny("#send_textarea, textarea#send_textarea, #send_textarea_text, textarea#send_textarea_text");
  if (!sendButton) sendButton = qsAny("#send_but, #send_button, #send_butt");
  if (!input || !sendButton) return;

  async function interceptAndSend() {
    if (__sending) return;
    __sending = true;
    try {
      const userMsg = (input.value || "").trim();
      if (!userMsg) return;
      const character = getActiveCharacterName();

      await prepareMemoriesForContext(userMsg, character);
      // do NOT modify the input — keep the user's text clean
      input.value = userMsg;

      triggerSillyTavernSend();

      setTimeout(() => { try { input.value = ""; } catch {} }, 100);
    } finally {
      setTimeout(() => { __sending = false; }, 50);
    }
  }

  if (sendButton && !sendButton.__arkhonHooked) {
    __sendClickHandler = async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      await interceptAndSend();
    };
    sendButton.addEventListener("click", __sendClickHandler, { capture: true });
    sendButton.__arkhonHooked = true;
  }

  if (input && !input.__arkhonHooked) {
    __keyHandler = async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        await interceptAndSend();
      }
    };
    input.addEventListener("keydown", __keyHandler, { capture: true });
    input.__arkhonHooked = true;
  }
}

setInterval(attachSendIntercept, 1500);
attachSendIntercept();

function ensureControls() {
  if (!document.getElementById("arkhon-controls")) injectMemoryButtons();
}
setInterval(ensureControls, 1500);
injectMemoryButtons();
setupAutoSave();
mountInlineActions();

/* ===== Floating Controls (quick access) ===== */
function injectMemoryButtons() {
  if (document.getElementById("arkhon-controls")) return;

  const wrap = document.createElement("div");
  wrap.id = "arkhon-controls";
  Object.assign(wrap.style, {
    position:"fixed", bottom:"16px", right:"16px", zIndex:99999, display:"flex", flexDirection: "column", gap:"8px", alignItems:"stretch",
    pointerEvents:"auto"
  });

  const mkBtn = (label, onclick) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = onclick;
    Object.assign(b.style, {
      background: "var(--accent-color, #2196f3)", color: "var(--fg-color, #fff)",
      border:"none", borderRadius:"6px", padding:"6px 12px", cursor:"pointer",
      boxShadow:"0 2px 6px rgba(0,0,0,.25)"
    });
    return b;
  };

  wrap.appendChild(mkBtn("Fetch Memories", fetchMemories));
  wrap.appendChild(mkBtn("Store Memory", storeMemory));

  const label = document.createElement("label");
  label.textContent = "Autosave:";
  Object.assign(label.style, {
    background:"var(--bg-color, #222)", color:"var(--fg-color, #fff)",
    borderRadius:"6px", padding:"6px 8px", display:"inline-flex", alignItems:"center", gap:"6px"
  });

  const sel = document.createElement("select");
  ["off", 1, 5, 10, 20, 30, 50].forEach(v => {
    const o = document.createElement("option");
    o.value = String(v);
    o.textContent = String(v);
    sel.appendChild(o);
  });
  sel.value = localStorage.getItem("arkhon_autosave_turns") || "20";
  sel.onchange = e => setAutoSaveTurns(e.target.value);

  label.appendChild(sel);

  const counter = document.createElement("span");
  counter.id = "arkhon-autosave-status";
  Object.assign(counter.style, {
    background:"var(--bg-color, #111)",
    color:"var(--fg-color, #fff)",
    padding:"2px 6px",
    borderRadius:"4px",
    fontSize:"11px",
    border:"1px solid var(--Border, rgba(255,255,255,0.12))",
    pointerEvents:"none"
  });
  label.appendChild(counter);

  wrap.appendChild(label);
  document.body.appendChild(wrap);

  updateAutoSaveStatus();
}

/* ===== Inline (per-message) Actions ===== */
function ensureArkhonInlineStyle() {
  if (document.getElementById('arkhon-inline-style')) return;
  const css = `
  .arkhon-rel { position: relative; }
  .arkhon-msg-actions {
    position: absolute; top: 6px; right: 8px; display: flex; gap: 6px;
    opacity: 0; pointer-events: none; transition: opacity 150ms ease, transform 120ms ease;
    transform: translateY(-2px); z-index: 2;
  }
  .arkhon-actions-always .arkhon-msg-actions { opacity: 1; pointer-events: auto; transform: translateY(0); }
  .mes:hover .arkhon-msg-actions,
  .mes:focus-within .arkhon-msg-actions { opacity: 1; pointer-events: auto; transform: translateY(0); }
  #chat .mes { overflow: visible !important; }

  .arkhon-msg-action {
    display:inline-flex; align-items:center; gap:6px; padding:4px 8px; font:inherit; font-size:12px; line-height:1;
    border-radius:8px; border:1px solid var(--Border, rgba(255,255,255,0.12));
    color:var(--fg-color, #ddd);
    background: color-mix(in srgb, var(--bg-color, #111) 85%, transparent);
    backdrop-filter: blur(2px);
    cursor:pointer; user-select:none; transition: transform 100ms ease, background 120ms ease, opacity 120ms ease;
    opacity:.95;
  }
  .arkhon-msg-action:hover { transform: translateY(-1px); opacity:1; }
  .arkhon-msg-action:active { transform: translateY(0); }
  .arkhon-msg-action svg { width:14px; height:14px; }
  .arkhon-msg-action.save { border-color: color-mix(in srgb, var(--accent-color, #6cf) 40%, transparent); }
  .arkhon-msg-action.important { border-color: color-mix(in srgb, var(--accent-color, #6cf) 60%, transparent); }
  .arkhon-msg-action.important.active { outline: 1px solid var(--accent-color, #6cf); opacity: 1; }
  `;
  const style = document.createElement('style');
  style.id = 'arkhon-inline-style';
  style.textContent = css;
  document.head.appendChild(style);
}

function findActionsHost(mesEl) {
  return mesEl.querySelector('.mes_actions, .mes__actions, .extraMesButtons, .message-actions, .msg-actions');
}

function buildInlineActionsForMessage(mesEl) {
  if (!mesEl || mesEl.dataset.arkhonInline === '1') return;
  const isUser = mesEl.getAttribute('is_user') === 'true';
  if (isUser) { mesEl.dataset.arkhonInline = '1'; return; }

  const host = findActionsHost(mesEl);
  const actionsWrap = document.createElement('div');
  actionsWrap.className = 'arkhon-msg-actions';
  if (host) {
    actionsWrap.style.position = 'static';
    actionsWrap.style.transform = 'none';
    actionsWrap.style.opacity = '1';
    actionsWrap.style.pointerEvents = 'auto';
    actionsWrap.style.gap = '4px';
  } else if (getComputedStyle(mesEl).position === 'static') {
    mesEl.classList.add('arkhon-rel');
  }

  const iconSave = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 5h10l4 4v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5z" stroke="currentColor" stroke-width="1.5"/><path d="M7 5v4h8V5" stroke="currentColor" stroke-width="1.5"/></svg>`;
  const iconStar = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3l2.9 6.2 6.8.6-5.1 4.6 1.5 6.6L12 17.9 5.9 21l1.5-6.6-5.1-4.6 6.8-.6L12 3z" stroke="currentColor" stroke-width="1.5"/></svg>`;

  const btnSave = document.createElement('button');
  btnSave.className = 'arkhon-msg-action save';
  btnSave.title = 'Save this exchange to memory';
  btnSave.innerHTML = `${iconSave}<span>Save</span>`;
  btnSave.setAttribute('aria-label','Save this exchange to memory');
  btnSave.setAttribute('tabindex','0');

  const btnImportant = document.createElement('button');
  btnImportant.className = 'arkhon-msg-action important';
  btnImportant.title = 'Save as Important';
  btnImportant.innerHTML = `${iconStar}<span>Important</span>`;
  btnImportant.setAttribute('aria-label','Save as Important');
  btnImportant.setAttribute('tabindex','0');

  // Manual saves should be important=true per spec
  btnSave.addEventListener('click', async (e) => {
    e.stopPropagation();
    await storeMemoryFromBubble(mesEl, { important: true });
  });
  btnImportant.addEventListener('click', async (e) => {
    e.stopPropagation();
    btnImportant.disabled = true;
    btnImportant.classList.add('active');
    try { await storeMemoryFromBubble(mesEl, { important: true }); }
    catch { btnImportant.disabled = false; btnImportant.classList.remove('active'); }
  });
  [btnSave, btnImportant].forEach(b=>{
    b.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); }
    });
  });

  actionsWrap.appendChild(btnSave);
  actionsWrap.appendChild(btnImportant);
  (host || mesEl).appendChild(actionsWrap);
  mesEl.dataset.arkhonInline = '1';
}

function mountInlineActions() {
  if (__inlineMounted) return;
  __inlineMounted = true;

  ensureArkhonInlineStyle();

  const chat = document.querySelector('#chat');
  if (!chat) { __inlineMounted = false; return; }

  Array.from(chat.querySelectorAll('.mes')).forEach(buildInlineActionsForMessage);

  __inlineObs = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes?.forEach(n => {
        if (n.nodeType === 1 && n.classList?.contains('mes')) buildInlineActionsForMessage(n);
      });
    }
  });
  __inlineObs.observe(chat, { childList: true, subtree: true });

  // periodic self-heal
  setInterval(() => {
    Array.from(document.querySelectorAll('#chat .mes')).forEach(buildInlineActionsForMessage);
  }, 2500);

  window.addEventListener('beforeunload', () => { try { __inlineObs?.disconnect(); } catch {} });
}

// Health-check both NAS and Memory servers
Promise.allSettled([
  fetch(jNAS("/ping")),
  fetch(jMemory("/ping"))
])
  .then(results => {
    console.log("Ping results:", results);
  })
  .catch(err => {
    console.warn("Backend not reachable — UI still mounted", err);
  });

} // __arkhon_loaded guard end