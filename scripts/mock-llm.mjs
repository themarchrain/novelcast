import { createServer } from 'node:http';

/**
 * 模拟 OpenAI 兼容 /chat/completions 端点，用于端到端验证。
 * 依据用户消息里小说章节关键词生成一段固定风格的双播/单播 JSON 脚本。
 */

function pickUserText(messages) {
  return (messages || [])
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
}

function pickSystemText(messages) {
  return (messages || [])
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
}

export function startMockLlm(opts = {}) {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && (req.url || '').endsWith('/chat/completions')) {
      let body = '';
      req.on('data', (c) => (body += c.toString('utf8')));
      req.on('end', () => {
        let parsed = { messages: [] };
        try {
          parsed = JSON.parse(body);
        } catch {
          /* 忽略 */
        }
        const userText = pickUserText(parsed.messages);
        const isDuo = pickSystemText(parsed.messages).includes('两位主播');
        const mChapter = userText.match(/章节：(.+)/);
        const mBook = userText.match(/小说：(.+)/);
        const book = (mBook ? mBook[1] : '这本书').trim().slice(0, 20);
        const chapter = (mChapter ? mChapter[1] : '这一章').trim().slice(0, 30);
        const content = isDuo
          ? JSON.stringify({
              title: `《${book}》${chapter} 深夜漫谈`,
              segments: [
                { speaker: 'male', text: '哈喽大家好，欢迎收听本期播客，我是阿远。' },
                { speaker: 'female', text: '大家好呀，我是小雅。今天咱们要聊的是这本小说里的精彩一章。' },
                { speaker: 'male', text: `没错，"${chapter}"这一章的剧情推进特别快，一开头就压着气氛走。` },
                { speaker: 'female', text: '嗯嗯，而且人物之间的那种试探感写得很妙，读起来有点喘不过气。' },
                { speaker: 'male', text: '我觉得最妙的是那句伏笔，前面看着不起眼，回头再看全是细节。' },
                { speaker: 'female', text: '哈哈对，所以这一章值得反复品。那今天就先聊到这里，下次再接着说，拜拜！' },
              ],
            })
          : JSON.stringify({
              title: `《${book}》${chapter} 单人精讲`,
              segments: [
                { speaker: 'female', text: '大家好，欢迎收听本期播客，今天带大家精讲一章小说。' },
                { speaker: 'female', text: `这一章叫"${chapter}"，节奏紧凑，情绪是一层层往上叠的。` },
                { speaker: 'female', text: '我个人最喜欢中间那段对话，寥寥几句，人物性格就立住了。' },
                { speaker: 'female', text: '好啦，今天的讲解就到这里，我们下期再见，拜拜！' },
              ],
            });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-mock',
            object: 'chat.completion',
            choices: [
              { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' },
            ],
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(opts.port || 0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/v1` });
    });
  });
}

// 直接运行时启动
if (process.argv[1] && process.argv[1].endsWith('mock-llm.mjs')) {
  const port = Number(process.env.MOCK_LLM_PORT || 3999);
  startMockLlm({ port }).then(({ url }) => {
    console.log(`Mock LLM 已启动: ${url} （POST ${url}/chat/completions）`);
  });
}
