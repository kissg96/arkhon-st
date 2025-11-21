import os
import json
import requests
import uuid
from pathlib import Path
from datetime import datetime, timezone
from flask import Flask, request, jsonify, abort
from flask_cors import CORS
import numpy as np
import faiss
import logging
from sentence_transformers import SentenceTransformer

app = Flask(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

# Allow SillyTavern frontend origins
CORS(app,
     resources={r"/*": {"origins": "*"}},
     supports_credentials=True,
     allow_headers=["Content-Type", "Authorization"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])

API_TOKEN = os.getenv("ARKHON_API_TOKEN", "")
NAS_SCORER_BASE = os.getenv("ARKHON_NAS_SCORER", "https://arkhon.app")

MEMORY_DIR = Path(os.getenv("ARKHON_DATA_DIR", Path.cwd() / "arkhon_data"))
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

MODEL_NAME = os.getenv("ARKHON_EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
MODEL_DIR  = Path(os.getenv("ARKHON_MODEL_DIR", "./models")).resolve()
MODEL_DIR.mkdir(parents=True, exist_ok=True)

_EMBEDDER = None
def get_embedder():
    global _EMBEDDER
    if _EMBEDDER is None:
        _EMBEDDER = SentenceTransformer(MODEL_NAME, device="cpu", cache_folder=str(MODEL_DIR))
        _ = _EMBEDDER.encode(["warmup"], normalize_embeddings=True, show_progress_bar=False)
    return _EMBEDDER

EMBEDDING_DIM = get_embedder().get_sentence_embedding_dimension()
TOPK_CANDIDATES = 24
FINAL_CAP = 12

REQUIRE_AUTH = os.getenv("ARKHON_REQUIRE_AUTH", "0") == "1"
def ensure_auth():
    if not REQUIRE_AUTH:
        return
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth.split(" ", 1)[1] != API_TOKEN:
        abort(401)

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Max-Age'] = '3600'
    return response

def ensure_user_dir(user_id: str, char_name: str) -> Path:
    safe_user = "".join(c for c in str(user_id) if c not in "\\/:*?\"<>|").strip() or "anon"
    safe_char = "".join(c for c in str(char_name) if c not in "\\/:*?\"<>|").strip() or "default"
    base_dir = MEMORY_DIR / safe_user / safe_char
    if not base_dir.exists():
        logging.warning(f"[BETA] New folder created for user_id='{safe_user}', char='{safe_char}'.")
        base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir

class ArkhonMemory:
    def __init__(self, user_id: str, character: str):
        self.user_id = "".join(c for c in str(user_id) if c not in "\\/:*?\"<>|").strip() or "anon"
        self.character = "".join(c for c in str(character) if c not in "\\/:*?\"<>|").strip() or "default"
        base_dir = ensure_user_dir(self.user_id, self.character)
        self.filepath  = base_dir / "memories.jsonl"
        self.indexpath = base_dir / "memories.faiss"
        self.mappath   = base_dir / "memories.map.json"   # FAISS row -> memory_id
        self.embedder  = get_embedder()

    def save(self, memory: dict):
        text = (memory.get("text")
                or memory.get("message")
                or " / ".join(x for x in [memory.get("user_message"), memory.get("character_message")] if x)
                or "").strip()
        if not text:
            raise ValueError("text is required")

        memory_id = memory.get("memory_id") or str(uuid.uuid4())

        ts = memory.get("timestamp")
        if ts:
            ts = str(ts).strip()
        else:
            ts = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

        important = bool(memory.get("important", False))

        rec = {
            "memory_id": memory_id,
            "char_name": self.character,
            "user": self.user_id,
            "character": self.character,
            "text": text,
            "timestamp": ts,
            "important": important,
        }

        with self.filepath.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        return {"memory_id": memory_id, "timestamp": ts, "important": important}

    def load_all(self):
        if not self.filepath.exists():
            return []
        out = []
        with self.filepath.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                pruned = {
                    "memory_id": rec.get("memory_id"),
                    "char_name": rec.get("char_name") or rec.get("character"),
                    "user": rec.get("user"),
                    "character": rec.get("character") or rec.get("char_name"),
                    "text": (rec.get("text") or rec.get("message") or "").strip(),
                    "timestamp": rec.get("timestamp"),
                    "important": bool(rec.get("important", False)),
                }
                if pruned["text"]:
                    out.append(pruned)
        return out

    def build_index(self):
        memories = self.load_all()
        if not memories:
            return
        vectors, row_map = [], []
        for m in memories:
            text = (m.get("text") or "").strip()
            if not text:
                continue
            emb = self.embedder.encode(text, normalize_embeddings=True)
            vectors.append(emb.astype("float32"))
            row_map.append(m.get("memory_id"))
        if not vectors:
            return
        arr = np.vstack(vectors).astype("float32")
        index = faiss.IndexFlatIP(EMBEDDING_DIM)
        index.add(arr)
        faiss.write_index(index, str(self.indexpath))
        with self.mappath.open("w", encoding="utf-8") as f:
            json.dump(row_map, f)

    def _ensure_index(self):
        if not self.indexpath.exists() or not self.mappath.exists():
            self.build_index()
        return self.indexpath.exists() and self.mappath.exists()

    def recall(self, query: str, top_k: int = TOPK_CANDIDATES, min_score: float = 0.0):
        if not self._ensure_index():
            return []
        index = faiss.read_index(str(self.indexpath))
        try:
            row_map = json.loads(self.mappath.read_text(encoding="utf-8"))
        except Exception:
            row_map = []
        qvec = self.embedder.encode(query, normalize_embeddings=True).reshape(1, -1).astype("float32")
        scores, indices = index.search(qvec, top_k)
        out = []
        for idx, s in zip(indices[0], scores[0]):
            if idx < 0 or s < min_score:
                continue
            mem_id = row_map[idx] if 0 <= idx < len(row_map) else None
            if mem_id:
                out.append({"memory_id": mem_id, "faiss_score": float(s)})
        return out

    def load_by_ids(self, ids: set[str]) -> list[dict]:
        if not ids:
            return []
        found = []
        try:
            with self.filepath.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    mid = rec.get("memory_id")
                    if mid in ids:
                        pruned = {
                            "memory_id": rec.get("memory_id"),
                            "char_name": rec.get("char_name") or rec.get("character"),
                            "user": rec.get("user"),
                            "character": rec.get("character") or rec.get("char_name"),
                            "text": (rec.get("text") or rec.get("message") or "").strip(),
                            "timestamp": rec.get("timestamp"),
                            "important": bool(rec.get("important", False)),
                        }
                        found.append(pruned)
                        if len(found) == len(ids):
                            break
        except FileNotFoundError:
            pass
        return found

@app.get("/health")
def health():
    return jsonify(ok=True, time=datetime.now(timezone.utc).isoformat())

@app.get("/version")
def version():
    return jsonify(version="0.9-beta")

@app.route("/memories", methods=["POST"])
def store_memory():
    ensure_auth()
    payload   = request.get_json(silent=True) or {}
    user_id   = payload.get("user_id", "anon")
    char_name = payload.get("char_name") or payload.get("character") or "default"
    try:
        hub  = ArkhonMemory(user_id, char_name)
        meta = hub.save(payload)
        fe_auth = request.headers.get("Authorization", "")
        headers = {"Content-Type": "application/json"}
        if fe_auth.startswith("Bearer "):
            headers["Authorization"] = fe_auth
        else:
            logging.info("[META->NAS] skipped (no FE token)")
            headers = None

        if headers:
            try:
                nas_meta_path = os.getenv("ARKHON_NAS_META_PATH", "/meta")
                url  = f"{NAS_SCORER_BASE.rstrip('/')}{nas_meta_path}"
                resp = requests.post(
                    url,
                    headers=headers,
                    json={"user_id": user_id, "character": char_name, **meta},
                    timeout=4
                )
                logging.info("[META->NAS] %s %s", resp.status_code, resp.text[:160])
            except Exception as e:
                logging.warning("[META->NAS] failed: %s", e)

        hub.build_index()
        return jsonify({"status": "stored", **meta})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/memories", methods=["GET"])
def get_memories():
    ensure_auth()
    user_id   = request.args.get("user_id", "anon")
    char_name = request.args.get("char_name") or request.args.get("character") or "default"
    try:
        hub = ArkhonMemory(user_id, char_name)
        return jsonify(hub.load_all())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/memories/recall", methods=["POST"])
def recall_memories():
    ensure_auth()
    req = request.get_json(silent=True) or {}
    user_id   = req.get("user_id", "anon")
    char_name = req.get("char_name") or req.get("character") or "default"
    query = (req.get("query") or "").strip()
    top_k     = int(req.get("top_k", 5))

    try:
        hub = ArkhonMemory(user_id, char_name)

        cands = hub.recall(query, top_k=top_k)

        if cands:
            ids = {c["memory_id"] for c in cands}
            local = {r["memory_id"]: (bool(r.get("important", False)), r.get("timestamp"))
                     for r in hub.load_by_ids(ids)}
            for c in cands:
                imp, ts = local.get(c["memory_id"], (False, None))
                c["important"] = imp
                if ts:
                    c["timestamp"] = ts

        selected_ids = []
        if cands:
            fe_auth = request.headers.get("Authorization", "")
            headers = {"Content-Type": "application/json"}
            if fe_auth.startswith("Bearer "):
                headers["Authorization"] = fe_auth
                try:
                    nas_score_path = os.getenv("ARKHON_NAS_SCORE_PATH", "/score")
                    url = f"{NAS_SCORER_BASE.rstrip('/')}{nas_score_path}"
                    payload = {"user_id": user_id, "character": char_name, "candidates": cands}
                    r = requests.post(url, headers=headers, json=payload, timeout=6)
                    if r.ok:
                        data = r.json()
                        selected_ids = data.get("selected", data if isinstance(data, list) else [])
                    else:
                        logging.warning("[SCORE->NAS] HTTP %s: %s", r.status_code, r.text[:200])
                except Exception as e:
                    logging.warning("[SCORE->NAS] failed: %s", e)
            else:
                logging.info("[SCORE->NAS] skipped (no FE token)")

        if not selected_ids and cands:
            selected_ids = [c["memory_id"] for c in cands[:FINAL_CAP]]

        hydrated = hub.load_by_ids(set(selected_ids))
        order = {mid: i for i, mid in enumerate(selected_ids)}
        hydrated.sort(key=lambda rec: order.get(rec.get("memory_id"), 1_000_000))
        return jsonify(hydrated)
    except Exception as e:
        logging.info("[RECALL] soft-fail: %s", e)
        return jsonify([]), 200

@app.route('/<path:path>', methods=['OPTIONS'])
@app.route('/', methods=['OPTIONS'])
def handle_options(path=None):
    response = jsonify({"status": "ok"})
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Max-Age'] = '3600'
    return response, 200

@app.get("/ping")
def ping():
    return jsonify({"status": "pong", "message": "pong"})

# For advanced Linux users - pip install gunicorn needed if uncommented!!!
# if __name__ == "__main__":
#    import sys, subprocess
#    cmd = [
#        sys.executable, "-m", "gunicorn",
#        "-w", "1",
#        "-b", "0.0.0.0:9000",
#        "memory_server:app"
#    ]
#    print("Starting gunicorn:", " ".join(cmd))
#    subprocess.run(cmd)

# For local default users - comment out if using gunicorn!!!
if __name__ == "__main__":
    from waitress import serve
    print("Welcome to CATH. Starting waitress on http://0.0.0.0:9000 ...")
    serve(app, host="0.0.0.0", port=9000)