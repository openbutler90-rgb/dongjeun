# MEMORY.md - 장기 기억

## 프로젝트: 동전커피 (Community Platform)

### 핵심 아키텍처
- **Frontend**: React + Vite + TailwindCSS
- **Backend**: Firebase (Firestore, Auth)
- **Image Storage**: Cloudinary (2026-05-16 전환)

### 주요 변경 이력
- **2026-05-16**: Firebase Storage에서 Cloudinary로 이미지 저장소 전환. 
    - 이유: 비용 절감 및 카드 등록 회피.
    - 설정: `cloud_name: dpxw6gtiz`, `upload_preset: dongjeoncoffee` (Unsigned).
    - 대상: 게시글, 모임, 프로필, 관리자 배너.

### 배운 점 및 주의 사항
- Firebase Storage는 소규모 프로젝트에서 카드 등록이 필수적일 수 있으나, Cloudinary는 Unsigned 업로드로 간단히 대체 가능함.
- 프로필 이미지를 Base64로 Firestore에 저장하면 문서 크기 제한(1MB)에 걸릴 위험이 있으므로, 외부 URL 방식이 권장됨.
