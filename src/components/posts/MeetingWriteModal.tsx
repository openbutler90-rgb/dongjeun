import React, { useState, useRef } from 'react';
import { collection, serverTimestamp, updateDoc, doc, increment, setDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { uploadToCloudinary } from '../../lib/cloudinary';
import { sendGlobalNotification } from '../../lib/notifications';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { encodeGeohash, getGeoPrefix } from '../../lib/geo';
import { useToastStore } from '../../stores/toastStore';
import { useVisualViewportInset } from '../../hooks/useVisualViewportInset';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const MEETING_TYPES = [
  { value: 'regular',  label: '정모',    icon: '🤝', color: 'bg-rose-100 text-rose-600 border-rose-200' },
  { value: 'regional', label: '지역모임', icon: '📍', color: 'bg-blue-100 text-blue-600 border-blue-200' },
  { value: 'small',    label: '소모임',   icon: '☕', color: 'bg-emerald-100 text-emerald-600 border-emerald-200' },
];

interface Props {
  onClose: () => void;
  onSaved?: () => void;
  editMeeting?: {
    id: string;
    title: string;
    content: string;
    meetingType: string;
    meetingDate: any;
    registrationDeadline: any;
    maxAttendees: number;
    locationName: string;
    lat: number;
    lng: number;
    locationPrivate: boolean;
    imageUrls?: string[];
  };
}

function MapClickHandler({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  useMapEvents({ click(e) { onSelect(e.latlng.lat, e.latlng.lng); } });
  return null;
}

async function compressImage(file: File, maxWidth = 1200, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas failed'));
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Blob 변환 실패')), 'image/jpeg', quality);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

function toDatetimeLocal(ts: any): string {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MeetingWriteModal({ onClose, onSaved, editMeeting }: Props) {
  const [title, setTitle] = useState(editMeeting?.title || '');
  const [content, setContent] = useState(editMeeting?.content || '');
  const [meetingType, setMeetingType] = useState(editMeeting?.meetingType || 'regular');
  const [meetingDate, setMeetingDate] = useState(editMeeting ? toDatetimeLocal(editMeeting.meetingDate) : '');
  const [deadline, setDeadline] = useState(editMeeting ? toDatetimeLocal(editMeeting.registrationDeadline) : '');
  const [maxAttendees, setMaxAttendees] = useState(editMeeting?.maxAttendees?.toString() || '0');
  const [locationName, setLocationName] = useState(editMeeting?.locationName || '');
  const [lat, setLat] = useState(editMeeting?.lat || 37.5665);
  const [lng, setLng] = useState(editMeeting?.lng || 126.9780);
  const [locationPrivate, setLocationPrivate] = useState(editMeeting?.locationPrivate ?? true);
  const [imageUrls, setImageUrls] = useState<string[]>(editMeeting?.imageUrls || []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeoLoading, setIsGeoLoading] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const { showToast } = useToastStore();
  const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyboardInset = useVisualViewportInset();

  const handleGetLocation = () => {
    if (!navigator.geolocation) return alert('위치 정보를 지원하지 않습니다.');
    setIsGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(pos.coords.latitude); setLng(pos.coords.longitude); setIsGeoLoading(false); setShowMap(true); },
      (err) => { alert('위치 오류: ' + err.message); setIsGeoLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (!files.length) return;
    if (imageUrls.length + files.length > 3) return alert('이미지는 최대 3장까지 첨부할 수 있습니다.');
    if (!auth.currentUser) return alert('로그인이 필요합니다.');
    setIsSubmitting(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file: File = files[i];
        const uploadBlob: Blob = file.size > 300 * 1024 ? await compressImage(file) : file;
        const fileIdx = imageUrls.length + i;
        setUploadProgress(prev => ({ ...prev, [fileIdx]: 50 }));
        const secureUrl = await uploadToCloudinary(uploadBlob, 'meetings');
        setImageUrls(prev => [...prev, secureUrl]);
        setUploadProgress(prev => ({ ...prev, [fileIdx]: 100 }));
      }
    } catch (err: any) {
      alert(`이미지 업로드 오류: ${err.message}`);
    } finally {
      setIsSubmitting(false);
      setUploadProgress({});
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || !auth.currentUser || isSubmitting) return;
    if (!meetingDate) return alert('모임 날짜를 입력해주세요.');
    if (!deadline) return alert('참석 마감일을 입력해주세요.');
    if (!locationName.trim()) return alert('장소명을 입력해주세요.');

    const meetingDateTs = new Date(meetingDate);
    const deadlineTs = new Date(deadline);
    if (deadlineTs >= meetingDateTs) return alert('참석 마감일은 모임 날짜보다 이전이어야 합니다.');

    setIsSubmitting(true);
    try {
      const data: Record<string, any> = {
        channelId: 'meetings',
        authorId: auth.currentUser.uid,
        title: title.trim(),
        content: content.trim(),
        meetingType,
        meetingDate: meetingDateTs,
        registrationDeadline: deadlineTs,
        maxAttendees: parseInt(maxAttendees) || 0,
        locationName: locationName.trim(),
        lat,
        lng,
        geohash: encodeGeohash(lat, lng),
        geoPrefix: getGeoPrefix(encodeGeohash(lat, lng)),
        locationPrivate,
        totalCost: 0,
        attendeesCount: 0,
        imageUrls,
        isActive: true,
        updatedAt: serverTimestamp(),
      };

      if (!editMeeting) {
        data.createdAt = new Date();
        const meetingRef = doc(collection(db, 'meetings'));
        await setDoc(meetingRef, data);
        // ✅ 모임글 등록 시 전역 알림
        sendGlobalNotification({
          userId: auth.currentUser?.uid || '',
          type: 'new_meeting',
          title: '새 모임',
          message: `🎉 ${title.trim()}`,
          postId: meetingRef.id,
          postTitle: title.trim(),
          actorId: auth.currentUser?.uid,
          actorName: auth.currentUser?.displayName || '익명',
          channelId: 'meeting_board',
          url: `${import.meta.env.VITE_APP_URL || ''}/channels/meeting_board`,
        }).catch(console.error);
        updateDoc(doc(db, 'users', auth.currentUser.uid), { xp: increment(50), updatedAt: new Date() }).catch(() => {});
      } else {
        const { authorId, channelId, createdAt, attendeesCount, totalCost, isActive, ...updateData } = data;
        await updateDoc(doc(db, 'meetings', editMeeting.id), updateData);
      }
      showToast(editMeeting ? '모임이 수정되었습니다! ✏️' : '모임이 등록되었습니다! 🎉', 'success');
      onSaved?.();
      onClose();
    } catch (err: any) {
      showToast(`오류: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isUploading = Object.keys(uploadProgress).length > 0;

  return (
    <div
      className="fixed inset-0 z-[30000] flex items-start justify-center bg-slate-900/50 backdrop-blur-sm p-0 md:items-center md:p-4"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: keyboardInset ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)' }}
    >
      <div className="bg-white w-full h-[100dvh] max-h-[100dvh] rounded-none shadow-2xl flex flex-col overflow-hidden md:h-auto md:max-w-2xl md:max-h-[92vh] md:rounded-2xl">
        <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🤝</span>
            <h3 className="font-bold text-lg text-slate-800">{editMeeting ? '모임 수정' : '모임 만들기'}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {/* 모임 종류 */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">모임 종류</label>
            <div className="flex gap-2">
              {MEETING_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => setMeetingType(t.value)}
                  className={`flex-1 py-2.5 rounded-xl border-2 font-bold text-sm transition-all ${meetingType === t.value ? t.color + ' border-current shadow-sm' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* 제목 */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">모임 제목</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 font-bold focus:ring-2 focus:ring-rose-400 focus:outline-none"
              placeholder="모임 제목을 입력하세요" required maxLength={100} />
          </div>

          {/* 날짜 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">📅 모임 날짜/시간</label>
              <input type="datetime-local" value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none" required />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">⏰ 참석 마감일</label>
              <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-800 text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none" required />
            </div>
          </div>

          {/* 최대 인원 */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">최대 인원 (0 = 무제한)</label>
            <input type="number" value={maxAttendees} onChange={e => setMaxAttendees(e.target.value)} min="0"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-slate-800 text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none" />
          </div>

          {/* 장소 */}
          <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-indigo-600 text-sm font-bold">📍 모임 장소</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={locationPrivate} onChange={e => setLocationPrivate(e.target.checked)} className="rounded" />
                  참석자만 위치 공개
                </label>
                <button type="button" onClick={handleGetLocation} disabled={isGeoLoading}
                  className="text-[11px] bg-indigo-500 text-white px-3 py-1 rounded-full font-bold hover:bg-indigo-600 transition-colors disabled:opacity-50">
                  {isGeoLoading ? '위치 확인 중...' : '📡 현재 위치'}
                </button>
              </div>
            </div>
            <input type="text" value={locationName} onChange={e => setLocationName(e.target.value)}
              className="w-full bg-white border border-indigo-200 rounded-lg px-3 py-2 text-slate-800 text-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none"
              placeholder="장소명 (예: 홍대 스타벅스 2층)" required />
            <button type="button" onClick={() => setShowMap(v => !v)} className="text-xs text-indigo-600 font-bold underline">
              {showMap ? '지도 숨기기 🔼' : '🗺️ 지도에서 위치 선택 🔽'}
            </button>
            {showMap && (
              <div className="rounded-xl overflow-hidden border border-indigo-200" style={{ height: 220 }}>
                <MapContainer center={[lat, lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
                  <Marker position={[lat, lng]} />
                  <MapClickHandler onSelect={(la, lo) => { setLat(la); setLng(lo); }} />
                </MapContainer>
              </div>
            )}
            <p className="text-[10px] text-indigo-400 font-medium">🖱️ 클릭해서 정확한 위치 지정 | 좌표: {lat.toFixed(4)}, {lng.toFixed(4)}</p>
          </div>

          {/* 내용 */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">모임 소개</label>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none resize-none min-h-[120px]"
              placeholder="모임을 자세히 소개해주세요 (준비물, 드레스코드, 일정 등)" required maxLength={2000} />
          </div>

          {/* 이미지 */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">사진 ({imageUrls.length}/3)</label>
            {isUploading && (
              <div className="mb-2 space-y-1">
                {Object.entries(uploadProgress).map(([idx, p]) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${p}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-500 w-8 text-right">{Math.round(p as number)}%</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {imageUrls.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setImageUrls(prev => prev.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-slate-900/70 text-white rounded-full flex items-center justify-center text-xs hover:bg-rose-600">✕</button>
                </div>
              ))}
              {imageUrls.length < 3 && !isUploading && (
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="w-20 h-20 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-400 transition-colors">
                  <span className="text-xl">+</span>
                  <span className="text-[9px] mt-0.5">사진 추가</span>
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
          </div>
        </form>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 bg-slate-50 shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-slate-600 font-medium hover:bg-slate-100 transition-colors text-sm">취소</button>
          <button onClick={handleSubmit} disabled={isSubmitting || !title.trim() || !content.trim() || isUploading}
            className="px-6 py-2 rounded-xl text-white font-bold bg-gradient-to-r from-rose-500 to-orange-400 shadow-md hover:shadow-lg transition-all disabled:opacity-50 text-sm">
            {isSubmitting ? '처리 중...' : editMeeting ? '수정 완료 ✏️' : '모임 만들기 🎉'}
          </button>
        </div>
      </div>
    </div>
  );
}
