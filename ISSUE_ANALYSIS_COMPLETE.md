# 동전커피 AI 집사 & 지도/이미지 기능 종합 분석 보고서

> **작성일**: 2026-06-03
> **분석 대상**: AI 집사(루이) 장소 추천 → 게시물 생성 → 지도 표시 전체 흐름

---

## 1. 전체 데이터 흐름도

```
사용자: "성수동 핫플 추천해줘"
  ↓
[1] Gemini AI → 장소 추천 JSON 생성
      └─ title: "성수동 감성 카페" (모호: 상호명/주소 없음)
      └─ locationName: "성수동" (지역명만)
      └─ imageUrls: [] (AI가 직접 이미지 URL 생성 못 함)
  ↓
[2] enrichRecommendations (AiAssistant.tsx / louisTaskManager.ts)
      ├─ splitKoreanPlaceAddress("성수동 감성 카페")
      │    └─ placeName: "성수동 감성 카페", address: "", region: ""
      ├─ resolveKoreanPlace("성수동 감성 카페")
      │    ├─ /api/place/resolve → 실패
      │    ├─ 카카오 SDK keywordSearch → 실패 (실제 장소명 아님)
      │    ├─ 카카오 주소 검색 → 실패
      │    └─ OSM (OpenStreetMap) → 실패
      │         └─ toResolvedLinkOnly() 반환
      │              ├─ lat: 0, lng: 0
      │              ├─ address: "", roadAddress: ""
      │              ├─ source: 'link-only'
      │              └─ kakaoMapUrl: "https://map.kakao.com/?q=성수동+감성+카페"
      ├─ searchNaverPlaceImages("성수동 감성 카페")
      │    └─ 네이버 이미지 검색 결과 3~8장 확보 ✅
      │    └─ usableImageUrl 필터 통과 → 2~6장 정제 ✅
      └─ 최종 RecommendationItem:
           ├─ imageUrls: ["url1", "url2", "url3"] (3장 확보) ✅
           ├─ imageUrl: "url1" (1장)
           ├─ locationName: "" (비어있음!) ❌
           ├─ mapUrl: "https://map.kakao.com/?q=성수동+감성+카페"
           ├─ lat: 0, lng: 0 ❌
           └─ placeVerified: false
  ↓
[3] handleUpload (AiAssistant.tsx: 게시 버튼)
      ├─ firstRealRecommendationImage(cardImages, deepSearch, rec.imageUrls, rec.imageUrl)
      │    └─ "url1" 1장만 반환 ❌ (3장 중 1장만 취함)
      ├─ isDuplicateLocation check
      │    └─ locationName이 ""라서 체크 실질적으로 무효
      ├─ DB 저장:
      │    ├─ imageUrl: "url1" (1장)
      │    ├─ imageUrls: ["url1"] (배열에도 1장) ❌
      │    ├─ locationName: "" (비어있음) ❌
      │    ├─ lat: 0, lng: 0 ❌
      │    ├─ mapUrl: "https://map.kakao.com/?q=성수동+감성+카페"
      │    └─ region: ""
      └─ navigate(`/channels/${channelId}`)
  ↓
[4] PostList.tsx (목록 화면)
      ├─ firstUsableImageUrl(post.imageUrl, post.imageUrls)
      │    └─ "url1" 1장만 썸네일 표시
      └─ 목록 UI: 썸네일 1장 + 제목
  ↓
[5] 게시물 상세 보기
      ├─ imageUrls.map() → ["url1"] → 이미지 1장만 표시 ❌
      ├─ locationName이 "" → "📍 위치:" 항목 완전히 누락 ❌
      ├─ mapUrl 링크: "🗺️ 지도보기" 버튼
      │    └─ 클릭 → 카카오맵 검색 URL
      │         └─ "게시물이 비어있다" 또는 검색 결과 없음 ❌
      └─ sourceLinks: 네이버/카카오 검색 URL만 있음
  ↓
[6] MapPage.tsx (지도)
      ├─ onSnapshot으로 posts 구독
      ├─ data.lat !== 0 && data.lng !== 0 필터
      │    └─ lat=0, lng=0 → 이 게시물은 완전히 누락 ❌
      └─ 지도에 핀이 안 보임
```

---

## 2. 🚨 문제 요약 (3가지 삼중 죽음)

### ❌ 문제 A: 이미지 — 3장 가져오는데 1장만 저장

| 단계 | 개수 | 파일/함수 |
|------|------|----------|
| 네이버 검색 | ~8장 | `searchNaverPlaceImages()` |
| 정제/필터 | ~3-6장 | `usableImageUrl()` 필터 |
| AI enrich 저장 | 최대 6장 | `louisTaskManager.ts:enrichRecommendation()` |
| **게시 저장** | **1장** | `AiAssistant.tsx:handleUpload()` ❌ |
| DB imageUrls | ["url1"] | Firestore posts 문서 |
| 목록/상태 표시 | 1장 | `PostList.tsx` |

**원인 코드**:
```typescript
// AiAssistant.tsx:558-563
let imageUrl = firstRealRecommendationImage(
  cardImages[recKey], deepSearch[recKey]?.images, 
  rec.imageUrls, rec.imageUrl
);
// ...
imageUrl,                              // ← 1개 string
imageUrls: imageUrl ? [imageUrl] : [], // ← 배열에도 1개만
```

`firstRealRecommendationImage`는 "첫 번째 실제 이미지"만 반환합니다. 3장이 있어도 무조건 1장.

---

### ❌ 문제 B: 주소 — locationName이 비어있음

| 상황 | locationName | 원인 |
|------|-------------|------|
| AI가 "성수동 감성 카페" 생성 | `""` | splitKoreanPlaceAddress가 주소 분리 못 함 |
| resolveKoreanPlace 실패 | `""` | 실제 장소 검색 실패 → link-only |
| link-only fallback | `""` | `toResolvedLinkOnly()`가 `name: keyword`만 설정 |
| 게시물에 표시 | `"📍 위치:"` 항목 없음 | handleUpload가 빈 문자열 그대로 저장 |

**결과**: 사용자가 게시물을 봐도 **어디인지 모름**

---

### ❌ 문제 C: 지도 — 핀 완전 누락 + 링크 실패

| 항목 | 현상 | 원인 |
|------|------|------|
| 지도 핀 | ❌ 없음 | MapPage가 lat=0인 게시물 필터링 |
| 카카오맵 링크 | "게시물 비어있다" | 키워드가 실제 장소명이 아님 |
| 네이버맵 링크 | 검색 결과 없음 | 모호한 키워드 |

---

## 3. 현재 "정상 작동"하는 경우 (반대 케이스)

AI가 **구체적 상호명 + 주소**를 생성하면:

```
사용자: "연남동 탬버린즈 카페 알려줘"
  ↓
AI → title: "탬버린즈", locationName: "서울 마포구 연남동 239-11"
  ↓
splitKoreanPlaceAddress → placeName: "탬버린즈", address: "서울 마포구 연남동 239-11", region: "서울"
  ↓
resolveKoreanPlace("탬버린즈 서울 마포구 연남동 239-11")
  ├─ 카카오 검색 → 탬버린즈 장소 결과
  ├─ lat: 37.5634, lng: 126.9235 ✅
  ├─ address: "서울 마포구 연남동 239-11"
  └─ source: 'kakao'
  ↓
imageUrls: ["url1", "url2", "url3"] (네이버 검색으로 3장 확보)
  ↓
handleUpload → DB 저장
  ├─ lat, lng: 실제 좌표 ✅
  ├─ locationName: "서울 마포구 연남동 239-11" ✅
  ├─ imageUrls: ["url1"] (여전히 1장) ❌
  └─ mapUrl: 카카오맵 상세 장소 URL ✅
  ↓
지도: 핀 표시됨 ✅
링크: 카카오맵 상세 페이지 정상 작동 ✅
주소: "📍 서울 마포구 연남동 239-11" 표시됨 ✅
```

**핵심**: AI가 구체적 주소를 넣어주면 거의 다 정상. 문제는 AI가 **자주 모호하게 답변**한다는 것.

---

## 4. 완벽해지려면 필요한 작업

### A. 이미지 1→3장 저장

| 파일 | 변경 | 내용 |
|------|------|------|
| `AiAssistant.tsx:handleUpload` | 수정 | `imageUrls: usableImages.slice(0, 3)` (기존: `[imageUrl]`) |
| `PostList.tsx` | 수정 | 상세 보기에서 `imageUrls` 1~3장 그리드/캐러셀로 표시 |
| `PostList.tsx` | 수정 | 목록 썸네일에 여러 장 있으면 "📸 3장" 배지 |
| `louisTaskManager.ts` | 확인 | 이미 6장까지 확보 중. 변경 불필요 |

**예상 효과**: 맛집 외관/음식, 핫플 풍경/인테리어 등 다양한 시각 정보 제공

---

### B. 주소/위치 fallback (모호한 경우)

| 파일 | 변경 | 내용 |
|------|------|------|
| `placeTools.ts:toResolvedLinkOnly` | 수정 | `address`에 지역명이라도 넣기 (ex: "성수동 근처") |
| `AiAssistant.tsx:handleUpload` | 수정 | `locationName`이 비어있으면 `keyword`나 `title` 저장 |
| `placeTools.ts` | 신규 함수 | `resolveRegionCenter(region)` — 지역명 → 대표 좌표 반환 |
| `placeTools.ts:resolveKoreanPlace` | 수정 | link-only 시에도 지역명 추출 → 지역 대표 좌표 반환 |
| `MapPage.tsx` | 수정 | `lat=0` 게시물도 포함시키되, UI로 "대략적 위치" 표시 |

**예상 효과**: 모호한 키워드라도 지역 중심에 핀 표시, 사용자가 "아 여기 쯤이구나" 파악 가능

---

### C. 링크 실패 방지 (UI 기대치 관리)

| 파일 | 변경 | 내용 |
|------|------|------|
| `PostList.tsx` | 수정 | `placeVerified: false`일 때 "🗺️ 주변 검색하기" (기존: "지도보기") |
| `PostList.tsx` | 수정 | `locationName` 없을 때 "📍 위치 정보 확인 중" 표시 |
| `MapPage.tsx` | 수정 | 핀이 대략적 위치일 때 회색/반투명 핀으로 구분 |

**예상 효과**: 사용자가 링크 클릭했는데 "게시물 비어있다" 보는 것 방지

---

### D. 근본 해결 (AI 프롬프트)

| 파일 | 변경 | 내용 |
|------|------|------|
| `gemini/prompts.ts` | 수정 | generateRecommendations 프롬프트에 "상호명+주소 필수" 지시 추가 |

**예상 효과**: AI가 "감성 카페" → "성수동 카페 OOO (서울 성동구 성수이로 123)"처럼 구체적으로 생성

---

## 5. 📊 현재 vs 완벽 비교

| 시나리오 | 현재 | 완벽 | 개선점 |
|----------|------|------|--------|
| AI: "성수동 핫플" | 이미지 1장, 주소 없음, 지도 없음, 링크 실패 | 이미지 3장, "성수동 근처", 성수동 중심 핀, "주변 검색" 링크 | A+B+C |
| AI: "연남동 탬버린즈" | 이미지 1장, 주소 정확, 지도 핀 정상, 링크 정상 | 이미지 3장, 주소 정확, 지도 핀 정상, 링크 정상 | A만 |
| 사용자 직접 작성 | 위치 입력하면 정상 | 위치 입력하면 정상 | - |

---

## 6. 🎯 우선순위 제안

| 순위 | 작업 | 난이도 | 효과 |
|------|------|--------|------|
| 1 | 이미지 1→3장 저장 | 낮음 | 즉각적 UX 향상 |
| 2 | locationName 비었을 때 title/keyword 저장 | 낮음 | 주소 누락 해결 |
| 3 | 지역 대표 좌표 fallback | 중간 | 지도 누락 해결 |
| 4 | UI 문구 변경 ("지도보기" → "주변 검색") | 낮음 | 사용자 기대치 관리 |
| 5 | AI 프롬프트 강화 | 낮음 | 근본적 개선 |
| 6 | 지도 핀 색상 구분 (정확/대략적) | 중간 | 시각적 구분 |

---

## 7. 💡 종합 판정

**현재 상태**: AI가 구체적 주소를 생성하면 정상 작동. 모호한 키워드일 때만 문제 발생.

**완벽해지려면**: 위 6가지 작업 모두 필요. 하지만 **1, 2, 4번만 해도 80% 개선**됩니다.

**작업 예상 시간**: 
- 1, 2, 4, 5번: 약 30분
- 3, 6번 포함: 약 1시간 30분

모두 수정하고 배포(승격)까지 진행할까요?

---

*마지막 업데이트: 2026-06-03*
