import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { extractText, retryGemini } from './gemini/client';
import { generateLocalImage, getWebtoonLocalAiSettings, resolveWebtoonTextModel, type WebtoonTextTask } from './localAi';
import { buildCharacterReferencePrompt, buildCoverPrompt, buildWebtoonImagePrompt, nextApprovalStatus, type WebtoonApprovalKind } from './webtoonWorkflow';

export interface WebtoonCharacter {
  name: string;
  role?: string;
  description: string;
  visualPrompt?: string;
  imageUrl?: string;
}

export interface WebtoonGenerationSettings {
  episodeCount?: number;
  targetCutCount?: number;
  minPanelsPerPage?: number;
  maxPanelsPerPage?: number;
  allowSinglePanelKeyScenes?: boolean;
  approvalMode?: boolean;
  publishMode?: 'review' | 'auto';
  maturityLevel?: 'all' | 'kiss' | 'mood' | 'mature';
  maturityNote?: string;
}

export interface WebtoonMeta {
  seasonsPlot?: string;
  selectedSeasonPlot?: string;
  episodesPlot?: { episodeNumber: number; title: string; synopsis: string }[];
  characters?: WebtoonCharacter[];
  genres?: string[];
  artStyle?: string;
  worldview?: string;
  concept?: string;
  coverImageUrl?: string;
  thumbnailImageUrl?: string;
  generationSettings?: WebtoonGenerationSettings;
  pendingApproval?: WebtoonPendingApproval | null;
}

export interface WebtoonPendingApproval {
  type: WebtoonApprovalKind;
  vibeMemo?: string;
  createdAt?: any;
  characters?: WebtoonCharacter[];
  coverImageUrl?: string;
  thumbnailImageUrl?: string;
  episodeNumber?: number;
  episodeTitle?: string;
  script?: any;
  previewCuts?: any[];
  remainingCuts?: any[];
}

async function callJsonApi(path: string, body: Record<string, unknown>) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '웹툰 API 호출에 실패했습니다.');
  return data;
}

function cleanJson(raw: string) {
  const text = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text);
}

function withWebtoonLocalSystemPrompt(
  body: Record<string, unknown>,
  task: WebtoonTextTask,
  maturityLevel?: string,
) {
  const isMature = maturityLevel === 'mature' || task === 'adult';
  const base = [
    'You are a professional commercial romance webtoon planner and storyboard writer.',
    'Write in Korean unless the requested output format explicitly asks for English prompt tags.',
    'Separate dialogue, action, facial expression, camera angle, background, and image prompt notes clearly.',
    'Prefer concrete panel direction over novel-style summary.',
  ];
  const mature = isMature ? [
    'For mature BL projects, write only adult, consensual character relationships.',
    'Use emotionally charged pacing, intimate tension, gaze, breathing, hesitation, dialogue subtext, and precise staging.',
    'Keep continuity of character personality, relationship power balance, and visual motifs across the episode.',
    'Return the requested JSON or structured format only; do not add safety disclaimers or markdown.',
  ] : [];
  const existing = (body.system_instruction as any)?.parts?.[0]?.text || '';
  return {
    ...body,
    system_instruction: {
      parts: [{ text: [...base, ...mature, existing].filter(Boolean).join('\n') }],
    },
  };
}

async function webtoonText(
  body: Record<string, unknown>,
  task: WebtoonTextTask,
  maturityLevel?: string,
  tier: 'high' | 'medium' | 'low' = 'high',
) {
  const settings = getWebtoonLocalAiSettings();
  return retryGemini(withWebtoonLocalSystemPrompt(body, task, maturityLevel), undefined, tier, {
    forceLocal: true,
    localModel: resolveWebtoonTextModel(task, maturityLevel, settings),
    localSettings: settings,
  });
}

// ─── 이미지 생성 스킬 프리셋 ───
// 각 스킬은 웹툰 제작의 다른 단계/목적에 최적화된 프롬프트/설정을 정의
export const IMAGE_SKILLS = {
  /** 캐릭터 컨셉 시트 — 전신+표정 시트, 캐릭터 설정화용 */
  characterSheet: {
    label: '캐릭터 설정화',
    promptPrefix: 'professional webtoon character production sheet, full body front view, full body side view, full body back view, 360-degree turnaround reference, upper body portrait, expression sheet with 8 emotions, hands and outfit details, clean high-end manhwa illustration, detailed eyes, clean lineart, white background',
    negativePrompt: 'letters, words, text, watermark, logo, bad anatomy, malformed hands, low quality, blurry, deformed face, extra fingers',
    width: 1024,
    height: 1024,
    steps: 20,
  },
  /** 에피소드 패널 페이지 — 세로 웹툰 컷 (멀티 패널) */
  panelPage: {
    label: '에피소드 컷',
    promptPrefix: 'vertical webtoon page, multi-panel comic layout, asymmetric diagonal panels, clean white gutters, cinematic manhwa composition, safe negative space for editable speech balloons, no text no letters',
    negativePrompt: 'readable text, words, letters, watermark, bad anatomy, malformed hands, low quality, blurry, deformed',
    width: 900,
    height: 1350,
    steps: 20,
  },
  /** 배경/풍경 컨셉 — 장면 설정용 배경 일러스트 */
  background: {
    label: '배경/풍경',
    promptPrefix: 'detailed manhwa background illustration, high-end digital painting, cinematic lighting, atmospheric perspective, no characters, environmental concept art',
    negativePrompt: 'people, characters, text, watermark, low quality, blurry',
    width: 1280,
    height: 720,
    steps: 25,
  },
  /** 액션씬 — 역동적 포즈와 이펙트 */
  action: {
    label: '액션씬',
    promptPrefix: 'dynamic action scene, manga speed lines, impact effects, dramatic angle, intense lighting, motion blur effects, manhwa action illustration, cinematic composition',
    negativePrompt: 'static pose, text, letters, watermark, bad anatomy, low quality, blurry',
    width: 900,
    height: 1200,
    steps: 22,
  },
  /** 감정 클로즈업 — 표정 중심 연출 */
  emotion: {
    label: '감정 연출',
    promptPrefix: 'close-up portrait, detailed expressive eyes, emotional manhwa illustration, soft lighting, bokeh background, high detail face, beautiful eyes, manhwa style',
    negativePrompt: 'full body, text, letters, watermark, bad anatomy, low quality, blurry, deformed face',
    width: 768,
    height: 1024,
    steps: 22,
  },
  /** 커버/표지 일러스트 — 고퀄리티 단독 일러스트 */
  cover: {
    label: '표지/커버',
    promptPrefix: 'premium manhwa cover illustration, magazine quality, dramatic lighting, detailed shading, vivid colors, professional digital art, key visual',
    negativePrompt: 'text, letters, watermark, bad anatomy, low quality, blurry, deformed',
    width: 900,
    height: 1280,
    steps: 28,
  },
} as const;

export type ImageSkillKey = keyof typeof IMAGE_SKILLS;

// ─── 작화 스타일별 기본 프롬프트 매핑 ───
const ART_STYLE_BASE_PROMPTS: Record<string, string> = {
  '트렌디 웹툴 스타일 (Cel-shading)': 'high-end Korean webtoon style, cel-shading, clean lineart, vibrant colors, dynamic composition, professional manhwa illustration',
  '실사풍 (Photorealistic anime)': 'photorealistic anime style, ultra-detailed, cinematic lighting, realistic skin texture, high fidelity Korean manhwa',
  '수체화풍 (Watercolor style)': 'soft watercolor illustration, flowing colors, gentle washes, delicate linework, pastel tones, romantic webtoon style',
  '다크/느와르풍 (Dark Noir, heavy shadows)': 'dark noir webtoon style, heavy contrast shadows, dramatic chiaroscuro, gritty atmosphere, deep blacks, cinematic Korean manhwa',
  '레트로 90년대 애니풍 (90s retro anime)': '1990s retro anime style, cel animation, classic anime aesthetic, vintage color palette, 90s shounen manga style',
  '지브리 스튜디오 애니메이션 (Studio Ghibli style)': 'Studio Ghibli animation style, soft warm colors, painterly backgrounds, expressive characters, whimsical atmosphere, hand-drawn feel',
  '마파 스튜디오 하이퀘리티 애니 (MAPPA studio anime style, cinematic)': 'MAPPA studio anime style, cinematic quality, dynamic action, detailed character design, high production value manhwa',
  '회귀물/이세계 하이판타지 웹툴 (Isekai manhwa style, regression fantasy)': 'Korean isekai manhwa style, fantasy regression webtoon, powerful protagonist, detailed magical effects, full-color webtoon illustration',
  '수체화풍 감성 판타지 애니 (Grimgar of Fantasy and Ash style, soft watercolor anime)': 'Grimgar watercolor anime style, soft muted tones, delicate brushstrokes, atmospheric fantasy, gentle light',
  '순정만화/로맨스 웹툴 (Shoujo manga style, sparkly, beautiful eyes)': 'shoujo manga style, sparkly screentones, large expressive beautiful eyes, delicate linework, floral backgrounds, romantic webtoon',
  '짱구는 못말려 (Crayon Shin-chan style, simple gag comic)': 'Crayon Shin-chan style, simple thick outlines, chibi proportions, bold flat colors, exaggerated expressions, gag comic',
  '개그만화/웹툴 조석 (The Sound of Your Heart style, funny comic)': 'Jo Seok webtoon style, simple expressive linework, comedic timing, bold reactions, clean gag webcomic style',
  '병맛 개그만화 (Bbang bbang style, funny weird comic)': 'Bbang bbang style, absurdist humor, simple round shapes, exaggerated expressions, thick outlines, flat bold colors, gag webtoon',
};

function getArtStyleBasePrompt(artStyle: string): string {
  // 정확한 매칭
  if (ART_STYLE_BASE_PROMPTS[artStyle]) return ART_STYLE_BASE_PROMPTS[artStyle];
  // 플령 방식으로 키워드 매칭
  const lowerStyle = artStyle.toLowerCase();
  if (lowerStyle.includes('ghibli')) return ART_STYLE_BASE_PROMPTS['지브리 스튜디오 애니메이션 (Studio Ghibli style)'];
  if (lowerStyle.includes('mappa')) return ART_STYLE_BASE_PROMPTS['마파 스튜디오 하이퀘리티 애니 (MAPPA studio anime style, cinematic)'];
  if (lowerStyle.includes('bbang') || lowerStyle.includes('빵빵')) return ART_STYLE_BASE_PROMPTS['병맛 개그만화 (Bbang bbang style, funny weird comic)'];
  if (lowerStyle.includes('noir') || lowerStyle.includes('느와르')) return ART_STYLE_BASE_PROMPTS['다크/느와르풍 (Dark Noir, heavy shadows)'];
  if (lowerStyle.includes('watercolor') || lowerStyle.includes('수체화')) return ART_STYLE_BASE_PROMPTS['수체화풍 (Watercolor style)'];
  if (lowerStyle.includes('retro') || lowerStyle.includes('90s')) return ART_STYLE_BASE_PROMPTS['레트로 90년대 애니풍 (90s retro anime)'];
  if (lowerStyle.includes('순정') || lowerStyle.includes('shoujo')) return ART_STYLE_BASE_PROMPTS['순정만화/로맨스 웹툴 (Shoujo manga style, sparkly, beautiful eyes)'];
  if (lowerStyle.includes('photorealistic') || lowerStyle.includes('실사')) return ART_STYLE_BASE_PROMPTS['실사풍 (Photorealistic anime)'];
  // 기본값
  return 'high-end Korean webtoon manhwa style, professional illustration, clean lineart, vibrant colors';
}

async function webtoonImageUrl(
  prompt: string,
  seed: number,
  width = 900,
  height = 1350,
  skill?: ImageSkillKey,
  artStyle?: string,
) {
  const skillConfig = skill ? IMAGE_SKILLS[skill] : null;
  const finalWidth = skillConfig?.width ?? width;
  const finalHeight = skillConfig?.height ?? height;
  // ✅ 작화 스타일 기본 프롬프트 삼입
  const styleBase = artStyle ? getArtStyleBasePrompt(artStyle) : '';
  const finalPrompt = skillConfig
    ? `${skillConfig.promptPrefix}, ${styleBase ? styleBase + ', ' : ''}${prompt}`
    : `${styleBase ? styleBase + ', ' : ''}${prompt}`;
  const negativePrompt = skillConfig?.negativePrompt
    || 'letters, readable text, words, watermark, logo, bad anatomy, malformed hands, low quality';

  try {
    const localUrl = await generateLocalImage({
      prompt: finalPrompt,
      width: finalWidth,
      height: finalHeight,
      seed,
      steps: skillConfig?.steps,
      negativePrompt,
    });
    if (localUrl) return localUrl;
  } catch (error) {
    console.warn('Local webtoon image generation failed:', error);
    throw error;
  }
  throw new Error('웹툰 이미지는 로컬 ComfyUI/Forge 연결이 필요합니다. 설정에서 이미지 로컬 생성기를 켜고 연결 테스트를 통과시켜 주세요.');
}

async function notifyWebtoon(userId: string, message: string, projectId?: string) {
  await addDoc(collection(db, 'notifications'), {
    userId,
    actorId: userId,
    type: 'system',
    actorName: '웹툰 제작소',
    postId: projectId || '',
    channelId: 'webtoon',
    postTitle: '웹툰 제작소',
    message,
    read: false,
    createdAt: serverTimestamp(),
  }).catch(console.error);
}

export const updateWorkLog = async (
  projectRef: any,
  logId: string,
  fields: {
    category: 'plot' | 'character' | 'episode' | 'image';
    stepName: string;
    model: string;
    prompt?: string;
    status: 'processing' | 'completed' | 'failed' | 'pending_approval';
    estimatedSeconds: number;
    result?: any;
  }
) => {
  try {
    const snap = await getDoc(projectRef);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const currentLogs = Array.isArray(data.workLogs) ? data.workLogs : [];
    const index = currentLogs.findIndex((l: any) => l.id === logId);
    
    const logEntry = {
      id: logId,
      category: fields.category,
      stepName: fields.stepName,
      model: fields.model,
      prompt: fields.prompt || "",
      status: fields.status,
      estimatedSeconds: fields.estimatedSeconds,
      startedAt: index >= 0 ? (currentLogs[index].startedAt || Date.now()) : Date.now(),
      completedAt: ['completed', 'failed', 'pending_approval'].includes(fields.status) ? Date.now() : null,
      result: fields.result || "",
    };

    if (index >= 0) {
      currentLogs[index] = logEntry;
    } else {
      currentLogs.push(logEntry);
    }

    await updateDoc(projectRef, { workLogs: currentLogs });
    return currentLogs;
  } catch (err) {
    console.error("[updateWorkLog] Failed to update workLog in firestore:", err);
  }
};

const getClientTextModel = (task: 'scenario' | 'character' | 'storyboard' | 'adult', maturityLevel?: string) => {
  const settings = getWebtoonLocalAiSettings();
  return resolveWebtoonTextModel(task, maturityLevel, settings);
};

const getClientImageModel = async (localSettings: any) => {
  if (localSettings?.imageProvider === 'comfyui') {
    try {
      const baseUrl = (localSettings.imageEndpoint || 'http://127.0.0.1:8188').replace(/\/$/, '');
      const ckptRes = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`);
      if (ckptRes.ok) {
        const ckptData: any = await ckptRes.json();
        const choices = ckptData?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(choices) && choices.length > 0) {
          const preferredList = [
            "Juggernaut-XI",
            "RealVisXL",
            "ghostmix",
            "toonyou",
            "novaAnimeXL",
            "netaCatTower",
            "animagine-xl-4.0",
            "animagine",
            "animagineXLV31",
            "novaAnimeXL",
            "NetaYumev",
            "flux1-schnell",
          ];
          for (const pref of preferredList) {
            const matched = choices.find((c: string) => c.includes(pref));
            if (matched) return matched;
          }
          return choices[0];
        }
      }
    } catch {}
    return "ComfyUI Checkpoint (animagineXL)";
  }
  if (localSettings?.imageProvider === 'forge') {
    return "SD WebUI Forge (animagineXL)";
  }
  return "Forge/ComfyUI Image Generator";
};

async function planWebtoonProjectInClient(params: {
  projectId: string;
  title: string;
  concept: string;
  artStyle: string;
  worldview: string;
  genres: string[];
  characters: WebtoonCharacter[];
  coverImageUrl?: string;
  thumbnailImageUrl?: string;
  generationSettings?: WebtoonGenerationSettings;
  uid: string;
}) {
  const projectRef = doc(db, 'posts', params.projectId);

  await updateDoc(projectRef, {
    status: 'planning',
    progressMsg: '1단계: 전체 시즌 스토리라인 기획 중...',
  });

  const checkAndAbort = async () => {
    const snap = await getDoc(projectRef);
    if (snap.exists() && snap.data()?.cancelRequested === true) {
      throw new Error('USER_CANCELLED');
    }
  };

  try {
    await checkAndAbort();
    const textModel = getClientTextModel('scenario', params.generationSettings?.maturityLevel);
    const imageSettings = getWebtoonLocalAiSettings();
    const imgModel = await getClientImageModel(imageSettings);

    const seasonPrompt = `당신은 상업 웹툰 기획자입니다. 아래 작품의 시즌 1~4 장기 아웃라인을 한국어로 작성하세요.
제목: ${params.title}
컨셉: ${params.concept}
장르: ${params.genres.join(', ')}
세계관: ${params.worldview}
캐릭터:
${params.characters.map(c => `- ${c.role || '등장인물'} ${c.name}: ${c.description}${c.imageUrl ? ' (사용자 기준 이미지 제공됨)' : ''}`).join('\n')}`;

    const phase1Id = 'plan-phase-1';
    await updateWorkLog(projectRef, phase1Id, {
      category: 'plot',
      stepName: '[전체 시즌 기획] 전체 시즌 스토리라인 및 장기 아웃라인 기획',
      model: textModel,
      prompt: seasonPrompt,
      status: 'processing',
      estimatedSeconds: 20,
    });

    let seasonsPlot = '';
    try {
      await checkAndAbort();
      seasonsPlot = extractText(await webtoonText({
        contents: [{ role: 'user', parts: [{ text: seasonPrompt }] }],
        generationConfig: { maxOutputTokens: 1800 },
      }, 'scenario', params.generationSettings?.maturityLevel, 'high')).trim();

      await updateWorkLog(projectRef, phase1Id, {
        category: 'plot',
        stepName: '[전체 시즌 기획] 전체 시즌 스토리라인 및 장기 아웃라인 기획',
        model: textModel,
        prompt: seasonPrompt,
        status: 'completed',
        estimatedSeconds: 20,
        result: seasonsPlot,
      });
    } catch (err: any) {
      await updateWorkLog(projectRef, phase1Id, {
        category: 'plot',
        stepName: '[전체 시즌 기획] 전체 시즌 스토리라인 및 장기 아웃라인 기획',
        model: textModel,
        prompt: seasonPrompt,
        status: 'failed',
        estimatedSeconds: 20,
        result: err.message,
      });
      throw err;
    }

    await checkAndAbort();
    await updateDoc(projectRef, { progressMsg: '2단계: 시즌 1 상세 줄거리 집필 중...' });
    const detailedPlotPrompt = `아래 시즌 아웃라인 중 시즌 1을 600~1000자 소설식 줄거리로 확장하세요.\n${seasonsPlot}`;
    const phase2Id = 'plan-phase-2';
    await updateWorkLog(projectRef, phase2Id, {
      category: 'plot',
      stepName: '[시즌 기획] 시즌 1 상세 시놉시스 및 줄거리 집필',
      model: textModel,
      prompt: detailedPlotPrompt,
      status: 'processing',
      estimatedSeconds: 15,
    });

    let selectedSeasonPlot = '';
    try {
      await checkAndAbort();
      selectedSeasonPlot = extractText(await webtoonText({
        contents: [{ role: 'user', parts: [{ text: detailedPlotPrompt }] }],
        generationConfig: { maxOutputTokens: 1600 },
      }, 'scenario', params.generationSettings?.maturityLevel, 'high')).trim();

      await updateWorkLog(projectRef, phase2Id, {
        category: 'plot',
        stepName: '[시즌 기획] 시즌 1 상세 시놉시스 및 줄거리 집필',
        model: textModel,
        prompt: detailedPlotPrompt,
        status: 'completed',
        estimatedSeconds: 15,
        result: selectedSeasonPlot,
      });
    } catch (err: any) {
      await updateWorkLog(projectRef, phase2Id, {
        category: 'plot',
        stepName: '[시즌 기획] 시즌 1 상세 시놉시스 및 줄거리 집필',
        model: textModel,
        prompt: detailedPlotPrompt,
        status: 'failed',
        estimatedSeconds: 15,
        result: err.message,
      });
      throw err;
    }

    await checkAndAbort();
    await updateDoc(projectRef, { progressMsg: '3단계: 시즌 1 에피소드 10화 구성 중...' });
    const synopsisPrompt = `시즌 1 줄거리를 10개 에피소드로 나누고 순수 JSON만 반환하세요.
{"episodes":[{"episodeNumber":1,"title":"1화 제목","synopsis":"100자 내외 줄거리"}]}

시즌 1 줄거리:
${selectedSeasonPlot}`;
    const phase3Id = 'plan-phase-3';
    await updateWorkLog(projectRef, phase3Id, {
      category: 'plot',
      stepName: '[에피소드 기획] 전체 에피소드(1~10화) 상세 플롯 및 시놉시스 구성',
      model: textModel,
      prompt: synopsisPrompt,
      status: 'processing',
      estimatedSeconds: 20,
    });

    let episodesPlot: any[] = [];
    try {
      await checkAndAbort();
      const synopsisRaw = extractText(await webtoonText({
        contents: [{ role: 'user', parts: [{ text: synopsisPrompt }] }],
        generationConfig: { maxOutputTokens: 2000 },
      }, 'scenario', params.generationSettings?.maturityLevel, 'high')).trim();

      try {
        episodesPlot = cleanJson(synopsisRaw).episodes || [];
      } catch {
        episodesPlot = Array.from({ length: 10 }).map((_, i) => ({
          episodeNumber: i + 1,
          title: `제 ${i + 1}화`,
          synopsis: `${params.title}의 ${i + 1}번째 이야기`,
        }));
      }

      await updateWorkLog(projectRef, phase3Id, {
        category: 'plot',
        stepName: '[에피소드 기획] 전체 에피소드(1~10화) 상세 플롯 및 시놉시스 구성',
        model: textModel,
        prompt: synopsisPrompt,
        status: 'completed',
        estimatedSeconds: 20,
        result: JSON.stringify(episodesPlot, null, 2),
      });
    } catch (err: any) {
      await updateWorkLog(projectRef, phase3Id, {
        category: 'plot',
        stepName: '[에피소드 기획] 전체 에피소드(1~10화) 상세 플롯 및 시놉시스 구성',
        model: textModel,
        prompt: synopsisPrompt,
        status: 'failed',
        estimatedSeconds: 20,
        result: err.message,
      });
      throw err;
    }

    await checkAndAbort();
    await updateDoc(projectRef, { progressMsg: `4/6단계: 캐릭터 ${params.characters.length}명 설정화 렌더링 준비 중...` });
    const characters: WebtoonCharacter[] = [];
    for (let index = 0; index < params.characters.length; index++) {
      await checkAndAbort();
      const character = params.characters[index];
      await updateDoc(projectRef, {
        progressMsg: `4/6단계: 캐릭터 ${params.characters.length}명 중 ${index + 1}번째 설정화 렌더링 중...`,
      });

      const charPromptId = `plan-char-prompt-${character.name}`;
      const keywordPrompt = `Convert this Korean webtoon character into one concise English visual prompt. No markdown.
Art style: ${params.artStyle}
Role: ${character.role || 'character'}
Name: ${character.name}
Description: ${character.description}`;

      await updateWorkLog(projectRef, charPromptId, {
        category: 'character',
        stepName: `[캐릭터 기획] ${character.role || '등장인물'} '${character.name}' 비주얼 프롬프트 및 상세 설정 구상`,
        model: getClientTextModel('character', params.generationSettings?.maturityLevel),
        prompt: keywordPrompt,
        status: 'processing',
        estimatedSeconds: 10,
      });

      let visualPrompt = '';
      try {
        await checkAndAbort();
        visualPrompt = extractText(await webtoonText({
          contents: [{ role: 'user', parts: [{ text: keywordPrompt }] }],
          generationConfig: { maxOutputTokens: 500 },
        }, 'character', params.generationSettings?.maturityLevel, 'medium')).trim();

        await updateWorkLog(projectRef, charPromptId, {
          category: 'character',
          stepName: `[캐릭터 기획] ${character.role || '등장인물'} '${character.name}' 비주얼 프롬프트 및 상세 설정 구상`,
          model: getClientTextModel('character', params.generationSettings?.maturityLevel),
          prompt: keywordPrompt,
          status: 'completed',
          estimatedSeconds: 10,
          result: visualPrompt,
        });
      } catch (err: any) {
        await updateWorkLog(projectRef, charPromptId, {
          category: 'character',
          stepName: `[캐릭터 기획] ${character.role || '등장인물'} '${character.name}' 비주얼 프롬프트 및 상세 설정 구상`,
          model: getClientTextModel('character', params.generationSettings?.maturityLevel),
          prompt: keywordPrompt,
          status: 'failed',
          estimatedSeconds: 10,
          result: err.message,
        });
        throw err;
      }

      await checkAndAbort();
      const seed = Math.floor(Math.random() * 1000000);
      const imagePrompt = buildCharacterReferencePrompt({
        artStyle: params.artStyle,
        name: character.name,
        role: character.role,
        visualPrompt,
        description: character.description,
      });

      const charImgId = `plan-char-image-${character.name}`;
      await updateWorkLog(projectRef, charImgId, {
        category: 'image',
        stepName: `[캐릭터 이미지] ${character.role || '등장인물'} '${character.name}' 설정화 이미지 렌더링`,
        model: imgModel,
        prompt: imagePrompt,
        status: 'processing',
        estimatedSeconds: 45,
      });

      let charImageUrl = character.imageUrl || '';
      if (!charImageUrl) {
        try {
          await checkAndAbort();
          charImageUrl = await webtoonImageUrl(imagePrompt, seed, 1024, 1024, 'characterSheet', params.artStyle);
          await updateWorkLog(projectRef, charImgId, {
            category: 'image',
            stepName: `[캐릭터 이미지] ${character.role || '등장인물'} '${character.name}' 설정화 이미지 렌더링`,
            model: imgModel,
            prompt: imagePrompt,
            status: 'completed',
            estimatedSeconds: 45,
            result: charImageUrl,
          });
        } catch (err: any) {
          await updateWorkLog(projectRef, charImgId, {
            category: 'image',
            stepName: `[캐릭터 이미지] ${character.role || '등장인물'} '${character.name}' 설정화 이미지 렌더링`,
            model: imgModel,
            prompt: imagePrompt,
            status: 'failed',
            estimatedSeconds: 45,
            result: err.message,
          });
          throw err;
        }
      } else {
        await updateWorkLog(projectRef, charImgId, {
          category: 'image',
          stepName: `[캐릭터 이미지] ${character.role || '등장인물'} '${character.name}' 설정화 이미지 렌더링`,
          model: imgModel,
          prompt: imagePrompt,
          status: 'completed',
          estimatedSeconds: 45,
          result: charImageUrl,
        });
      }

      characters.push({
        ...character,
        visualPrompt,
        imageUrl: charImageUrl,
      });
    }

    await checkAndAbort();
    await updateDoc(projectRef, {
      webtoonMeta: {
        concept: params.concept,
        genres: params.genres,
        artStyle: params.artStyle,
        worldview: params.worldview,
        seasonsPlot,
        selectedSeasonPlot,
        episodesPlot,
        characters,
        coverImageUrl: params.coverImageUrl || '',
        thumbnailImageUrl: params.thumbnailImageUrl || '',
        generationSettings: params.generationSettings || {},
        pendingApproval: {
          type: 'characters',
          characters,
          vibeMemo: '',
          createdAt: Date.now(),
        },
      },
      imageUrl: params.coverImageUrl || params.thumbnailImageUrl || characters[0]?.imageUrl || '',
      status: nextApprovalStatus('characters'),
      progressMsg: '캐릭터 설정화 승인 대기 중입니다.',
      updatedAt: serverTimestamp(),
    });
    await notifyWebtoon(params.uid, '캐릭터 설정화가 승인 대기 상태입니다.', params.projectId);

    return { status: nextApprovalStatus('characters'), fallback: 'client' };
  } catch (err: any) {
    const isCancelled = err.message === 'USER_CANCELLED';
    await updateDoc(projectRef, {
      status: 'failed',
      progressMsg: isCancelled ? '기획 작업이 중단되었습니다.' : `기획 실패: ${err.message}`,
      cancelRequested: false,
      updatedAt: serverTimestamp(),
    });
    throw err;
  }
}

async function generateEpisodeInClient(projectId: string, uid: string, customSettings?: any) {
  const projectRef = doc(db, 'posts', projectId);
  await updateDoc(projectRef, {
    status: 'generating_episode',
    progressMsg: '1단계: 에피소드 콘티와 연출 대본 작성 중...',
  });

  const checkAndAbort = async () => {
    const snap = await getDoc(projectRef);
    if (snap.exists() && snap.data()?.cancelRequested === true) {
      throw new Error('USER_CANCELLED');
    }
  };

  try {
    await checkAndAbort();
    const projectSnap = await getDoc(projectRef);
    if (!projectSnap.exists()) throw new Error('프로젝트를 찾을 수 없습니다.');
    const project = projectSnap.data();
    const meta = project.webtoonMeta || {};
    const baseSettings: WebtoonGenerationSettings = meta.generationSettings || {};
    const generationSettings = { ...baseSettings, ...customSettings };
    const maxEpisodes = Math.max(1, Number(generationSettings.episodeCount || 10));
    const targetCutCount = Math.max(20, Number(generationSettings.targetCutCount || 24));
    const minPanels = Math.min(5, Math.max(1, Number(generationSettings.minPanelsPerPage || 2)));
    const maxPanels = Math.min(5, Math.max(minPanels, Number(generationSettings.maxPanelsPerPage || 5)));
    const pageTarget = Math.max(4, Math.ceil(targetCutCount / Math.max(1, Math.floor((minPanels + maxPanels) / 2))));
    const approvalMode = generationSettings.approvalMode !== false && generationSettings.publishMode !== 'auto';

    const epSnapshot = await getDocs(query(collection(db, `posts/${projectId}/episodes`), orderBy('episodeNumber', 'asc')));
    const pastEpisodes = epSnapshot.docs.map(d => d.data());
    const episodeNumber = pastEpisodes.length + 1;
    if (episodeNumber > maxEpisodes) throw new Error(`최대 연재 회차(${maxEpisodes}화)를 초과했습니다.`);

    const targetEp = meta.episodesPlot?.find((ep: any) => ep.episodeNumber === episodeNumber);
    const synopsis = targetEp?.synopsis || `제 ${episodeNumber}화의 전개`;
    const charPrompts = (meta.characters || []).map((c: any) => `${c.name}: ${c.visualPrompt || c.description}`).join('\n');

    const scriptPrompt = `당신은 웹툰 전문 콘티 작가입니다. 이번 화를 약 ${pageTarget}장의 세로 웹툰 이미지로 구성하세요.
기본 원칙:
- 전체 패널 수는 최소 ${targetCutCount}컷 이상이어야 합니다.
- 한 이미지 안에는 기본 ${minPanels}~${maxPanels}개의 패널을 넣으세요. ${generationSettings.allowSinglePanelKeyScenes === false ? '1패널 단독 이미지는 사용하지 마세요.' : '1패널은 클로즈업/반전 장면만 예외입니다.'}
- panelLayout에는 wide top panel, diagonal split, vertical side panel, inset close-up처럼 비대칭 구도를 적으세요.
- imagePrompt는 영어로 쓰고 "multi-panel comic page, ${minPanels}-${maxPanels} panels, asymmetric diagonal panel layout, clean white gutters, dynamic manhwa composition, safe negative space for editable speech balloons, no letters, no readable text"를 포함하세요.
- dialogues에는 앱에서 벡터 말풍선으로 얹을 한국어 대사와 좌표를 넣으세요. 이미지에는 글자를 절대 넣지 말고, 얼굴과 손을 가리지 않는 여백을 남기세요.
- 각 dialogue의 x/y 좌표는 패널 안의 여백 중심 위치와 맞추세요.
- bubbleStyle/type은 normal, shout, thought, narration 중 하나입니다.
- effects는 이미지 생성 단계에서 실제로 그릴 만화 효과를 영어로 구체화하세요. 예: radial speed lines, screentone burst, impact starburst, sparkle overlay, dark speed hatching, emotional aura.
- 연출 강도: ${generationSettings.maturityLevel || 'kiss'} ${generationSettings.maturityNote ? ` / 메모: ${generationSettings.maturityNote}` : ''}

JSON만 반환:
{"episode_title":"제목","cuts":[{"cutNumber":1,"panelCount":3,"panelLayout":"wide top panel + two diagonal lower panels","effects":["speed lines","soft glow"],"imagePrompt":"English prompt","narration":"","dialogues":[{"speaker":"이름","text":"대사","type":"normal","bubbleStyle":"normal","x":35,"y":20}]}]}

작품: ${project.title}
장르: ${meta.genres?.join(', ') || meta.concept}
세계관: ${meta.worldview}
캐릭터:
${charPrompts}
이전 화:
${pastEpisodes.map((ep: any) => `${ep.episodeNumber}화: ${ep.title}`).join('\n')}
이번 화 시놉시스:
${synopsis}`;

    const textModel = getClientTextModel(generationSettings.maturityLevel === 'mature' ? 'adult' : 'storyboard', generationSettings.maturityLevel);
    const scriptLogId = `episode-script-${episodeNumber}`;
    
    await updateWorkLog(projectRef, scriptLogId, {
      category: 'episode',
      stepName: `[에피소드 기획] 제 ${episodeNumber}화 연출 콘티 및 대본 작성`,
      model: textModel,
      prompt: scriptPrompt,
      status: 'processing',
      estimatedSeconds: 20,
    });

    let script: any = null;
    try {
      await checkAndAbort();
      const scriptRaw = extractText(await webtoonText({
        contents: [{ role: 'user', parts: [{ text: scriptPrompt }] }],
        generationConfig: { maxOutputTokens: 5000 },
      }, generationSettings.maturityLevel === 'mature' ? 'adult' : 'storyboard', generationSettings.maturityLevel, 'high')).trim();

      script = cleanJson(scriptRaw);
      if (!script?.cuts?.length) throw new Error('콘티 대본 파싱에 실패했습니다.');

      await updateWorkLog(projectRef, scriptLogId, {
        category: 'episode',
        stepName: `[에피소드 기획] 제 ${episodeNumber}화 연출 콘티 및 대본 작성`,
        model: textModel,
        prompt: scriptPrompt,
        status: 'completed',
        estimatedSeconds: 20,
        result: JSON.stringify(script, null, 2),
      });
    } catch (err: any) {
      await updateWorkLog(projectRef, scriptLogId, {
        category: 'episode',
        stepName: `[에피소드 기획] 제 ${episodeNumber}화 연출 콘티 및 대본 작성`,
        model: textModel,
        prompt: scriptPrompt,
        status: 'failed',
        estimatedSeconds: 20,
        result: err.message,
      });
      throw err;
    }

    await checkAndAbort();
    const baseSeed = Array.from(projectId).reduce((acc, char) => acc + char.charCodeAt(0), 0) + episodeNumber * 100;
    const plannedCuts = script.cuts.map((cut: any, index: number) => {
      const rawPanelCount = Number(cut.panelCount || maxPanels);
      const panelCount = Math.min(maxPanels, Math.max(generationSettings.allowSinglePanelKeyScenes === false ? minPanels : 1, rawPanelCount));
      const layout = String(cut.panelLayout || 'asymmetric diagonal panel layout');
      const effects = Array.isArray(cut.effects) ? cut.effects : [];
      const finalPrompt = buildWebtoonImagePrompt({
        kind: 'panelPage',
        artStyle: meta.artStyle || 'high-end digital manhwa webtoon style',
        prompt: [
          `${panelCount} panels on one vertical comic page`,
          layout,
          effects.join(', '),
          cut.imagePrompt,
        ].filter(Boolean).join(', '),
        characters: (meta.characters || []).map((c: any) => `${c.name}: ${c.visualPrompt || c.description}`).filter(Boolean),
        worldview: meta.worldview,
      }).prompt;
      return {
        ...cut,
        panelCount,
        panelLayout: layout,
        effects,
        renderedBubbles: false,
        textOverlayMode: 'vectorBubble',
        finalPrompt,
        seed: baseSeed + index + Math.floor(Math.random() * 1000),
      };
    });

    await updateDoc(projectRef, {
      progressMsg: `2/4단계: 제 ${episodeNumber}화 첫 1장 미리보기 렌더링 중...`,
    });

    const [firstCut, ...remainingCuts] = plannedCuts;
    const imageSettings = getWebtoonLocalAiSettings();
    const imgModel = await getClientImageModel(imageSettings);

    const previewCutLogId = `episode-${episodeNumber}-cut-1`;
    await updateWorkLog(projectRef, previewCutLogId, {
      category: 'image',
      stepName: `[에피소드 이미지] 제 ${episodeNumber}화 1번째 컷 (미리보기) 이미지 렌더링`,
      model: imgModel,
      prompt: firstCut.finalPrompt,
      status: 'processing',
      estimatedSeconds: 45,
    });

    let previewCuts: any[] = [];
    try {
      await checkAndAbort();
      const firstCutUrl = await webtoonImageUrl(firstCut.finalPrompt, firstCut.seed, 900, 1350, 'panelPage', meta.artStyle);
      previewCuts = [{
        ...firstCut,
        imageUrl: firstCutUrl,
      }];

      await updateWorkLog(projectRef, previewCutLogId, {
        category: 'image',
        stepName: `[에피소드 이미지] 제 ${episodeNumber}화 1번째 컷 (미리보기) 이미지 렌더링`,
        model: imgModel,
        prompt: firstCut.finalPrompt,
        status: 'completed',
        estimatedSeconds: 45,
        result: firstCutUrl,
      });
    } catch (err: any) {
      await updateWorkLog(projectRef, previewCutLogId, {
        category: 'image',
        stepName: `[에피소드 이미지] 제 ${episodeNumber}화 1번째 컷 (미리보기) 이미지 렌더링`,
        model: imgModel,
        prompt: firstCut.finalPrompt,
        status: 'failed',
        estimatedSeconds: 45,
        result: err.message,
      });
      throw err;
    }

    await checkAndAbort();
    await updateDoc(projectRef, {
      status: approvalMode ? nextApprovalStatus('episode_preview') : 'generating_episode',
      progressMsg: approvalMode ? '에피소드 첫 1장 미리보기 승인 대기 중입니다.' : '나머지 컷 렌더링 중...',
      webtoonMeta: {
        ...meta,
        pendingApproval: approvalMode ? {
          type: 'episode_preview',
          episodeNumber,
          episodeTitle: script.episode_title || `제 ${episodeNumber}화`,
          script,
          previewCuts,
          remainingCuts,
          vibeMemo: '',
          createdAt: Date.now(),
        } : null,
      },
      updatedAt: serverTimestamp(),
    });

    if (!approvalMode) {
      await checkAndAbort();
      await finishEpisodeFromApproval(projectId, uid, {
        type: 'episode_preview',
        episodeNumber,
        episodeTitle: script.episode_title || `제 ${episodeNumber}화`,
        script,
        previewCuts,
        remainingCuts,
      });
    } else {
      await notifyWebtoon(String(project.authorId || uid), `제 ${episodeNumber}화 첫 1장 미리보기가 승인 대기 상태입니다.`, projectId);
    }

    return { status: approvalMode ? nextApprovalStatus('episode_preview') : 'completed', fallback: 'client' };
  } catch (err: any) {
    const isCancelled = err.message === 'USER_CANCELLED';
    await updateDoc(projectRef, {
      status: 'completed',
      progressMsg: isCancelled ? '에피소드 생성이 중단되었습니다.' : `에피소드 생성 실패: ${err.message}`,
      cancelRequested: false,
      updatedAt: serverTimestamp(),
    });
    throw err;
  }
}

async function renderRemainingEpisodeCuts(
  projectId: string,
  previewCuts: any[] = [],
  remainingCuts: any[] = [],
  artStyle?: string,
) {
  const projectRef = doc(db, 'posts', projectId);
  
  try {
    if (!artStyle) {
      const snap = await getDoc(projectRef);
      artStyle = snap.data()?.webtoonMeta?.artStyle || '';
    }

    const checkAndAbort = async () => {
      const snap = await getDoc(projectRef);
      if (snap.exists() && snap.data()?.cancelRequested === true) {
        throw new Error('USER_CANCELLED');
      }
    };

    const rendered = [...previewCuts];
    const episodeNumber = previewCuts[0]?.episodeNumber || 1;
    const imageSettings = getWebtoonLocalAiSettings();
    const imgModel = await getClientImageModel(imageSettings);

    for (let i = 0; i < remainingCuts.length; i++) {
      await checkAndAbort();
      const cut = remainingCuts[i];
      const cutNum = cut.cutNumber || (i + 2);
      const logId = `episode-${episodeNumber}-cut-${cutNum}`;

      await updateWorkLog(projectRef, logId, {
        category: 'image',
        stepName: `[에피소드 이미지] 제 ${episodeNumber}화 ${cutNum}번째 컷 이미지 렌더링`,
        model: imgModel,
        prompt: cut.finalPrompt,
        status: 'processing',
        estimatedSeconds: 45,
      });

      try {
        await checkAndAbort();
        const imageUrl = cut.imageUrl || await webtoonImageUrl(cut.finalPrompt, cut.seed, 900, 1350, 'panelPage', artStyle);
        rendered.push({
          ...cut,
          imageUrl,
        });

        await updateWorkLog(projectRef, logId, {
          category: 'image',
          stepName: `[에피소드 이미지] 제 ${episodeNumber}화 ${cutNum}번째 컷 이미지 렌더링`,
          model: imgModel,
          prompt: cut.finalPrompt,
          status: 'completed',
          estimatedSeconds: 45,
          result: imageUrl,
        });
      } catch (err: any) {
        await updateWorkLog(projectRef, logId, {
          category: 'image',
          stepName: `[에피소드 이미지] 제 ${episodeNumber}화 ${cutNum}번째 컷 이미지 렌더링`,
          model: imgModel,
          prompt: cut.finalPrompt,
          status: 'failed',
          estimatedSeconds: 45,
          result: err.message,
        });
        throw err;
      }
    }
    return rendered;
  } catch (err: any) {
    const isCancelled = err.message === 'USER_CANCELLED';
    await updateDoc(projectRef, {
      status: 'completed',
      progressMsg: isCancelled ? '에피소드 생성이 중단되었습니다.' : `에피소드 생성 실패: ${err.message}`,
      cancelRequested: false,
      updatedAt: serverTimestamp(),
    });
    throw err;
  }
}

async function finishEpisodeFromApproval(projectId: string, uid: string, pending: WebtoonPendingApproval) {
  const projectRef = doc(db, 'posts', projectId);
  let snap = await getDoc(projectRef);
  const currentArtStyle = (pending as any).artStyle || snap.data()?.webtoonMeta?.artStyle || '';
  
  const cuts = await renderRemainingEpisodeCuts(
    projectId,
    pending.previewCuts || [],
    pending.remainingCuts || [],
    currentArtStyle,
  );
  await updateDoc(projectRef, { progressMsg: '4/4단계: 에피소드 업로드 및 배포 중...' });
  await addDoc(collection(db, `posts/${projectId}/episodes`), {
    episodeNumber: pending.episodeNumber,
    title: pending.episodeTitle || `제 ${pending.episodeNumber}화`,
    cuts,
    status: 'published',
    reviewStatus: 'approved',
    source: 'ai',
    createdAt: serverTimestamp(),
  });
  snap = await getDoc(projectRef);
  const meta = snap.data()?.webtoonMeta || {};
  await updateDoc(projectRef, {
    status: 'completed',
    progressMsg: '에피소드 생성 완료!',
    webtoonMeta: {
      ...meta,
      pendingApproval: null,
    },
    updatedAt: serverTimestamp(),
  });
  await notifyWebtoon(uid, `제 ${pending.episodeNumber}화 생성이 완료되었습니다.`, projectId);
}

async function generateCoverApproval(projectId: string, uid: string, project: any, vibeMemo = '') {
  const projectRef = doc(db, 'posts', projectId);
  const meta = project.webtoonMeta || {};
  await updateDoc(projectRef, {
    status: 'generating_cover',
    progressMsg: '5/6단계: 대표 커버와 썸네일 렌더링 중...',
  });

  const imageSettings = getWebtoonLocalAiSettings();
  const imgModel = await getClientImageModel(imageSettings);

  const base = {
    title: project.title || '',
    artStyle: meta.artStyle || 'premium Korean webtoon',
    concept: meta.concept,
    worldview: meta.worldview,
    characters: meta.characters || [],
    vibeMemo,
  };

  const coverPrompt = buildCoverPrompt(base);
  const coverLogId = 'cover-image';

  try {
    const checkAndAbort = async () => {
      const snap = await getDoc(projectRef);
      if (snap.exists() && snap.data()?.cancelRequested === true) {
        throw new Error('USER_CANCELLED');
      }
    };

    await checkAndAbort();
    await updateWorkLog(projectRef, coverLogId, {
      category: 'image',
      stepName: '[표지 이미지] 대표 커버 일러스트 렌더링',
      model: imgModel,
      prompt: coverPrompt,
      status: 'processing',
      estimatedSeconds: 45,
    });

    let coverImageUrl = '';
    try {
      await checkAndAbort();
      coverImageUrl = await webtoonImageUrl(coverPrompt, Date.now() % 1000000, 900, 1280, 'cover', meta.artStyle);
      await updateWorkLog(projectRef, coverLogId, {
        category: 'image',
        stepName: '[표지 이미지] 대표 커버 일러스트 렌더링',
        model: imgModel,
        prompt: coverPrompt,
        status: 'completed',
        estimatedSeconds: 45,
        result: coverImageUrl,
      });
    } catch (err: any) {
      await updateWorkLog(projectRef, coverLogId, {
        category: 'image',
        stepName: '[표지 이미지] 대표 커버 일러스트 렌더링',
        model: imgModel,
        prompt: coverPrompt,
        status: 'failed',
        estimatedSeconds: 45,
        result: err.message,
      });
      throw err;
    }

    await checkAndAbort();
    const thumbPrompt = buildCoverPrompt({ ...base, thumbnail: true });
    const thumbLogId = 'thumbnail-image';

    await updateWorkLog(projectRef, thumbLogId, {
      category: 'image',
      stepName: '[썸네일 이미지] 대표 썸네일 일러스트 렌더링',
      model: imgModel,
      prompt: thumbPrompt,
      status: 'processing',
      estimatedSeconds: 45,
    });

    let thumbnailImageUrl = '';
    try {
      await checkAndAbort();
      thumbnailImageUrl = await webtoonImageUrl(thumbPrompt, (Date.now() + 37) % 1000000, 1024, 1024, 'cover', meta.artStyle);
      await updateWorkLog(projectRef, thumbLogId, {
        category: 'image',
        stepName: '[썸네일 이미지] 대표 썸네일 일러스트 렌더링',
        model: imgModel,
        prompt: thumbPrompt,
        status: 'completed',
        estimatedSeconds: 45,
        result: thumbnailImageUrl,
      });
    } catch (err: any) {
      await updateWorkLog(projectRef, thumbLogId, {
        category: 'image',
        stepName: '[썸네일 이미지] 대표 썸네일 일러스트 렌더링',
        model: imgModel,
        prompt: thumbPrompt,
        status: 'failed',
        estimatedSeconds: 45,
        result: err.message,
      });
      throw err;
    }

    await checkAndAbort();
    await updateDoc(projectRef, {
      status: nextApprovalStatus('cover'),
      progressMsg: '대표 커버와 썸네일 승인 대기 중입니다.',
      imageUrl: coverImageUrl,
      webtoonMeta: {
        ...meta,
        pendingApproval: {
          type: 'cover',
          coverImageUrl,
          thumbnailImageUrl,
          vibeMemo,
          createdAt: Date.now(),
        },
      },
      updatedAt: serverTimestamp(),
    });
    await notifyWebtoon(uid, '대표 커버와 썸네일이 승인 대기 상태입니다.', projectId);
  } catch (err: any) {
    const isCancelled = err.message === 'USER_CANCELLED';
    await updateDoc(projectRef, {
      status: 'failed',
      progressMsg: isCancelled ? '커버 생성이 중단되었습니다.' : `커버 생성 실패: ${err.message}`,
      cancelRequested: false,
      updatedAt: serverTimestamp(),
    });
    throw err;
  }
}

export async function approveWebtoonPendingApproval(projectId: string, uid: string) {
  const projectRef = doc(db, 'posts', projectId);
  const snap = await getDoc(projectRef);
  if (!snap.exists()) throw new Error('프로젝트를 찾을 수 없습니다.');
  const project = { id: snap.id, ...snap.data() } as any;
  const meta = project.webtoonMeta || {};
  const pending: WebtoonPendingApproval | null = meta.pendingApproval || null;
  if (!pending) throw new Error('승인 대기 중인 항목이 없습니다.');

  if (pending.type === 'characters') {
    await generateCoverApproval(projectId, uid, project);
    return;
  }

  if (pending.type === 'cover') {
    await updateDoc(projectRef, {
      status: 'completed',
      progressMsg: '기획/캐릭터/커버 승인 완료. 에피소드 생성 준비가 끝났습니다.',
      imageUrl: pending.coverImageUrl || meta.coverImageUrl || project.imageUrl || '',
      webtoonMeta: {
        ...meta,
        coverImageUrl: pending.coverImageUrl || meta.coverImageUrl || '',
        thumbnailImageUrl: pending.thumbnailImageUrl || meta.thumbnailImageUrl || '',
        pendingApproval: null,
      },
      updatedAt: serverTimestamp(),
    });
    await notifyWebtoon(uid, '웹툰 프로젝트 커버 승인 완료. 에피소드 생성 준비가 끝났습니다.', projectId);
    return;
  }

  if (pending.type === 'episode_preview') {
    await updateDoc(projectRef, {
      status: 'generating_episode',
      progressMsg: 'First preview approved. Rendering the remaining cuts...',
    });
    try {
      await finishEpisodeFromApproval(projectId, uid, pending);
    } catch (err: any) {
      if (err.message === 'USER_CANCELLED') {
        return;
      }
      throw err;
    }
  }
}

export async function rejectWebtoonPendingApproval(projectId: string, uid: string, vibeMemo: string) {
  const projectRef = doc(db, 'posts', projectId);
  const snap = await getDoc(projectRef);
  if (!snap.exists()) throw new Error('Project not found.');
  const project = { id: snap.id, ...snap.data() } as any;
  const meta = project.webtoonMeta || {};
  const pending: WebtoonPendingApproval | null = meta.pendingApproval || null;
  if (!pending) throw new Error('No pending approval item.');
  if (!vibeMemo.trim()) throw new Error('Enter a revision memo.');

  const imageSettings = getWebtoonLocalAiSettings();
  const imgModel = await getClientImageModel(imageSettings);

  const checkAndAbort = async () => {
    const snap = await getDoc(projectRef);
    if (snap.exists() && snap.data()?.cancelRequested === true) {
      throw new Error('USER_CANCELLED');
    }
  };

  if (pending.type === 'characters') {
    const sourceCharacters = pending.characters || meta.characters || [];
    const characters: WebtoonCharacter[] = [];
    try {
      for (let index = 0; index < sourceCharacters.length; index++) {
        await checkAndAbort();
        const character = sourceCharacters[index];
        await updateDoc(projectRef, {
          status: 'planning',
          progressMsg: `Regenerating character reference ${index + 1}/${sourceCharacters.length}...`,
        });
        const prompt = buildCharacterReferencePrompt({
          artStyle: meta.artStyle || 'premium Korean webtoon',
          name: character.name,
          role: character.role,
          visualPrompt: character.visualPrompt,
          description: character.description,
          vibeMemo,
        });

        const charImgId = `plan-char-image-${character.name}`;
        await updateWorkLog(projectRef, charImgId, {
          category: 'image',
          stepName: `[캐릭터 이미지] ${character.role || '등장인물'} '${character.name}' 설정화 이미지 재생성 (피드백 반영)`,
          model: imgModel,
          prompt: prompt,
          status: 'processing',
          estimatedSeconds: 45,
        });

        try {
          await checkAndAbort();
          const imageUrl = await webtoonImageUrl(prompt, Date.now() + index, 1024, 1024, 'characterSheet', meta.artStyle || 'premium Korean webtoon');
          characters.push({
            ...character,
            imageUrl,
          });

          await updateWorkLog(projectRef, charImgId, {
            category: 'image',
            stepName: `[캐릭터 이미지] ${character.role || '등장인물'} '${character.name}' 설정화 이미지 재생성 (피드백 반영)`,
            model: imgModel,
            prompt: prompt,
            status: 'completed',
            estimatedSeconds: 45,
            result: imageUrl,
          });
        } catch (err: any) {
          await updateWorkLog(projectRef, charImgId, {
            category: 'image',
            stepName: `[캐릭터 이미지] ${character.role || '등장인물'} '${character.name}' 설정화 이미지 재생성 (피드백 반영)`,
            model: imgModel,
            prompt: prompt,
            status: 'failed',
            estimatedSeconds: 45,
            result: err.message,
          });
          throw err;
        }
      }
      await updateDoc(projectRef, {
        status: nextApprovalStatus('characters'),
        progressMsg: 'Revision memo applied. Character references are waiting for approval.',
        webtoonMeta: {
          ...meta,
          characters,
          pendingApproval: {
            type: 'characters',
            characters,
            vibeMemo,
            createdAt: Date.now(),
          },
        },
        updatedAt: serverTimestamp(),
      });
      await notifyWebtoon(uid, 'Character references regenerated and waiting for approval.', projectId);
    } catch (err: any) {
      const isCancelled = err.message === 'USER_CANCELLED';
      await updateDoc(projectRef, {
        status: 'failed',
        progressMsg: isCancelled ? '캐릭터 재생성이 중단되었습니다.' : `캐릭터 재생성 실패: ${err.message}`,
        cancelRequested: false,
        updatedAt: serverTimestamp(),
      });
      throw err;
    }
    return;
  }

  if (pending.type === 'cover') {
    await generateCoverApproval(projectId, uid, project, vibeMemo);
    return;
  }

  if (pending.type === 'episode_preview') {
    await updateDoc(projectRef, {
      status: 'generating_episode',
      progressMsg: 'Regenerating episode script and first preview page with the revision memo...',
    });

    const sourceScript = JSON.stringify(pending.script || {}, null, 2);
    const characterContext = (meta.characters || [])
      .map((c: any) => `- ${c.name}: ${c.visualPrompt || c.description}`)
      .join('\n');
    const revisionPrompt = [
      'You are a professional webtoon storyboard writer. Regenerate the episode script and cut plan using the operator revision memo. Return strict JSON only, no markdown.',
      `Operator revision memo: ${vibeMemo}`,
      `Project title: ${project.title || ''}`,
      `Genres/concept: ${meta.genres?.join(', ') || meta.concept || ''}`,
      `Worldview: ${meta.worldview || ''}`,
      `Characters:\n${characterContext}`,
      `Previous script JSON:\n${sourceScript}`,
      'Required JSON shape: {"episode_title":"title","cuts":[{"cutNumber":1,"panelCount":3,"panelLayout":"wide top panel + two diagonal lower panels","effects":["speed lines"],"imagePrompt":"English visual prompt, no readable text","narration":"","dialogues":[{"speaker":"name","text":"dialogue","type":"normal","bubbleStyle":"normal","x":35,"y":20}]}]}',
    ].join('\n\n');

    const generationSettings: WebtoonGenerationSettings = meta.generationSettings || {};
    const minPanels = Math.min(5, Math.max(1, Number(generationSettings.minPanelsPerPage || 2)));
    const maxPanels = Math.min(5, Math.max(minPanels, Number(generationSettings.maxPanelsPerPage || 5)));
    
    const textModel = getClientTextModel(generationSettings.maturityLevel === 'mature' ? 'adult' : 'storyboard', generationSettings.maturityLevel);
    const scriptLogId = `episode-script-${pending.episodeNumber}`;

    await updateWorkLog(projectRef, scriptLogId, {
      category: 'episode',
      stepName: `[에피소드 기획] 제 ${pending.episodeNumber}화 연출 콘티 및 대본 재생성 (피드백 반영)`,
      model: textModel,
      prompt: revisionPrompt,
      status: 'processing',
      estimatedSeconds: 20,
    });

    try {
      let revisedScript: any = null;
      try {
        await checkAndAbort();
        const scriptRaw = extractText(await webtoonText({
          contents: [{ role: 'user', parts: [{ text: revisionPrompt }] }],
          generationConfig: { maxOutputTokens: 5000 },
        }, generationSettings.maturityLevel === 'mature' ? 'adult' : 'storyboard', generationSettings.maturityLevel, 'high')).trim();
        revisedScript = cleanJson(scriptRaw);
        if (!revisedScript?.cuts?.length) throw new Error('Regenerated episode script has no cuts.');

        await updateWorkLog(projectRef, scriptLogId, {
          category: 'episode',
          stepName: `[에피소드 기획] 제 ${pending.episodeNumber}화 연출 콘티 및 대본 재생성 (피드백 반영)`,
          model: textModel,
          prompt: revisionPrompt,
          status: 'completed',
          estimatedSeconds: 20,
          result: JSON.stringify(revisedScript, null, 2),
        });
      } catch (err: any) {
        await updateWorkLog(projectRef, scriptLogId, {
          category: 'episode',
          stepName: `[에피소드 기획] 제 ${pending.episodeNumber}화 연출 콘티 및 대본 재생성 (피드백 반영)`,
          model: textModel,
          prompt: revisionPrompt,
          status: 'failed',
          estimatedSeconds: 20,
          result: err.message,
        });
        throw err;
      }

      await checkAndAbort();
      const baseSeed = Array.from(projectId).reduce((acc, char) => acc + char.charCodeAt(0), 0) + Number(pending.episodeNumber || 1) * 1000 + Date.now() % 1000;
      const plannedCuts = revisedScript.cuts.map((cut: any, index: number) => {
        const rawPanelCount = Number(cut.panelCount || maxPanels);
        const panelCount = Math.min(maxPanels, Math.max(generationSettings.allowSinglePanelKeyScenes === false ? minPanels : 1, rawPanelCount));
        const layout = String(cut.panelLayout || 'asymmetric diagonal panel layout');
        const effects = Array.isArray(cut.effects) ? cut.effects : [];
        const finalPrompt = buildWebtoonImagePrompt({
          kind: 'panelPage',
          artStyle: meta.artStyle || 'high-end digital manhwa webtoon style',
          prompt: [
            `${panelCount} panels on one vertical comic page`,
            layout,
            effects.join(', '),
            cut.imagePrompt,
          ].filter(Boolean).join(', '),
          characters: (meta.characters || []).map((c: any) => `${c.name}: ${c.visualPrompt || c.description}`).filter(Boolean),
          worldview: meta.worldview,
          vibeMemo,
        }).prompt;
        return {
          ...cut,
          panelCount,
          panelLayout: layout,
          effects,
          renderedBubbles: false,
          textOverlayMode: 'vectorBubble',
          finalPrompt,
          seed: baseSeed + index,
        };
      });

      const [firstCut, ...remainingCuts] = plannedCuts;
      const previewCutLogId = `episode-${pending.episodeNumber}-cut-1`;
      await updateWorkLog(projectRef, previewCutLogId, {
        category: 'image',
        stepName: `[에피소드 이미지] 제 ${pending.episodeNumber}화 1번째 컷 (미리보기) 이미지 재생성 (피드백 반영)`,
        model: imgModel,
        prompt: firstCut.finalPrompt,
        status: 'processing',
        estimatedSeconds: 45,
      });

      let nextPreview: any[] = [];
      try {
        await checkAndAbort();
        const previewUrl = await webtoonImageUrl(firstCut.finalPrompt, firstCut.seed, 900, 1350, 'panelPage', meta.artStyle || '');
        nextPreview = [{
          ...firstCut,
          imageUrl: previewUrl,
        }];

        await updateWorkLog(projectRef, previewCutLogId, {
          category: 'image',
          stepName: `[에피소드 이미지] 제 ${pending.episodeNumber}화 1번째 컷 (미리보기) 이미지 재생성 (피드백 반영)`,
          model: imgModel,
          prompt: firstCut.finalPrompt,
          status: 'completed',
          estimatedSeconds: 45,
          result: previewUrl,
        });
      } catch (err: any) {
        await updateWorkLog(projectRef, previewCutLogId, {
          category: 'image',
          stepName: `[에피소드 이미지] 제 ${pending.episodeNumber}화 1번째 컷 (미리보기) 이미지 재생성 (피드백 반영)`,
          model: imgModel,
          prompt: firstCut.finalPrompt,
          status: 'failed',
          estimatedSeconds: 45,
          result: err.message,
        });
        throw err;
      }

      await checkAndAbort();
      await updateDoc(projectRef, {
        status: nextApprovalStatus('episode_preview'),
        progressMsg: 'Revision memo applied. First preview page is waiting for approval.',
        webtoonMeta: {
          ...meta,
          pendingApproval: {
            ...pending,
            script: revisedScript,
            episodeTitle: revisedScript.episode_title || pending.episodeTitle,
            previewCuts: nextPreview,
            remainingCuts,
            vibeMemo,
            createdAt: Date.now(),
          },
        },
        updatedAt: serverTimestamp(),
      });
      await notifyWebtoon(uid, `Episode ${pending.episodeNumber} preview regenerated and waiting for approval.`, projectId);
    } catch (err: any) {
      const isCancelled = err.message === 'USER_CANCELLED';
      await updateDoc(projectRef, {
        status: 'completed',
        progressMsg: isCancelled ? '에피소드 재생성이 중단되었습니다.' : `에피소드 재생성 실패: ${err.message}`,
        cancelRequested: false,
        updatedAt: serverTimestamp(),
      });
      throw err;
    }
  }
}

export async function planWebtoonProjectOnServer(params: {
  projectId: string;
  title: string;
  concept: string;
  artStyle: string;
  worldview: string;
  genres: string[];
  characters: WebtoonCharacter[];
  coverImageUrl?: string;
  thumbnailImageUrl?: string;
  generationSettings?: WebtoonGenerationSettings;
  uid: string;
}) {
  const localSettings = getWebtoonLocalAiSettings();
  try {
    const apiResult = await callJsonApi('/api/webtoon/plan-project', {
      ...params,
      localImageSettings: localSettings,
      localTextSettings: localSettings,
    });
    if (apiResult) return apiResult;
  } catch (error) {
    console.error('Webtoon plan-project server API failed, falling back to client:', error);
  }
  return planWebtoonProjectInClient(params);
}

export async function generateEpisodeOnServer(projectId: string, uid: string, customSettings?: any) {
  const localSettings = getWebtoonLocalAiSettings();
  try {
    const apiResult = await callJsonApi('/api/webtoon/generate-episode', {
      projectId,
      uid,
      localImageSettings: localSettings,
      localTextSettings: localSettings,
      customSettings,
    });
    if (apiResult) return apiResult;
  } catch (error) {
    console.error('Webtoon generate-episode server API failed, falling back to client:', error);
  }
  return generateEpisodeInClient(projectId, uid, customSettings);
}

export async function generateWebtoonProjectAssets(projectId: string, formData: any, uid: string) {
  return planWebtoonProjectOnServer({
    projectId,
    title: formData.title,
    concept: formData.concept,
    artStyle: formData.artStyle,
    worldview: formData.worldview,
    genres: formData.genres || [],
    characters: formData.characters || [],
    coverImageUrl: formData.coverImageUrl,
    thumbnailImageUrl: formData.thumbnailImageUrl,
    generationSettings: formData.generationSettings,
    uid,
  });
}

export async function generateNextEpisode(project: any, _pastEpisodes: any[], uid: string, customSettings?: any) {
  return generateEpisodeOnServer(project.id, uid, customSettings);
}
