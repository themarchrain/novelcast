# -*- coding: utf-8 -*-
"""
NovelCast 本地 VoxCPM 语音服务（零额外依赖，仅 Python 标准库 + voxcpm）。

用法（在 VoxCPM 项目根目录下，用它的虚拟环境运行）：
    .venv/Scripts/python.exe <novelcast>/scripts/voxcpm_server.py
可选参数：
    --model  VoxCPM 模型目录（默认自动探测 novelcast 同级的 VoxCPM/models/OpenBMB/VoxCPM2）
    --port   监听端口（默认 18511，或环境变量 VOXCPM_PORT）
    --host   监听地址（默认 127.0.0.1）
    --timesteps 推理步数（默认 10，越小越快、音质略降，建议 4~30）

接口：
    GET  /health            -> {"ok":true,"ready":bool,"sample_rate":int}
    POST /tts               -> body {"speaker":"male|female","text":"台词"}
                              返回 WAV 音频（48kHz 单声道 PCM16）
说明：
    - 首次使用某个音色时会用 Voice Design 生成一段自我介绍作为该音色的
      参考样本（缓存到 data/voices/），之后所有台词通过参考样本克隆，
      保证整期播客音色一致、情感一致。
    - 模型推理串行执行（单 GPU）。
"""

import argparse
import io
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_DIR_CANDIDATES = [
    # novelcast 的同级 VoxCPM 目录（scripts/ 的上两级再进 VoxCPM）
    os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "VoxCPM", "models", "OpenBMB", "VoxCPM2")),
    os.environ.get("VOXCPM_MODEL_PATH", ""),
]

# 两位"主播"的音色设计与开场白（开场白同时作为克隆参考样本的文本）
VOICES = {
    "male": {
        "design": "年轻男声主播，声音温暖有活力，吐字清晰，语气自然放松，像和朋友聊天",
        "intro": "哈喽大家好，欢迎收听我们的播客节目，我是男主播阿远，今天咱们接着聊这本小说。",
    },
    "female": {
        "design": "年轻女声主播，声音清亮甜美，节奏明快，语气生动有感染力",
        "intro": "大家好呀，我是女主播小雅，很开心又和大家见面了，这一章的内容特别精彩。",
    },
}

CFG_VALUE = 2.0

_lock = threading.Lock()
_state = {"model": None, "sample_rate": 48000, "ready": False, "error": None}
_voice_refs: dict = {}  # speaker -> {"wav": path, "text": intro}


def find_model_dir(cli_value):
    candidates = []
    if cli_value:
        candidates.append(cli_value)
    candidates.extend(MODEL_DIR_CANDIDATES)
    for c in candidates:
        if c and os.path.isdir(c) and os.path.isfile(os.path.join(c, "config.json")):
            return c
    raise SystemExit(
        "未找到 VoxCPM 模型目录。请用 --model 指定包含 config.json 的模型目录，"
        "或设置环境变量 VOXCPM_MODEL_PATH。"
    )


def load_model(model_dir):
    from voxcpm import VoxCPM

    print(f"[voxcpm] loading model from {model_dir} ...", flush=True)
    t0 = time.time()
    model = VoxCPM.from_pretrained(model_dir, load_denoiser=False)
    sr = int(model.tts_model.sample_rate)
    _state["model"] = model
    _state["sample_rate"] = sr
    _state["ready"] = True
    print(f"[voxcpm] model ready in {time.time() - t0:.0f}s, sample_rate={sr}", flush=True)


def ensure_voice(speaker, timesteps):
    """生成并缓存每个音色的参考样本（Voice Design 一次，之后克隆）。"""
    if speaker in _voice_refs:
        return _voice_refs[speaker]
    model = _state["model"]
    spec = VOICES[speaker]
    cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "voices")
    os.makedirs(cache_dir, exist_ok=True)
    wav_path = os.path.normpath(os.path.join(cache_dir, f"{speaker}.wav"))

    if not os.path.isfile(wav_path):
        design_text = f"({spec['design']}){spec['intro']}"
        print(f"[voxcpm] designing voice '{speaker}' ...", flush=True)
        wav = model.generate(
            text=design_text, cfg_value=CFG_VALUE, inference_timesteps=timesteps
        )
        import soundfile as sf

        sf.write(wav_path, wav, _state["sample_rate"])
    _voice_refs[speaker] = {"wav": wav_path, "text": spec["intro"]}
    return _voice_refs[speaker]


def tts_bytes(speaker, text, timesteps):
    import soundfile as sf

    model = _state["model"]
    ref = ensure_voice(speaker, timesteps)
    # 克隆模式：参考音频 + 参考文本；台词本身不再带音色描述
    wav = model.generate(
        text=text,
        prompt_wav_path=ref["wav"],
        prompt_text=ref["text"],
        cfg_value=CFG_VALUE,
        inference_timesteps=timesteps,
    )
    buf = io.BytesIO()
    sf.write(buf, wav, _state["sample_rate"], format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # 安静一点
        pass

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {
                "ok": True,
                "ready": _state["ready"],
                "sample_rate": _state["sample_rate"],
                "error": _state["error"],
            })
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/tts"):
            self._json(404, {"error": "not found"})
            return
        if not _state["ready"]:
            self._json(503, {"error": f"模型未就绪: {_state['error'] or '加载中'}"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            speaker = body.get("speaker", "female")
            text = (body.get("text") or "").strip()
            timesteps = int(body.get("timesteps", ARGS.timesteps))
            if speaker not in VOICES:
                raise ValueError(f"未知 speaker: {speaker}")
            if not text:
                raise ValueError("text 不能为空")
            # 台词过长时按句切分逐段合成，避免单次生成过长
            chunks = split_text(text, 160)
            audios = []
            with _lock:
                for c in chunks:
                    audios.append(tts_bytes(speaker, c, timesteps))
            wav = concat_wav(audios)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            self.wfile.write(wav)
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})


def split_text(text, max_len):
    if len(text) <= max_len:
        return [text]
    parts = []
    cur = ""
    for sentence in re.split(r"(?<=[。！？；!?;\n])", text):
        if len(cur) + len(sentence) > max_len and cur:
            parts.append(cur)
            cur = sentence
        else:
            cur += sentence
    if cur:
        parts.append(cur)
    return parts


def concat_wav(chunks):
    """按 RIFF 结构拼接多个 PCM16 WAV（同采样率同声道）。"""
    import struct

    datas = []
    sample_rate = None
    channels = None
    bits = None
    for c in chunks:
        if c[0:4] != b"RIFF" or c[8:12] != b"WAVE":
            raise ValueError("非 WAV 数据")
        pos = 12
        while pos + 8 <= len(c):
            cid = c[pos:pos + 4]
            size = struct.unpack("<I", c[pos + 4:pos + 8])[0]
            if cid == b"fmt ":
                fmt = struct.unpack("<HHIIHH", c[pos + 8:pos + 24])
                channels, sample_rate, bits = fmt[1], fmt[2], fmt[5]
            elif cid == b"data":
                datas.append(c[pos + 8:pos + 8 + size])
            pos += 8 + size + (size % 2)
    data = b"".join(datas)
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    header = b"RIFF" + struct.pack(
        "<I", 36 + len(data)
    ) + b"WAVEfmt " + struct.pack(
        "<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits
    ) + b"data" + struct.pack("<I", len(data))
    return header + data


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=None)
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOXCPM_PORT", "18511")))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--timesteps", type=int, default=10)
    ARGS = parser.parse_args()

    model_dir = find_model_dir(ARGS.model)
    try:
        load_model(model_dir)
    except Exception as e:  # noqa: BLE001
        _state["error"] = str(e)
        print(f"[voxcpm] load failed: {e}", file=sys.stderr, flush=True)
        # 依旧启动 HTTP，health 会报错，便于上层诊断

    server = ThreadingHTTPServer((ARGS.host, ARGS.port), Handler)
    print(f"[voxcpm] listening on http://{ARGS.host}:{ARGS.port}", flush=True)
    server.serve_forever()
