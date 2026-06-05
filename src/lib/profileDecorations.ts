import type { UserProfile } from '../stores/authStore';

export type DecorationStyleId = 'none' | 'rose' | 'mint' | 'sky' | 'violet' | 'gold' | 'aurora' | 'rainbow';

export interface ProfileDecorations {
  enabled?: boolean;
  avatarFrame?: DecorationStyleId;
  nameStyle?: DecorationStyleId;
}

export interface DecorationStyle {
  id: DecorationStyleId;
  label: string;
  minLevel: number;
  avatarRingClass: string;
  nameClass: string;
  swatchClass: string;
}

export const DECORATION_STYLES: DecorationStyle[] = [
  { id: 'none', label: '기본', minLevel: 1, avatarRingClass: '', nameClass: '', swatchClass: 'bg-slate-200' },
  { id: 'rose', label: '로즈', minLevel: 5, avatarRingClass: 'reward-ring-rose', nameClass: 'reward-name-rose', swatchClass: 'bg-rose-400' },
  { id: 'mint', label: '민트', minLevel: 10, avatarRingClass: 'reward-ring-mint', nameClass: 'reward-name-mint', swatchClass: 'bg-emerald-400' },
  { id: 'sky', label: '스카이', minLevel: 20, avatarRingClass: 'reward-ring-sky', nameClass: 'reward-name-sky', swatchClass: 'bg-sky-400' },
  { id: 'violet', label: '바이올렛', minLevel: 35, avatarRingClass: 'reward-ring-violet', nameClass: 'reward-name-violet', swatchClass: 'bg-violet-400' },
  { id: 'gold', label: '골드', minLevel: 50, avatarRingClass: 'reward-ring-gold', nameClass: 'reward-name-gold', swatchClass: 'bg-amber-400' },
  { id: 'aurora', label: '오로라', minLevel: 70, avatarRingClass: 'reward-ring-aurora', nameClass: 'reward-name-aurora', swatchClass: 'bg-gradient-to-br from-emerald-300 via-sky-300 to-fuchsia-300' },
  { id: 'rainbow', label: '레인보우', minLevel: 100, avatarRingClass: 'reward-ring-rainbow', nameClass: 'reward-name-rainbow', swatchClass: 'bg-gradient-to-br from-rose-400 via-amber-300 to-violet-400' },
];

export const DECORATION_STYLE_IDS = DECORATION_STYLES.map(style => style.id);

export function xpToLevel(xp?: number) {
  const safeXp = Math.max(0, Number(xp || 0));
  return Math.min(100, Math.max(1, Math.floor(safeXp / 300) + 1));
}

export function getEffectiveLevel(profile?: Partial<UserProfile> | null) {
  if (!profile) return 1;
  if (profile.role === 'admin' || profile.role === 'manager') return 100;
  return Math.max(1, Math.min(100, Math.max(Number(profile.level || 1), xpToLevel(profile.xp))));
}

export function getDecorationStyle(id?: string) {
  return DECORATION_STYLES.find(style => style.id === id) || DECORATION_STYLES[0];
}

export function isDecorationUnlocked(profile: Partial<UserProfile> | null | undefined, id?: string) {
  const style = getDecorationStyle(id);
  return getEffectiveLevel(profile) >= style.minLevel;
}

export function getHighestUnlockedDecoration(profile: Partial<UserProfile> | null | undefined) {
  const level = getEffectiveLevel(profile);
  return [...DECORATION_STYLES].reverse().find(style => style.minLevel <= level) || DECORATION_STYLES[0];
}

export function resolveProfileDecorations(profile?: Partial<UserProfile> | null) {
  const enabled = profile?.decorations?.enabled !== false;
  if (!enabled) {
    return { enabled, style: DECORATION_STYLES[0], avatarRingClass: '', nameClass: '' };
  }

  const avatarStyle = isDecorationUnlocked(profile, profile?.decorations?.avatarFrame)
    ? getDecorationStyle(profile?.decorations?.avatarFrame)
    : getHighestUnlockedDecoration(profile);
  const nameStyle = isDecorationUnlocked(profile, profile?.decorations?.nameStyle)
    ? getDecorationStyle(profile?.decorations?.nameStyle)
    : avatarStyle;

  return {
    enabled,
    style: avatarStyle,
    avatarRingClass: avatarStyle.avatarRingClass,
    nameClass: nameStyle.nameClass,
  };
}
