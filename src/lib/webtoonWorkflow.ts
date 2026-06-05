export type WebtoonApprovalKind = 'characters' | 'cover' | 'episode_preview';

export type WebtoonApprovalStatus =
  | 'awaiting_character_approval'
  | 'awaiting_cover_approval'
  | 'awaiting_episode_approval';

export type WebtoonStepState = 'done' | 'active' | 'pending';

export interface WebtoonStepDisplay {
  id: 'plot' | 'characters' | 'cover' | 'episode';
  label: string;
  state: WebtoonStepState;
}

export interface CharacterReferencePromptInput {
  artStyle: string;
  name: string;
  role?: string;
  visualPrompt?: string;
  description?: string;
  vibeMemo?: string;
}

export type WebtoonImagePromptKind = 'characterSheet' | 'cover' | 'thumbnail' | 'panelPage';

export interface WebtoonImagePromptInput {
  kind: WebtoonImagePromptKind;
  artStyle: string;
  prompt: string;
  characters?: string[];
  worldview?: string;
  vibeMemo?: string;
}

const WEBTOON_IMAGE_PROMPT_PREFIX: Record<WebtoonImagePromptKind, string> = {
  characterSheet: [
    'professional premium character reference sheet',
    'full body front view, full body side view, full body back view',
    '360-degree turnaround reference',
    'upper body portrait, expression sheet with 8 emotions',
    'hands, outfit, hairstyle, eye shape, body proportions clearly documented',
    'clean white background, production-ready model sheet, semi-realistic polished illustration',
  ].join(', '),
  cover: [
    'premium vertical romance cover key visual',
    'commercial manhwa-inspired semi-realistic illustration quality',
    'dramatic cinematic composition, polished lighting, high detail faces',
    'thumbnail-readable silhouettes, no title text embedded in image',
  ].join(', '),
  thumbnail: [
    'premium square romance thumbnail key visual',
    'strong readable character silhouette',
    'high contrast composition, polished commercial semi-realistic art',
    'no title text embedded in image',
  ].join(', '),
  panelPage: [
    'vertical webtoon page',
    'multi-panel comic layout',
    'asymmetric diagonal panels, clean white gutters',
    'cinematic Korean manhwa composition',
    'safe negative space for app-rendered speech bubbles',
    'comic SFX shapes without letters',
  ].join(', '),
};

const WEBTOON_NEGATIVE_PROMPT: Record<WebtoonImagePromptKind, string> = {
  characterSheet: 'letters, readable text, logo, watermark, bad anatomy, malformed hands, extra fingers, inconsistent face, inconsistent hairstyle, blurry, smudged, smeared, watercolor, oil painting, soft focus, low quality',
  cover: 'letters, readable text, logo, watermark, bad anatomy, malformed hands, extra fingers, blurry, smudged, smeared, watercolor, oil painting, soft focus, low quality, distorted face, comic panels, panel border',
  thumbnail: 'letters, readable text, logo, watermark, bad anatomy, malformed hands, extra fingers, blurry, smudged, smeared, watercolor, oil painting, soft focus, low quality, distorted face, comic panels, panel border',
  panelPage: 'readable text, letters, words, logo, watermark, malformed hands, extra fingers, bad anatomy, blurry, smudged, smeared, watercolor, oil painting, soft focus, low quality, cluttered speech bubble area',
};

const APPROVAL_STATUS_BY_KIND: Record<WebtoonApprovalKind, WebtoonApprovalStatus> = {
  characters: 'awaiting_character_approval',
  cover: 'awaiting_cover_approval',
  episode_preview: 'awaiting_episode_approval',
};

const KIND_BY_APPROVAL_STATUS: Record<WebtoonApprovalStatus, WebtoonApprovalKind> = {
  awaiting_character_approval: 'characters',
  awaiting_cover_approval: 'cover',
  awaiting_episode_approval: 'episode_preview',
};

export function nextApprovalStatus(kind: WebtoonApprovalKind): WebtoonApprovalStatus {
  return APPROVAL_STATUS_BY_KIND[kind];
}

export function isWebtoonApprovalStatus(status?: string): status is WebtoonApprovalStatus {
  return Boolean(status && status in KIND_BY_APPROVAL_STATUS);
}

export function getPendingApprovalKind(status?: string): WebtoonApprovalKind | null {
  return isWebtoonApprovalStatus(status) ? KIND_BY_APPROVAL_STATUS[status] : null;
}

export function getWebtoonStepState(status?: string): WebtoonStepDisplay[] {
  const activeIndex =
    status === 'awaiting_character_approval' ? 1 :
    status === 'awaiting_cover_approval' ? 2 :
    status === 'awaiting_episode_approval' || status === 'generating_episode' ? 3 :
    status === 'completed' ? 3 :
    0;

  return [
    { id: 'plot', label: '플롯', state: activeIndex > 0 ? 'done' : activeIndex === 0 ? 'active' : 'pending' },
    { id: 'characters', label: '캐릭터', state: activeIndex > 1 ? 'done' : activeIndex === 1 ? 'active' : 'pending' },
    { id: 'cover', label: '커버', state: activeIndex > 2 ? 'done' : activeIndex === 2 ? 'active' : 'pending' },
    { id: 'episode', label: '에피소드', state: activeIndex > 3 ? 'done' : activeIndex === 3 ? 'active' : 'pending' },
  ];
}

export function buildCharacterReferencePrompt(input: CharacterReferencePromptInput) {
  return [
    input.artStyle,
    `character reference sheet for ${input.name}${input.role ? `, ${input.role}` : ''}`,
    input.visualPrompt || input.description,
    'full body front view',
    'full body side view',
    'full body back view',
    '360-degree turnaround reference',
    'upper body portrait',
    'expression sheet with 8 clear emotions',
    'hands and outfit details',
    'consistent face, consistent hairstyle, consistent body proportions',
    'clean white background, premium semi-realistic production sheet',
    input.vibeMemo ? `operator revision note: ${input.vibeMemo}` : '',
    'no letters, no readable text, no logo, no watermark',
  ].filter(Boolean).join(', ');
}

export function buildCoverPrompt(params: {
  title: string;
  artStyle: string;
  concept?: string;
  worldview?: string;
  characters?: Array<{ name?: string; visualPrompt?: string; description?: string }>;
  vibeMemo?: string;
  thumbnail?: boolean;
}) {
  const characterText = (params.characters || [])
    .map(character => [character.name, character.visualPrompt || character.description].filter(Boolean).join(': '))
    .filter(Boolean)
    .join(' / ');

  return [
    params.artStyle,
    params.thumbnail ? 'premium square romance thumbnail key visual' : 'premium vertical romance cover key visual',
    `title concept: ${params.title}`,
    params.concept,
    params.worldview,
    characterText,
    'dramatic composition, polished commercial semi-realistic manhwa-inspired art, consistent characters, no title letters embedded in image',
    params.vibeMemo ? `operator revision note: ${params.vibeMemo}` : '',
    'no readable text, no watermark, no logo',
  ].filter(Boolean).join(', ');
}

export function buildWebtoonImagePrompt(input: WebtoonImagePromptInput) {
  const characterLock = input.characters?.length
    ? `character consistency lock: ${input.characters.join(' | ')}`
    : '';
  const prompt = [
    input.artStyle,
    WEBTOON_IMAGE_PROMPT_PREFIX[input.kind],
    characterLock,
    input.worldview ? `world and mood: ${input.worldview}` : '',
    input.prompt,
    input.vibeMemo ? `operator revision note: ${input.vibeMemo}` : '',
    'consistent face, consistent hairstyle, consistent outfit, consistent body proportions',
    'high-end commercial romance illustration quality, semi-realistic manhwa-inspired finish',
  ].filter(Boolean).join(', ');

  return {
    prompt,
    negativePrompt: WEBTOON_NEGATIVE_PROMPT[input.kind],
  };
}
