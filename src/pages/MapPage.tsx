import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Link, useNavigate } from 'react-router';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useAuthStore } from '../stores/authStore';

// 커스텀 마커 아이콘
const createCustomIcon = (emoji: string, color: string) => L.divIcon({
  className: 'custom-leaflet-icon',
  html: `<div style="background:white;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-size:20px;border:2.5px solid ${color};">${emoji}</div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 38],
  popupAnchor: [0, -40],
});

const CHANNEL_META: Record<string, { label: string; emoji: string; color: string }> = {
  hotplace:      { label: '핫플레이스', emoji: '📍', color: '#f43f5e' },
  restaurants:   { label: '맛집',       emoji: '🍽️', color: '#f97316' },
  spots:         { label: '인생샷 스팟', emoji: '📸', color: '#8b5cf6' },
  accommodation: { label: '숙소',       emoji: '🏨', color: '#3b82f6' },
};

const ICONS = Object.fromEntries(
  Object.entries(CHANNEL_META).map(([k, v]) => [k, createCustomIcon(v.emoji, v.color)])
);

const LOCATION_CHANNELS = ['hotplace', 'restaurants', 'spots', 'accommodation'];

export function MapPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const { profile } = useAuthStore();
  const navigate = useNavigate();
  const isGuest = profile?.role === 'guest';

  // ✅ onSnapshot으로 실시간 업데이트 (getDocs 1회 조회 → 실시간 스트림으로 교체)
  useEffect(() => {
    setLoading(true);
    // 위치 채널 게시물만 구독
    const q = query(
      collection(db, 'posts'),
      where('channelId', 'in', LOCATION_CHANNELS)
    );

    const unsub = onSnapshot(q, snap => {
      const locs: any[] = [];
      snap.docs.forEach(d => {
        const data = d.data({ serverTimestamps: 'estimate' });
        // ✅ lat/lng가 실제 좌표인 경우만 (0이 아닌 경우)
        if (data.lat && data.lng && data.lat !== 0 && data.lng !== 0) {
          locs.push({ id: d.id, ...data });
        }
      });
      setLocations(locs);
      setLoading(false);
    }, err => {
      console.error('MapPage onSnapshot error:', err);
      setLoading(false);
    });

    return unsub;
  }, []);

  const filteredLocations = locations.filter(loc =>
    selectedCategory === 'all' || loc.channelId === selectedCategory
  );

  const totalWithCoords = locations.length;

  return (
    <div className="h-full flex flex-col bg-slate-50 relative">
      {/* 헤더 - z-[1000]으로 Leaflet(z-800)보다 위에 표시 */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex flex-row flex-nowrap justify-between items-center gap-3 relative z-[1000] shadow-sm">
        <div className="min-w-0 flex-1">
          <h2 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2 truncate">
            🗺️ 동전커피 전국 지도
          </h2>
          <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 truncate">
            {loading ? '로딩 중...' : (
              totalWithCoords > 0
                ? `총 ${totalWithCoords}개의 핀이 등록되어 있어요`
                : '아직 지도에 표시된 장소가 없어요 — 게시물 작성 시 위치 정보를 입력해주세요'
            )}
          </p>
        </div>

        {/* ✅ 카테고리 필터 (버튼 5개 → ⋮ 하나로 통합) */}
        <div className="relative">
          <button
            onClick={() => setShowCategoryMenu(!showCategoryMenu)}
            className="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full transition-all border bg-white text-slate-600 border-slate-300 hover:border-slate-500"
          >
            {selectedCategory === 'all' ? '🗺️ 전체' : `${CHANNEL_META[selectedCategory]?.emoji} ${CHANNEL_META[selectedCategory]?.label}`}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showCategoryMenu && (
            <div className="absolute right-0 top-full mt-1 w-max min-w-[9rem] max-w-[14rem] bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-[10] overflow-hidden">
              <button
                onClick={() => { setSelectedCategory('all'); setShowCategoryMenu(false); }}
                className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors ${selectedCategory === 'all' ? 'bg-slate-100 text-slate-800' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                🗺️ 전체 ({locations.length})
              </button>
              {LOCATION_CHANNELS.map(ch => {
                const meta = CHANNEL_META[ch];
                const count = locations.filter(l => l.channelId === ch).length;
                return (
                  <button
                    key={ch}
                    onClick={() => { setSelectedCategory(ch); setShowCategoryMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors ${selectedCategory === ch ? 'bg-slate-100 text-slate-800' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {meta.emoji} {meta.label} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 지도 */}
      <div className="flex-1 relative z-0">
        {/* 게스트용 오버레이 */}
        {isGuest && (
          <div className="absolute inset-0 bg-slate-200 flex items-center justify-center" style={{ filter: 'blur(3px)', transform: 'scale(1.05)', zIndex: 10 }}>
            <div className="w-full h-full bg-gradient-to-br from-blue-100 via-green-50 to-blue-200 opacity-80" />
          </div>
        )}
        
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100">
            <div className="animate-pulse flex flex-col items-center">
              <div className="w-12 h-12 bg-indigo-200 rounded-full mb-4"></div>
              <p className="text-slate-500 font-bold">지도 데이터를 불러오는 중..</p>
            </div>
          </div>
        ) : (
          <MapContainer
            center={[36.5, 127.5]}
            zoom={7}
            style={{ height: '100%', width: '100%', zIndex: 0, pointerEvents: isGuest ? 'none' : 'auto' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {filteredLocations.map(loc => {
              const meta = CHANNEL_META[loc.channelId] || CHANNEL_META.hotplace;
              const icon = ICONS[loc.channelId] || ICONS.hotplace;
              return (
                <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={icon}>
                  <Popup className="custom-popup" minWidth={180}>
                    <div className="w-48">
                      {/* 이미지 */}
                      {(loc.imageUrl || (loc.imageUrls && loc.imageUrls[0])) && (
                        <img
                          src={loc.imageUrl || loc.imageUrls[0]}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-full h-24 object-cover rounded-lg mb-2"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}

                      {/* 뱃지 */}
                      <div className="flex items-center gap-1 mb-1 flex-wrap">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {meta.emoji} {meta.label}
                        </span>
                        {loc.region && (
                          <span className="text-[10px] text-slate-400">{loc.region}</span>
                        )}
                      </div>

                      <h3 className="font-bold text-slate-800 text-sm mb-1 line-clamp-2">{loc.title}</h3>

                      {/* ✅ 주소 → 클릭 시 카카오맵 */}
                      {loc.locationName && (
                        <a
                          href={`https://map.kakao.com/link/search/${encodeURIComponent(loc.locationName)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 font-bold px-2 py-1 rounded-lg mb-2 text-center hover:bg-yellow-100 transition-colors"
                        >
                          🗺️ {loc.locationName}
                        </a>
                      )}

                      {/* 게시물 보기 */}
                      <button
                        onClick={() => {
                          sessionStorage.setItem('openPostId', loc.id);
                          navigate(`/channels/${loc.channelId}`);
                        }}
                        className="block w-full text-center bg-slate-900 text-white text-sm font-black py-2.5 rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
                      >
                        게시물 보기 →
                      </button>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>
        )}
        
        {/* 게스트 오버레이 메시지 */}
        {isGuest && (
          <div className="absolute inset-0 flex items-center justify-center z-20">
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl p-8 shadow-2xl text-center max-w-sm">
              <span className="text-6xl block mb-4">🗺️</span>
              <h3 className="text-xl font-black text-slate-800 mb-2">정회원 전용 지도</h3>
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                맛집, 핫플레이스, 숙소 위치 정보는<br/>가입 승인 후 확인하실 수 있습니다.
              </p>
              <button
                onClick={() => navigate('/channels/join_request')}
                className="w-full py-3 bg-gradient-to-r from-rose-500 to-orange-400 text-white font-bold rounded-xl hover:opacity-90 transition-opacity"
              >
                📝 가입신청 진행하기
              </button>
            </div>
          </div>
        )}

        {/* 빈 상태 안내 */}
        {!loading && filteredLocations.length === 0 && !isGuest && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 400 }}>
            <div className="bg-white/90 backdrop-blur-sm border border-slate-200 rounded-2xl shadow-lg p-6 max-w-xs text-center pointer-events-auto">
              <p className="text-3xl mb-3">📍</p>
              <p className="font-bold text-slate-700 mb-1">
                {selectedCategory === 'all' ? '지도에 표시된 장소가 없어요' : `${CHANNEL_META[selectedCategory]?.label} 핀이 없어요`}
              </p>
              <p className="text-xs text-slate-500 mb-3">
                맛집, 핫플, 숙소 게시물 작성 시<br />
                <strong>"현재 위치 자동입력"</strong> 버튼을 눌러<br />
                위치 정보를 추가해주세요!
              </p>
              <Link
                to="/channels/hotplace"
                className="inline-block text-xs bg-indigo-600 text-white font-bold px-4 py-2 rounded-full hover:bg-indigo-700 transition-colors"
              >
                핫플 채널에 게시하기
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* ✅ 접이식 범례 (bottom-right, 클릭 시 펼침/접힘) */}
      <div className="absolute bottom-6 right-4 z-[500]">
        <button
          onClick={() => setShowLegend(!showLegend)}
          className={`w-10 h-10 rounded-full shadow-lg border flex items-center justify-center text-lg transition-all ${showLegend ? 'bg-slate-800 text-white border-slate-800' : 'bg-white/90 backdrop-blur-sm border-slate-200 hover:bg-white'}`}
          title="범례"
        >
          {showLegend ? '✕' : 'ℹ️'}
        </button>
        {showLegend && (
          <div className="absolute bottom-full right-0 mb-2 bg-white/95 backdrop-blur-sm p-3 rounded-xl shadow-xl border border-slate-200 text-xs min-w-[150px]">
            <h4 className="font-bold text-slate-700 mb-2 text-[11px]">📍 카테고리</h4>
            <div className="space-y-2">
              {Object.entries(CHANNEL_META).map(([, meta]) => (
                <div key={meta.label} className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 bg-white rounded-full flex items-center justify-center flex-shrink-0 text-sm shadow-sm"
                    style={{ border: `2.5px solid ${meta.color}` }}
                  >
                    {meta.emoji}
                  </div>
                  <span className="text-slate-600 font-medium">{meta.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
