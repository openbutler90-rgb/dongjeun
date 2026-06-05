import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outRoot = path.join(root, 'public', 'generated', 'bromantoon-demo');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(outRoot, runId);
mkdirSync(outDir, { recursive: true });

const model = process.env.BROMANTOON_MODEL || 'gemma4:e4b';

const fallbackScript = {
  title: '비 오는 밤, 한 잔의 온도',
  logline: '비 오는 밤의 작은 카페에서, 말보다 먼저 서로의 빈 컵을 알아보는 두 사람의 첫 번째 에피소드.',
  characters: [
    {
      name: '서윤',
      role: '주인공',
      visual: 'soft black wavy hair, calm eyes, cream knit cardigan, quiet cafe owner, gentle expression',
    },
    {
      name: '도하',
      role: '상대역',
      visual: 'dark brown short hair, sharp but tired eyes, navy coat, travel photographer, reserved expression',
    },
  ],
  pages: [
    {
      title: '닫힌 시간의 카페',
      panelCount: 3,
      panelLayout: 'wide rainy street establishing panel, diagonal split close-up, small inset reaction panel',
      effects: ['rain streaks', 'warm window glow', 'soft screentone'],
      prompt:
        'vertical Korean romance webtoon page, 3 panels, rainy night cafe exterior, warm cozy interior light, two young Korean men, one cafe owner behind counter, one photographer entering with wet coat, clean white gutters, empty speech bubbles, empty narration boxes, cinematic manhwa, no readable text',
      lines: [
        { speaker: '서윤', text: '마감했는데... 많이 젖으셨네요.', type: 'normal', x: 33, y: 22 },
        { speaker: '도하', text: '비가 갑자기 세져서요. 잠깐만 있어도 될까요?', type: 'normal', x: 63, y: 48 },
        { speaker: '서윤', text: '따뜻한 거 한 잔 드릴게요.', type: 'normal', x: 38, y: 78 },
      ],
    },
    {
      title: '말보다 먼저 놓인 컵',
      panelCount: 4,
      panelLayout: 'top horizontal panel, two middle vertical panels, bottom emotional close-up panel',
      effects: ['steam from coffee', 'sparkle overlay', 'soft focus background'],
      prompt:
        'vertical Korean romance webtoon page, 4 panels, cozy cafe counter, steaming coffee cup, subtle hand close-up, two young Korean men avoiding eye contact but smiling slightly, warm amber lighting, empty speech bubbles, empty narration boxes, clean white gutters, no readable text',
      lines: [
        { speaker: '도하', text: '이 집 커피는 처음인데 향이 좋네요.', type: 'normal', x: 65, y: 19 },
        { speaker: '서윤', text: '오늘처럼 추운 날엔 조금 진하게 내려요.', type: 'normal', x: 30, y: 43 },
        { speaker: '도하', text: '...기억해둘게요.', type: 'thought', x: 70, y: 66 },
        { speaker: '나레이션', text: '낯선 사람의 목소리가 이상하게 오래 남았다.', type: 'narration', x: 45, y: 88 },
      ],
    },
    {
      title: '다시 올 이유',
      panelCount: 3,
      panelLayout: 'large emotional close-up, narrow side panel, wide ending panel with rain stopping',
      effects: ['gentle emotional aura', 'rain stopping', 'light bloom'],
      prompt:
        'vertical Korean romance webtoon page, 3 panels, rain stopping outside cafe, photographer looking at cafe owner, cafe owner smiling softly, quiet romantic tension, empty speech bubbles and empty narration boxes, elegant manhwa composition, no readable text',
      lines: [
        { speaker: '도하', text: '다음엔 손님으로 올게요. 비 때문 말고.', type: 'normal', x: 57, y: 28 },
        { speaker: '서윤', text: '그럼 그땐 문 열어둘게요.', type: 'normal', x: 36, y: 56 },
        { speaker: '나레이션', text: '비가 그친 뒤에도, 카페 안은 조금 더 따뜻했다.', type: 'narration', x: 45, y: 84 },
      ],
    },
  ],
};

function pollinationsUrl(prompt, seed, width = 900, height = 1350) {
  return `https://image.pollinations.ai/p/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
}

async function isComfyReady() {
  try {
    const res = await fetch('http://127.0.0.1:8188/system_stats');
    return res.ok;
  } catch {
    return false;
  }
}

function comfyWorkflow(promptText, seed, width = 512, height = 768) {
  return {
    "3": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": "flux1-schnell-fp8.safetensors" } },
    "4": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": promptText,
        "clip": ["3", 1],
      },
    },
    "5": {
      "class_type": "CLIPTextEncode",
      "inputs": {
        "text": "bad anatomy, malformed hands, low quality, blurry, watermark, logo, letters, readable words, gibberish text, deformed face",
        "clip": ["3", 1],
      },
    },
    "6": { "class_type": "EmptyLatentImage", "inputs": { "width": width, "height": height, "batch_size": 1 } },
    "7": {
      "class_type": "KSampler",
      "inputs": {
        "model": ["3", 0],
        "positive": ["4", 0],
        "negative": ["5", 0],
        "latent_image": ["6", 0],
        "seed": seed,
        "steps": 8,
        "cfg": 1.0,
        "sampler_name": "euler",
        "scheduler": "simple",
        "denoise": 1,
      },
    },
    "8": { "class_type": "VAEDecode", "inputs": { "samples": ["7", 0], "vae": ["3", 2] } },
    "9": { "class_type": "SaveImage", "inputs": { "images": ["8", 0], "filename_prefix": "dongjeon_bromantoon_demo" } },
  };
}

async function generateComfyImage(promptText, seed, pageIndex) {
  const queue = await fetch('http://127.0.0.1:8188/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: crypto.randomUUID(),
      prompt: comfyWorkflow(promptText, seed),
    }),
  });
  const queued = await queue.json();
  if (!queue.ok || !queued.prompt_id) {
    throw new Error(`Comfy queue failed: ${JSON.stringify(queued)}`);
  }

  let imageInfo = null;
  for (let i = 0; i < 180; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const history = await (await fetch(`http://127.0.0.1:8188/history/${queued.prompt_id}`)).json();
    const images = history?.[queued.prompt_id]?.outputs?.['9']?.images;
    if (images?.length) {
      imageInfo = images[0];
      break;
    }
    if (i % 10 === 0) console.log(`Comfy page ${pageIndex + 1}: ${i * 2}s`);
  }
  if (!imageInfo) throw new Error('Comfy image generation timed out');

  const params = new URLSearchParams({
    filename: imageInfo.filename,
    subfolder: imageInfo.subfolder || '',
    type: imageInfo.type || 'output',
  });
  const imageResponse = await fetch(`http://127.0.0.1:8188/view?${params.toString()}`);
  if (!imageResponse.ok) throw new Error(`Comfy image fetch failed: ${imageResponse.status}`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());
  const filename = `page-${String(pageIndex + 1).padStart(2, '0')}-${imageInfo.filename}`;
  const filePath = path.join(outDir, filename);
  writeFileSync(filePath, bytes);
  return { filePath, webPath: filename, source: 'ComfyUI' };
}

function stripCodeFence(text) {
  return text.replace(/```json/gi, '').replace(/```/g, '').trim();
}

async function callOllama() {
  const prompt = `
브로맨툰 샘플 1화를 JSON으로 작성해.
조건:
- 현대 브로맨스, 카페, 비 오는 밤, 은근한 감정선.
- 총 3페이지.
- 각 페이지는 한 장 이미지 안에 2~5패널.
- 이미지에는 빈 말풍선과 효과만 있고 읽을 수 있는 글자는 없어야 함.
- 한국어 대사는 별도 lines 배열로 제공.
- lines의 x/y는 백분율 좌표.
- JSON만 반환.

스키마:
{
  "title": "작품명",
  "logline": "짧은 소개",
  "characters": [{"name":"", "role":"", "visual":""}],
  "pages": [{
    "title": "",
    "panelCount": 3,
    "panelLayout": "영어 패널 구성",
    "effects": ["영어 효과"],
    "prompt": "English image prompt, must include empty speech bubbles and no readable text",
    "lines": [{"speaker":"", "text":"", "type":"normal|thought|shout|narration", "x":50, "y":20}]
  }]
}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.75, num_ctx: 8192 },
        messages: [
          { role: 'system', content: 'You are a professional Korean webtoon planner. Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    const raw = data?.message?.content || '';
    const jsonText = stripCodeFence(raw);
    const match = jsonText.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : jsonText);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeScript(script) {
  const next = script && Array.isArray(script.pages) ? script : fallbackScript;
  next.pages = next.pages.slice(0, 3).map((page, index) => ({
    ...fallbackScript.pages[index],
    ...page,
    panelCount: Math.min(5, Math.max(2, Number(page.panelCount || fallbackScript.pages[index].panelCount))),
    lines: Array.isArray(page.lines) && page.lines.length ? page.lines : fallbackScript.pages[index].lines,
  }));
  return next;
}

function bubbleClass(type) {
  if (type === 'thought') return 'bubble thought';
  if (type === 'shout') return 'bubble shout';
  if (type === 'narration') return 'bubble narration';
  return 'bubble';
}

async function buildRenderedPages(script) {
  const comfyReady = await isComfyReady();
  const rendered = [];
  for (const [index, page] of script.pages.entries()) {
    const seed = 20260521 + index * 17;
    const prompt = [
      'high-end Korean digital manhwa style',
      `${page.panelCount} panels on one vertical comic page`,
      page.panelLayout,
      Array.isArray(page.effects) ? page.effects.join(', ') : '',
      page.prompt,
      'blank speech bubbles, blank thought bubbles, blank narration boxes, expressive manga effects, no readable text, no letters, no watermark',
    ].filter(Boolean).join(', ');
    let imageUrl = pollinationsUrl(prompt, seed, 512, 768);
    let imageSource = 'Pollinations fallback';
    if (comfyReady) {
      try {
        const generated = await generateComfyImage(prompt, seed, index);
        imageUrl = generated.webPath;
        imageSource = generated.source;
      } catch (error) {
        console.warn(`Comfy page ${index + 1} failed, fallback URL used: ${error.message}`);
      }
    }
    rendered.push({ page, imageUrl, imageSource });
  }
  return rendered;
}

function renderHtml(script, renderedPages) {
  const pages = renderedPages.map(({ page, imageUrl, imageSource }, index) => {
    const lines = page.lines.map(line => `
      <div class="${bubbleClass(line.type)}" style="left:${Number(line.x || 50)}%;top:${Number(line.y || 50)}%;">
        ${line.speaker && line.type !== 'narration' ? `<b>${escapeHtml(line.speaker)}</b>` : ''}
        <span>${escapeHtml(line.text || '')}</span>
      </div>`).join('');
    return `
      <section class="page">
        <div class="page-head">
          <strong>${index + 1}. ${escapeHtml(page.title || `페이지 ${index + 1}`)}</strong>
          <span>${escapeHtml(imageSource)} / ${page.panelCount}컷 / ${escapeHtml(page.panelLayout || '')}</span>
        </div>
        <div class="comic">
          <img src="${imageUrl}" alt="${escapeHtml(page.title || '')}" />
          ${lines}
        </div>
      </section>`;
  }).join('');

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(script.title)} - 브로맨툰 샘플</title>
  <style>
    :root { color-scheme: light; --ink:#111827; --muted:#64748b; --rose:#ff5a66; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f4f6fa; color:var(--ink); }
    header { position:sticky; top:0; z-index:10; background:rgba(255,255,255,.92); backdrop-filter: blur(10px); border-bottom:1px solid #e5e7eb; padding:16px 22px; }
    h1 { margin:0; font-size:24px; letter-spacing:0; }
    header p { margin:6px 0 0; color:var(--muted); font-size:14px; }
    main { max-width:980px; margin:0 auto; padding:24px 16px 64px; display:grid; gap:28px; }
    .meta { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:16px; display:grid; gap:10px; }
    .meta h2 { margin:0; font-size:16px; }
    .meta ul { margin:0; padding-left:18px; color:#334155; }
    .page { background:#fff; border:1px solid #e5e7eb; border-radius:18px; padding:14px; box-shadow:0 10px 30px rgba(15,23,42,.06); }
    .page-head { display:flex; justify-content:space-between; gap:12px; align-items:center; padding:4px 4px 12px; }
    .page-head strong { font-size:16px; }
    .page-head span { color:var(--muted); font-size:12px; text-align:right; }
    .comic { position:relative; width:min(100%, 620px); margin:0 auto; overflow:hidden; border-radius:12px; background:#e5e7eb; border:1px solid #dbe2ea; }
    .comic img { display:block; width:100%; aspect-ratio:2/3; object-fit:cover; }
    .bubble { position:absolute; transform:translate(-50%, -50%); max-width:42%; min-width:110px; padding:11px 14px; background:#fff; border:3px solid #111827; border-radius:999px; box-shadow:0 4px 0 rgba(17,24,39,.16); font-weight:800; font-size:14px; line-height:1.35; text-align:center; }
    .bubble::after { content:""; position:absolute; left:50%; bottom:-13px; width:18px; height:18px; background:#fff; border-right:3px solid #111827; border-bottom:3px solid #111827; transform:translateX(-50%) rotate(45deg); }
    .bubble b { display:block; font-size:10px; color:var(--rose); margin-bottom:2px; }
    .thought { border-radius:28px; border-style:dashed; }
    .thought::before { content:""; position:absolute; right:18px; bottom:-18px; width:12px; height:12px; background:#fff; border:3px solid #111827; border-radius:50%; }
    .thought::after { right:5px; left:auto; bottom:-30px; width:8px; height:8px; border:3px solid #111827; border-radius:50%; transform:none; }
    .shout { border-radius:12px; background:#fff7ed; clip-path: polygon(5% 15%, 15% 5%, 28% 12%, 42% 2%, 52% 13%, 67% 5%, 80% 16%, 94% 12%, 88% 31%, 98% 44%, 86% 58%, 96% 77%, 76% 76%, 66% 96%, 51% 83%, 35% 96%, 28% 80%, 8% 86%, 14% 64%, 2% 50%, 12% 35%); }
    .narration { border-radius:8px; background:#111827; color:#fff; border-color:#111827; box-shadow:none; max-width:55%; }
    .narration::after { display:none; }
    @media (max-width: 720px) {
      header { padding:14px 16px; }
      h1 { font-size:20px; }
      main { padding:16px 10px 48px; }
      .page { border-radius:12px; padding:8px; }
      .page-head { display:block; }
      .page-head span { display:block; margin-top:4px; text-align:left; }
      .bubble { font-size:12px; min-width:84px; max-width:50%; padding:8px 10px; border-width:2px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(script.title)}</h1>
    <p>${escapeHtml(script.logline || '')}</p>
  </header>
  <main>
    <section class="meta">
      <h2>캐릭터</h2>
      <ul>${(script.characters || []).map(c => `<li><b>${escapeHtml(c.name || '')}</b> ${escapeHtml(c.role || '')} · ${escapeHtml(c.visual || c.description || '')}</li>`).join('')}</ul>
    </section>
    ${pages}
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let script;
try {
  script = normalizeScript(await callOllama());
} catch (error) {
  console.warn(`Ollama planning failed, using fallback script: ${error.message}`);
script = fallbackScript;
}

const renderedPages = await buildRenderedPages(script);
const html = renderHtml(script, renderedPages);
const htmlPath = path.join(outDir, 'index.html');
const jsonPath = path.join(outDir, 'script.json');
writeFileSync(htmlPath, html, 'utf-8');
writeFileSync(jsonPath, JSON.stringify({ ...script, renderedPages }, null, 2), 'utf-8');

console.log(JSON.stringify({ htmlPath, jsonPath, title: script.title }, null, 2));
