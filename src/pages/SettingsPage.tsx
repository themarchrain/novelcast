import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import { LockOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { AppConfig } from '../types';
import { EDGE_VOICES, SILICONFLOW_BASE_URL, SILICONFLOW_MODEL, SILICONFLOW_VOICES } from '../voices';

const MASKED = '••••••••';

export default function SettingsPage() {
  const [form] = Form.useForm();
  const [provider, setProvider] = useState<'edge' | 'openai' | 'voxcpm'>('edge');
  const [saving, setSaving] = useState(false);
  const [testingLlm, setTestingLlm] = useState(false);
  const [testingTts, setTestingTts] = useState<'male' | 'female' | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api.getSettings();
        setProvider(cfg.tts.provider);
        form.setFieldsValue({
          ...cfg,
          // 脱敏 key 展示为占位符
          llm: { ...cfg.llm, apiKey: cfg.llm.apiKey ? MASKED : '' },
          tts: {
            ...cfg.tts,
            openai: { ...cfg.tts.openai, apiKey: cfg.tts.openai.apiKey ? MASKED : '' },
          },
        });
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [form]);

  const collect = (): AppConfig => {
    const v = form.getFieldsValue(true) as AppConfig;
    return {
      llm: {
        baseURL: (v.llm?.baseURL || '').trim(),
        apiKey: v.llm?.apiKey || '',
        model: (v.llm?.model || '').trim(),
        jsonMode: !!v.llm?.jsonMode,
        temperature: Number(v.llm?.temperature ?? 0.8),
      },
      tts: {
        provider,
        edge: {
          maleVoice: v.tts?.edge?.maleVoice || 'zh-CN-YunxiNeural',
          femaleVoice: v.tts?.edge?.femaleVoice || 'zh-CN-XiaoxiaoNeural',
        },
        openai: {
          baseURL: (v.tts?.openai?.baseURL || '').trim(),
          apiKey: v.tts?.openai?.apiKey || '',
          model: (v.tts?.openai?.model || '').trim(),
          maleVoice: (v.tts?.openai?.maleVoice || '').trim(),
          femaleVoice: (v.tts?.openai?.femaleVoice || '').trim(),
          styleInstruction: (v.tts?.openai?.styleInstruction || '').trim(),
        },
        voxcpm: {
          baseURL: (v.tts?.voxcpm?.baseURL || 'http://127.0.0.1:18511').trim(),
          maleControl: v.tts?.voxcpm?.maleControl || '',
          femaleControl: v.tts?.voxcpm?.femaleControl || '',
          timesteps: Number(v.tts?.voxcpm?.timesteps ?? 10),
        },
      },
    };
  };

  const applySiliconFlowPreset = () => {
    form.setFieldsValue({
      tts: {
        ...form.getFieldValue('tts'),
        openai: {
          ...form.getFieldValue('tts')?.openai,
          baseURL: SILICONFLOW_BASE_URL,
          model: SILICONFLOW_MODEL,
          maleVoice: SILICONFLOW_VOICES.find((v) => v.id.endsWith(':charles'))?.id,
          femaleVoice: SILICONFLOW_VOICES.find((v) => v.id.endsWith(':diana'))?.id,
        },
      },
    });
    message.success('已填入 SiliconFlow CosyVoice2 预设，补充 API Key 即可');
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const saved = await api.saveSettings(collect());
      message.success('设置已保存');
      form.setFieldsValue({
        ...saved,
        llm: { ...saved.llm, apiKey: saved.llm.apiKey ? MASKED : '' },
        tts: {
          ...saved.tts,
          openai: { ...saved.tts.openai, apiKey: saved.tts.openai.apiKey ? MASKED : '' },
        },
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const onTestLlm = async () => {
    setTestingLlm(true);
    try {
      const v = collect();
      const r = await api.testLlm({
        baseURL: v.llm.baseURL,
        model: v.llm.model,
        // 占位符不回传，服务端用已保存的真实 key
        apiKey: v.llm.apiKey && v.llm.apiKey !== MASKED ? v.llm.apiKey : undefined,
      });
      message.success(`AI 接口连通正常，模型回复：${r.reply}`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingLlm(false);
    }
  };

  const onTestTts = async (speaker: 'male' | 'female') => {
    setTestingTts(speaker);
    try {
      const v = collect();
      const ttsCfg: AppConfig['tts'] = {
        ...v.tts,
        openai: {
          ...v.tts.openai,
          apiKey: v.tts.openai.apiKey && v.tts.openai.apiKey !== MASKED ? v.tts.openai.apiKey : '',
        },
      };
      const { url } = await api.testTts(ttsCfg, speaker);
      new Audio(url).play();
      message.success('试听已播放');
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingTts(null);
    }
  };

  const openaiBase = Form.useWatch(['tts', 'openai', 'baseURL'], form) as string | undefined;
  const isSiliconFlow = (openaiBase || '').includes('siliconflow');

  return (
    <div className="page page-wide">
      <div className="tip-banner reveal d1">
        <LockOutlined />
        <span>所有配置保存在本机 data/config.json，不会上传。</span>
      </div>

      <Card className="panel reveal d2" style={{ marginBottom: 20 }} title={<span className="h-title">🤖 AI 接口（OpenAI 通用格式）</span>}>
        <Form form={form} layout="vertical">
          <Space size="middle" wrap align="start" style={{ width: '100%' }}>
            <Form.Item name={['llm', 'baseURL']} label="BaseURL" style={{ minWidth: 320 }}
              extra="填到 /v1 这一级即可，例如 https://api.openai.com/v1 或 https://api.siliconflow.cn/v1">
              <Input placeholder="https://api.openai.com/v1" allowClear />
            </Form.Item>
            <Form.Item name={['llm', 'apiKey']} label="API Key" style={{ minWidth: 280 }}>
              <Input.Password placeholder="sk-..." />
            </Form.Item>
            <Form.Item name={['llm', 'model']} label="模型" style={{ minWidth: 220 }}
              extra="例如 gpt-4o-mini、deepseek-chat、Qwen/Qwen2.5-72B-Instruct 等">
              <Input placeholder="模型名称" allowClear />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name={['llm', 'jsonMode']} label="JSON 模式" valuePropName="checked"
              extra="部分兼容端点不支持 response_format，报错时关闭">
              <Switch />
            </Form.Item>
            <Button loading={testingLlm} onClick={onTestLlm}>测试连通</Button>
          </Space>
        </Form>
      </Card>

      <Card className="panel reveal d3" title={<span className="h-title">🔊 语音合成（TTS）</span>}>
        <Form form={form} layout="vertical">
          <Form.Item label="合成通道">
            <Radio.Group
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'edge' | 'openai' | 'voxcpm')}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="voxcpm">本地 VoxCPM（免费 · 情感最佳，推荐）</Radio.Button>
              <Radio.Button value="openai">SiliconFlow / OpenAI 兼容（云端快）</Radio.Button>
              <Radio.Button value="edge">Edge 神经语音（免费保底）</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {provider === 'voxcpm' && (
            <>
              <div className="tip-banner" style={{ marginBottom: 16 }}>
                <WarningOutlined />
                <div className="tip-body">
                  <div>需要先启动本地 VoxCPM 服务。</div>
                  <div className="sub">
                    首次启动需加载模型约 2 分钟；合成速度约为音频时长的 3~5 倍（4060 显卡实测），适合后台慢慢生成。
                  </div>
                </div>
                <span className="tip-action">
                  <Button size="small" onClick={() => setGuideOpen(true)}>查看启动命令</Button>
                </span>
              </div>
              <Space size="middle" wrap align="start">
                <Form.Item name={['tts', 'voxcpm', 'baseURL']} label="服务地址" style={{ minWidth: 280 }}>
                  <Input placeholder="http://127.0.0.1:18511" allowClear />
                </Form.Item>
                <Form.Item name={['tts', 'voxcpm', 'timesteps']} label="推理步数（4~30）" style={{ minWidth: 200 }}
                  extra="默认 10 质量最好；调到 4 速度约快一倍">
                  <InputNumber min={4} max={30} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="试听">
                  <Space>
                    <Button loading={testingTts === 'male'} onClick={() => onTestTts('male')}>▶ 男声</Button>
                    <Button loading={testingTts === 'female'} onClick={() => onTestTts('female')}>▶ 女声</Button>
                  </Space>
                </Form.Item>
              </Space>
              <Space size="middle" wrap align="start">
                <Form.Item name={['tts', 'voxcpm', 'maleControl']} label="男主播音色描述" style={{ minWidth: 420 }}
                  extra="Voice Design 用自然语言描述声音；改描述后需删除 data/voices/male.wav 重新设计">
                  <Input allowClear />
                </Form.Item>
                <Form.Item name={['tts', 'voxcpm', 'femaleControl']} label="女主播音色描述" style={{ minWidth: 420 }}>
                  <Input allowClear />
                </Form.Item>
              </Space>
            </>
          )}

          {provider === 'openai' && (
            <>
              <Space wrap style={{ marginBottom: 8 }}>
                <Button onClick={applySiliconFlowPreset}>一键填入 SiliconFlow CosyVoice2 预设</Button>
                <Typography.Text type="secondary">
                  按输入文本 UTF-8 字节计费，一章播客通常只需几毛钱，合成秒级完成
                </Typography.Text>
              </Space>
              <Space size="middle" wrap align="start">
                <Form.Item name={['tts', 'openai', 'baseURL']} label="BaseURL" style={{ minWidth: 300 }}
                  extra="填到 /v1 这一级，例如 https://api.siliconflow.cn/v1">
                  <Input placeholder="https://api.siliconflow.cn/v1" allowClear />
                </Form.Item>
                <Form.Item name={['tts', 'openai', 'apiKey']} label="API Key" style={{ minWidth: 260 }}>
                  <Input.Password placeholder="sk-..." />
                </Form.Item>
                <Form.Item name={['tts', 'openai', 'model']} label="模型" style={{ minWidth: 260 }}
                  extra="SiliconFlow 推荐 FunAudioLLM/CosyVoice2-0.5B">
                  <Input allowClear />
                </Form.Item>
                {isSiliconFlow ? (
                  <>
                    <Form.Item name={['tts', 'openai', 'maleVoice']} label="男声音色" style={{ minWidth: 280 }}>
                      <Select options={SILICONFLOW_VOICES.filter((v) => v.gender === 'male').map((v) => ({ value: v.id, label: v.label }))} />
                    </Form.Item>
                    <Form.Item name={['tts', 'openai', 'femaleVoice']} label="女声音色" style={{ minWidth: 280 }}>
                      <Select options={SILICONFLOW_VOICES.filter((v) => v.gender === 'female').map((v) => ({ value: v.id, label: v.label }))} />
                    </Form.Item>
                  </>
                ) : (
                  <>
                    <Form.Item name={['tts', 'openai', 'maleVoice']} label="男声音色 ID" style={{ minWidth: 260 }}>
                      <Input placeholder="按服务商文档填写" allowClear />
                    </Form.Item>
                    <Form.Item name={['tts', 'openai', 'femaleVoice']} label="女声音色 ID" style={{ minWidth: 260 }}>
                      <Input placeholder="按服务商文档填写" allowClear />
                    </Form.Item>
                  </>
                )}
                <Form.Item name={['tts', 'openai', 'styleInstruction']} label="语气指令（SiliconFlow 专用）" style={{ minWidth: 340 }}
                  extra="留空关闭；仅 SiliconFlow CosyVoice 支持 <|endofprompt|> 语法">
                  <Input placeholder="请用轻松自然的聊天语气说" allowClear />
                </Form.Item>
                <Form.Item label="试听">
                  <Space>
                    <Button loading={testingTts === 'male'} onClick={() => onTestTts('male')}>▶ 男声</Button>
                    <Button loading={testingTts === 'female'} onClick={() => onTestTts('female')}>▶ 女声</Button>
                  </Space>
                </Form.Item>
              </Space>
            </>
          )}

          {provider === 'edge' && (
            <Space size="middle" wrap align="start">
              <Form.Item name={['tts', 'edge', 'maleVoice']} label="男声" style={{ minWidth: 300 }}>
                <Select options={EDGE_VOICES.filter((v) => v.gender === 'male').map((v) => ({ value: v.id, label: v.label }))} />
              </Form.Item>
              <Form.Item name={['tts', 'edge', 'femaleVoice']} label="女声" style={{ minWidth: 300 }}>
                <Select options={EDGE_VOICES.filter((v) => v.gender === 'female').map((v) => ({ value: v.id, label: v.label }))} />
              </Form.Item>
              <Form.Item label="试听">
                <Space>
                  <Button loading={testingTts === 'male'} onClick={() => onTestTts('male')}>▶ 男声</Button>
                  <Button loading={testingTts === 'female'} onClick={() => onTestTts('female')}>▶ 女声</Button>
                </Space>
              </Form.Item>
            </Space>
          )}
        </Form>
      </Card>

      <Space style={{ marginTop: 4 }}>
        <Button type="primary" size="large" loading={saving} onClick={onSave}>
          保存设置
        </Button>
        <Typography.Text type="secondary">保存后回到首页即可生成播客</Typography.Text>
      </Space>

      <Modal
        title="启动本地 VoxCPM 服务"
        open={guideOpen}
        footer={null}
        onCancel={() => setGuideOpen(false)}
      >
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>在 VoxCPM 项目根目录（含 .venv 与 models）执行：</Typography.Text>
          <pre style={{ background: '#f6f6f6', padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`# Windows（VoxCPM 的虚拟环境）
.venv\\Scripts\\python.exe <novelcast目录>\\scripts\\voxcpm_server.py

# 常用参数
#   --timesteps 6   推理步数（默认 10，调小更快）
#   --port 18511    监听端口（默认 18511）
#   --model <目录>  指定模型路径（默认自动探测同级的 VoxCPM 模型）`}
          </pre>
          <Typography.Text type="secondary">
            首次加载约 2 分钟；见到 listening on http://127.0.0.1:18511 即就绪。
            每个音色首次使用时会自动生成参考样本（约半分钟），之后音色保持一致。
          </Typography.Text>
        </Space>
      </Modal>
    </div>
  );
}
