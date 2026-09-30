# AGENTS.md

本文件写给在这仓库里工作的 AI 助手（以及新加入的人类协作者）。开工前请通读，尤其是「硬性约束」。

## 项目是什么

NovelCast 是一条「章节文本 → 播客音频」的流水线：**接收一章全量文本 → LLM 写成单播/双播讲解脚本 → 语音服务逐句合成并拼成 MP3**。前端三页（新建/详情/设置），后端单进程 Express 托管静态产物，无数据库（`data/` 目录 JSON + 音频文件）。

- 技术栈：React 18 + Vite + antd（前端）；Express 5 + TypeScript（后端，tsx 直接运行 TS，**生产也是 tsx**）；vitest。
- AI（LLM）只有一个接入点：写稿（`server/script.ts`）。正文清洗、拼接、落盘都是普通代码。
- 当前支持：URL 输入、单章产出；TXT 整本书上传、智能分章与多章批量产出尚未实现。

## 一条原则

**核心只面对契约；一切实现要么在进程外（HTTP 服务），要么在启动时从固定目录静态加载；运行时永不加载、永不上传新代码。**

- "源"（Source）回答「章节文本从哪来」，契约在 `server/sources/types.ts`。
- 静态扩展：`extensions-local/` 下的实现**放入即注册、重启生效**；重启即审计点。
- 为什么不做运行时上传：能访问服务的人就能以服务进程身份执行任意代码（该进程持有 LLM API Key、可读写 data/）。

## 硬性约束

1. **仓库零爬取实现**：禁止向仓库添加任何针对具体站点的爬取/解密/水印规则、示例站点 URL、站点名——无论以代码、注释、测试还是文档的形式。站点支持一律通过「用户自己写源放入 `extensions-local/sources/`」实现，该目录已被 gitignore。
2. **提交前脱敏自查**：本机绝对路径（盘符开头路径）、API Key、私有项目名、内部端点，一律不得进入任何将被 git 追踪的文件。`data/`（含 config.json 的 Key）与 `extensions-local/` 永不入库——`.gitignore` 已覆盖，不要往这两个目录放任何"应该开源"的东西。
3. **运行时永不加载新代码**：不要提议或实现"界面上传源 / 热注册 / 动态加载"功能。UI 对数据源、语音服务只做展示与选择，不做代码注入面。
4. **核心层不 import 具体实现**：`server/` 里除 `sources/registry.ts` 的目录扫描外，任何文件不得引用 `extensions-local/` 或具体源；模块间只走 `server/sources/types.ts` 的契约。
5. **UI 文案、注释、文档用简体中文**；错误信息面向最终用户，要中文、可操作。
6. **提交前跑全量回归**：`npm test` + `npm run test:local` + `npm run typecheck` + `npm run typecheck:local` + `npm run build`。

## 架构导览

```
生成管线（server/jobs.ts，串行队列）：
  ① selectSource(url, sourceId?) → source.listChapters → source.fetchChapter   // 源内部完成爬取/解密/清洗
  ② script.ts：LLM 写稿（>4000 字分块续写，JSON 容错解析）
  ③ tts/index.ts：逐句合成（voxcpm 本地 / openai 兼容云端 / edge 免费保底）
  ④ mp3.ts：帧级解析得总时长与分段时长（前端文稿跟随、点击跳转靠它）
  ⑤ store.ts：落盘 data/podcasts/<id>/{meta.json,script.json,audio.mp3}
```

| 模块 | 职责 |
|---|---|
| `server/sources/types.ts` | 源契约：`NovelSource { id, label, matchUrl?, inputs, listChapters, fetchChapter }` |
| `server/sources/registry.ts` | 启动扫描 `extensions-local/sources/` → 形状校验 → 注册；URL 自动匹配（注册序首个命中）；`GET /api/sources` 能力清单 |
| `server/jobs.ts` | 串行任务队列 + 进度上报 |
| `server/script.ts` / `llm.ts` | LLM 写稿 / OpenAI 兼容客户端（BaseURL 自动补全 `/v1/chat/completions`，`#` 结尾用原样地址） |
| `server/tts/*` | 三通道合成；`wav.ts` 解析 RIFF/PCM16，`voxcpm.ts` 用 lamejs 转 128kbps MP3 |
| `server/mp3.ts` | MPEG1/2/2.5 Layer3 帧解析、ID3v2 跳过 |
| `server/store.ts` / `config.ts` | 文件存储 / 配置读写（`PUT /api/settings` 对 Key 脱敏回显，回传占位符不覆盖真实 Key） |
| `src/` | HomePage（新建+列表+源下拉动态表单）/ DetailPage（播放器+文稿跟随）/ SettingsPage |

前端调后端只走 `src/api.ts`；API 语义变更要同步两端。

## 源开发要点

- 一个源一个目录：`extensions-local/sources/<源名>/`，入口 `index.ts`（推荐，tsx 环境可直接用 TS）或 `index.js`，默认导出 `NovelSource`。
- **自包含**：源目录内自带所需工具（HTTP 封装、清洗规则），拷走即用；核心不为源提供爬取工具函数。
- 类型引入：`import type { NovelSource } from '../../../server/sources/types.js'`（仅 type import，运行时零依赖）。
- 形状校验：启动时逐个校验（id/label/inputs/两个方法），不合法跳过并打 `[源]` 告警，不阻断启动；id 冲突按目录名字母序先到先得。
- `matchUrl` 恒真即兜底源——把它放注册顺序最后（目录名靠后），让更具体的源先命中；不实现 `matchUrl` 的源只能手动选择。
- 下划线开头的目录不作为源加载（可放共享草稿）。
- 本地源测试放各自目录（`*.test.ts`），用 `npm run test:local` 运行；**仓库 `tests/` 里不得出现具体源的内容**。

## 运行与测试

| 命令 | 用途 |
|---|---|
| `npm run dev` | 开发：tsx watch 3000 + Vite 5173（代理已配） |
| `npm run build` + `npm start` | 生产：Vite 产物 + tsx 单进程托管（3000） |
| `npm test` / `npm run test:local` | 仓库单测 / 本地源单测 |
| `npm run typecheck` / `typecheck:local` | 仓库双 tsconfig / extensions-local |

## 已知陷阱，别再踩

- **antd 6 cssVar 模式**：`colorPrimary` 设近黑会污染派生 token（下拉选中态深底深字）。`src/main.tsx` 已在 token 层覆盖 `controlItemBgActive/ActiveHover` + Select 组件级 `optionSelectedBg/optionActiveBg`——别动；改主题色前先验证所有派生 token。
- **Edge 免费端点只接受纯文本 SSML**：`<break>`、`mstts:express-as` 一律 1007 "SSML is invalid"（那是 Azure 付费功能）；`Sec-MS-GEC` 签名的 Edge 版本号必须 ≥133（旧版本 403），现用 140.0.3485.54。
- **Windows 端口保留段**：7922–8021 会 `WinError 10013`，VoxCPM 服务默认端口用 18511。
- **MP3 转码**：torchcodec 在 Windows 缺 FFmpeg DLL 不可用；用 `@breezystack/lamejs`（Node 侧）。MP3 帧流可按序二进制拼接，段间无缝。
- **Git Bash curl 发中文**：`-d` 会按 GBK 发送导致 Python 侧解码报错；用 UTF-8 文件 + `--data-binary @file`。
- **cheerio 依赖**：核心不再解析 HTML，但 cheerio 保留在 dependencies——它是本地源开发的事实依赖（源从仓库根 node_modules 解析）。

## 当前状态

- 核心流水线可用：数据源取章 → LLM 写稿 → 逐句语音合成 → MP3 拼接落盘，串行任务队列 + 进度上报。
- 源契约与静态注册表已落地（`server/sources/`）：仓库零爬取实现、内置零源是刻意设计；本地源放 `extensions-local/sources/`（gitignore，不入库）。
- 语音合成三通道可用：本地 VoxCPM（默认）/ OpenAI 兼容云端 / Edge 免费保底。
- 测试双层：`npm test` 覆盖核心、`npm run test:local` 覆盖本地源。
