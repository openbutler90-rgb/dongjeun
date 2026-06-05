import React, { useEffect, useState, useRef } from 'react';
import { collection, query, onSnapshot, orderBy, addDoc, serverTimestamp, limit, deleteDoc, doc, updateDoc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth } from '../../lib/firebase';
import { UserProfile, useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { generateChatReply } from '../../lib/gemini';
import { listLocalTextModels } from '../../lib/localAi';
import { uploadToCloudinary } from '../../lib/cloudinary';
import { sendPersonalNotification } from '../../lib/notifications';

export function getFriendlyModelName(model: string): string {
  if (model === 'none') return '사용 안 함 (기존 API)';
  
  const lower = model.toLowerCase();
  
  // 1. 제약 없는 버전 여부 판별 (abliterated, uncensored 키워드가 들어간 모델만)
  const isAbliterated = lower.includes('abliterated') || lower.includes('uncensored');
  
  // 2. 태그 추출
  let tag = '';
  if (model.includes(':')) {
    tag = model.split(':').pop() || '';
  }
  
  // 3. 베이스 이름 추출 (슬래시 및 태그 제거)
  const parts = model.split('/');
  const baseWithoutTag = parts[parts.length - 1].split(':')[0];
  const baseLower = baseWithoutTag.toLowerCase();
  
  let displayName = baseWithoutTag;
  
  // 대략적인 모델 이름 예쁘게 정제
  if (baseLower.includes('gemma-4') || baseLower === 'gemma4') {
    displayName = '젬마 4';
  } else if (baseLower.includes('gemma-2') || baseLower === 'gemma2') {
    displayName = '젬마 2';
  } else if (baseLower === 'gemma') {
    displayName = '젬마';
  } else if (baseLower.includes('qwen3-coder') || baseLower.includes('qwen3_coder')) {
    displayName = 'Qwen 3 Coder';
  } else if (baseLower.includes('qwen3')) {
    displayName = 'Qwen 3';
  } else if (baseLower.includes('qwen')) {
    displayName = 'Qwen';
  } else if (baseLower.includes('hermes')) {
    displayName = 'Hermes';
  } else if (baseLower.includes('mistral-small') || baseLower.includes('mistral_small')) {
    displayName = 'Mistral Small';
  } else if (baseLower.includes('mistral')) {
    displayName = 'Mistral';
  } else if (baseLower.includes('llama')) {
    displayName = 'Llama';
  }
  
  // 4. 모델 속성 설명 및 사이즈 정보 구성
  let safetyType = isAbliterated ? '제약 없는 버전' : '기본 모델';
  let sizeInfo = '';
  
  // 태그에 따라 모델 사이즈 표시 구성
  const tagUpper = tag.toUpperCase();
  if (tagUpper) {
    if (tagUpper === 'E4B') {
      sizeInfo = 'E4B / 4B급';
    } else if (tagUpper === 'E2B') {
      sizeInfo = 'E2B / 2B급';
    } else if (tagUpper === 'LATEST') {
      if (baseLower === 'gemma4' || baseLower === 'nexusriot/gemma-4-abliterated') {
        sizeInfo = 'E4B / 4B급';
      }
    } else {
      sizeInfo = tagUpper.replace('-8K', ' / 8K context');
    }
  } else {
    if (baseLower === 'gemma4' || baseLower === 'nexusriot/gemma-4-abliterated') {
      sizeInfo = 'E4B / 4B급';
    }
  }
  
  let label = `${displayName} (${safetyType})`;
  if (sizeInfo) {
    label += ` [${sizeInfo}]`;
  }
  
  return label;
}

import { extractUrls, LinkPreviewCard } from '../common/LinkPreviewCard';
import { resolveProfileDecorations } from '../../lib/profileDecorations';
import { useVisualViewportInset } from '../../hooks/useVisualViewportInset';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface ChatMessage {
  id: string;
  authorId: string;
  nickname: string;
  content: string;
  createdAt: any;
  replyToId?: string;
  replyToAuthorId?: string;
  replyToNickname?: string;
  replyToContent?: string;
  stickerUrl?: string;
  stickerName?: string;
}

interface SavedSticker {
  id: string;
  imageUrl: string;
  name: string;
  status?: 'active' | 'pending';
  requestedBy?: string;
  requestedByName?: string;
  prompt?: string;
  createdAt: any;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  admin: { label: '방장', className: 'bg-red-100 text-red-600' },
  manager: { label: '부방장', className: 'bg-amber-100 text-amber-600' },
  regionalLeader: { label: '지역장', className: 'bg-blue-100 text-blue-600' },
};

const ONLINE_STALE_MS = 5 * 60 * 1000;
const AI_COMMANDS = [
  { command: '/루이', icon: '☕', title: 'AI 루이', desc: '짧은 질문, 일정, 장소 고민을 바로 물어보기', template: '/루이 ' },
  { command: '/집사', icon: '☕', title: 'AI 루이', desc: '기존 호출어도 계속 사용할 수 있어요', template: '/집사 ' },
  { command: '/장소', icon: '📍', title: '장소 추천', desc: '지역/분위기를 말하면 맛집·핫플 후보를 정리', template: '/장소 ' },
  { command: '/요약', icon: '📝', title: '대화 요약', desc: '최근 채팅 흐름을 운영진 공지처럼 압축', template: '/요약' },
  { command: '/공지', icon: '📌', title: '공지 초안', desc: '모임 공지나 안내문 문장을 다듬기', template: '/공지 ' },
  { command: '/소개', icon: '☕', title: '동전커피 소개', desc: '앱 목적, 기능, 등급, 사용법을 짧게 안내', template: '/소개' },
  { command: '/이모티콘', icon: '🖼️', title: '이모티콘 아이디어', desc: '만들고 싶은 표정·상황을 이미지 프롬프트로 정리', template: '/이모티콘 ' },
] as const;

const timestampToMs = (value: any) => {
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
};

const renderLinkedText = (text: string) => {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-white/60 underline-offset-2 break-all"
        onClick={(event) => event.stopPropagation()}
      >
        {part}
      </a>
    ) : part
  );
};

function optimizeStickerImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 512;
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * ratio));
        const height = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('이미지 최적화에 실패했어요.'));
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했어요.')),
          'image/webp',
          0.82
        );
      };
      img.onerror = () => reject(new Error('이미지를 읽을 수 없어요.'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('파일을 읽을 수 없어요.'));
    reader.readAsDataURL(file);
  });
}

export function RightSidebar({ isMobile = false }: { isMobile?: boolean }) {
  const [users, setUsers] = useState<(UserProfile & { id: string })[]>([]);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<(UserProfile & { id: string }) | null>(null);
  const [activeTab, setActiveTab] = useState<'members' | 'chat'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [showStickerPanel, setShowStickerPanel] = useState(false);
  const [savedStickers, setSavedStickers] = useState<SavedSticker[]>([]);
  const [pendingStickers, setPendingStickers] = useState<SavedSticker[]>([]);
  const [isStickerUploading, setIsStickerUploading] = useState(false);
  const [stickerApprovalTarget, setStickerApprovalTarget] = useState<SavedSticker | null>(null);
  const [aiLimitNotice, setAiLimitNotice] = useState<string | null>(null);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification === 'undefined' ? 'denied' : Notification.permission
  );
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const { showToast } = useToastStore();
  const stickerFileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const { profile } = useAuthStore();
  const isPureOperator = profile?.role === 'admin' || profile?.role === 'manager';
  const isElectronApp = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

  const [localModels, setLocalModels] = useState<string[]>([]);
  const [selectedLocalModel, setSelectedLocalModel] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('operator-chat-local-model') || 'none';
    }
    return 'none';
  });

  useEffect(() => {
    if (isPureOperator && isElectronApp) {
      listLocalTextModels()
        .then((res) => {
          if (res.ok && Array.isArray(res.models)) {
            setLocalModels(res.models);
          }
        })
        .catch((err) => console.warn('Failed to load local text models:', err));
    }
  }, [isPureOperator]);
  const keyboardInset = useVisualViewportInset();
  const sessionStartTime = useRef(new Date(Date.now() - 1000 * 60 * 60 * 3));
  const seenChatIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedChatRef = useRef(false);

  // 드래그 가능한 버튼 위치 상태
  const [btnPos, setBtnPos] = useState({ x: 16, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const btnStartPos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setIsDragging(false);
    dragStartPos.current = { x: clientX, y: clientY };
    btnStartPos.current = { ...btnPos };

    const moveHandler = (moveEvent: MouseEvent | TouchEvent) => {
      const mX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const mY = 'touches' in moveEvent ? moveEvent.touches[0].clientY : moveEvent.clientY;
      const deltaX = dragStartPos.current.x - mX;
      const deltaY = dragStartPos.current.y - mY;

      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        setIsDragging(true);
        setBtnPos({ x: btnStartPos.current.x + deltaX, y: btnStartPos.current.y + deltaY });
      }
    };

    const upHandler = () => {
      window.removeEventListener('mousemove', moveHandler);
      window.removeEventListener('mouseup', upHandler);
      window.removeEventListener('touchmove', moveHandler);
      window.removeEventListener('touchend', upHandler);
    };

    window.addEventListener('mousemove', moveHandler);
    window.addEventListener('mouseup', upHandler);
    window.addEventListener('touchmove', moveHandler, { passive: false });
    window.addEventListener('touchend', upHandler);
  };

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('updatedAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snapshot) => {
      const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile & { id: string }));
      setUsers(results);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'chats'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snapshot) => {
      const results = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage))
        .filter(msg => !msg.createdAt || msg.createdAt.toDate() > sessionStartTime.current)
        .reverse();
      if (auth.currentUser && hasHydratedChatRef.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        results
          .filter(msg => !seenChatIdsRef.current.has(msg.id))
          .filter(msg => msg.authorId !== auth.currentUser?.uid && msg.replyToAuthorId === auth.currentUser?.uid)
          .forEach(msg => {
            new Notification(`${msg.nickname}님이 답글을 남겼어요`, {
              body: msg.content.slice(0, 80),
              icon: '/logo.png',
              tag: `chat-reply-${msg.id}`,
            });
          });
      }
      results.forEach(msg => seenChatIdsRef.current.add(msg.id));
      // ✅ 메모리 누수 방지: 200개 초과 시 초기화
      if (seenChatIdsRef.current.size > 200) {
        seenChatIdsRef.current.clear();
        results.forEach(msg => seenChatIdsRef.current.add(msg.id));
      }
      hasHydratedChatRef.current = true;
      setMessages(results);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'chats'));
    return unsub;
  }, []);

  useEffect(() => {
    if (!auth.currentUser) {
      setSavedStickers([]);
      setPendingStickers([]);
      return;
    }
    const stickerQuery = query(collection(db, 'stickers'), orderBy('createdAt', 'desc'), limit(100));
    const unsub = onSnapshot(stickerQuery, (snapshot) => {
      const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as SavedSticker));
      setSavedStickers(all.filter(sticker => sticker.status === 'active'));
      setPendingStickers(all.filter(sticker => sticker.status === 'pending'));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'stickers'));
    return unsub;
  }, [profile?.role]);

  const handleClearChat = async () => {
    if (confirm('채팅을 전체 삭제하시겠습니까? (서버에서 완전 삭제되며 복구할 수 없습니다)')) {
      try {
        // ✅ Firestore 병렬 제한 대응: 10개씩 batch 삭제
        for (let i = 0; i < messages.length; i += 10) {
          const batch = writeBatch(db);
          messages.slice(i, i + 10).forEach(msg => {
            batch.delete(doc(db, 'chats', msg.id));
          });
          await batch.commit();
        }
        showToast('모든 채팅이 삭제되었습니다!', 'success');
      } catch (err) {
        console.error(err);
        showToast('일부 메시지를 삭제하는 중 권한 또는 네트워크 오류가 발생했습니다.', 'error');
      }
    }
  };

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      alert('이 브라우저에서는 알림을 지원하지 않아요.');
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission === 'granted') alert('답글 알림을 켰어요. 앱이 열려 있을 때 바로 알려드릴게요.');
  };

  const isManagerRole = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'regionalLeader';
  const canManageStickers = profile?.role === 'admin' || profile?.role === 'manager';
  const getCommand = (content: string) => content.trim().split(/\s+/)[0].toLowerCase();
  const isAiCommand = (content: string) => {
    const command = getCommand(content);
    return command === '/ai' || AI_COMMANDS.some(item => item.command === command);
  };
  const parseCommandDraft = (content: string) => {
    const trimmedStart = content.trimStart();
    if (!trimmedStart.startsWith('/')) {
      return { token: '', remainder: content.trim(), command: null as (typeof AI_COMMANDS)[number] | null, isKnown: false };
    }
    const match = trimmedStart.match(/^\/[^\s]*/);
    const token = match?.[0] || '/';
    const command = AI_COMMANDS.find(item => item.command === token) || (token === '/ai' ? AI_COMMANDS[0] : null);
    const rawRemainder = trimmedStart.slice(token.length);
    const remainder = rawRemainder.startsWith(' ') ? rawRemainder.slice(1) : rawRemainder;
    return { token, remainder, command, isKnown: Boolean(command) };
  };
  const activeCommandDraft = parseCommandDraft(newMessage);
  const inputDisplayValue = activeCommandDraft.token ? activeCommandDraft.remainder : newMessage;
  const getTodayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  const reserveAiUsage = async () => {
    if (!auth.currentUser || isManagerRole) return true;
    const usageRef = doc(db, 'aiUsage', `${auth.currentUser.uid}_${getTodayKey()}`);
    const snap = await getDoc(usageRef);
    const currentCount = Number(snap.data()?.count || 0);
    if (currentCount >= 9) {
      setAiLimitNotice('일반 회원은 AI 루이를 하루 9회까지 사용할 수 있어요.');
      return false;
    }
    await setDoc(usageRef, {
      userId: auth.currentUser.uid,
      date: getTodayKey(),
      count: currentCount + 1,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    setAiLimitNotice(null);
    return true;
  };

  const runAiButler = async (content: string) => {
    if (!(await reserveAiUsage())) return;
    setIsAiThinking(true);
    const command = getCommand(content);
    const rawQuestion = content.replace(/^\/(루이|집사|ai|장소|요약|공지|소개|이모티콘)\s*/i, '').trim();
    const recentChat = messages
      .slice(-18)
      .map(m => `${m.nickname}: ${m.stickerName ? `[이모티콘 ${m.stickerName}]` : m.content}`)
      .join('\n');
    let question = rawQuestion || '실시간 채팅에서 짧게 인사하고, 무엇을 도와줄 수 있는지 한두 문장으로 알려줘.';
    if (command === '/요약') {
      question = `최근 실시간 채팅을 운영자가 바로 볼 수 있게 3줄로 요약하고, 필요하면 다음 액션 1개를 제안해줘.\n\n최근 채팅:\n${recentChat || '아직 요약할 채팅이 거의 없습니다.'}`;
    } else if (command === '/장소') {
      question = `동전커피 채팅 안에서 쓸 장소 추천 답변을 만들어줘. 사용자의 조건을 먼저 반영하고, 후보를 3개 이하로 압축해서 이유/주의점/검색 키워드를 짧게 적어줘. 실제 주소나 평점은 확정하지 말고 네이버지도/카카오맵에서 확인하라고 안내해줘.\n\n요청: ${rawQuestion || '가볍게 갈 만한 장소 추천'}`;
    } else if (command === '/공지') {
      question = `아래 내용을 동전커피 모임 공지 초안으로 다듬어줘. 밖에서 봐도 부담 없는 중립적인 표현을 쓰고, 제목/본문/확인사항으로 정리해줘.\n\n내용: ${rawQuestion || recentChat || '공지로 정리할 내용이 없습니다.'}`;
    } else if (command === '/소개') {
      question = `동전커피 앱을 처음 보는 회원에게 소개해줘. 목적, 주요 기능, 등급, 문의/신고 비공개, AI 루이가 도와주는 일을 5문장 이내로 중립적으로 설명해줘.`;
    } else if (command === '/이모티콘') {
      question = `사용자가 만들고 싶은 이모티콘 아이디어를 운영진이 승인/제작하기 좋은 요청서로 정리해줘. 실제 이미지를 생성했다고 말하지 말고, "운영진 승인 후 공용 이모티콘으로 등록할 수 있어요"라고 안내해줘. 결과는 1) 이모티콘 이름 2) 표정/포즈 3) 누끼 필요 여부 4) 생성 프롬프트 순서로 짧게 써줘.\n\n아이디어: ${rawQuestion || '동전커피에서 쓸 귀여운 리액션 이모티콘'}`;
    }
    try {
      const reply = await generateChatReply(
        '채팅',
        '실시간 채팅',
        question,
        undefined,
        {
          isOperator: isManagerRole,
          forceLocal: isPureOperator && isElectronApp && selectedLocalModel !== 'none',
          localModel: selectedLocalModel !== 'none' ? selectedLocalModel : undefined,
        }
      );
      if (reply) {
        await addDoc(collection(db, 'chats'), {
          authorId: 'ai-butler',
          nickname: '루이',
          content: reply,
          createdAt: serverTimestamp()
        });
      }
    } catch (err) {
      console.error(err);
      await addDoc(collection(db, 'chats'), {
        authorId: 'ai-butler',
        nickname: '루이',
        content: '지금은 답변을 만들지 못했어요. 잠시 후 다시 불러주세요.',
          createdAt: serverTimestamp()
      });
    } finally {
      setIsAiThinking(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !profile || !auth.currentUser) return;
    const content = newMessage.trim();
    const commandDraft = parseCommandDraft(content);
    const aiCommand = isAiCommand(content);
    const visibleContent = aiCommand
      ? (commandDraft.remainder.trim() || (
          commandDraft.token === '/요약' ? '최근 대화 요약해줘' :
          commandDraft.token === '/소개' ? '동전커피 소개해줘' :
          commandDraft.token === '/이모티콘' ? '이모티콘 아이디어 만들어줘' :
          '루이에게 질문'
        ))
      : content;
    setNewMessage('');
    setShowCommandMenu(false);
    try {
        const chatRef = await addDoc(collection(db, 'chats'), {
          authorId: auth.currentUser.uid,
          nickname: profile.nickname,
          content: visibleContent,
          ...(replyingTo ? {
            replyToId: replyingTo.id,
            replyToAuthorId: replyingTo.authorId,
            replyToNickname: replyingTo.nickname,
            replyToContent: replyingTo.content.slice(0, 120),
          } : {}),
          createdAt: serverTimestamp()
        });
      setReplyingTo(null);
      // ✅ 대댓글 알림
      if (replyingTo && replyingTo.authorId !== auth.currentUser.uid) {
        sendPersonalNotification({
          userId: replyingTo.authorId,
          type: 'chat_reply',
          title: '새 답글',
          message: `${profile.nickname}님이 회원님의 메시지에 답글을 남겼어요: "${visibleContent.slice(0, 30)}${visibleContent.length > 30 ? '...' : ''}"`,
          actorId: auth.currentUser.uid,
          actorName: profile.nickname,
          url: '/channels/freeboard',
        }).catch(console.error);
      }

      if (aiCommand) {
        runAiButler(content);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'chats');
    }
  };

  const handleStickerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auth.currentUser) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 이모티콘으로 저장할 수 있어요.');
      return;
    }
    setIsStickerUploading(true);
    try {
      const optimized = await optimizeStickerImage(file);
      const imageUrl = await uploadToCloudinary(optimized, 'stickers/shared');
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 24) || '내 이모티콘';
      if (stickerApprovalTarget && canManageStickers) {
        await updateDoc(doc(db, 'stickers', stickerApprovalTarget.id), {
          imageUrl,
          name: stickerApprovalTarget.name || baseName,
          status: 'active',
          approvedAt: serverTimestamp(),
        });
        setShowStickerPanel(true);
        return;
      }
      await addDoc(collection(db, 'stickers'), {
        imageUrl,
        name: baseName,
        status: canManageStickers ? 'active' : 'pending',
        requestedBy: auth.currentUser.uid,
        requestedByName: profile?.nickname || '',
        createdAt: serverTimestamp(),
      });
      setShowStickerPanel(true);
    } catch (err: any) {
      showToast(`이모티콘 저장 실패: ${err.message || '다시 시도해주세요.'}`, 'error');
    } finally {
      setIsStickerUploading(false);
      setStickerApprovalTarget(null);
      if (stickerFileInputRef.current) stickerFileInputRef.current.value = '';
    }
  };

  const sendSticker = async (sticker: SavedSticker) => {
    if (!profile || !auth.currentUser) return;
    try {
      await addDoc(collection(db, 'chats'), {
        authorId: auth.currentUser.uid,
        nickname: profile.nickname,
        content: `[이모티콘] ${sticker.name}`,
        stickerUrl: sticker.imageUrl,
        stickerName: sticker.name,
        ...(replyingTo ? {
          replyToId: replyingTo.id,
          replyToAuthorId: replyingTo.authorId,
          replyToNickname: replyingTo.nickname,
          replyToContent: replyingTo.stickerName ? `[이모티콘] ${replyingTo.stickerName}` : replyingTo.content.slice(0, 120),
        } : {}),
        createdAt: serverTimestamp()
      });
      setReplyingTo(null);
      setShowStickerPanel(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'chats');
    }
  };

  const deleteSticker = async (stickerId: string) => {
    if (!auth.currentUser) return;
    if (!canManageStickers) {
      alert('공용 이모티콘 삭제는 운영진만 할 수 있어요.');
      return;
    }
    if (!confirm('이 공용 이모티콘을 삭제할까요?')) return;
    try {
      await deleteDoc(doc(db, 'stickers', stickerId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'stickers');
    }
  };

  const requestStickerFromPrompt = async () => {
    if (!auth.currentUser || !profile) return;
    const prompt = window.prompt('만들고 싶은 이모티콘을 적어주세요. 예: 진지한 표정으로 방장 팻말 든 동전커피 캐릭터');
    if (!prompt?.trim()) return;
    try {
      await addDoc(collection(db, 'stickers'), {
        imageUrl: '',
        name: prompt.trim().slice(0, 24),
        prompt: prompt.trim().slice(0, 300),
        status: 'pending',
        requestedBy: auth.currentUser.uid,
        requestedByName: profile.nickname,
        createdAt: serverTimestamp(),
      });
      setShowStickerPanel(true);
      alert('이모티콘 요청을 운영진 승인 대기로 올렸어요.');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'stickers');
    }
  };

  const approveSticker = async (sticker: SavedSticker) => {
    if (!canManageStickers) return;
    if (!sticker.imageUrl) {
      alert('이미지가 없는 요청입니다. 운영진이 이미지를 업로드해서 공용 이모티콘으로 등록해주세요.');
      return;
    }
    try {
      await updateDoc(doc(db, 'stickers', sticker.id), { status: 'active', approvedAt: serverTimestamp() });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'stickers');
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('복사되었습니다! 채팅 글 내용을 붙여넣기 해보세요.');
    } catch (e) {
      alert('복사가 실패했습니다.');
    }
  };

  const isActuallyOnline = (user: UserProfile & { id: string }) => {
    if (user.status !== 'online') return false;
    const lastSeen = timestampToMs((user as any).updatedAt);
    return !lastSeen || Date.now() - lastSeen < ONLINE_STALE_MS;
  };
  const visibleUsers = users.filter(u => u.role !== 'guest' && !(u as any).isAnonymous);
  const sortedUsers = [...visibleUsers].sort((a, b) => {
    const onlineDelta = Number(isActuallyOnline(b)) - Number(isActuallyOnline(a));
    if (onlineDelta !== 0) return onlineDelta;
    return (a.nickname || '').localeCompare(b.nickname || '', 'ko');
  });
  const onlineUsers = sortedUsers.filter(isActuallyOnline);
  const offlineUsers = sortedUsers.filter(u => !isActuallyOnline(u));
  const getPartner = (user: UserProfile & { id: string }) =>
    visibleUsers.find(candidate => candidate.id === user.partnerId);
  const activeCoupleMaxLevel = visibleUsers.reduce((maxLevel, member) => {
    const partner = getPartner(member);
    if (!partner || partner.partnerId !== member.id || !isActuallyOnline(member) || !isActuallyOnline(partner)) {
      return maxLevel;
    }
    const totalLevel = (Number(member.level) || 1) + (Number(partner.level) || 1);
    return Math.max(maxLevel, totalLevel);
  }, 0);
  const getCoupleMeta = (user: UserProfile & { id: string }) => {
    const partner = getPartner(user);
    const active = Boolean(partner && partner.partnerId === user.id && isActuallyOnline(user) && isActuallyOnline(partner));
    const totalLevel = (Number(user.level) || 1) + (Number(partner?.level) || 1);
    if (!active) {
      return {
        active,
        totalLevel,
        ringClass: '',
        nameClass: '',
      };
    }
    if (totalLevel >= activeCoupleMaxLevel) {
      return {
        active,
        totalLevel,
        ringClass: 'couple-ring-rainbow',
        nameClass: 'couple-name-rainbow',
      };
    }
    if (totalLevel >= 80) {
      return {
        active,
        totalLevel,
        ringClass: 'couple-ring-violet',
        nameClass: 'text-violet-600',
      };
    }
    if (totalLevel >= 40) {
      return {
        active,
        totalLevel,
        ringClass: 'couple-ring-blue',
        nameClass: 'text-sky-600',
      };
    }
    return {
      active,
      totalLevel,
      ringClass: 'couple-ring-rose',
      nameClass: 'text-rose-500',
    };
  };
  const selectedDecoration = selectedUser ? resolveProfileDecorations(selectedUser) : null;
  const selectedCouple = selectedUser ? getCoupleMeta(selectedUser) : null;
  const selectedRingClass = selectedCouple?.ringClass || selectedDecoration?.avatarRingClass || '';
  const selectedNameClass = selectedCouple?.nameClass || selectedDecoration?.nameClass || 'text-gray-900';

  const handleUpdateRole = async (userId: string, newRole: UserProfile['role']) => {
    try {
      const roleName = newRole === 'manager' ? '부방장으로 임명' : newRole === 'regionalLeader' ? '지역장으로 임명' : '권한을 제거';
      if (confirm(`정말 ${roleName}하시겠습니까?`)) {
        const isTopRole = newRole === 'admin' || newRole === 'manager';
        await updateDoc(doc(db, 'users', userId), {
          role: newRole,
          ...(isTopRole ? { level: 100, xp: 999999 } : {}),
          updatedAt: serverTimestamp(),
        });
        setSelectedUser(prev => prev ? { ...prev, role: newRole, ...(isTopRole ? { level: 100, xp: 999999 } : {}) } : null);
      }
    } catch (e) { console.error('Failed to update role', e); }
  };

  const handleBanUser = async (userId: string, currentBanStatus?: boolean) => {
    try {
      if (confirm(`정말 이 유저를 ${currentBanStatus ? '차단 해제' : '강퇴 및 차단'}하시겠습니까?`)) {
        await updateDoc(doc(db, 'users', userId), { isBanned: !currentBanStatus, updatedAt: serverTimestamp() });
        setSelectedUser(prev => prev ? { ...prev, isBanned: !currentBanStatus } : null);
      }
    } catch (e) {
      console.error('Failed to ban user', e);
      alert('운영자 이상의 권한이 필요합니다.');
    }
  };

  const renderSidebarContent = () => {
    if (profile?.role === 'guest') {
      return (
        <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-white">
          <span className="text-4xl mb-4 animate-pulse">🔒</span>
          <h3 className="font-extrabold text-slate-800 text-sm mb-2">실시간 채팅 및 멤버 목록</h3>
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-[200px] font-medium">
            가입 신청이 승인되면 실시간 채팅 참여와 회원 목록 열람이 가능합니다.
          </p>
        </div>
      );
    }

    return (
      <>
        {/* 탭 */}
        <div className="flex border-b border-slate-200 shrink-0">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'chat' ? 'border-b-2 border-[#FF5C5C] text-[#FF5C5C]' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          실시간 채팅 💬
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-3 text-sm font-bold transition-colors ${activeTab === 'members' ? 'border-b-2 border-[#FF5C5C] text-[#FF5C5C]' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          멤버 목록
        </button>
      </div>

      {activeTab === 'members' ? (
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
          <div className="bg-red-50 rounded-2xl p-4 border border-red-100 shadow-sm">
            <h4 className="text-[#FF5C5C] font-bold text-sm mb-2 flex items-center">
              <span className="mr-2">☕</span>동전커피 오픈채팅
            </h4>
            <p className="text-red-400 text-xs leading-relaxed font-medium">
              지역, 취향이 맞는 핫플레이스와 맛집을 공유하고 함께 갈 멤버를 찾아보세요!
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase mb-3">온라인 · {onlineUsers.length}명</h4>
            <div className="space-y-2 mb-4">
              {onlineUsers.map(user => {
                const couple = getCoupleMeta(user);
                const decoration = resolveProfileDecorations(user);
                const ringClass = couple.ringClass || decoration.avatarRingClass;
                const nameClass = couple.nameClass || decoration.nameClass || 'text-gray-700';
                return (
                  <div key={user.id} className="flex items-center space-x-3 cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-xl transition-colors" onClick={() => setSelectedUser(user)}>
                    <div className={`relative rounded-full p-[2px] ${ringClass}`}>
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.nickname} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover bg-white" />
                      ) : (
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: user.profileColor }}>
                          {user.nickname?.[0]?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"></div>
                    </div>
                    <div className="min-w-0 flex flex-1 flex-wrap items-center gap-1.5">
                      <span className={`min-w-0 max-w-[8rem] text-sm font-semibold truncate ${nameClass}`}>{user.nickname}</span>
                      <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 rounded-full font-bold shrink-0">Lv.{user.level || 1}</span>
                      {ROLE_BADGES[user.role] && <span className={`text-[10px] ${ROLE_BADGES[user.role].className} px-1.5 rounded-full font-bold shrink-0`}>{ROLE_BADGES[user.role].label}</span>}
                      {couple.active && <span className="text-[10px] bg-rose-50 text-rose-500 px-1.5 rounded-full font-bold" title={`커플 합산 Lv.${couple.totalLevel}`}>♡</span>}
                    </div>
                  </div>
                );
              })}
              {onlineUsers.length === 0 && <p className="text-sm text-gray-400">현재 온라인 멤버가 없습니다.</p>}
            </div>

            {offlineUsers.length > 0 && (
              <>
                <h4 className="text-xs font-bold text-gray-400 uppercase mb-3">오프라인 · {offlineUsers.length}명</h4>
                <div className="space-y-2">
                  {offlineUsers.map(user => (
                    <div key={user.id} className="flex items-center space-x-3 cursor-pointer hover:bg-gray-50 p-2 -mx-2 rounded-xl transition-colors" onClick={() => setSelectedUser(user)}>
                      <div className="relative">
                        {user.photoURL ? (
                          <img src={user.photoURL} alt={user.nickname} referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover grayscale opacity-50" />
                        ) : (
                          <div className="w-8 h-8 rounded-full opacity-50 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: user.profileColor }}>
                            {user.nickname?.[0]?.toUpperCase() || '?'}
                          </div>
                        )}
                        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-gray-300 border-2 border-white rounded-full"></div>
                      </div>
                      <div className="min-w-0 flex flex-1 items-center gap-1.5 flex-wrap">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-400">{user.nickname}</span>
                        <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 rounded-full font-bold shrink-0">Lv.{user.level || 1}</span>
                        {ROLE_BADGES[user.role] && <span className={`text-[10px] ${ROLE_BADGES[user.role].className} px-1.5 rounded-full font-bold opacity-70 shrink-0`}>{ROLE_BADGES[user.role].label}</span>}
                        {(() => {
                          const lastMs = timestampToMs((user as any).updatedAt);
                          if (!lastMs) return null;
                          return <span className="text-[9px] text-slate-400 font-medium shrink-0">{formatDistanceToNow(new Date(lastMs), { addSuffix: true, locale: ko }).replace('약 ', '')} 접속</span>;
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-3 overflow-y-auto custom-scrollbar flex flex-col space-y-3">
            {isPureOperator && isElectronApp && (
              <div className="px-3 py-2 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between gap-2 shrink-0 shadow-sm animate-fade-in">
                <span className="text-[10px] font-black text-indigo-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                  로컬 AI 모델
                </span>
                <select
                  value={selectedLocalModel}
                  onChange={(e) => {
                    setSelectedLocalModel(e.target.value);
                    localStorage.setItem('operator-chat-local-model', e.target.value);
                  }}
                  className="bg-white border border-indigo-100 rounded-lg px-2 py-1 text-xs text-indigo-700 font-bold max-w-[170px] truncate shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  <option value="none">사용 안 함 (기존 API)</option>
                  {localModels.map((m) => (
                    <option key={m} value={m}>
                      {getFriendlyModelName(m)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex justify-between items-center text-xs text-gray-400 py-2 border-b border-gray-100 mb-1 shrink-0">
              <span className="truncate mr-2 font-medium">자유롭게 대화해보세요. / 입력 시 명령어가 열립니다.</span>
              {notificationPermission !== 'granted' && (
                <button onClick={requestNotifications} className="bg-rose-50 hover:bg-rose-100 text-rose-500 px-2 py-1 rounded-lg transition-colors whitespace-nowrap text-[10px] font-bold">알림 켜기</button>
              )}
              {(profile?.role === 'admin' || profile?.role === 'manager') && (
                <button onClick={handleClearChat} className="bg-gray-100 hover:bg-gray-200 text-gray-500 px-2 py-1 rounded-lg transition-colors whitespace-nowrap text-[10px] font-bold">비우기</button>
              )}
            </div>
            {messages.map(msg => {
              const isMe = msg.authorId === auth.currentUser?.uid;
              const isAI = msg.authorId === 'ai-butler';
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group`}>
                  {!isMe && (
                    <span className={`text-[10px] ml-1 mb-1 font-bold inline-flex items-center gap-1 ${isAI ? 'text-indigo-500' : 'text-gray-500'}`}>
                      {isAI && <img src="/ai-butler.png?v=20260518" alt="" className="w-4 h-4 rounded-full object-cover border border-indigo-100" />}
                      {msg.nickname}
                    </span>
                  )}
                  <div className={`p-2 px-3 rounded-2xl max-w-[85%] text-sm relative group/msg ${
                    isMe ? 'bg-[#FF5C5C] text-white rounded-tr-sm' :
                    isAI ? 'bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-tl-sm' :
                    'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
                  }`}>
                    {msg.replyToId && (
                      <div className={`mb-1.5 rounded-xl border-l-4 px-2 py-1 text-[11px] ${
                        isMe
                          ? 'bg-white/15 border-white/70 text-white/85'
                          : 'bg-slate-50 border-indigo-300 text-slate-500'
                      }`}>
                        <div className="font-black truncate">{msg.replyToNickname || '답글'}</div>
                        <div className="truncate">{msg.replyToContent}</div>
                      </div>
                    )}
                    {msg.stickerUrl ? (
                      <div>
                        <img src={msg.stickerUrl} alt={msg.stickerName || '이모티콘'} className="max-w-[150px] max-h-[150px] rounded-2xl object-contain bg-white/70" />
                      </div>
                    ) : (
                      <>
                        {renderLinkedText(msg.content)}
                        {extractUrls(msg.content).slice(0, 1).map(url => (
                          <span key={url} className="block">
                            <LinkPreviewCard url={url} compact />
                          </span>
                        ))}
                      </>
                    )}
                    <div className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity ${isMe ? '-left-16' : '-right-16'}`}>
                      <button onClick={() => setReplyingTo(msg)} className="text-gray-400 hover:text-indigo-500 text-xs px-1" title="답글">↩</button>
                      <button onClick={() => copyToClipboard(msg.content)} className="text-gray-400 hover:text-indigo-500 text-xs px-1" title="복사">📋</button>
                      {(isMe || profile?.role === 'admin' || profile?.role === 'manager') && (
                        <button onClick={async () => { if (confirm('삭제하시겠습니까?')) { try { await deleteDoc(doc(db, 'chats', msg.id)); } catch (e) { console.error(e); } } }}
                          className="text-red-400 hover:text-red-500 text-xs px-1 font-bold" title="삭제">✕</button>
                      )}
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 mt-1">
                    {msg.createdAt && typeof msg.createdAt.toDate === 'function'
                      ? formatDistanceToNow(msg.createdAt.toDate(), { addSuffix: true, locale: ko })
                      : '방금 전'}
                  </span>
                </div>
              );
            })}
            {isAiThinking && (
              <div className="flex flex-col items-start">
                <span className="text-[10px] ml-1 mb-1 font-bold inline-flex items-center gap-1 text-indigo-500">
                  <img src="/ai-butler.png?v=20260518" alt="" className="w-4 h-4 rounded-full object-cover border border-indigo-100" />
                  루이
                </span>
                <div className="bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-2xl rounded-tl-sm px-3 py-2 text-xs font-bold inline-flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75 animate-ping"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                  </span>
                  답변을 정리하는 중...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={handleSendMessage} className="relative p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-white border-t border-gray-100 flex flex-col gap-2 shrink-0">
            {(showCommandMenu || aiLimitNotice) && (
              <div className="absolute left-3 right-14 bottom-[58px] rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden z-10">
                {showCommandMenu && (
                  <div className="max-h-72 overflow-y-auto py-1">
                    {AI_COMMANDS
                      .filter(item => {
                        const typed = newMessage.trim();
                        return typed === '/' || item.command.startsWith(typed) || item.title.includes(typed.replace('/', ''));
                      })
                      .map(item => (
                        <button
                          key={item.command}
                          type="button"
                          onClick={() => {
                            setNewMessage(item.template);
                            setShowCommandMenu(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-indigo-50 transition-colors"
                        >
                          <span className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">{item.icon}</span>
                          <span>
                            <span className="block text-sm font-black text-slate-800">{item.command} · {item.title}</span>
                            <span className="block text-xs text-slate-500">{item.desc}</span>
                          </span>
                        </button>
                      ))}
                  </div>
                )}
                {aiLimitNotice && <p className="px-4 py-2 text-xs font-bold text-rose-500 bg-rose-50">{aiLimitNotice}</p>}
              </div>
            )}
            {showStickerPanel && (
              <div className="absolute left-3 right-3 bottom-[58px] rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden z-20">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div>
                    <p className="text-sm font-black text-slate-800">공용 이모티콘</p>
                    <p className="text-[10px] text-slate-500">운영진이 승인한 이모티콘을 모두가 같이 씁니다.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => canManageStickers ? stickerFileInputRef.current?.click() : requestStickerFromPrompt()}
                      disabled={isStickerUploading}
                      className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-black text-rose-500 disabled:opacity-50"
                    >
                      {isStickerUploading ? '저장 중' : canManageStickers ? '공용 추가' : '제작 요청'}
                    </button>
                    <button type="button" onClick={() => setShowStickerPanel(false)} className="text-slate-400 hover:text-rose-500 font-black">×</button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto p-3">
                  {savedStickers.length > 0 ? (
                    <div className="grid grid-cols-4 gap-2">
                      {savedStickers.map(sticker => (
                        <div key={sticker.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => sendSticker(sticker)}
                            className="w-full aspect-square rounded-2xl border border-slate-100 bg-slate-50 p-1.5 hover:border-rose-200 hover:bg-rose-50 transition-colors"
                            title={sticker.name}
                          >
                            <img src={sticker.imageUrl} alt={sticker.name} className="w-full h-full object-contain" />
                          </button>
                          {canManageStickers && (
                            <button
                              type="button"
                              onClick={() => deleteSticker(sticker.id)}
                              className="absolute -right-1 -top-1 hidden group-hover:flex w-5 h-5 items-center justify-center rounded-full bg-slate-900 text-white text-[10px]"
                              title="삭제"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-8 text-center">
                      <p className="text-3xl mb-2">🖼️</p>
                      <p className="text-sm font-bold text-slate-500">등록된 공용 이모티콘이 아직 없어요.</p>
                      <p className="text-xs text-slate-400 mt-1">{canManageStickers ? '이미지를 추가하면 모두가 같이 쓸 수 있습니다.' : '원하는 이모티콘을 제작 요청해보세요.'}</p>
                    </div>
                  )}
                  {canManageStickers && pendingStickers.length > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <p className="mb-2 text-xs font-black text-slate-500">승인 대기 요청</p>
                      <div className="space-y-2">
                        {pendingStickers.slice(0, 6).map(sticker => (
                          <div key={sticker.id} className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-black text-slate-700">{sticker.prompt || sticker.name}</p>
                              <p className="text-[10px] text-slate-400">{sticker.requestedByName || '회원'} 요청</p>
                            </div>
                            {sticker.imageUrl ? (
                              <button type="button" onClick={() => approveSticker(sticker)} className="rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-black text-white">승인</button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setStickerApprovalTarget(sticker);
                                  stickerFileInputRef.current?.click();
                                }}
                                className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-amber-600"
                              >
                                이미지 업로드
                              </button>
                            )}
                            <button type="button" onClick={() => deleteSticker(sticker.id)} className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-rose-500">삭제</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {replyingTo && (
              <div className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black text-indigo-500">{replyingTo.nickname}에게 답글</p>
                  <p className="text-xs text-slate-500 truncate">{replyingTo.stickerName ? `[이모티콘] ${replyingTo.stickerName}` : replyingTo.content}</p>
                </div>
                <button type="button" onClick={() => setReplyingTo(null)} className="text-slate-400 hover:text-rose-500 text-sm font-black">✕</button>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowStickerPanel(prev => !prev);
                  setShowCommandMenu(false);
                }}
                className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-rose-50 hover:text-rose-500 transition-colors"
                title="이모티콘"
              >
                🖼️
              </button>
              <div className={`flex-1 flex items-center gap-2 bg-gray-50 border rounded-full px-3 py-1.5 transition-colors ${activeCommandDraft.token ? 'border-indigo-200 ring-2 ring-indigo-50' : 'border-gray-200'}`}>
                {activeCommandDraft.token && (
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-black ${activeCommandDraft.isKnown ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-500'}`}>
                    {activeCommandDraft.command?.icon || '⌘'} {activeCommandDraft.token}
                  </span>
                )}
                <input
                  type="text"
                  value={inputDisplayValue}
                  onChange={e => {
                    const value = e.target.value;
                    const nextValue = activeCommandDraft.token && !value.startsWith('/')
                      ? `${activeCommandDraft.token}${value ? ` ${value}` : ' '}`
                      : value;
                    setNewMessage(nextValue);
                    setShowCommandMenu(nextValue === '/' || nextValue.startsWith('/'));
                    if (aiLimitNotice) setAiLimitNotice(null);
                  }}
                  onFocus={() => setShowCommandMenu(newMessage.startsWith('/'))}
                  className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none"
                  placeholder={replyingTo ? '답글 입력...' : activeCommandDraft.token ? '질문 내용을 이어서 입력...' : '메시지 입력... /루이 질문'}
                />
              </div>
              <button type="submit" disabled={!newMessage.trim()}
                className="w-10 h-10 rounded-full bg-[#FF5C5C] text-white flex items-center justify-center disabled:opacity-50 hover:bg-[#e54f4f] transition-colors"
                title={newMessage.trim() ? '전송' : '입력 대기'}>
                {newMessage.trim() ? (
                  <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" />
                  </svg>
                )}
              </button>
              <input ref={stickerFileInputRef} type="file" accept="image/*" onChange={handleStickerUpload} className="hidden" />
            </div>
          </form>
        </div>
      )}

      {/* 유저 프로필 모달 */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setSelectedUser(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="h-24" style={{ backgroundColor: selectedUser.profileColor || '#FF5C5C' }}></div>
            <div className="px-6 pb-6 relative">
              <div className={`absolute -top-12 left-6 rounded-full p-[3px] ${selectedRingClass || 'bg-white'}`}>
                {selectedUser.photoURL ? (
                  <img src={selectedUser.photoURL} alt="Profile" referrerPolicy="no-referrer" className="w-24 h-24 rounded-full border-4 border-white object-cover bg-white" />
                ) : (
                  <div className="w-24 h-24 rounded-full border-4 border-white flex items-center justify-center text-white text-3xl font-bold" style={{ backgroundColor: selectedUser.profileColor }}>
                    {selectedUser.nickname?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className={`absolute bottom-1 right-1 w-4 h-4 border-2 border-white rounded-full ${selectedUser.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
              </div>
              <div className="pt-14">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                  <span className={selectedUser.isBanned ? 'line-through text-gray-400' : selectedNameClass}>{selectedUser.nickname}</span>
                  {ROLE_BADGES[selectedUser.role] && <span className={`text-[10px] ${ROLE_BADGES[selectedUser.role].className} px-2 py-0.5 rounded-full font-bold`}>{ROLE_BADGES[selectedUser.role].label}</span>}
                  {selectedUser.level && <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-bold">Lv.{selectedUser.level}</span>}
                  {selectedUser.isBanned && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">강퇴됨</span>}
                </h2>
                <div className="mt-4 bg-gray-50 p-3 rounded-xl border border-gray-100">
                  <p className="text-sm font-semibold text-gray-600 mb-1">상태 메시지</p>
                  <p className="text-sm text-gray-800">{selectedUser.bio || '상태 메시지가 없습니다.'}</p>
                </div>
                {(profile?.role === 'admin' || profile?.role === 'manager') && profile?.email !== selectedUser.email && (
                  <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
                    {profile?.role === 'admin' && selectedUser.role !== 'admin' && (
                      <>
                        {selectedUser.role === 'user' && (
                          <>
                            <button onClick={() => handleUpdateRole(selectedUser.id, 'regionalLeader')} className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition-colors">지역장 임명</button>
                            <button onClick={() => handleUpdateRole(selectedUser.id, 'manager')} className="px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg text-xs font-bold transition-colors">부방장 임명</button>
                          </>
                        )}
                        {(selectedUser.role === 'manager' || selectedUser.role === 'regionalLeader') && (
                          <button onClick={() => handleUpdateRole(selectedUser.id, 'user')} className="px-3 py-1.5 bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-lg text-xs font-bold transition-colors">권한 제거</button>
                        )}
                      </>
                    )}
                    {(profile?.role === 'admin' || (profile?.role === 'manager' && selectedUser.role === 'user')) && (
                      <button onClick={() => handleBanUser(selectedUser.id, selectedUser.isBanned)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${selectedUser.isBanned ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}>
                        {selectedUser.isBanned ? '차단 해제' : '강퇴 (영구 차단)'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="bg-gray-50 p-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setSelectedUser(null)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-300 transition-colors">닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
  };

  if (isMobile) {
    return (
      <>
        <button
          onMouseDown={handleMouseDown}
          onTouchStart={handleMouseDown}
          onClick={(e) => {
            if (isDragging) { e.preventDefault(); e.stopPropagation(); }
            else { setIsMobileOpen(true); }
          }}
          style={{ right: `${btnPos.x}px`, bottom: `${btnPos.y}px`, touchAction: 'none' }}
          className={`fixed w-14 h-14 bg-[#FF5C5C] text-white rounded-full shadow-2xl flex items-center justify-center z-[20020] active:scale-95 ${isDragging ? 'cursor-grabbing' : 'cursor-pointer active:cursor-grabbing'}`}
        >
          <span className="text-2xl select-none">💬</span>
          {onlineUsers.length > 0 && <span className="absolute top-0 right-0 w-4 h-4 bg-green-400 border-2 border-white rounded-full"></span>}
        </button>

        <div
          className={`fixed inset-0 z-[30000] transition-transform duration-300 md:inset-auto md:right-6 md:bottom-24 md:h-[680px] md:max-h-[calc(100vh-8rem)] md:w-[430px] md:max-w-[calc(100vw-3rem)] ${isMobileOpen ? 'translate-y-0 md:scale-100 md:opacity-100 pointer-events-auto visible' : 'translate-y-full pointer-events-none md:translate-y-4 md:scale-95 md:opacity-0 md:pointer-events-none invisible'}`}
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: keyboardInset ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)' }}
        >
          <div className="absolute inset-0 bg-white shadow-2xl flex flex-col overflow-hidden md:rounded-[28px] md:border md:border-slate-200">
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-white shrink-0">
              <h2 className="font-bold text-lg text-gray-800">☕ 동전커피 라운지</h2>
              <button onClick={() => setIsMobileOpen(false)} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 font-bold hover:bg-gray-200 transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-hidden flex flex-col bg-white">
              {renderSidebarContent()}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="w-full h-full bg-white flex flex-col relative overflow-hidden">
      {renderSidebarContent()}
    </div>
  );
}
