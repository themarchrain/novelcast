# NovelCast · 小说播客工坊

把一章小说变成一档可听的播客：给一个章节地址，系统获取正文 → AI 改写成单播/双播讲解脚本 → TTS 合成 → 在线播放或下载 MP3。

https://github.com/user-attachments/assets/063ab22a-29d4-4e40-99c4-7e88c10acc42

> **本项目不含任何针对具体网站的爬取器。**"章节文本从哪来"由数据源（Source）决定——仓库内置零数据源，把你的源放入 `extensions-local/sources/` 即注册使用，详见下方[数据源](#数据源source)一节。

当前支持两种输入通道：**URL 单章**（贴入章节页地址）与 **TXT 整本书批量**（上传整本 TXT，按章多选，批量产出）。

## 快速开始

```bash
npm install

# 开发模式（前端 Vite 5173 + 后端 tsx watch 7749，已配代理）
npm run dev        # 打开 http://localhost:5173

# 生产模式（单进程，后端托管前端静态产物）
npm run build
npm start          # 打开 http://127.0.0.1:7749
```

生成播客需要两样东西：

1. **AI 接口**（必须）：设置页配置一个 OpenAI 兼容接口（BaseURL + API Key + 模型名）。未配置时首页会出现提醒。
2. **至少一个数据源**（必须）：仓库内置零源，见下节。

## 数据源（Source）

核心只做三件事：**接收一章全量文本 → LLM 写稿 → 语音合成**。文本从哪来，核心不关心——那是"源"的事：

- 仓库**刻意不内置**任何站点爬取逻辑；每个使用者按自己的需要实现源；
- 把源放入 `extensions-local/sources/<源名>/`（入口 `index.ts` 或 `index.js`），**重启服务即注册**；该目录已被 gitignore，私有实现与调试代码永不入库；
- 输入章节地址后，按注册顺序自动匹配第一个命中的源（`matchUrl`），也可在首页手动指定；
- 接口契约见 [`server/sources/types.ts`](server/sources/types.ts)：`NovelSource { id, label, matchUrl?, inputs, listChapters, fetchChapter }`——爬取、解密、清洗全部发生在源内部，核心只接收一章全量文本。
- 声明了 `type:'file'` 输入的源构成 **TXT 批量通道**：上传的文件由核心原样落盘到 `data/uploads/<id>/<原文件名>`，源拿到的输入值是文件绝对路径——读取、分章、取章全部在源内部；首页会列出该源解析出的章节供多选，选中后按章入队依次产出。

**为什么只有静态扩展**：运行时上传注册代码等于让任何能访问服务的人以服务进程身份执行任意代码；目录加载的代码与主程序同信任级别，且任何改动必须经过一次重启——重启即审计点。

## 语音合成：三条通道

| 通道 | 质量 | 成本 | 速度 | 前提 |
|---|---|---|---|---|
| **本地 VoxCPM**（推荐默认） | ★★★★★ 上下文感知、情感自然（OpenBMB VoxCPM2，2025 开源） | 免费 | 慢：约音频时长的 3\~5 倍（RTX 4060 实测），一章 4000 字约 30\~50 分钟后台合成 | 本机 GPU + VoxCPM 环境 + 启动本地服务 |
| **SiliconFlow CosyVoice2** | ★★★★ 情感自然 | 极低：按输入 UTF-8 字节计费，一章几毛钱 | 秒级 | 注册 siliconflow.cn 充几块钱拿 API Key |
| **Edge 神经语音** | ★★★ 可用但平（免费端点只支持纯文本，无韵律控制） | 免费 | 快 | 无 |

设置页可一键切换、试听；SiliconFlow 通道有"一键填入预设"按钮（CosyVoice2 的 8 个预置音色 + 语气指令）。

### 启动本地 VoxCPM 服务

前提：本机有 NVIDIA 显卡，且已有 VoxCPM 项目（含虚拟环境 `.venv` 与模型 `models/OpenBMB/VoxCPM2`）。服务脚本会自动探测 novelcast 同级目录下的 `VoxCPM/models/OpenBMB/VoxCPM2`：

```bash
# 在 VoxCPM 项目根目录执行
.venv\Scripts\python.exe <novelcast目录>\scripts\voxcpm_server.py
```

- 首次启动加载模型约 2 分钟，看到 `listening on http://127.0.0.1:18511` 即就绪
- 每个音色首次使用时用 Voice Design（音色文字描述）生成一次参考样本（缓存在 `data/voices/`），之后所有台词克隆该样本——保证整期播客音色一致
- 想换音色：改设置页的"音色描述"，并删除 `data/voices/male.wav` / `female.wav`
- 想快：`--timesteps 4`（默认 10 质量最好；4 约快一倍），或直接用 SiliconFlow 云端

## 功能

| 功能 | 说明 |
|---|---|
| 输入通道 | **URL 单章**：按注册顺序自动匹配源，也可手动指定；**TXT 整本书批量**：上传后按章多选，每章一期依次产出，单章失败不影响其余 |
| 任务可靠性 | 任务记录落盘 `data/jobs.json`：服务重启自动恢复（排队中的重新排队、执行中的标记中断可重试）；进度视图与浏览器无关，任意标签页/刷新后都能看到实时进度与最近任务 |
| 讲解形式 | 双人讲解（一男一女对谈）/ 单人讲解（可选男生或女生的声音） |
| AI 写稿 | OpenAI 兼容 `/chat/completions`；长章节自动分块续写；台词强制口语化短句、带语气词 |
| 语音合成 | 三通道见上表；VoxCPM 输出 48kHz，经 lamejs 转 128kbps MP3 进入统一管线 |
| 在线播放 | MP3 流式播放（支持 Range 拖动） |
| 文稿跟随 | 每条台词带精确时间轴：播放时自动高亮当前台词，点击任意台词跳转播放 |
| 下载 | `下载 MP3` 按钮（附件头，文件名为播客标题） |
| 管理 | 播客列表、删除；设置页连通测试与真实试听 |

## 目录结构

```
novelcast/
├─ server/                      Express + TS 服务端
│  ├─ sources/                  源契约 types.ts + 静态加载注册表 registry.ts（核心只面对契约）
│  ├─ uploads.ts                上传文件落盘 data/uploads/（file 类源输入的取值）
│  ├─ llm.ts                    OpenAI 兼容 chat/completions 客户端 + JSON 容错解析
│  ├─ script.ts                 播客脚本生成（单播/双播 prompt、长文分块）
│  ├─ tts/                      语音合成
│  │  ├─ edge.ts                Edge 朗读协议自实现（WebSocket + Sec-MS-GEC 签名；免费端点仅纯文本 SSML）
│  │  ├─ voxcpm.ts              本地 VoxCPM 客户端 + WAV→MP3（lamejs）
│  │  ├─ openai.ts              OpenAI 兼容 /audio/speech（含 SiliconFlow 语气指令）
│  │  └─ wav.ts                 RIFF/PCM16 解析
│  ├─ mp3.ts                    MP3 帧级解析（总时长、分段时长）
│  ├─ jobs.ts                   生成管线（取章→写稿→逐段合成→拼接→落盘）+ 串行队列（批量＝每章一个任务）
│  └─ store.ts                  文件存储 data/podcasts/<id>/（meta/script/audio），无数据库
├─ src/                         React 18 + Vite + antd 前端（首页 / 详情 / 设置）
├─ extensions-local/            本地私有扩展（gitignore）：sources/<源名>/ 一源一目录，放入即注册
├─ scripts/
│  ├─ voxcpm_server.py          本地 VoxCPM 服务（纯标准库，配合 VoxCPM 虚拟环境运行）
│  └─ mock-llm.mjs              模拟 OpenAI 兼容端点（联调用）
└─ tests/                       vitest 单测（源注册表、脚本、MP3、WAV、LLM 客户端）
```

## 测试

```bash
npm test            # 仓库核心单测
npm run test:local  # 本地源专属测试（extensions-local/ 不入仓库，故单独跑）
```

AI 协作开发请先读 [AGENTS.md](AGENTS.md)——里面有架构口径、源开发要点与提交前的脱敏自查清单。

## 已知边界

- 仓库内置零数据源：克隆后需要先放入至少一个源才能获取正文（这是刻意的法律与安全边界，不是缺陷）。
- 本地 VoxCPM 合成速度约 3~5 倍实时（笔记本 GPU 实测），整章生成需要等待；赶时间用 SiliconFlow。
- 服务默认只监听 `127.0.0.1`，需要局域网访问时用 `HOST=0.0.0.0 npm start`。
- Windows 终端日志中文乱码时先 `chcp 65001`。
