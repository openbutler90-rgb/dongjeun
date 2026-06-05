import express from "express";
import path from "path";
import { readFileSync } from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
Showing lines 364 to 470
import {
  getFirestore,
  doc,
  updateDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

// round-robin 클라이언트 모듈에서 retryGemini 및 extractText 재사용
import { retryGemini, extractText } from "./src/lib/gemini/client";

// Firebase App SDK 초기화 (서버 사이드 백그라운드 태스크용)
const firebaseConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf-8")
);
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

async function startServer() 
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ─── 기존 AI 집사 API ───

  app.post("/api/ai/generate-reply", async (req, res) => {
    try {
      const { postTitle, postContent, commentContent } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
      }
      }

      const ai = new GoogleGenAI({ apiKey });
      const 
// MISSING LINE 49
// MISSING LINE 50
// MISSING LINE 51

Write a friendly, engaged, and brief reply to the user's comment, acting as a helpful community manager. 
Do NOT refer to yourself in the third person or use your name 'AI 집사' within your sentence (e.g. absolutely DO NOT SAY "AI집사도..."). Instead, use the first-person pronouns "저" or "저도".
Do NOT use markdown code blocks or JSON. Just write the plain text reply. Keep it under 2 sentences.`;

      const response = await ai.models.generateContent({

      const response = await ai.models.generateContent({
      });
// MISSING LINE 61
      });

// MISSING LINE 64
// MISSING LINE 65
- 기존 클라이언트에서 직접 생성하던 로직을 삭제하고 서버 API `/api/webtoon/plan-project`를 호출하도록 전면 수정.
- 기획 시작 후, Firestore 문서의 `progressMsg` 및 `status`를 `onSnapshot`으로 실시간 감지하여 원형 프로그레스 바나 단계별 체크리스트 UI를 노출.


- 에피소드 상세 뷰어 화면에서 `cut.dialogues` 배열이 감지되면 해당 텍스트를 이미지 위에 **공식 만화 말풍선 디자인**으로 오버레이 렌더링.
- 에피소드가 백그라운드 생성 중인 경우, 뷰어 화면 진입 시 "현재 N번째 컷 이미지 그리는 중..." 과 같은 진행 상태 카드 노출.
- 프로젝트 전체 정보에 포함된 `seasonsPlot`, `selectedSeasonPlot` 등을 탭 레이아웃(Tab Layout)으로 나누어 상세 보기 제공.

---

## 🧪 검증 계획 (Verification Plan)

### 1. 기획/에피소드 백그라운드 생성 동작 검증
- 웹 브라우저에서 웹툰 프로젝트 기획 버튼을 누른 후, 브라우저 탭을 닫거나 다른 페이지로 이동했다가 다시 돌아왔을 때 Firestore에 기획 자료가 완벽하게 들어차 있고 상태가 `completed`로 완결되어 있는지 확인.

### 2. 말풍선 오버레이 렌더링 검증
- 생성된 각 컷에 설정된 대사가 이미지 위의 상/하/좌/우 지정 위치에 정상적으로 겹쳐서 나오는지, 꼬리가 적절히 어우러지는지 반응형 크기(모바일/PC) 테스트.

### 3. 권한 보안 검증
- 일반 회원 권한 계정으로 기획 또는 에피소드 생성 API를 임의 호출했을 때, `403 Forbidden` 에러를 응답하며 동작이 차단되는지 검증.

      contents.push({
// MISSING LINE 88
// MISSING LINE 89
The above content does NOT show the entire file contents. If you need to view any lines of the file which were not shown to complete your task, call this tool again to view those lines.

      const systemPrompt = `You are an AI assistant for a local community app called '동전커피' ('Coin Coffee'). Your name is 'AI 집사' (AI Butler).
You converse with the user and recommend places (hotplaces, restaurants, photo spots, etc.).
// MISSING LINE 94
{
// MISSING LINE 96
// MISSING LINE 97
    {
// MISSING LINE 99
// MISSING LINE 100
The above content does NOT show the entire file contents. If you need to view any lines of the file which were not shown to complete your task, call this tool again to view those lines.

The above content does NOT show the entire file contents. If you need to view any lines of the file which were not shown to complete your task, call this tool again to view those lines.

    }
  ]
}
For each recommendation, 'imageKeywords' must be a list of 1 to 5 English visual keywords to represent the place photos.
// MISSING LINE 109
If no specific places are requested or recommended, leave the recommendations array empty.
Do NOT use markdown code blocks like \`\`\`json. Just return the raw JSON object.`;

      const response = await ai.models.generateContent({
// MISSING LINE 114
        contents,
// MISSING LINE 116
// MISSING LINE 117
        }
      });

      const responseText = response.text || "";
      let jsonResponse;
      try {
        jsonResponse = JSON.parse(responseText.replace(/```json/g, "").replace(/```/g, "").trim());
        if (jsonResponse.recommendations) {
// MISSING LINE 126
             rec.imageUrls = [];
             if (rec.imageKeywords && Array.isArray(rec.imageKeywords)) {
// MISSING LINE 129
                 // Add index to avoid duplicate images from loremflickr
// MISSING LINE 131
               });
             } else if (rec.imageKeyword) {
// MISSING LINE 134
             }
             
             // Fallback
             if (rec.imageUrls.length === 0) {
// MISSING LINE 139
             }
             rec.imageUrl = rec.imageUrls[0]; // For backwards compatibility
          });
        }
      } catch (e) {
// MISSING LINE 145
        // Fallback if AI fails to return JSON
        jsonResponse = {
// MISSING LINE 148
// MISSING LINE 149





































































// MISSING LINE 219
세계관: ${worldview}
장르: ${genres?.join(", ") || "일반"}`;

        const seasonRes = await retryGemini({
          contents: [{ role: "user", parts: [{ text: seasonPrompt }] }],
        }, undefined, 'high');
        const seasonsPlot = extractText(seasonRes).trim();

        // [Phase 2] 1시즌 전체 줄거리 집필
        await updateDoc(projectRef, {
          progressMsg: "2단계: 1시즌 전체 줄거리 집필 중...",
        });

        const detailedPlotPrompt = `작성된 전체 시즌 아웃라인을 참고하여, '시즌 1' 동안 전개될 전체 스토리라인을 인물들의 갈등, 감정선 위주로 아주 상세하게 한국어 600~1000자 분량으로 집필해 주세요.
전체 시즌 플롯:
${seasonsPlot}`;

        const detailedPlotRes = await retryGemini({
          contents: [{ role: "user", parts: [{ text: detailedPlotPrompt }] }],
        }, undefined, 'high');
        const selectedSeasonPlot = extractText(detailedPlotRes).trim();

        // [Phase 3] 1시즌 전 에피소드(10화) 시놉시스 구성
        await updateDoc(projectRef, {
          progressMsg: "3단계: 1시즌 총 10화 분량의 각 화별 시놉시스 구성 중...",
        });

        const synopsisPrompt = `시즌 1 전체 줄거리를 참고하여, 총 10화 분량의 각 에피소드별 흥미진진한 제목과 줄거리 시놉시스(각 100자 내외)를 구성하세요.
반드시 아래 JSON 포맷으로만 응답하세요:
{
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "1화 제목",
      "synopsis": "1화 상세 줄거리"
    }
  ]
}

시즌 1 전체 줄거리:
${selectedSeasonPlot}`;

        const synopsisRes = await retryGemini({
          contents: [{ role: "user", parts: [{ text: synopsisPrompt }] }],
 
        const rawEpJson = extractText(synopsisRes).trim();
        let episodesPlot = [];
        try {
         
          const parsed = JSON.parse(
            rawEpJson.replace(/```json/g, "").replace(/```/g, "").trim()
          );
          episodesPlot = parsed.episodes || [];
        } catch {
// MISSING LINE 274
// MISSING LINE 275
// MISSING LINE 276
          }));






















































































  app.post("/api/webtoon/generate-episode", async (req, res) => {
    const { projectId, uid } = req.body;

    const isOperator = await checkOperatorPermission(uid);
    if (!isOperator) {
      return res.status(403).json({ error: "운영자 권한이 없거나 권한 확인에 실패했습니다." });
    }

    // 즉시 응답 반환
    res.json({ status: "processing", message: "에피소드 제작을 시작했습니다." });

    // 백그라운드 스레드 기동
    (async () => {
      const projectRef = doc(db, "posts", projectId);
      try {
        await updateDoc(projectRef, {
          status: "generating_episode",
          progressMsg: "1단계: 에피소드 기획안 및 연출 대본 집필 중...",
        });

        const projectSnap = await getDoc(projectRef);
        if (!projectSnap.exists()) throw new Error("프로젝트를 찾을 수 없습니다.");






































          "position": "top-left"
        }
      ]
    }
  ]
}
분량은 5~8컷으로 구성하세요.`;

        const charPrompts = (meta.characters || [])
          .map(
            (c: any) => `
[캐릭터: ${c.name}]
외모 설정: ${c.visualPrompt || c.description}
`
          )
          .join("");

        const contextText = `
프로젝트 제목: ${projectData.title}
장르: ${meta.genres?.join(", ") || meta.concept}
세계관: ${meta.worldview}
${charPrompts}

이전 줄거리 요약:
${pastEpisodes.map((e: any) => `${e.episodeNumber}화: ${e.title}`).join("\n")}

이번 화(${episodeNumber}화) 시놉시스:
${thisEpSynopsis}
`;

        const response = await retryGemini({
          contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + contextText }] }],
        }, undefined, 'high');

        const responseText = extractText(response).trim();
        const script = JSON.parse(
          responseText.replace(/```json/g, "").replace(/```/g, "").trim()
        );

        if (!script || !script.cuts) {
          throw new Error("콘티 대본 파싱 실패");
        }

        // 이미지 생성 루프
        const baseSeed =
          Array.from(projectId as string).reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) +
          episodeNumber * 10;

















            ...cut,
            imageUrl,
          });
        }

        // Firestore 에피소드 컬렉션 추가
        await updateDoc(projectRef, {
        });

        await addDoc(collection(db, `posts/${projectId}/episodes`), {
          episodeNumber,
          title: script.episode_title || `제 ${episodeNumber}화`,
          cuts: cutsWithImages,
          createdAt: serverTimestamp(),
        });

        await updateDoc(projectRef, {
          status: "completed",
          progressMsg: "에피소드 생성 완료!",
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.error("Episode generation failed:", err);
        await updateDoc(projectRef, {
          status: "completed",
          progressMsg: `에피소드 생성 실패: ${err.message}`,
          updatedAt: serverTimestamp(),
        });
      }
    })();
  });

  // ─── 기존 Vite 서버 및 스태틱 배포 파일 서빙 ───

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
