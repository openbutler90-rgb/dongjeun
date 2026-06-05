export const LOCAL_AI_STORAGE_KEY = 'dongjeon-local-ai-settings';

export interface LocalAiSettings {
  textEnabled: boolean;
  textProvider: 'ollama' | 'lmstudio';
  textEndpoint: string;
  textModel: string;
  webtoonScenarioModel?: string;
  webtoonCharacterModel?: string;
  webtoonStoryboardModel?: string;
  webtoonAdultModel?: string;
  autoStartPinokio?: boolean;
  imageEnabled: boolean;
  imageProvider: 'comfyui' | 'forge';
  imageEndpoint: string;
  comfyWorkflowJson?: string;
}

export type WebtoonTextTask = 'scenario' | 'character' | 'storyboard' | 'adult';

const DEFAULT_SETTINGS: LocalAiSettings = {
  textEnabled: false,
  textProvider: 'ollama',
  textEndpoint: 'http://127.0.0.1:11434',
  textModel: 'gemma4:e4b',
  webtoonScenarioModel: 'gemma4:e4b',
  webtoonCharacterModel: 'gemma4:e4b',
  webtoonStoryboardModel: 'gemma4:e4b',
  webtoonAdultModel: 'gemma4:e4b',
  autoStartPinokio: false,
  imageEnabled: false,
  imageProvider: 'comfyui',
  imageEndpoint: 'http://127.0.0.1:8188',
  comfyWorkflowJson: '',
};

export function getLocalAiSettings(): LocalAiSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(LOCAL_AI_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getWebtoonLocalAiSettings(): LocalAiSettings {
  const saved = getLocalAiSettings();
  return {
    ...saved,
    textEnabled: saved.textEnabled,
    textProvider: saved.textProvider || DEFAULT_SETTINGS.textProvider,
    textEndpoint: saved.textEndpoint || DEFAULT_SETTINGS.textEndpoint,
    textModel: saved.textModel || DEFAULT_SETTINGS.textModel,
    webtoonScenarioModel: saved.webtoonScenarioModel || saved.textModel || DEFAULT_SETTINGS.webtoonScenarioModel,
    webtoonCharacterModel: saved.webtoonCharacterModel || saved.textModel || DEFAULT_SETTINGS.webtoonCharacterModel,
    webtoonStoryboardModel: saved.webtoonStoryboardModel || DEFAULT_SETTINGS.webtoonStoryboardModel,
    webtoonAdultModel: saved.webtoonAdultModel || DEFAULT_SETTINGS.webtoonAdultModel,
    autoStartPinokio: saved.autoStartPinokio ?? DEFAULT_SETTINGS.autoStartPinokio,
    imageEnabled: true,
    imageProvider: saved.imageProvider || DEFAULT_SETTINGS.imageProvider,
    imageEndpoint: saved.imageEndpoint || DEFAULT_SETTINGS.imageEndpoint,
    comfyWorkflowJson: saved.comfyWorkflowJson || '',
  };
}

export function saveLocalAiSettings(settings: LocalAiSettings) {
  localStorage.setItem(LOCAL_AI_STORAGE_KEY, JSON.stringify(settings));
}

function flattenParts(parts: any[] = []) {
  return parts.map(part => part?.text || '').filter(Boolean).join('\n');
}

export function geminiBodyToPrompt(body: Record<string, any>) {
  const systemText = flattenParts(body.system_instruction?.parts || []);
  const contentsText = (body.contents || [])
    .map((content: any) => {
      const role = content.role === 'model' ? 'assistant' : 'user';
      return `${role}: ${flattenParts(content.parts || [])}`;
    })
    .filter((line: string) => line.trim() !== 'user:')
    .join('\n\n');

  return [systemText, contentsText].filter(Boolean).join('\n\n');
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function geminiBodyToMessages(body: Record<string, any>): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const systemText = flattenParts(body.system_instruction?.parts || []);
  if (systemText.trim()) {
    messages.push({ role: 'system', content: systemText });
  }
  const contents = body.contents || [];
  contents.forEach((content: any) => {
    const role = content.role === 'model' ? 'assistant' : 'user';
    const text = flattenParts(content.parts || []);
    if (text.trim()) {
      messages.push({ role, content: text });
    }
  });
  return messages;
}

export function shouldTryLocalText(body: Record<string, any>) {
  if (typeof window === 'undefined') return false;
  return getLocalAiSettings().textEnabled;
}

export function resolveWebtoonTextModel(
  task: WebtoonTextTask,
  maturityLevel?: string,
  settings = getLocalAiSettings(),
) {
  if ((maturityLevel === 'mature' || task === 'adult') && settings.webtoonAdultModel?.trim()) {
    return settings.webtoonAdultModel.trim();
  }
  if (task === 'character' && settings.webtoonCharacterModel?.trim()) return settings.webtoonCharacterModel.trim();
  if (task === 'storyboard' && settings.webtoonStoryboardModel?.trim()) return settings.webtoonStoryboardModel.trim();
  if (settings.webtoonScenarioModel?.trim()) return settings.webtoonScenarioModel.trim();
  return settings.textModel || DEFAULT_SETTINGS.textModel;
}

function withModel(settings: LocalAiSettings, model?: string): LocalAiSettings {
  return model?.trim() ? { ...settings, textModel: model.trim() } : settings;
}

async function callOllama(settings: LocalAiSettings, messages: ChatMessage[], prompt: string, signal?: AbortSignal) {
  const proxied = await callLocalProxyText(settings, messages, prompt, signal).catch(() => null);
  if (proxied) return proxied;

  const response = await fetch(`${settings.textEndpoint.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.textModel || DEFAULT_SETTINGS.textModel,
      stream: false,
      messages: messages.length > 0 ? messages : [{ role: 'user', content: prompt }],
      keep_alive: '1m',
      options: { temperature: 0.7 },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Local Ollama HTTP ${response.status}`);
  const data = await response.json();
  return data?.message?.content || data?.response || '';
}

async function callLmStudio(settings: LocalAiSettings, messages: ChatMessage[], prompt: string, signal?: AbortSignal) {
  const proxied = await callLocalProxyText(settings, messages, prompt, signal).catch(() => null);
  if (proxied) return proxied;

  const response = await fetch(`${settings.textEndpoint.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.textModel || 'local-model',
      messages: messages.length > 0 ? messages : [{ role: 'user', content: prompt }],
      temperature: 0.7,
      stream: false,
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Local LM Studio HTTP ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function callLocalProxyText(settings: LocalAiSettings, messages: ChatMessage[], prompt: string, signal?: AbortSignal) {
  const response = await fetch('/api/local-ai/text/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: settings.textProvider,
      endpoint: settings.textEndpoint,
      model: settings.textModel || DEFAULT_SETTINGS.textModel,
      prompt,
      messages,
    }),
    signal,
  });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('application/json')) throw new Error('Local proxy unavailable');
  const data = await response.json();
  return data?.text || '';
}

export async function callLocalTextAI(
  body: Record<string, any>,
  signal?: AbortSignal,
  options: { model?: string; settings?: LocalAiSettings } = {},
) {
  const settings = withModel(options.settings || getLocalAiSettings(), options.model);
  const prompt = geminiBodyToPrompt(body);
  const messages = geminiBodyToMessages(body);
  if (!prompt.trim() && messages.length === 0) throw new Error('Local AI prompt/messages is empty');
  const text = settings.textProvider === 'lmstudio'
    ? await callLmStudio(settings, messages, prompt, signal)
    : await callOllama(settings, messages, prompt, signal);
  if (!text.trim()) throw new Error('Local AI returned empty text');
  return {
    __dongjeonAiSource: {
      type: 'local',
      provider: settings.textProvider,
      model: settings.textModel || DEFAULT_SETTINGS.textModel,
    },
    candidates: [{
      content: {
        parts: [{ text }],
      },
    }],
  };
}

export async function listLocalTextModels(settings = getLocalAiSettings()) {
  const proxied = await fetch('/api/local-ai/text/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: settings.textProvider,
      endpoint: settings.textEndpoint,
    }),
  }).then(async response => {
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) throw new Error('Local proxy unavailable');
    return response.json();
  }).catch(() => null);
  if (proxied?.models) return { ok: true, models: proxied.models };

  const baseUrl = settings.textEndpoint.replace(/\/$/, '');
  const url = settings.textProvider === 'lmstudio' ? `${baseUrl}/v1/models` : `${baseUrl}/api/tags`;
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json().catch(() => ({}));
  if (settings.textProvider === 'ollama') {
    const models = Array.isArray(data?.models) ? data.models.map((model: any) => model?.name).filter(Boolean) : [];
    return { ok: true, models };
  }
  const models = Array.isArray(data?.data) ? data.data.map((model: any) => model?.id).filter(Boolean) : [];
  return { ok: true, models };
}

export async function testLocalTextConnection(settings = getLocalAiSettings()) {
  return listLocalTextModels(settings);
}

export async function startLocalAiTarget(target: 'ollama' | 'comfyui', endpoint?: string) {
  const response = await fetch('/api/local-ai/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, endpoint }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `Local ${target} start/check failed`);
  }
  return data;
}

export async function testLocalImageConnection(settings = getLocalAiSettings()) {
  if (settings.imageProvider === 'comfyui') {
    await startLocalAiTarget('comfyui', settings.imageEndpoint);
    return { ok: true };
  }

  const baseUrl = settings.imageEndpoint.replace(/\/$/, '');
  const url = settings.imageProvider === 'forge' ? `${baseUrl}/sdapi/v1/options` : `${baseUrl}/system_stats`;
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await response.json().catch(() => ({}));
  return { ok: true };
}

export async function generateLocalImage(params: {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  cfgScale?: number;
  workflow?: Record<string, any>;
}, settings = getLocalAiSettings()) {
  if (!settings.imageEnabled) return null;
  const response = await fetch('/api/local-ai/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: settings.imageProvider,
      endpoint: settings.imageEndpoint,
      ...params,
      workflow: params.workflow,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.imageUrl) {
    throw new Error(data?.error || `Local image HTTP ${response.status}`);
  }
  return data.imageUrl as string;
}
