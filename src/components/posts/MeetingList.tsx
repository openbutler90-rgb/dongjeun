import { useEffect, useState, useRef } from 'react';
import {
  collection, query, onSnapshot, orderBy, Timestamp, doc, deleteDoc,
  updateDoc, getDoc, setDoc, serverTimestamp, increment, writeBatch, runTransaction,
  where, getDocs, documentId
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAuthStore } from '../../stores/authStore';
import { linkifyText } from '../../lib/linkify';
import { formatDistanceToNow, format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { MeetingWriteModal } from './MeetingWriteModal';
import { useVisualViewportInset } from '../../hooks/useVisualViewportInset';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const MEETING_TYPE_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  regular:  { label: '정모',    icon: '🤝', color: 'text-rose-600',    bg: 'bg-rose-50 border-rose-200' },
  regional: { label: '지역모임', icon: '📍', color: 'text-blue-600',    bg: 'bg-blue-50 border-blue-200' },
  small:    { label: '소모임',   icon: '☕', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
};

interface Meeting {
  id: string;
  channelId: string;
  authorId: string;
  title: string;
  content: string;
  meetingType: string;
  meetingDate: Timestamp;
  registrationDeadline: Timestamp;
  maxAttendees: number;
  locationName: string;
  lat: number;
  lng: number;
  locationPrivate: boolean;
  totalCost: number;
  attendeesCount: number;
  imageUrls?: string[];
  isActive: boolean;
  createdAt: Timestamp;
}

interface Attendee {
  userId: string;
  nickname: string;
  joinedAt: Timestamp;
  isPaid: boolean;
  paidAt?: Timestamp;
  markedBy?: string;
  isOrganizer?: boolean;
}

interface Comment {
  id: string;
  authorId: string;
  nickname: string;
  content: string;
  createdAt: Timestamp;
  parentId?: string;
}

function MeetingBadge({ type }: { type: string }) {
  const meta = MEETING_TYPE_META[type] || MEETING_TYPE_META.regular;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border ${meta.bg} ${meta.color}`}>
      {meta.icon} {meta.label}
    </span>
  );
}

function CountdownBadge({ deadline }: { deadline: Timestamp }) {
  const now = Date.now();
  const dl = deadline.toDate().getTime();
  const isExpired = now > dl;
  if (isExpired) return <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">마감</span>;
  const diff = dl - now;
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return <span className="text-[11px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">D-{days}</span>;
  return <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">{hours}시간 후 마감</span>;
}

const FILTER_TABS = [
  { id: 'all',      label: '전체',    icon: '📋' },
  { id: 'regular',  label: '정모',    icon: '🤝' },
  { id: 'regional', label: '지역모임', icon: '📍' },
  { id: 'small',    label: '소모임',   icon: '☕' },
] as const;

export function MeetingList() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Record<string, Attendee[]>>({});
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [users, setUsers] = useState<Record<string, { nickname: string; role?: string }>>({});
  const [myAttendance, setMyAttendance] = useState<Record<string, boolean>>({});
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [newComment, setNewComment] = useState('');
  const [costInput, setCostInput] = useState('');
  const [isEditingCost, setIsEditingCost] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'attendees' | 'cost' | 'comments'>('info');
  const [filterType, setFilterType] = useState<'all' | 'regular' | 'regional' | 'small'>('all');
  const [showPastMeetings, setShowPastMeetings] = useState(false);
  const { profile } = useAuthStore();
  const commentInputRef = useRef<HTMLInputElement>(null);
  const keyboardInset = useVisualViewportInset();

  const selectedMeeting = meetings.find(m => m.id === selectedMeetingId) ?? null;

  useEffect(() => {
    if (meetings.length === 0) return;
    const uids = Array.from(new Set(meetings.map(m => m.authorId))).filter((id): id is string => Boolean(id) && !users[id]);
    if (uids.length === 0) return;

    const fetchBatch = async (batchUids: string[]) => {
      try {
        const q = query(collection(db, 'users'), where(documentId(), 'in', batchUids));
        const snap = await getDocs(q);
        const newUsers: Record<string, { nickname: string; role?: string }> = {};
        snap.docs.forEach(doc => {
          newUsers[doc.id] = doc.data() as any;
        });
        setUsers(prev => ({ ...prev, ...newUsers }));
      } catch (err) {
        console.error("Error fetching users in MeetingList batch:", err);
      }
    };

    for (let i = 0; i < uids.length; i += 30) {
      fetchBatch(uids.slice(i, i + 30));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings]);

  useEffect(() => {
    setIsLoading(true);
    const q = query(collection(db, 'meetings'), orderBy('meetingDate', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setMeetings(snap.docs.map(d => ({
        id: d.id,
        ...d.data({ serverTimestamps: 'estimate' }),
      } as Meeting)));
      setIsLoading(false);
    }, () => setIsLoading(false));
    return unsub;
  }, []);

  useEffect(() => {
    if (!auth.currentUser || meetings.length === 0) return;
    meetings.forEach(m => {
      getDoc(doc(db, 'meetings', m.id, 'attendees', auth.currentUser!.uid)).then(d => {
        setMyAttendance(prev => ({ ...prev, [m.id]: d.exists() }));
      });
    });
  }, [meetings]);

  useEffect(() => {
    if (!selectedMeetingId) return;
    const mid = selectedMeetingId;
    const unsubA = onSnapshot(
      query(collection(db, 'meetings', mid, 'attendees'), orderBy('joinedAt', 'asc')),
      snap => setAttendees(prev => ({ ...prev, [mid]: snap.docs.map(d => ({
        userId: d.id,
        ...d.data({ serverTimestamps: 'estimate' }),
      } as Attendee)) }))
    );
    const unsubC = onSnapshot(
      query(collection(db, 'meetings', mid, 'comments'), orderBy('createdAt', 'asc')),
      snap => setComments(prev => ({ ...prev, [mid]: snap.docs.map(d => ({
        id: d.id,
        ...d.data({ serverTimestamps: 'estimate' }),
      } as Comment)) }))
    );
    return () => { unsubA(); unsubC(); };
  }, [selectedMeetingId]);

  useEffect(() => {
    if (selectedMeeting && !isEditingCost) {
      setCostInput(selectedMeeting.totalCost.toString());
    }
  }, [selectedMeeting?.totalCost]);

  const isDeadlinePassed = (m: Meeting) => m.registrationDeadline.toDate() < new Date();
  const isMeetingPast = (m: Meeting) => m.meetingDate.toDate() < new Date();
  const isAuthorOrAdmin = (m: Meeting) =>
    auth.currentUser?.uid === m.authorId || profile?.role === 'admin' || profile?.role === 'manager';

  const openModal = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setActiveTab('info');
    setCostInput(meeting.totalCost.toString());
    setIsEditingCost(false);
    setNewComment('');
  };

  const closeModal = () => {
    setSelectedMeetingId(null);
    setIsEditingCost(false);
    setNewComment('');
  };

  const handleAttend = async (meeting: Meeting) => {
    if (!auth.currentUser || !profile) return;
    if (isDeadlinePassed(meeting)) return alert('참석 마감 시간이 지났습니다.');
    if (meeting.maxAttendees > 0 && meeting.attendeesCount >= meeting.maxAttendees) return alert('참석 인원이 가득 찼습니다.');
    const uid = auth.currentUser.uid;
    const attendRef = doc(db, 'meetings', meeting.id, 'attendees', uid);
    const optimisticAttendee: Attendee = {
      userId: uid,
      nickname: profile.nickname,
      joinedAt: Timestamp.now(),
      isPaid: false,
      isOrganizer: false,
    };
    const prevAttendees = attendees[meeting.id] || [];
    const prevAttendance = myAttendance[meeting.id];
    setMyAttendance(prev => ({ ...prev, [meeting.id]: true }));
    setMeetings(prev => prev.map(m => m.id === meeting.id ? {
      ...m,
      attendeesCount: (m.attendeesCount || 0) + 1,
    } : m));
    if (selectedMeetingId === meeting.id) {
      setAttendees(prev => ({ ...prev, [meeting.id]: [...(prev[meeting.id] || []), optimisticAttendee] }));
    }
    try {
      await runTransaction(db, async (transaction) => {
        const meetingRef = doc(db, 'meetings', meeting.id);
        const meetingSnap = await transaction.get(meetingRef);
        const currentCount = meetingSnap.data()?.attendeesCount || 0;
        if (meeting.maxAttendees > 0 && currentCount >= meeting.maxAttendees) {
          throw new Error('참석 인원이 가득 찼습니다.');
        }
        transaction.set(attendRef, {
          userId: uid,
          nickname: profile.nickname,
          joinedAt: serverTimestamp(),
          isPaid: false,
          isOrganizer: false,
        });
        transaction.update(meetingRef, { attendeesCount: currentCount + 1, updatedAt: serverTimestamp() });
      });
    } catch (err: any) {
      setMyAttendance(prev => ({ ...prev, [meeting.id]: prevAttendance || false }));
      setMeetings(prev => prev.map(m => m.id === meeting.id ? {
        ...m,
        attendeesCount: Math.max(0, (m.attendeesCount || 0) - 1),
      } : m));
      setAttendees(prev => ({ ...prev, [meeting.id]: prevAttendees }));
      alert('오류: ' + err.message);
    }
  };

  const handleCancelAttend = async (meeting: Meeting) => {
    if (!auth.currentUser) return;
    if (!confirm('참석을 취소하시겠습니까?')) return;
    const uid = auth.currentUser.uid;
    const prevAttendees = attendees[meeting.id] || [];
    const prevAttendance = myAttendance[meeting.id];
    setMyAttendance(prev => ({ ...prev, [meeting.id]: false }));
    setMeetings(prev => prev.map(m => m.id === meeting.id ? {
      ...m,
      attendeesCount: Math.max(0, (m.attendeesCount || 0) - 1),
    } : m));
    setAttendees(prev => ({ ...prev, [meeting.id]: (prev[meeting.id] || []).filter(a => a.userId !== uid) }));
    try {
      await runTransaction(db, async (transaction) => {
        const meetingRef = doc(db, 'meetings', meeting.id);
        const meetingSnap = await transaction.get(meetingRef);
        const currentCount = meetingSnap.data()?.attendeesCount || 0;
        transaction.delete(doc(db, 'meetings', meeting.id, 'attendees', uid));
        transaction.update(meetingRef, { attendeesCount: Math.max(0, currentCount - 1), updatedAt: serverTimestamp() });
      });
    } catch (err: any) {
      setMyAttendance(prev => ({ ...prev, [meeting.id]: prevAttendance || false }));
      setMeetings(prev => prev.map(m => m.id === meeting.id ? {
        ...m,
        attendeesCount: (m.attendeesCount || 0) + 1,
      } : m));
      setAttendees(prev => ({ ...prev, [meeting.id]: prevAttendees }));
      alert('오류: ' + err.message);
    }
  };

  const handleMarkPaid = async (meeting: Meeting, attendee: Attendee) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    const canMark = uid === attendee.userId || isAuthorOrAdmin(meeting);
    if (!canMark) return alert('권한이 없습니다.');
    const prevAttendees = attendees[meeting.id] || [];
    setAttendees(prev => ({
      ...prev,
      [meeting.id]: (prev[meeting.id] || []).map(a => a.userId === attendee.userId ? {
        ...a,
        isPaid: !attendee.isPaid,
        paidAt: !attendee.isPaid ? Timestamp.now() : undefined,
        markedBy: !attendee.isPaid ? uid : undefined,
      } : a),
    }));
    try {
      await updateDoc(doc(db, 'meetings', meeting.id, 'attendees', attendee.userId), {
        isPaid: !attendee.isPaid,
        paidAt: !attendee.isPaid ? serverTimestamp() : null,
        markedBy: !attendee.isPaid ? uid : null,
      });
    } catch (err: any) {
      setAttendees(prev => ({ ...prev, [meeting.id]: prevAttendees }));
      alert('오류: ' + err.message);
    }
  };

  const handleSetOrganizer = async (meeting: Meeting, attendee: Attendee) => {
    if (!isAuthorOrAdmin(meeting)) return alert('권한이 없습니다.');
    try {
      await updateDoc(doc(db, 'meetings', meeting.id, 'attendees', attendee.userId), {
        isOrganizer: !attendee.isOrganizer,
      });
    } catch (err: any) { alert('오류: ' + err.message); }
  };

  const handleUpdateCost = async (meeting: Meeting) => {
    const cost = parseFloat(costInput);
    if (isNaN(cost) || cost < 0) return alert('올바른 금액을 입력해주세요.');
    if (!isAuthorOrAdmin(meeting)) return alert('모임장 또는 운영진만 설정할 수 있습니다.');
    try {
      await updateDoc(doc(db, 'meetings', meeting.id), { totalCost: cost, updatedAt: serverTimestamp() });
      setIsEditingCost(false);
    } catch (err: any) { alert('오류: ' + err.message); }
  };

  const handleAddComment = async (meeting: Meeting) => {
    if (!newComment.trim() || !auth.currentUser || !profile) return;
    const contentToSave = newComment.trim();
    const commentRef = doc(collection(db, 'meetings', meeting.id, 'comments'));
    const tempComment: Comment = {
      id: `temp-${commentRef.id}`,
      authorId: auth.currentUser.uid,
      nickname: profile.nickname,
      content: contentToSave,
      createdAt: Timestamp.now(),
    };
    setNewComment('');
    setComments(prev => ({ ...prev, [meeting.id]: [...(prev[meeting.id] || []), tempComment] }));
    try {
      await setDoc(commentRef, {
        authorId: auth.currentUser.uid,
        nickname: profile.nickname,
        content: contentToSave,
        createdAt: serverTimestamp(),
        postId: meeting.id,
      });
      updateDoc(doc(db, 'users', auth.currentUser.uid), { xp: increment(10), updatedAt: serverTimestamp() }).catch(() => {});
    } catch (err: any) {
      setComments(prev => ({ ...prev, [meeting.id]: (prev[meeting.id] || []).filter(c => c.id !== tempComment.id) }));
      setNewComment(contentToSave);
      alert('오류: ' + err.message);
    }
  };

  const handleDeleteMeeting = async (meeting: Meeting) => {
    if (!isAuthorOrAdmin(meeting)) return alert('권한이 없습니다.');
    if (!confirm('모임을 삭제하시겠습니까?')) return;
    try {
      await deleteDoc(doc(db, 'meetings', meeting.id));
      closeModal();
    } catch (err: any) { alert('오류: ' + err.message); }
  };

  const handleDeleteComment = async (meeting: Meeting, commentId: string, authorId: string) => {
    if (auth.currentUser?.uid !== authorId && !isAuthorOrAdmin(meeting)) return alert('권한이 없습니다.');
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    const prevComments = comments[meeting.id] || [];
    setComments(prev => ({ ...prev, [meeting.id]: prevComments.filter(c => c.id !== commentId) }));
    try {
      await deleteDoc(doc(db, 'meetings', meeting.id, 'comments', commentId));
    } catch (err: any) {
      setComments(prev => ({ ...prev, [meeting.id]: prevComments }));
      alert('오류: ' + err.message);
    }
  };

  const filteredMeetings = meetings.filter(m => {
    if (filterType !== 'all' && m.meetingType !== filterType) return false;
    if (!showPastMeetings && isMeetingPast(m)) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1,2,3].map(i => (
          <div key={i} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <div className="h-5 bg-slate-100 rounded w-1/4 mb-3" />
            <div className="h-6 bg-slate-100 rounded w-2/3 mb-2" />
            <div className="h-4 bg-slate-100 rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* 필터 탭 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex gap-1.5 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                filterType === tab.id ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowPastMeetings(v => !v)}
          className={`flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
            showPastMeetings ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
          }`}
        >
          {showPastMeetings ? '🙈 지난 모임 숨기기' : '📅 지난 모임 보기'}
        </button>
      </div>

      {filteredMeetings.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-5xl mb-4">🫂</p>
          <p className="font-bold text-slate-500">
            {filterType !== 'all' ? `${MEETING_TYPE_META[filterType]?.label} 모임이 없습니다.` : '등록된 모임이 없습니다.'}
          </p>
          <p className="text-sm mt-2">첫 번째 모임을 만들어보세요!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-20">
          {filteredMeetings.map(meeting => {
            const expired = isDeadlinePassed(meeting);
            const past = isMeetingPast(meeting);
            const iAttend = myAttendance[meeting.id];
            const canManage = isAuthorOrAdmin(meeting);

            return (
              <div
                key={meeting.id}
                className={`bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow overflow-hidden cursor-pointer flex flex-col ${past ? 'border-slate-200 opacity-70' : 'border-slate-100'}`}
                onClick={() => openModal(meeting)}
              >
                {meeting.imageUrls && meeting.imageUrls[0] && (
                  <div className="w-full h-36 flex-shrink-0 overflow-hidden">
                    <img src={meeting.imageUrls[0]} alt="" className="w-full h-full object-cover" />
                  </div>
                )}

                <div className="p-3 flex flex-col flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <MeetingBadge type={meeting.meetingType} />
                      {!expired && !past && <CountdownBadge deadline={meeting.registrationDeadline} />}
                      {past && <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">종료</span>}
                      {iAttend && <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">✅ 참석</span>}
                    </div>
                    {canManage && (
                      <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditingMeeting(meeting)} className="text-[11px] text-slate-400 hover:text-indigo-500 px-2 py-1 rounded">수정</button>
                        <button onClick={() => handleDeleteMeeting(meeting)} className="text-[11px] text-slate-400 hover:text-rose-500 px-2 py-1 rounded">삭제</button>
                      </div>
                    )}
                  </div>

                  <h3 className="font-bold text-sm text-slate-900 mb-1 line-clamp-1">{meeting.title}</h3>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 mb-2">
                    <span>📅 {format(meeting.meetingDate.toDate(), 'M월 d일(EEE) HH:mm', { locale: ko })}</span>
                    <span>📍 {meeting.locationPrivate && !iAttend ? '참석자만 공개' : meeting.locationName}</span>
                    <span>👥 {meeting.attendeesCount}명{meeting.maxAttendees > 0 ? ` / ${meeting.maxAttendees}명` : ''}</span>
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed flex-1">{meeting.content}</p>

                  <div className="mt-2 pt-2" onClick={e => e.stopPropagation()}>
                    {past ? (
                      <span className="text-[11px] text-slate-400 font-medium">모임 종료</span>
                    ) : expired ? (
                      <span className="text-[11px] text-slate-400 font-medium">참석 마감</span>
                    ) : iAttend ? (
                      <button
                        onClick={() => handleCancelAttend(meeting)}
                        className="text-[11px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 px-3 py-1 rounded-full transition-colors"
                      >참석 취소</button>
                    ) : (
                      <button
                        onClick={() => handleAttend(meeting)}
                        className="text-[11px] font-bold text-white bg-gradient-to-r from-rose-500 to-orange-400 px-3 py-1 rounded-full shadow-sm hover:shadow-md transition-all"
                      >참석하기 🙋</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 모임 상세 모달 */}
      {selectedMeeting && (() => {
        const m = selectedMeeting;
        const mid = m.id;
        const iAttend = myAttendance[mid];
        const canManage = isAuthorOrAdmin(m);
        const expired = isDeadlinePassed(m);
        const past = isMeetingPast(m);
        const mAttendees = attendees[mid] || [];
        const paidCount = mAttendees.filter(a => a.isPaid).length;
        const perPerson = mAttendees.length > 0 ? Math.ceil(m.totalCost / mAttendees.length) : 0;
        const showLocation = !m.locationPrivate || iAttend || canManage;
        const mComments = comments[mid] || [];
        const author = users[m.authorId];

        return (
          <div
            className="fixed inset-0 z-[30000] bg-slate-900/60 backdrop-blur-sm flex items-start justify-center p-0 md:items-center md:p-6"
            style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: keyboardInset ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)' }}
            onClick={closeModal}
          >
            <div className="bg-white w-full h-[100dvh] max-h-[100dvh] rounded-none flex flex-col overflow-hidden shadow-2xl md:h-auto md:max-w-3xl md:max-h-[92vh] md:rounded-2xl" onClick={e => e.stopPropagation()}>
              {/* 모달 헤더 */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
                <div className="flex items-center gap-3 min-w-0">
                  <MeetingBadge type={m.meetingType} />
                  <h2 className="font-bold text-lg text-slate-800 truncate">{m.title}</h2>
                  {past && <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">종료</span>}
                </div>
                <button onClick={closeModal} className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 font-bold shrink-0">✕</button>
              </div>

              {/* 탭 */}
              <div className="flex border-b border-slate-100 shrink-0 bg-white">
                {(['info', 'attendees', 'cost', 'comments'] as const).map(tab => {
                  const labels: Record<string, string> = {
                    info: '📋 정보',
                    attendees: `👥 참석(${mAttendees.length})`,
                    cost: '💰 정산',
                    comments: `💬 댓글(${mComments.length})`,
                  };
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 py-2.5 text-xs font-bold transition-colors ${activeTab === tab ? 'text-rose-500 border-b-2 border-rose-500 bg-rose-50/30' : 'text-slate-400 hover:text-slate-600'}`}
                    >{labels[tab]}</button>
                  );
                })}
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {/* 모임 정보 탭 */}
                {activeTab === 'info' && (
                  <div className="p-5 space-y-4">
                    {m.imageUrls && m.imageUrls.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {m.imageUrls.map((url, i) => (
                          <img key={i} src={url} alt="" className="h-40 w-auto rounded-xl object-cover shrink-0" />
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-bold text-slate-700">{author?.nickname || '알 수 없음'}</span>
                      <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">모임장</span>
                      {canManage && (
                        <div className="flex gap-1 ml-auto">
                          <button onClick={() => setEditingMeeting(m)} className="text-xs text-indigo-500 font-bold px-2 py-1 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">✏️ 수정</button>
                          <button onClick={() => handleDeleteMeeting(m)} className="text-xs text-rose-500 font-bold px-2 py-1 bg-rose-50 rounded-lg hover:bg-rose-100 transition-colors">🗑️ 삭제</button>
                        </div>
                      )}
                      {!canManage && (
                        <span className="text-xs text-slate-400 ml-auto">
                          {m.createdAt ? formatDistanceToNow(m.createdAt.toDate(), { addSuffix: true, locale: ko }) : ''}
                        </span>
                      )}
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 w-24 shrink-0">📅 모임 일시</span>
                        <span className="font-bold text-slate-800">{format(m.meetingDate.toDate(), 'yyyy년 M월 d일(EEE) HH:mm', { locale: ko })}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 w-24 shrink-0">⏰ 참석 마감</span>
                        <span className={`font-bold ${expired ? 'text-slate-400' : 'text-orange-500'}`}>
                          {format(m.registrationDeadline.toDate(), 'M월 d일(EEE) HH:mm', { locale: ko })}
                          {expired ? ' (마감됨)' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-400 w-24 shrink-0">👥 참석 인원</span>
                        <span className="font-bold text-slate-800">
                          {m.attendeesCount}명{m.maxAttendees > 0 ? ` / 최대 ${m.maxAttendees}명` : ' (무제한)'}
                        </span>
                      </div>
                      <div className="flex items-start gap-3">
                        <span className="text-slate-400 w-24 shrink-0">📍 장소</span>
                        <div>
                          {showLocation ? (
                            <span className="font-bold text-slate-800">{m.locationName}</span>
                          ) : (
                            <span className="text-slate-400 italic">참석 후 공개됩니다</span>
                          )}
                          {m.locationPrivate && (
                            <span className="ml-2 text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-bold border border-amber-200">참석후 공개</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {showLocation && m.lat !== 0 && (
                      <div className="rounded-xl overflow-hidden border border-slate-200" style={{ height: 220 }}>
                        <MapContainer center={[m.lat, m.lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                          <Marker position={[m.lat, m.lng]}>
                            <Popup>{m.locationName}</Popup>
                          </Marker>
                        </MapContainer>
                      </div>
                    )}
                    {showLocation && m.lat !== 0 && (
                      <a href={`https://map.kakao.com/link/map/${encodeURIComponent(m.locationName)},${m.lat},${m.lng}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs bg-yellow-400 text-yellow-900 font-bold px-3 py-1.5 rounded-full hover:bg-yellow-300 transition-colors">
                        🗺️ 카카오맵으로 보기
                      </a>
                    )}

                    <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{linkifyText(m.content)}</div>

                    <div className="pt-2">
                      {past ? (
                        <div className="text-center text-sm text-slate-400 bg-slate-50 py-3 rounded-xl font-medium">모임이 종료되었습니다</div>
                      ) : expired ? (
                        <div className="text-center text-sm text-slate-400 bg-slate-50 py-3 rounded-xl font-medium">참석 마감</div>
                      ) : iAttend ? (
                        <button onClick={() => handleCancelAttend(m)} className="w-full py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">참석 취소</button>
                      ) : (
                        <button onClick={() => handleAttend(m)} className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-rose-500 to-orange-400 shadow-md hover:shadow-lg transition-all">🙋 참석하기</button>
                      )}
                    </div>
                  </div>
                )}

                {/* 참석자 탭 */}
                {activeTab === 'attendees' && (
                  <div className="p-5">
                    {mAttendees.length === 0 ? (
                      <div className="text-center py-12 text-slate-400">
                        <p className="text-3xl mb-2">🫂</p>
                        <p>아직 참석자가 없습니다</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mAttendees.map(att => {
                          const canMark = auth.currentUser?.uid === att.userId || canManage;
                          return (
                            <div key={att.userId} className={`flex items-center gap-3 p-3 rounded-xl border ${att.isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-100'}`}>
                              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-rose-400 to-orange-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                {att.nickname?.[0]?.toUpperCase() || '?'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-sm text-slate-800">{att.nickname}</span>
                                  {att.userId === m.authorId && <span className="text-[10px] font-bold bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded">모임장</span>}
                                  {att.isOrganizer && att.userId !== m.authorId && <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded">운영진</span>}
                                </div>
                                <span className="text-[11px] text-slate-400">
                                  {att.joinedAt ? formatDistanceToNow(att.joinedAt.toDate(), { addSuffix: true, locale: ko }) : ''} 참석
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {canManage && att.userId !== m.authorId && (
                                  <button onClick={() => handleSetOrganizer(m, att)}
                                    className={`text-[10px] font-bold px-2 py-1 rounded transition-colors ${att.isOrganizer ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600'}`}>
                                    {att.isOrganizer ? '운영진 제거' : '운영진 지정'}
                                  </button>
                                )}
                                {canMark ? (
                                  <button onClick={() => handleMarkPaid(m, att)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${att.isPaid ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600'}`}>
                                    {att.isPaid ? '✅ 완료' : '결제 완료'}
                                  </button>
                                ) : att.isPaid ? (
                                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">✅ 완료</span>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 정산 탭 */}
                {activeTab === 'cost' && (
                  <div className="p-5 space-y-4">
                    <div className="bg-gradient-to-br from-rose-50 to-orange-50 rounded-2xl p-5 border border-rose-100">
                      <h4 className="font-bold text-slate-800 mb-3">💰 정산 현황</h4>
                      {isEditingCost && canManage ? (
                        <div className="flex gap-2 mb-3">
                          <input type="number" value={costInput} onChange={e => setCostInput(e.target.value)}
                            className="flex-1 bg-white border border-rose-200 rounded-xl px-4 py-2.5 text-slate-800 font-bold focus:ring-2 focus:ring-rose-400 focus:outline-none"
                            placeholder="총 금액 입력" min="0" />
                          <button onClick={() => handleUpdateCost(m)} className="px-4 py-2.5 bg-rose-500 text-white rounded-xl font-bold text-sm hover:bg-rose-600">저장</button>
                          <button onClick={() => setIsEditingCost(false)} className="px-4 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm">취소</button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-3xl font-black text-slate-800">{m.totalCost.toLocaleString()}원</span>
                          {canManage && (
                            <button onClick={() => { setIsEditingCost(true); setCostInput(m.totalCost.toString()); }}
                              className="text-xs text-rose-500 font-bold underline">수정</button>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-white rounded-xl p-3 text-center border border-rose-100">
                          <p className="text-xs text-slate-400 mb-1">총 참석자</p>
                          <p className="text-xl font-black text-slate-800">{mAttendees.length}명</p>
                        </div>
                        <div className="bg-white rounded-xl p-3 text-center border border-rose-100">
                          <p className="text-xs text-slate-400 mb-1">1인당</p>
                          <p className="text-xl font-black text-rose-500">{perPerson.toLocaleString()}원</p>
                        </div>
                        <div className="bg-white rounded-xl p-3 text-center border border-rose-100">
                          <p className="text-xs text-slate-400 mb-1">결제 완료</p>
                          <p className="text-xl font-black text-emerald-500">{paidCount}명</p>
                        </div>
                      </div>
                      {mAttendees.length > 0 && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-slate-500 mb-1">
                            <span>결제 진행률</span><span>{paidCount}/{mAttendees.length}</span>
                          </div>
                          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500"
                              style={{ width: `${mAttendees.length > 0 ? (paidCount / mAttendees.length) * 100 : 0}%` }} />
                          </div>
                        </div>
                      )}
                    </div>

                    <h4 className="font-bold text-slate-700 text-sm">참석자별 결제 현황</h4>
                    {mAttendees.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-6">아직 참석자가 없습니다</p>
                    ) : (
                      <div className="space-y-2">
                        {mAttendees.map(att => {
                          const canMark = auth.currentUser?.uid === att.userId || canManage;
                          return (
                            <div key={att.userId} className={`flex items-center justify-between p-3 rounded-xl border ${att.isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-slate-800">{att.nickname}</span>
                                {att.userId === m.authorId && <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 rounded font-bold">모임장</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-slate-600">{perPerson.toLocaleString()}원</span>
                                {canMark ? (
                                  <button onClick={() => handleMarkPaid(m, att)}
                                    className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${att.isPaid ? 'bg-emerald-500 text-white' : 'bg-white border border-slate-300 text-slate-500 hover:border-emerald-400 hover:text-emerald-600'}`}>
                                    {att.isPaid ? '✅ 완료' : '완료 표시'}
                                  </button>
                                ) : (
                                  <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${att.isPaid ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                    {att.isPaid ? '✅ 완료' : '미결제'}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 댓글 탭 */}
                {activeTab === 'comments' && (
                  <div className="flex flex-col" style={{ minHeight: 400 }}>
                    <div className="flex-1 p-4 space-y-3 overflow-y-auto custom-scrollbar">
                      {mComments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                          <span className="text-3xl mb-2">💬</span>
                          <p className="text-sm">첫 번째 댓글을 남겨보세요!</p>
                        </div>
                      ) : mComments.map(comment => (
                        <div key={comment.id} className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-slate-700">{comment.nickname}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400">
                                {comment.createdAt ? formatDistanceToNow(comment.createdAt.toDate(), { addSuffix: true, locale: ko }) : ''}
                              </span>
                              {(auth.currentUser?.uid === comment.authorId || canManage) && (
                                <button onClick={() => handleDeleteComment(m, comment.id, comment.authorId)} className="text-[10px] text-rose-400 hover:text-rose-600 font-bold">삭제</button>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-slate-600 whitespace-pre-wrap">{linkifyText(comment.content)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="p-3 bg-white border-t border-slate-200 shrink-0">
                      <div className="flex gap-2">
                        <input ref={commentInputRef} type="text" value={newComment} onChange={e => setNewComment(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(m); } }}
                          placeholder="댓글을 입력하세요..."
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400" />
                        <button onClick={() => handleAddComment(m)} disabled={!newComment.trim()}
                          className="bg-rose-500 text-white font-bold w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-40 hover:bg-rose-600 transition-colors">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {editingMeeting && (
        <MeetingWriteModal
          onClose={() => setEditingMeeting(null)}
          editMeeting={{
            id: editingMeeting.id,
            title: editingMeeting.title,
            content: editingMeeting.content,
            meetingType: editingMeeting.meetingType,
            meetingDate: editingMeeting.meetingDate,
            registrationDeadline: editingMeeting.registrationDeadline,
            maxAttendees: editingMeeting.maxAttendees,
            locationName: editingMeeting.locationName,
            lat: editingMeeting.lat,
            lng: editingMeeting.lng,
            locationPrivate: editingMeeting.locationPrivate,
            imageUrls: editingMeeting.imageUrls,
          }}
        />
      )}
    </>
  );
}
