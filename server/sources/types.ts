/**
 * 源契约 —— 核心层只认识这个接口。
 *
 * 源回答"章节文本从哪来"：爬取、解密、清洗全部发生在源内部，
 * 核心只接收一章全量文本（ChapterContent）。
 * 实现不随仓库发布：放入 extensions-local/sources/ 即注册，重启生效（静态扩展）。
 */

export interface SourceInputField {
  key: string;
  label: string;
  /** TXT 整本书上传即 type:'file'（尚未实现） */
  type: 'url' | 'text' | 'file';
  required: boolean;
  placeholder?: string;
}

export interface ChapterRef {
  sourceId: string;
  /** 章节引用：URL、文件内位置、章节序号……由源自定义编码，核心不解释 */
  ref: string;
  bookTitle?: string;
  chapterTitle?: string;
  /** 正文字符数（估算，供章节选择界面展示） */
  chars?: number;
}

export interface ChapterContent {
  bookTitle?: string;
  author?: string;
  chapterTitle?: string;
  /** 一章的全量原始文本 —— 核心唯一真正关心的东西 */
  text: string;
}

export interface NovelSource {
  id: string;
  label: string;
  /** 一句话说明，用于前端展示 */
  description?: string;
  /** URL 自动匹配：返回 true 即选中；恒真即兜底；不实现则只能手动选择 */
  matchUrl?(url: string): boolean;
  /** 手动选择该源时，前端按此声明渲染表单 */
  inputs: SourceInputField[];
  /** 用户输入 → 章节引用列表；URL 源返回 1 章，TXT 源在此做智能分章返回 N 章 */
  listChapters(input: Record<string, string>): Promise<ChapterRef[]>;
  /** 拉取一章全量文本 */
  fetchChapter(ref: ChapterRef): Promise<ChapterContent>;
}

/** 供前端渲染的能力清单（GET /api/sources） */
export interface SourceInfo {
  id: string;
  label: string;
  description?: string;
  inputs: SourceInputField[];
}
