/**
 * 上传文件存储：前端经 POST /api/uploads 提交原始字节，核心原样落盘到
 * data/uploads/<id>/<原文件名>（保留原名，源可从路径推导书名），
 * file 类源输入的值即这里的文件绝对路径——源自行读取解析。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOADS_DIR = path.join(ROOT, 'data', 'uploads');

/** 清理文件名：去掉路径部分与非法字符，避免目录穿越与平台非法名 */
function sanitizeName(name: string): string {
  const base = path.basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '_').trim();
  return base || 'upload.txt';
}

/** 保存上传内容，返回文件 id 与绝对路径 */
export async function saveUpload(buf: Buffer, originalName: string): Promise<{ id: string; filePath: string }> {
  const id = newId();
  const dir = path.join(UPLOADS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, sanitizeName(originalName));
  await fs.writeFile(filePath, buf);
  return { id, filePath };
}
