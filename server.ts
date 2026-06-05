import 'dotenv/config';
import express from "express";
import path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execFile, spawn } from "child_process";
import os from "os";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { createServer as createViteServer } from "vite";
import { initializeApp } from "firebase/app";
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
  where,
  onSnapshot
} from "firebase/firestore";

// round-robin 클라이언트 모듈에서 retryGemini 및 extractText 재사용
import { retryGemini, extractText } from "./src/lib/gemini/client";

const execFileAsync = promisify(execFile);

// Stable Diffusion 프롬프트 가중치/구두점 및 한국어 입력을 보존하기 위한 안전 소독 헬퍼
function cleanPromptText(text: string): string {
  if (!text) return "";
  // 영문 대소문자, 숫자, 한글(자음/모음/완성형), 공백 및 SD 프롬프트 가중치/구조 특수문자 , . - _ ( ) : / [ ] { } + @ 만 허용
  return text.replace(/[^a-zA-Z0-9ㄱ-ㅎ가-힣 ,.\-_():/\[\]{}+@]/g, "").trim();
}

// Firebase App SDK 초기화 (서버 사이드 백그라운드 태스크용)
const firebaseConfig = JSON.parse(
  readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf-8")
);
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// 운영진 권한 체크 헬퍼
async function checkOperatorPermission(uid: string): Promise<boolean> {
  if (!uid) return false;
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      console.warn(`[Operator Check] User ${uid} not readable on local server. Allowing local operator workflow.`);
      return true;
    }
    const userData = userSnap.data();
    return userData.role === "admin" || userData.role === "manager";
  } catch (err) {
    console.error("[Operator Check] Firestore auth/rules check failed on local server. Allowing local operator workflow:", err);
    return true;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json());

  const normalizeBaseUrl = (value: string, fallback: string) => (value || fallback).replace(/\/$/, "");
  const koreanRegionPattern = /(서울특별시|서울|부산광역시|부산|대구광역시|대구|인천광역시|인천|광주광역시|광주|대전광역시|대전|울산광역시|울산|세종특별자치시|세종|경기도|경기|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주)/;
  const detectServerRegion = (...parts: string[]) => {
    const raw = parts.filter(Boolean).join(" ").match(koreanRegionPattern)?.[1] || "";
    if (raw.includes("서울")) return "서울";
    if (raw.includes("부산")) return "부산";
    if (raw.includes("대구")) return "대구";
    if (raw.includes("인천")) return "인천";
    if (raw.includes("광주")) return "광주";
    if (raw.includes("대전")) return "대전";
    if (raw.includes("울산")) return "울산";
    if (raw.includes("세종")) return "세종";
    if (raw.includes("경기")) return "경기";
    if (raw.includes("강원")) return "강원";
    if (raw.includes("충북")) return "충북";
    if (raw.includes("충남")) return "충남";
    if (raw.includes("전북") || raw.includes("전라북")) return "전북";
    if (raw.includes("전남") || raw.includes("전라남")) return "전남";
    if (raw.includes("경북")) return "경북";
    if (raw.includes("경남")) return "경남";
    if (raw.includes("제주")) return "제주";
    return raw;
  };
  const scoreServerPlace = (queryText: string, item: any) => {
    const expectedRegion = detectServerRegion(queryText);
    const expectedName = queryText.replace(koreanRegionPattern, "").replace(/\s+/g, "").trim();
    const haystack = `${item.place_name || item.title || ""} ${item.road_address_name || ""} ${item.address_name || ""}`;
    const compactName = String(item.place_name || item.title || "").replace(/\s+/g, "");
    let score = 0;
    if (expectedRegion && detectServerRegion(haystack) === expectedRegion) score += 80;
    if (expectedRegion && haystack.includes(expectedRegion)) score += 20;
    if (expectedName && compactName.includes(expectedName)) score += 50;
    if (expectedName && expectedName.includes(compactName)) score += 30;
    if (item.road_address_name) score += 5;
    return score;
  };
  const generatedDir = path.join(process.cwd(), "public", "generated", "local-ai");
  const saveGeneratedImage = (base64OrBuffer: string | ArrayBuffer, ext = "png") => {
    mkdirSync(generatedDir, { recursive: true });
    const filename = `${Date.now()}-${randomUUID()}.${ext}`;
    const filePath = path.join(generatedDir, filename);
    const buffer = typeof base64OrBuffer === "string"
      ? Buffer.from(base64OrBuffer.replace(/^data:image\/\w+;base64,/, ""), "base64")
      : Buffer.from(base64OrBuffer);
    writeFileSync(filePath, buffer);
    return `/generated/local-ai/${filename}`;
  };

  const roundToMultiple = (value: number, unit = 8) => Math.max(unit, Math.round(value / unit) * unit);
  const resolveImageQualityProfile = (preset: string, width: number, height: number, steps: number, cfgScale: number) => {
    const mode = String(preset || "standard").toLowerCase();
    const ratio = width > 0 && height > 0 ? height / width : 1.5;
    if (mode === "ultra" || mode === "webtoon-ultra") {
      const targetW = width >= height
        ? Math.max(width, 1536)
        : Math.max(width, 1200);
      const finalW = roundToMultiple(targetW);
      const finalH = roundToMultiple(finalW * ratio);
      return {
        mode: "ultra",
        finalW,
        finalH,
        baseW: roundToMultiple(Math.min(finalW, width >= height ? 1536 : 1024)),
        baseH: roundToMultiple(Math.min(finalH, width >= height ? 1024 : 1536)),
        steps: Math.max(Number(steps) || 0, 42),
        cfg: Number(cfgScale) || 6.5,
        refineSteps: 24,
        refineDenoise: 0.32,
        stageLabel: "composition -> high-res upscale -> low-denoise detail pass",
      };
    }
    if (mode === "draft") {
      return {
        mode: "draft",
        finalW: roundToMultiple(width),
        finalH: roundToMultiple(height),
        baseW: roundToMultiple(width),
        baseH: roundToMultiple(height),
        steps: Math.max(Number(steps) || 0, 20),
        cfg: Number(cfgScale) || 7,
        refineSteps: 0,
        refineDenoise: 0,
        stageLabel: "single draft pass",
      };
    }
    return {
      mode: "standard",
      finalW: roundToMultiple(width),
      finalH: roundToMultiple(height),
      baseW: roundToMultiple(width),
      baseH: roundToMultiple(height),
      steps: Math.max(Number(steps) || 0, 28),
      cfg: Number(cfgScale) || 7,
      refineSteps: 15,
      refineDenoise: 0.45,
      stageLabel: "base pass -> upscale detail pass",
    };
  };

  const premiumWebtoonPromptPrefix = [
    "masterpiece",
    "best quality",
    "high-end commercial Korean webtoon illustration",
    "premium manhwa rendering",
    "crisp clean lineart",
    "intricate object details",
    "detailed eyes",
    "detailed hands",
    "correct anatomy",
    "polished lighting",
    "cinematic composition",
    "sharp focus",
  ].join(", ");

  const flattenGeminiParts = (parts: any[] = []) =>
    parts.map(part => part?.text || "").filter(Boolean).join("\n");
  const geminiBodyToPrompt = (body: Record<string, any>) => {
    const systemText = flattenGeminiParts(body.system_instruction?.parts || []);
    const contentsText = (body.contents || [])
      .map((content: any) => `${content.role === "model" ? "assistant" : "user"}: ${flattenGeminiParts(content.parts || [])}`)
      .filter((line: string) => line.trim() !== "user:")
      .join("\n\n");
    return [systemText, contentsText].filter(Boolean).join("\n\n");
  };
  const geminiBodyToMessages = (body: Record<string, any>) => {
    const messages: any[] = [];
    const systemText = flattenGeminiParts(body.system_instruction?.parts || []);
    if (systemText.trim()) messages.push({ role: "system", content: systemText });
    (body.contents || []).forEach((content: any) => {
      const text = flattenGeminiParts(content.parts || []);
      if (text.trim()) messages.push({ role: content.role === "model" ? "assistant" : "user", content: text });
    });
    return messages;
  };
  const resolveWebtoonTextModel = (settings: any, task: "scenario" | "character" | "storyboard" | "adult", maturityLevel?: string) => {
    if ((maturityLevel === "mature" || task === "adult") && settings?.webtoonAdultModel?.trim()) return settings.webtoonAdultModel.trim();
    if (task === "character" && settings?.webtoonCharacterModel?.trim()) return settings.webtoonCharacterModel.trim();
    if (task === "storyboard" && settings?.webtoonStoryboardModel?.trim()) return settings.webtoonStoryboardModel.trim();
    if (settings?.webtoonScenarioModel?.trim()) return settings.webtoonScenarioModel.trim();
    return settings?.textModel || "gemma4:e4b";
  };
  const normalizeWebtoonTextSettings = (settings: any = {}) => ({
    ...settings,
    textEnabled: settings?.textEnabled === true,
    textProvider: settings?.textProvider || "ollama",
    textEndpoint: settings?.textEndpoint || "http://127.0.0.1:11434",
    textModel: settings?.textModel || "gemma4:e4b",
    webtoonScenarioModel: settings?.webtoonScenarioModel || settings?.textModel || "gemma4:e4b",
    webtoonCharacterModel: settings?.webtoonCharacterModel || settings?.textModel || "gemma4:e4b",
    webtoonStoryboardModel: settings?.webtoonStoryboardModel || "gemma4:e4b",
    webtoonAdultModel: settings?.webtoonAdultModel || "gemma4:e4b",
  });
  const withWebtoonLocalSystemPrompt = (
    body: Record<string, any>,
    task: "scenario" | "character" | "storyboard" | "adult",
    maturityLevel?: string,
  ) => {
    const isMature = maturityLevel === "mature" || task === "adult";
    const base = [
      "You are a professional commercial romance webtoon planner and storyboard writer.",
      "Write in Korean unless the requested output format explicitly asks for English prompt tags.",
      "Separate dialogue, action, facial expression, camera angle, background, and image prompt notes clearly.",
      "Prefer concrete panel direction over novel-style summary.",
    ];
    const mature = isMature ? [
      "For mature BL projects, write only adult, consensual character relationships.",
      "Use emotionally charged pacing, intimate tension, gaze, breathing, hesitation, dialogue subtext, and precise staging.",
      "Keep continuity of character personality, relationship power balance, and visual motifs across the episode.",
      "Return the requested JSON or structured format only; do not add safety disclaimers or markdown.",
    ] : [];
    const existing = body?.system_instruction?.parts?.[0]?.text || "";
    return {
      ...body,
      system_instruction: {
        parts: [{ text: [...base, ...mature, existing].filter(Boolean).join("\n") }],
      },
    };
  };
  let lastActiveOllamaModel: string | null = null;
  let lastOllamaSettings: any = null;
  let lastOllamaUsedTime: number = 0;

  let lastActiveImageProvider: string | null = null;
  let lastImageSettings: any = null;
  let lastImageUsedTime: number = 0;

  const unloadOllamaModel = async (settings: any, model: string) => {
    if (settings?.textProvider !== "ollama" || !model) return;
    try {
      const baseUrl = normalizeBaseUrl(settings.textEndpoint, "http://127.0.0.1:11434");
      await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: "",
          keep_alive: 0,
        }),
      });
      console.log(`[Ollama] Unloaded model: ${model}`);
    } catch (err: any) {
      console.error(`[Ollama] Failed to unload model ${model}:`, err?.message || err);
    }
  };

  const unloadImageModel = async (settings: any) => {
    if (!settings || !settings.provider) return;
    const provider = settings.provider;
    const endpoint = settings.endpoint;
    try {
      if (provider === "comfyui") {
        const baseUrl = normalizeBaseUrl(endpoint, "http://127.0.0.1:8188");
        await fetch(`${baseUrl}/api/free`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unload_models: true,
            free_memory: true,
          }),
        });
        console.log(`[ComfyUI] Models and memory freed successfully.`);
      } else if (provider === "forge") {
        const baseUrl = normalizeBaseUrl(endpoint, "http://127.0.0.1:7860");
        await fetch(`${baseUrl}/sdapi/v1/unload-checkpoint`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        console.log(`[Forge] Checkpoint unloaded successfully.`);
      }
    } catch (err: any) {
      console.error(`[Image Generator] Failed to unload model for ${provider}:`, err?.message || err);
    }
  };

  const triggerVramSwitchForImage = async () => {
    if (lastActiveOllamaModel && lastOllamaSettings) {
      console.log(`[VRAM Switch] Image generation requested. Force unloading LLM model: ${lastActiveOllamaModel}`);
      const modelToUnload = lastActiveOllamaModel;
      const settingsToUse = lastOllamaSettings;
      lastActiveOllamaModel = null;
      lastOllamaSettings = null;
      await unloadOllamaModel(settingsToUse, modelToUnload).catch(() => {});
    }
  };

  const triggerVramSwitchForText = async () => {
    if (lastActiveImageProvider && lastImageSettings) {
      console.log(`[VRAM Switch] Text LLM requested. Force unloading Image Generator: ${lastActiveImageProvider}`);
      const settingsToUse = lastImageSettings;
      lastActiveImageProvider = null;
      lastImageSettings = null;
      await unloadImageModel(settingsToUse).catch(() => {});
    }
  };

  setInterval(async () => {
    const now = Date.now();
    
    // 1. Ollama LLM Auto-Unload (5 minutes idle)
    if (lastActiveOllamaModel && lastOllamaSettings) {
      if (now - lastOllamaUsedTime >= 5 * 60 * 1000) {
        console.log(`[Ollama Scheduler] 5 minutes idle. Automatically unloading model: ${lastActiveOllamaModel}`);
        const modelToUnload = lastActiveOllamaModel;
        const settingsToUse = lastOllamaSettings;
        lastActiveOllamaModel = null;
        lastOllamaSettings = null;
        await unloadOllamaModel(settingsToUse, modelToUnload).catch(() => {});
      }
    }

    // 2. Image Generator Auto-Unload (5 minutes idle)
    if (lastActiveImageProvider && lastImageSettings) {
      if (now - lastImageUsedTime >= 5 * 60 * 1000) {
        console.log(`[Image Generator Scheduler] 5 minutes idle. Automatically unloading model: ${lastActiveImageProvider}`);
        const settingsToUse = lastImageSettings;
        lastActiveImageProvider = null;
        lastImageSettings = null;
        await unloadImageModel(settingsToUse).catch(() => {});
      }
    }
  }, 30000);

  // Webtoon 작업 과정 로그 업데이트를 위한 헬퍼 함수
  const updateWorkLog = async (
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
        startedAt: index >= 0 ? currentLogs[index].startedAt : Date.now(),
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

  const callWebtoonText = async (
    settings: any,
    body: Record<string, any>,
    task: "scenario" | "character" | "storyboard" | "adult",
    maturityLevel?: string,
    signal?: AbortSignal,
  ) => {
    const localSettings = normalizeWebtoonTextSettings(settings);
    // 브로맨툰은 운영자 로컬 설정을 우선한다. Gemini는 명시 선택 또는 로컬 비활성일 때만 사용한다.
    const useGemini = settings?.textProvider === "gemini" || !settings?.textEnabled;

    if (useGemini) {
      console.log(`[Webtoon Text] Routing task "${task}" to Gemini API (High priority)...`);
      try {
        const routedBody = withWebtoonLocalSystemPrompt(body, task, maturityLevel);
        const response = await retryGemini(routedBody, signal, "high");
        const text = extractText(response).trim();
        return {
          __dongjeonAiSource: { type: "gemini", provider: "gemini", model: "gemini-3.5" },
          candidates: [{ content: { parts: [{ text }] } }],
        };
      } catch (err: any) {
        if (err?.name === "AbortError" || signal?.aborted) throw err;
        console.error(`[Webtoon Text] Gemini routing failed for task "${task}":`, err?.message || err);
        console.log(`[Webtoon Text] Falling back to Local LLM for task "${task}"...`);
      }
    }

    // 2. 그 외의 경우(대본 콘티 등)는 로컬 LLM을 호출하고 VRAM에 5분간 Keep-alive 적용
    const model = resolveWebtoonTextModel(localSettings, task, maturityLevel);
    const routedBody = withWebtoonLocalSystemPrompt(body, task, maturityLevel);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/local-ai/text/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: localSettings.textProvider,
          endpoint: localSettings.textEndpoint,
          model,
          prompt: geminiBodyToPrompt(routedBody),
          messages: geminiBodyToMessages(routedBody),
          keep_alive: "5m",
        }),
        signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.text) throw new Error(data?.error || `Local LLM HTTP ${response.status}`);

      // Ollama 사용 상태 업데이트
      if (localSettings?.textProvider === "ollama") {
        lastActiveOllamaModel = model;
        lastOllamaSettings = localSettings;
        lastOllamaUsedTime = Date.now();
      }

      return {
        __dongjeonAiSource: { type: "local", provider: localSettings.textProvider, model },
        candidates: [{ content: { parts: [{ text: data.text }] } }],
      };
    } catch (err) {
      throw err;
    }
  };
  const applyComfyWorkflowPlaceholders = (
    value: any,
    replacements: Record<string, string | number>,
  ): any => {
    if (typeof value === "string") {
      return Object.entries(replacements).reduce((next, [key, replacement]) => {
        if (next === key && typeof replacement === "number") return replacement as any;
        if (typeof next !== "string") return next;
        return next.split(key).join(String(replacement));
      }, value as any);
    }
    if (Array.isArray(value)) return value.map(item => applyComfyWorkflowPlaceholders(item, replacements));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, applyComfyWorkflowPlaceholders(nested, replacements)])
      );
    }
    return value;
  };

  const readComfyComboChoices = (combo: any) => {
    if (Array.isArray(combo?.[0])) return combo[0].filter(Boolean);
    if (Array.isArray(combo?.[1]?.options)) return combo[1].options.filter(Boolean);
    return [];
  };

  const getComfyUiModels = async (baseUrl: string) => {
    let ckpt_name = "animagineXLV31_v31.safetensors";
    let upscale_name = "";
    let vae_name = "";
    try {
      const ckptRes = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`);
      if (ckptRes.ok) {
        const ckptData: any = await ckptRes.json();
        const choices = readComfyComboChoices(ckptData?.CheckpointLoaderSimple?.input?.required?.ckpt_name);
        if (Array.isArray(choices) && choices.length > 0) {
          const preferredList = [
            "novaAnimeXL",
            "animagine-xl-4.0",
            "animagineXLV31",
            "netaCatTower",
            "toonyou",
            "ghostmix",
            "Juggernaut-XI",
            "RealVisXL",
            "animagine-xl-4.0",
            "animagine",
            "NetaYumev",
            "flux1-schnell",
          ];
          let preferred = "";
          for (const pref of preferredList) {
            const matched = choices.find((c: string) => c.includes(pref));
            if (matched) {
              preferred = matched;
              break;
            }
          }
          ckpt_name = preferred || choices[0];
        }
      }
    } catch (e) {
      console.error("Failed to query comfyui checkpoints", e);
    }

    try {
      const upscaleRes = await fetch(`${baseUrl}/object_info/UpscaleModelLoader`);
      if (upscaleRes.ok) {
        const upscaleData: any = await upscaleRes.json();
        const choices = readComfyComboChoices(upscaleData?.UpscaleModelLoader?.input?.required?.model_name);
        if (Array.isArray(choices) && choices.length > 0) {
          // Prioritize anime/webtoon-specialized models first, then 4x-UltraSharp
          const preferredList = [
            "4x-AnimeSharp",
            "4xNMKDSuperscale",
            "realesrganX4plusAnime",
            "4x_AnimeSharp",
            "RealESRGAN_x4plus_anime_6B",
            "4x_NMKD-UltraYandere",
            "4x_NMKD-Superscale",
            "4x-UltraSharp"
          ];
          let found = "";
          for (const pref of preferredList) {
            const matched = choices.find((c: string) => c.includes(pref));
            if (matched) {
              found = matched;
              break;
            }
          }
          upscale_name = found || choices[0];
        }
      }
    } catch (e) {
      console.error("Failed to query comfyui upscale models", e);
    }

    try {
      const vaeRes = await fetch(`${baseUrl}/object_info/VAELoader`);
      if (vaeRes.ok) {
        const vaeData: any = await vaeRes.json();
        const choices = readComfyComboChoices(vaeData?.VAELoader?.input?.required?.vae_name);
        if (Array.isArray(choices) && choices.length > 0) {
          vae_name = choices.find((c: string) => c.includes("sdxl_vae")) || choices[0];
        }
      }
    } catch (e) {
      console.error("Failed to query comfyui vae models", e);
    }

    return { ckpt_name, upscale_name, vae_name };
  };

  const pinokioConfigPath = path.join(os.homedir(), ".pinokio", "config.json");
  const readPinokioConfig = () => {
    try {
      return JSON.parse(readFileSync(pinokioConfigPath, "utf-8"));
    } catch {
      return {};
    }
  };
  const resolvePterm = () => {
    try {
      const config = readPinokioConfig();
      const home = config.home || "C:\\pinokio";
      const candidates = [
        path.join(home, "bin", "npm", "pterm.cmd"),
        path.join(home, "bin", "npm", "pterm"),
        path.join(home, "bin", "pterm.cmd"),
      ];
      return candidates.find(candidate => existsSync(candidate)) || candidates[0];
    } catch {
      return "C:\\pinokio\\bin\\npm\\pterm.cmd";
    }
  };
  const resolvePinokioExe = () => {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Pinokio", "Pinokio.exe"),
      "C:\\Program Files\\Pinokio\\Pinokio.exe",
    ];
    return candidates.find(candidate => existsSync(candidate)) || candidates[0];
  };
  const resolveOllamaExe = () => {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
      "C:\\Program Files\\Ollama\\ollama.exe",
    ];
    return candidates.find(candidate => existsSync(candidate)) || candidates[0];
  };
  const resolveComfyUi = () => {
    const root = process.env.COMFYUI_USER_DIR || "C:\\ai\\ComfyUI";
    const programRoot = path.join(process.env.LOCALAPPDATA || "", "Programs", "ComfyUI", "resources", "ComfyUI");
    const pythonw = path.join(root, ".venv", "Scripts", "pythonw.exe");
    const python = path.join(root, ".venv", "Scripts", "python.exe");
    const localMain = path.join(root, "main.py");
    const desktopMain = path.join(programRoot, "main.py");
    
    let pythonPath = "python";
    if (existsSync(pythonw)) {
      pythonPath = pythonw;
    } else if (existsSync(python)) {
      pythonPath = python;
    }

    return {
      root,
      programRoot: existsSync(desktopMain) ? programRoot : root,
      python: pythonPath,
      main: existsSync(localMain) ? localMain : desktopMain,
    };
  };
  const waitForHttp = async (url: string, timeoutMs = 30000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) return true;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  };
  const ensureOllamaServer = async () => {
    if (await waitForHttp("http://127.0.0.1:11434/api/tags", 2000)) {
      return { started: false, ready: true };
    }
    const exe = resolveOllamaExe();
    const child = spawn(exe, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    const ready = await waitForHttp("http://127.0.0.1:11434/api/tags", 30000);
    return { started: true, ready };
  };
  const ensureComfyUiServer = async (endpoint = "http://127.0.0.1:8188") => {
    const baseUrl = normalizeBaseUrl(endpoint, "http://127.0.0.1:8188");
    if (await waitForHttp(`${baseUrl}/system_stats`, 2000)) {
      return { started: false, ready: true, readyUrl: baseUrl };
    }
    const comfy = resolveComfyUi();
    if (!existsSync(comfy.main)) {
      throw new Error(`ComfyUI main.py not found: ${comfy.main}`);
    }
    const child = spawn(comfy.python, [
      comfy.main,
      "--listen", "127.0.0.1",
      "--port", "8188",
      "--base-directory", comfy.root,
      "--enable-manager",
    ], {
      cwd: comfy.programRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    const ready = await waitForHttp(`${baseUrl}/system_stats`, 120000);
    return { started: true, ready, readyUrl: baseUrl, root: comfy.root };
  };
  const quoteCmdArg = (value: string) => `"${String(value).replace(/"/g, '\\"')}"`;
  const execPterm = async (args: string[], timeout = 120000) => {
    const command = [quoteCmdArg(resolvePterm()), ...args.map(quoteCmdArg)].join(" ");
    return execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    });
  };
  const spawnPterm = (args: string[]) => {
    const command = [quoteCmdArg(resolvePterm()), ...args.map(quoteCmdArg)].join(" ");
    const child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  };
  const ptermJson = async (args: string[], timeout = 120000) => {
    const { stdout } = await execPterm(args, timeout);
    try {
      return JSON.parse(stdout.trim());
    } catch {
      return stdout.trim();
    }
  };
  const isPinokioControlReady = async () => {
    const config = readPinokioConfig();
    const access = config.access || {};
    const urls = [
      "http://127.0.0.1:42000",
      access.protocol && access.host && access.port ? `${access.protocol}://${access.host}:${access.port}` : "",
    ].filter(Boolean);
    for (const baseUrl of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const response = await fetch(`${baseUrl}/pinokio/path/pterm`, { signal: controller.signal });
        clearTimeout(timer);
        if (response.ok) return true;
      } catch {}
    }
    return false;
  };
  const ensurePinokioControl = async () => {
    if (await isPinokioControlReady()) return { started: false };
    const exe = resolvePinokioExe();
    const child = spawn(exe, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 60000) {
      if (await isPinokioControlReady()) return { started: true };
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error("Pinokio 제어 서버가 아직 준비되지 않았습니다. Pinokio가 처음 켜지는 중이면 잠시 뒤 다시 눌러주세요.");
  };
  const targetToRef = async (target: string) => {
    const fallback: Record<string, string> = {
      ollama: "chatbot-ollama.git",
      openwebui: "open-webui.git",
      forge: "sd-webui-forge.pinokio.git",
      comfyui: "comfy.git",
    };
    const query = target === "forge" ? "stable diffusion forge" : target === "openwebui" ? "open webui" : target === "comfyui" ? "comfyui" : "ollama";
    try {
      const searchResult = await ptermJson(["search", query, "--mode", "balanced", "--min-match", "1", "--limit", "8"], 45000);
      const list = Array.isArray(searchResult) ? searchResult : Array.isArray(searchResult?.results) ? searchResult.results : [];
      const match = list.find((item: any) => {
        const text = `${item?.id || ""} ${item?.title || ""} ${item?.path || ""} ${item?.ref || ""}`.toLowerCase();
        if (target === "forge") return text.includes("forge");
        if (target === "openwebui") return text.includes("open-webui") || text.includes("open webui");
        if (target === "comfyui") return text.includes("comfy");
        return text.includes("ollama");
      }) || list[0];
      return match?.ref || match?.path || fallback[target] || fallback.ollama;
    } catch {
      return fallback[target] || fallback.ollama;
    }
  };
  const getPinokioStatus = async (ref: string) => {
    try {
      return await ptermJson(["status", ref, "--probe"], 45000);
    } catch {
      return null;
    }
  };

  app.post("/api/local-ai/pinokio/start", async (req, res) => {
    const { target } = req.body || {};
    try {
      const requestedTarget = target || "ollama";
      const control = await ensurePinokioControl();
      if (requestedTarget === "ollama") {
        const ollama = await ensureOllamaServer();
        if (ollama.ready) {
          return res.json({
            ok: true,
            target: requestedTarget,
            ref: "ollama.exe",
            pinokioStarted: control.started,
            localServerStarted: ollama.started,
            readyUrl: "http://127.0.0.1:11434",
            status: { state: "online", ready: true },
          });
        }
      }
      const ref = await targetToRef(requestedTarget);
      let status = await getPinokioStatus(ref);
      const isReady = (value: any) => value?.ready === true || value?.state === "online";
      if (!isReady(status)) {
        spawnPterm(["run", ref]);
        const startedAt = Date.now();
        while (Date.now() - startedAt < 30000) {
          status = await getPinokioStatus(ref);
          if (isReady(status)) break;
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
      }
      if (!isReady(status)) {
        return res.json({
          ok: true,
          target: requestedTarget,
          ref,
          starting: true,
          message: "Pinokio 앱 실행을 요청했습니다. 설치/초기 실행 중이면 준비까지 시간이 걸릴 수 있습니다.",
          status,
        });
      }
      res.json({
        ok: true,
        target: requestedTarget,
        ref,
        pinokioStarted: control.started,
        readyUrl: status?.ready_url || status?.external_ready_urls?.[0] || "",
        status,
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || "Pinokio start failed" });
    }
  });

  app.post("/api/local-ai/start", async (req, res) => {
    const { target = "ollama", endpoint } = req.body || {};
    try {
      if (target === "ollama") {
        const result = await ensureOllamaServer();
        return res.json({ ok: result.ready, target, ...result, readyUrl: "http://127.0.0.1:11434" });
      }
      if (target === "comfyui") {
        const result = await ensureComfyUiServer(endpoint || "http://127.0.0.1:8188");
        return res.json({ ok: result.ready, target, ...result });
      }
      return res.status(400).json({ ok: false, error: `Unsupported local target: ${target}` });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || "Local start failed" });
    }
  });

  app.get("/api/place/resolve", async (req, res) => {
    const queryText = String(req.query.query || "").trim();
    const key = process.env.KAKAO_REST_API_KEY || process.env.KAKAO_REST_KEY || "";
    if (!queryText) return res.status(400).json({ ok: false, error: "query is required" });
    if (!key) return res.status(404).json({ ok: false, error: "KAKAO_REST_API_KEY is not configured" });

    try {
      const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(queryText)}&size=10`;
      const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(response.status).json({ ok: false, error: data?.message || `Kakao Local HTTP ${response.status}` });
      const documents = Array.isArray(data?.documents) ? data.documents : [];
      if (!documents.length) return res.json({ ok: false, error: "no place found" });
      const best = [...documents].sort((a, b) => scoreServerPlace(queryText, b) - scoreServerPlace(queryText, a))[0];
      const name = best.place_name || queryText;
      const address = best.address_name || "";
      const roadAddress = best.road_address_name || "";
      const searchKeyword = `${name} ${roadAddress || address}`.trim();
      return res.json({
        ok: true,
        keyword: queryText,
        name,
        address,
        roadAddress,
        lat: Number.parseFloat(best.y) || 0,
        lng: Number.parseFloat(best.x) || 0,
        kakaoMapUrl: best.place_url || `https://map.kakao.com/link/search/${encodeURIComponent(searchKeyword)}`,
        naverMapUrl: `https://map.naver.com/p/search/${encodeURIComponent(searchKeyword)}`,
        source: "kakao-rest",
      });
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: error?.message || "Kakao Local unavailable" });
    }
  });

  app.get("/api/place/naver-images", async (req, res) => {
    const queryText = String(req.query.query || "").trim();
    const clientId = process.env.NAVER_CLIENT_ID || "";
    const clientSecret = process.env.NAVER_CLIENT_SECRET || "";
    if (!queryText) return res.status(400).json({ ok: false, error: "query is required" });
    if (!clientId || !clientSecret) return res.status(404).json({ ok: false, error: "Naver Search API keys are not configured" });

    try {
      const url = `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(queryText)}&display=10&sort=sim`;
      const response = await fetch(url, {
        headers: {
          "X-Naver-Client-Id": clientId,
          "X-Naver-Client-Secret": clientSecret,
        },
      });
      const data: any = await response.json().catch(() => ({}));
      if (!response.ok) return res.status(response.status).json({ ok: false, error: data?.errorMessage || `Naver Image HTTP ${response.status}` });
      const images = (Array.isArray(data?.items) ? data.items : [])
        .flatMap((item: any) => [item.link, item.thumbnail])
        .filter((url: string) => typeof url === "string" && /^https:\/\//.test(url));
      return res.json({ ok: true, images: Array.from(new Set(images)).slice(0, 8) });
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: error?.message || "Naver Image Search unavailable" });
    }
  });

  app.post("/api/local-ai/text/models", async (req, res) => {
    const { provider = "ollama", endpoint } = req.body || {};
    const baseUrl = normalizeBaseUrl(endpoint, provider === "lmstudio" ? "http://127.0.0.1:1234" : "http://127.0.0.1:11434");
    const url = provider === "lmstudio" ? `${baseUrl}/v1/models` : `${baseUrl}/api/tags`;
    try {
      const response = await fetch(url);
      if (!response.ok) return res.status(response.status).json({ error: `Local AI HTTP ${response.status}` });
      const data = await response.json();
      const models = provider === "lmstudio"
        ? (Array.isArray(data?.data) ? data.data.map((model: any) => model?.id).filter(Boolean) : [])
        : (Array.isArray(data?.models) ? data.models.map((model: any) => model?.name).filter(Boolean) : []);
      res.json({ ok: true, models });
    } catch (error: any) {
      res.status(502).json({ ok: false, error: error?.message || "Local AI unavailable" });
    }
  });

  app.post("/api/local-ai/text/chat", async (req, res) => {
    const { provider = "ollama", endpoint, model = "gemma4:e4b", prompt, messages, keep_alive } = req.body || {};
    const baseUrl = normalizeBaseUrl(endpoint, provider === "lmstudio" ? "http://127.0.0.1:1234" : "http://127.0.0.1:11434");
    const upstreamController = new AbortController();
    const timeout = setTimeout(() => upstreamController.abort(), 300000);
    req.on("aborted", () => upstreamController.abort());
    try {
      // 텍스트 생성 시작 시 이미지 생성기를 언로드하여 VRAM 확보
      await triggerVramSwitchForText().catch(() => {});

      if (provider === "ollama") {
        await ensureOllamaServer();
      }
      const url = provider === "lmstudio" ? `${baseUrl}/v1/chat/completions` : `${baseUrl}/api/chat`;
      const finalMessages = messages && messages.length > 0 ? messages : [{ role: "user", content: prompt }];
      const body = provider === "lmstudio"
        ? { model, messages: finalMessages, stream: false, temperature: 0.7 }
        : { model, stream: false, messages: finalMessages, keep_alive: keep_alive !== undefined ? keep_alive : "5m", options: { temperature: 0.7 } };
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: upstreamController.signal,
      });
      if (!response.ok) return res.status(response.status).json({ error: `Local AI HTTP ${response.status}` });
      const data = await response.json();
      const text = provider === "lmstudio" ? data?.choices?.[0]?.message?.content : (data?.message?.content || data?.response);

      if (provider === "ollama") {
        lastActiveOllamaModel = model;
        lastOllamaSettings = { textProvider: provider, textEndpoint: endpoint };
        lastOllamaUsedTime = Date.now();
      }

      res.json({ ok: true, text: text || "", source: { type: "local", provider, model } });
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(error?.name === "AbortError" ? 408 : 502).json({ ok: false, error: error?.message || "Local AI unavailable" });
      }
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post("/api/local-ai/unload", async (req, res) => {
    try {
      let ollamaUnloaded = false;
      let imageUnloaded = false;
      let activeOllamaModel = lastActiveOllamaModel;
      let activeImageProvider = lastActiveImageProvider;
      
      if (lastActiveOllamaModel && lastOllamaSettings) {
        const modelToUnload = lastActiveOllamaModel;
        const settingsToUse = lastOllamaSettings;
        lastActiveOllamaModel = null;
        lastOllamaSettings = null;
        await unloadOllamaModel(settingsToUse, modelToUnload).catch(() => {});
        ollamaUnloaded = true;
      }
      
      if (lastActiveImageProvider && lastImageSettings) {
        const settingsToUse = lastImageSettings;
        lastActiveImageProvider = null;
        lastImageSettings = null;
        await unloadImageModel(settingsToUse).catch(() => {});
        imageUnloaded = true;
      }
      
      res.json({
        ok: true,
        message: "AI 모델 언로드 요청이 완료되었습니다.",
        ollamaUnloaded,
        imageUnloaded,
        unloadedOllamaModel: activeOllamaModel,
        unloadedImageProvider: activeImageProvider,
      });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error?.message || "Unload failed" });
    }
  });

  app.get("/api/local-ai/status", async (req, res) => {
    res.json({
      ok: true,
      llm: {
        loaded: !!lastActiveOllamaModel,
        model: lastActiveOllamaModel,
        lastUsed: lastOllamaUsedTime,
      },
      image: {
        loaded: !!lastActiveImageProvider,
        provider: lastActiveImageProvider,
        lastUsed: lastImageUsedTime,
      }
    });
  });

  app.post("/api/local-ai/image/generate", async (req, res) => {
    const {
      provider = "forge",
      endpoint,
      prompt,
      negativePrompt = "text, words, logo, watermark, bad anatomy, malformed hands, low quality",
      width = 900,
      height = 1350,
      seed = -1,
      steps = 28,
      cfgScale = 7,
      qualityPreset = "standard",
      workflow,
    } = req.body || {};
    const baseUrl = normalizeBaseUrl(endpoint, provider === "comfyui" ? "http://127.0.0.1:8188" : "http://127.0.0.1:7860");
    const controller = new AbortController();
    req.on("aborted", () => controller.abort());

    // 이미지 생성 전 로드된 로컬 LLM을 확실하게 언로드하여 VRAM 반환
    await triggerVramSwitchForImage().catch(() => {});

    // 이미지 생성 시작 시 이미지 생성기 사용 정보 저장
    lastActiveImageProvider = provider;
    lastImageSettings = { provider, endpoint };
    lastImageUsedTime = Date.now();

    try {
      if (!prompt?.trim()) return res.status(400).json({ ok: false, error: "Prompt is required" });

      if (provider === "forge") {
        const response = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            negative_prompt: negativePrompt,
            width,
            height,
            seed,
            steps,
            cfg_scale: cfgScale,
            sampler_name: "DPM++ 2M Karras",
            batch_size: 1,
            n_iter: 1,
          }),
          signal: controller.signal,
        });
        if (!response.ok) return res.status(response.status).json({ ok: false, error: `Forge HTTP ${response.status}` });
        const data = await response.json();
        const image = data?.images?.[0];
        if (!image) return res.status(502).json({ ok: false, error: "Forge returned no image" });
        return res.json({ ok: true, provider, imageUrl: saveGeneratedImage(image, "png"), status: "completed", checkedAt: Date.now() });
      }

      if (provider === "comfyui") {
        let finalWorkflow = workflow;
        const quality = resolveImageQualityProfile(
          qualityPreset,
          Number(width) || 900,
          Number(height) || 1350,
          Number(steps) || 28,
          Number(cfgScale) || 7,
        );
        const effectivePrompt = quality.mode === "ultra"
          ? `${premiumWebtoonPromptPrefix}, ${prompt}`
          : prompt;
        const effectiveNegativePrompt = quality.mode === "ultra"
          ? `${negativePrompt}, worst quality, normal quality, low quality, lowres, blurry, soft focus, mushy details, melted object, plastic skin, flat lighting, dull colors, bad anatomy, bad hands, malformed fingers, extra fingers, fused fingers, missing fingers, broken wrist, distorted face, cross-eye, duplicated person, cropped head, bad perspective, unreadable panel, messy panel border, jpeg artifacts`
          : negativePrompt;
        if (!finalWorkflow || typeof finalWorkflow !== "object" || Object.keys(finalWorkflow).length === 0) {
          const { ckpt_name, upscale_name, vae_name } = await getComfyUiModels(baseUrl);
          
          const baseW = quality.baseW;
          const baseH = quality.baseH;
          const vaeRef = vae_name ? ["16", 0] : ["3", 2];

          finalWorkflow = {
            "3": {
              "class_type": "CheckpointLoaderSimple",
              "inputs": { "ckpt_name": ckpt_name }
            },
            ...(vae_name ? {
              "16": {
                "class_type": "VAELoader",
                "inputs": { "vae_name": vae_name }
              }
            } : {}),
            "4": {
              "class_type": "CLIPTextEncode",
              "inputs": {
                "text": "__PROMPT__",
                "clip": ["3", 1]
              }
            },
            "5": {
              "class_type": "CLIPTextEncode",
              "inputs": {
                "text": "__NEGATIVE_PROMPT__",
                "clip": ["3", 1]
              }
            },
            "6": {
              "class_type": "EmptyLatentImage",
              "inputs": {
                "width": baseW,
                "height": baseH,
                "batch_size": 1
              }
            },
            "7": {
              "class_type": "KSampler",
              "inputs": {
                "model": ["3", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
                "seed": "__SEED__",
                "steps": "__STEPS__",
                "cfg": "__CFG__",
                "sampler_name": "dpmpp_2m_sde",
                "scheduler": "karras",
                "denoise": 1.0
              }
            },
            "8": {
              "class_type": "VAEDecode",
              "inputs": {
                "samples": ["7", 0],
                "vae": vaeRef
              }
            },
            "10": {
              "class_type": "UpscaleModelLoader",
              "inputs": {
                "model_name": upscale_name
              }
            },
            "11": {
              "class_type": "ImageUpscaleWithModel",
              "inputs": {
                "upscale_model": ["10", 0],
                "image": ["8", 0]
              }
            },
            "12": {
              "class_type": "ImageScale",
              "inputs": {
                "image": ["11", 0],
                "width": "__WIDTH__",
                "height": "__HEIGHT__",
                "crop": "disabled",
                "upscale_method": "bicubic"
              }
            },
            "13": {
              "class_type": "VAEEncode",
              "inputs": {
                "pixels": ["12", 0],
                "vae": vaeRef
              }
            },
            "14": {
              "class_type": "KSampler",
              "inputs": {
                "model": ["3", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["13", 0],
                "seed": "__SEED__",
                "steps": "__REFINE_STEPS__",
                "cfg": "__CFG__",
                "sampler_name": "dpmpp_2m_sde",
                "scheduler": "karras",
                "denoise": "__REFINE_DENOISE__"
              }
            },
            "15": {
              "class_type": "VAEDecode",
              "inputs": {
                "samples": ["14", 0],
                "vae": vaeRef
              }
            },
            "9": {
              "class_type": "SaveImage",
              "inputs": {
                "images": ["15", 0],
                "filename_prefix": "dongjeon_bromantoon"
              }
            }
          };
          if (!upscale_name) {
            finalWorkflow["9"].inputs.images = ["8", 0];
            delete finalWorkflow["10"];
            delete finalWorkflow["11"];
            delete finalWorkflow["12"];
            delete finalWorkflow["13"];
            delete finalWorkflow["14"];
            delete finalWorkflow["15"];
          }
        }
        const safeSeed = Number(seed) >= 0 ? Number(seed) : Math.floor(Math.random() * 2147483647);
        const hydratedWorkflow = applyComfyWorkflowPlaceholders(finalWorkflow, {
          "__PROMPT__": effectivePrompt,
          "__NEGATIVE_PROMPT__": effectiveNegativePrompt,
          "__SEED__": safeSeed,
          "__WIDTH__": quality.finalW,
          "__HEIGHT__": quality.finalH,
          "__STEPS__": quality.steps,
          "__CFG__": quality.cfg,
          "__REFINE_STEPS__": quality.refineSteps,
          "__REFINE_DENOISE__": quality.refineDenoise,
        });
        const promptResponse = await fetch(`${baseUrl}/prompt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: hydratedWorkflow, client_id: randomUUID() }),
          signal: controller.signal,
        });
        if (!promptResponse.ok) {
          const detail = await promptResponse.text().catch(() => '');
          return res.status(promptResponse.status).json({
            ok: false,
            error: `ComfyUI prompt HTTP ${promptResponse.status}`,
            detail: detail.slice(0, 1200),
          });
        }
        const queued = await promptResponse.json();
        const promptId = queued?.prompt_id;
        if (!promptId) return res.status(502).json({ ok: false, error: "ComfyUI did not return prompt_id" });

        let history: any = null;
        let lastProgress: any = null;
        const startedAt = Date.now();
        while (true) {
          const historyResponse = await fetch(`${baseUrl}/history/${promptId}`, { signal: controller.signal });
          if (historyResponse.ok) {
            const json = await historyResponse.json();
            history = json?.[promptId];
            if (history?.outputs) break;
          }
          const progressResponse = await fetch(`${baseUrl}/progress`, { signal: controller.signal }).catch(() => null);
          if (progressResponse?.ok) {
            lastProgress = await progressResponse.json().catch(() => null);
          }
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        const outputs = history?.outputs || {};
        const imageInfo = Object.values(outputs)
          .flatMap((output: any) => Array.isArray(output?.images) ? output.images : [])
          .find((image: any) => image?.filename);
        if (!imageInfo) return res.status(502).json({ ok: false, error: "ComfyUI returned no image", promptId, lastProgress });

        const params = new URLSearchParams({
          filename: imageInfo.filename,
          subfolder: imageInfo.subfolder || "",
          type: imageInfo.type || "output",
        });
        const imageResponse = await fetch(`${baseUrl}/view?${params.toString()}`, { signal: controller.signal });
        if (!imageResponse.ok) return res.status(imageResponse.status).json({ ok: false, error: `ComfyUI view HTTP ${imageResponse.status}` });
        const buffer = await imageResponse.arrayBuffer();
        return res.json({
          ok: true,
          provider,
          imageUrl: saveGeneratedImage(buffer, "png"),
          promptId,
          status: "completed",
          quality: {
            preset: quality.mode,
            stageLabel: quality.stageLabel,
            baseWidth: quality.baseW,
            baseHeight: quality.baseH,
            width: quality.finalW,
            height: quality.finalH,
            steps: quality.steps,
            refineSteps: quality.refineSteps,
          },
          elapsedMs: Date.now() - startedAt,
          lastProgress,
          checkedAt: Date.now(),
        });
      }

      return res.status(400).json({ ok: false, error: `Unsupported image provider: ${provider}` });
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(error?.name === "AbortError" ? 408 : 502).json({ ok: false, error: error?.message || "Local image generator unavailable" });
      }
    }
  });

  const createLocalImageIfEnabled = async (
    settings: any,
    prompt: string,
    width: number,
    height: number,
    seed: number,
    negativePrompt = "text, words, caption, watermark, logo, bad anatomy, malformed hands, low quality",
    qualityPreset = "ultra",
    signal?: AbortSignal,
  ) => {
    if (!settings?.imageEnabled) return "";
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/api/local-ai/image/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings.imageProvider,
          endpoint: settings.imageEndpoint,
          prompt,
          width,
          height,
          seed,
          steps: qualityPreset === "ultra" ? 42 : 28,
          cfgScale: qualityPreset === "ultra" ? 6.5 : 7,
          qualityPreset,
          negativePrompt: `${negativePrompt}, blurry, mushy detail, melted objects, deformed fingers, fused fingers, extra fingers, broken hands, distorted face, inconsistent anatomy, lowres, jpeg artifacts, messy lineart`,
        }),
        signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.imageUrl) throw new Error(data?.error || `HTTP ${response.status}`);
      return data.imageUrl as string;
    } catch (error: any) {
      if (error?.name === "AbortError" || signal?.aborted) throw error;
      console.warn("Local image generation failed:", error);
      return "";
    }
  };

  // ─── AI 집사방 댓글 자동 생성 API ───
  app.post("/api/ai/generate-reply", async (req, res) => {
    try {
      const { postTitle, postContent, commentContent } = req.body;
      const prompt = `You are an AI assistant for a local community app called '동전커피' (Coin Coffee). Your name is '루이'.
A user just left a comment on a community post.
Post Title: "${postTitle}"
Post Content: "${postContent}"
User's Comment: "${commentContent}"

Write a friendly, engaged, and brief reply to the user's comment, acting as a helpful community manager.
Do NOT refer to yourself in the third person or use your name '루이' within your sentence. Instead, use the first-person pronouns "저" or "저도".
Do NOT use markdown code blocks or JSON. Just write the plain text reply. Keep it under 2 sentences.`;

      const response = await retryGemini({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }, undefined, 'low');

      res.json({ reply: extractText(response).trim() || "네, 부르셨나요? 😊" });
    } catch (error: any) {
      console.error("Generate reply error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ─── 백그라운드 웹툰 기획 API ───
  app.post("/api/webtoon/plan-project", async (req, res) => {
    const {
      projectId,
      title,
      concept,
      artStyle,
      worldview,
      genres,
      characters,
      coverImageUrl,
      thumbnailImageUrl,
      generationSettings,
      uid,
      localImageSettings,
      localTextSettings,
    } = req.body;

    const isOperator = await checkOperatorPermission(uid);
    if (!isOperator) {
      return res.status(403).json({ error: "운영진 권한이 없거나 권한 확인에 실패했습니다." });
    }

    // 즉시 가벼운 처리 응답 반환
    res.json({ status: "processing", message: "웹툰 기획 백그라운드 연산을 시작합니다." });

    // 비동기 백그라운드 연산 기동
    (async () => {
      const projectRef = doc(db, "posts", projectId);
      let activeLogId = "";
      const abortController = new AbortController();

      const unsubCancel = onSnapshot(projectRef, (snap) => {
        if (snap.exists() && snap.data()?.cancelRequested) {
          abortController.abort();
        }
      });
      
      const estimatedTextModel = (task: "scenario" | "character" | "storyboard" | "adult", settings: any) => {
        const useGemini = settings?.textProvider === "gemini" || !settings?.textEnabled;
        if (useGemini) return "gemini-3.5";
        return resolveWebtoonTextModel(settings, task, generationSettings?.maturityLevel);
      };

      const checkCancel = async () => {
        if (abortController.signal.aborted) {
          throw new Error("USER_CANCELLED");
        }
        const snap = await getDoc(projectRef);
        if (snap.exists() && snap.data()?.cancelRequested) {
          abortController.abort();
          throw new Error("USER_CANCELLED");
        }
      };

      try {
        await checkCancel();
        let finalTitle = title?.trim() || "";
        let finalWorldview = worldview?.trim() || "";
        let finalGenres = genres || [];
        let finalCharacters = characters || [];

        // ─── 1단계: 세계관완성 ───
        await checkCancel();
        activeLogId = "plan-phase-1-worldview";
        await updateDoc(projectRef, {
          status: "planning",
          progressMsg: "1단계: 세계관 완성 중...",
        });

        const worldviewPrompt = `당신은 웹툰 전문 기획자입니다.
제시된 기본 기획(컨셉: ${concept}, 장르: ${finalGenres.join(", ") || "없음"}) 및 세계관 입력값을 바탕으로, 독자의 마음을 사로잡을 수 있는 매력적이고 구체적인 웹툰 기획안 및 세계관을 상세히 기획해 주세요.
반드시 아래 JSON 포맷으로만 응답해야 합니다. 마크다운(\`\`\`)을 쓰지 말고 순수 JSON 문자열만 반환하세요:
{
  "title": "흥행할 만한 매력적인 작품 제목",
  "worldview": "작품의 세계관, 메인 갈등 구조, 시대적/공간적 배경 등을 상세히 설명 (400자 내외)"
}

기존 입력 정보:
- 제목: ${title || "없음"}
- 세계관: ${worldview || "없음"}`;

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "세계관 기획 및 완성",
          model: estimatedTextModel("scenario", localTextSettings),
          prompt: worldviewPrompt,
          status: 'processing',
          estimatedSeconds: 10,
        });

        const worldviewRes = await callWebtoonText(localTextSettings, {
          contents: [{ role: "user", parts: [{ text: worldviewPrompt }] }],
        }, "scenario", generationSettings?.maturityLevel, abortController.signal);
        const worldviewText = extractText(worldviewRes).trim();
        const worldviewModel = worldviewRes.__dongjeonAiSource?.model || "gemini-3.5";

        try {
          const parsed = JSON.parse(
            worldviewText.replace(/```json/g, "").replace(/```/g, "").trim()
          );
          if (parsed.title) finalTitle = parsed.title.trim();
          if (parsed.worldview) finalWorldview = parsed.worldview.trim();
        } catch (e) {
          console.error("Failed to parse Worldview JSON:", e);
          if (!finalTitle) finalTitle = title || "AI가 설계한 운명적 웹툰";
          if (!finalWorldview) finalWorldview = worldview || `${concept} 컨셉의 세계관 설정`;
        }

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "세계관 기획 및 완성",
          model: worldviewModel,
          prompt: worldviewPrompt,
          status: 'completed',
          estimatedSeconds: 10,
          result: JSON.stringify({ title: finalTitle, worldview: finalWorldview }, null, 2),
        });

        // ─── 2단계: 캐릭터설정 ───
        await checkCancel();
        activeLogId = "plan-phase-2-characters";
        await updateDoc(projectRef, {
          progressMsg: "2단계: 캐릭터 설정 구성 중...",
        });

        const charSetupPrompt = `당신은 웹툰 전문 캐릭터 디자이너 및 시나리오 작가입니다.
앞서 완성된 제목과 세계관을 바탕으로, 작품을 이끌어갈 매력적인 캐릭터들의 상세한 역할과 성격, 외양 묘사를 구성해 주세요.
반드시 아래 JSON 포맷으로만 응답해야 합니다. 마크다운(\`\`\`)을 쓰지 말고 순수 JSON 문자열만 반환하세요:
{
  "characters": [
    {
      "name": "인물 이름 (예: 강태경)",
      "role": "주인공",
      "description": "외양, 성격, 특징 및 이 역할에서의 성격 묘사 (150자 내외)"
    },
    {
      "name": "인물 이름 (예: 서하진)",
      "role": "상대역",
      "description": "외양, 성격, 특징 및 주인공과의 관계 묘사 (150자 내외)"
    }
  ]
}

주의사항:
1. 기존 입력된 캐릭터의 수(${characters.length})와 역할을 최대한 유지하며 상세 설정을 더해 주세요.
2. 기존 캐릭터 정보:
${characters.map((c: any, i: number) => `- 캐릭터 ${i+1}: 이름[${c.name || "없음"}], 역할[${c.role || "없음"}], 설명[${c.description || "없음"}]`).join("\n")}

작품 정보:
- 제목: ${finalTitle}
- 세계관: ${finalWorldview}`;

        await updateWorkLog(projectRef, activeLogId, {
          category: 'character',
          stepName: "캐릭터 상세 설정 구성",
          model: estimatedTextModel("scenario", localTextSettings),
          prompt: charSetupPrompt,
          status: 'processing',
          estimatedSeconds: 10,
        });

        const charSetupRes = await callWebtoonText(localTextSettings, {
          contents: [{ role: "user", parts: [{ text: charSetupPrompt }] }],
        }, "scenario", generationSettings?.maturityLevel, abortController.signal);
        const charSetupText = extractText(charSetupRes).trim();
        const charSetupModel = charSetupRes.__dongjeonAiSource?.model || "gemini-3.5";

        try {
          const parsed = JSON.parse(
            charSetupText.replace(/```json/g, "").replace(/```/g, "").trim()
          );
          if (Array.isArray(parsed.characters)) {
            finalCharacters = characters.map((c: any, idx: number) => {
              const parsedChar = parsed.characters[idx] || parsed.characters[0] || {};
              return {
                ...c,
                name: c.name?.trim() || parsedChar.name?.trim() || `캐릭터 ${idx + 1}`,
                description: c.description?.trim() || parsedChar.description?.trim() || "상세 설정 대기 중",
                role: c.role || parsedChar.role || "조연",
              };
            });
          }
        } catch (e) {
          console.error("Failed to parse Characters JSON:", e);
          finalCharacters = characters.map((c: any, idx: number) => ({
            ...c,
            name: c.name?.trim() || `캐릭터 ${idx + 1}`,
            description: c.description?.trim() || `${concept} 컨셉의 매력적인 인물`,
            role: c.role || "조연",
          }));
        }

        // Firestore 중간 업데이트
        await updateDoc(projectRef, {
          title: finalTitle,
          content: `${concept} / ${finalGenres.join(', ')}`,
          webtoonMeta: {
            concept,
            genres: finalGenres,
            artStyle,
            worldview: finalWorldview,
            characters: finalCharacters.map((c: any) => ({
              name: c.name,
              role: c.role,
              description: c.description,
              imageUrl: c.imageUrl || "",
            })),
            coverImageUrl: coverImageUrl || "",
            thumbnailImageUrl: thumbnailImageUrl || "",
            generationSettings: generationSettings || {},
          },
        });

        await updateWorkLog(projectRef, activeLogId, {
          category: 'character',
          stepName: "캐릭터 상세 설정 구성",
          model: charSetupModel,
          prompt: charSetupPrompt,
          status: 'completed',
          estimatedSeconds: 10,
          result: JSON.stringify(finalCharacters, null, 2),
        });

        // ─── 3단계: 전체시즌 플롯 ───
        await checkCancel();
        activeLogId = "plan-phase-3";
        await updateDoc(projectRef, {
          progressMsg: "3단계: 전체 시즌 스토리라인 기획 중...",
        });

        const seasonPrompt = `당신은 만화 및 웹툰 기획자입니다.
제시된 제목과 기획안(컨셉, 세계관, 장르, 캐릭터 정보)을 분석하여, 이 작품의 전체 시즌(시즌 1부터 시즌 4까지)의 대략적인 아웃라인과 각 시즌별 스토리 플롯(각 시즌당 150자 내외)을 완성도 높은 한국어로 기획해 주세요.

프로젝트 제목: ${finalTitle}
컨셉: ${concept}
세계관: ${finalWorldview}
장르: ${finalGenres?.join(", ") || "일반"}
캐릭터 목록:
${finalCharacters.map((c: any) => `- 이름: ${c.name}, 역할: ${c.description}`).join("\n")}
`;

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "전체 시즌 스토리라인 기획",
          model: estimatedTextModel("scenario", localTextSettings),
          prompt: seasonPrompt,
          status: 'processing',
          estimatedSeconds: 12,
        });

        const seasonRes = await callWebtoonText(localTextSettings, {
          contents: [{ role: "user", parts: [{ text: seasonPrompt }] }],
        }, "scenario", generationSettings?.maturityLevel, abortController.signal);
        const seasonsPlot = extractText(seasonRes).trim();
        const seasonModel = seasonRes.__dongjeonAiSource?.model || "gemini-3.5";

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "전체 시즌 스토리라인 기획",
          model: seasonModel,
          prompt: seasonPrompt,
          status: 'completed',
          estimatedSeconds: 12,
          result: seasonsPlot,
        });

        // ─── 4단계: 시즌플롯 ───
        await checkCancel();
        activeLogId = "plan-phase-4";
        await updateDoc(projectRef, {
          progressMsg: "4단계: 시즌 1 전체 줄거리 집필 중...",
        });

        const detailedPlotPrompt = `작성된 전체 시즌 아웃라인을 참고하여, '시즌 1' 동안 전개될 전체 스토리라인을 인물들의 갈등, 감정선 위주로 아주 상세하게 한국어 600~1000자 분량으로 집필해 주세요.
전체 시즌 플롯:
${seasonsPlot}`;

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "시즌 1 전체 줄거리 기획",
          model: estimatedTextModel("scenario", localTextSettings),
          prompt: detailedPlotPrompt,
          status: 'processing',
          estimatedSeconds: 15,
        });

        const detailedPlotRes = await callWebtoonText(localTextSettings, {
          contents: [{ role: "user", parts: [{ text: detailedPlotPrompt }] }],
        }, "scenario", generationSettings?.maturityLevel, abortController.signal);
        const selectedSeasonPlot = extractText(detailedPlotRes).trim();
        const plotModel = detailedPlotRes.__dongjeonAiSource?.model || "gemini-3.5";

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "시즌 1 전체 줄거리 기획",
          model: plotModel,
          prompt: detailedPlotPrompt,
          status: 'completed',
          estimatedSeconds: 15,
          result: selectedSeasonPlot,
        });

        // ─── 5단계: 에피플롯 ───
        await checkCancel();
        activeLogId = "plan-phase-5";
        await updateDoc(projectRef, {
          progressMsg: "5단계: 에피소드 시놉시스 및 에피플롯 구성 중...",
        });

        const synopsisPrompt = `시즌 1 전체 줄거리를 참고하여, 총 10화 분량의 각 에피소드별 흥미진진한 제목과 줄거리 시놉시스(각 100자 내외)를 구성하세요.
반드시 아래 JSON 포맷으로만 응답해야 합니다. 마크다운(\`\`\`)을 쓰지 말고 순수 JSON 문자열만 반환하세요:
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

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "시즌 1 에피소드(1~10화) 시놉시스 구성",
          model: estimatedTextModel("scenario", localTextSettings),
          prompt: synopsisPrompt,
          status: 'processing',
          estimatedSeconds: 15,
        });

        const synopsisRes = await callWebtoonText(localTextSettings, {
          contents: [{ role: "user", parts: [{ text: synopsisPrompt }] }],
        }, "scenario", generationSettings?.maturityLevel, abortController.signal);
        const rawEpJson = extractText(synopsisRes).trim();
        const synModel = synopsisRes.__dongjeonAiSource?.model || "gemini-3.5";

        let episodesPlot = [];
        try {
          const parsed = JSON.parse(
            rawEpJson.replace(/```json/g, "").replace(/```/g, "").trim()
          );
          episodesPlot = parsed.episodes || [];
        } catch {
          episodesPlot = Array.from({ length: 10 }).map((_, i) => ({
            episodeNumber: i + 1,
            title: `제 ${i + 1}화`,
            synopsis: `${finalTitle}의 매력적인 에피소드 제 ${i + 1}화`
          }));
        }

        await updateWorkLog(projectRef, activeLogId, {
          category: 'plot',
          stepName: "시즌 1 에피소드(1~10화) 시놉시스 구성",
          model: synModel,
          prompt: synopsisPrompt,
          status: 'completed',
          estimatedSeconds: 15,
          result: JSON.stringify(episodesPlot, null, 2),
        });

        // ─── 6단계: 캐릭터 이미지 생성 ───
        await checkCancel();
        await updateDoc(projectRef, {
          progressMsg: "6단계: 캐릭터 설정화 이미지 생성 중...",
        });

        const updatedCharacters = [];
        for (let idx = 0; idx < finalCharacters.length; idx++) {
          await checkCancel();
          const char = finalCharacters[idx];

          if (char.imageUrl) {
            updatedCharacters.push(char);
            continue;
          }

          const charPromptId = `plan-char-prompt-${char.name}`;
          const charPrompt = `위 웹툰의 아트 스타일(${artStyle})에 맞춰, 다음 캐릭터의 외모 드로잉을 위한 상세한 영어 프롬프트(물리적 특징: 머리 모양, 옷 스타일, 표정 등)를 생성해 주세요.
이름: ${char.name}
설명: ${char.description}
반드시 한 줄의 짧은 문구(30단어 내외, 콤마로 구분된 명사구 나열)의 영어로만 답하세요.`;

          activeLogId = charPromptId;
          await updateWorkLog(projectRef, activeLogId, {
            category: 'character',
            stepName: `캐릭터설정: ${char.name} 비주얼 키워드 생성`,
            model: estimatedTextModel("character", localTextSettings),
            prompt: charPrompt,
            status: 'processing',
            estimatedSeconds: 5,
          });

          const charRes = await callWebtoonText(localTextSettings, {
            contents: [{ role: "user", parts: [{ text: charPrompt }] }]
          }, "character", generationSettings?.maturityLevel, abortController.signal);
          const visualPrompt = extractText(charRes).trim();
          const charTextModel = charRes.__dongjeonAiSource?.model || "local-llm";

          await updateWorkLog(projectRef, activeLogId, {
            category: 'character',
            stepName: `캐릭터설정: ${char.name} 비주얼 키워드 생성`,
            model: charTextModel,
            prompt: charPrompt,
            status: 'completed',
            estimatedSeconds: 5,
            result: visualPrompt,
          });
          
          const seed = Math.floor(Math.random() * 1000000);
          const cleanStyle = cleanPromptText(artStyle);
          const cleanPrompt = cleanPromptText(visualPrompt);
          const fullImagePrompt = `${cleanStyle}, professional webtoon character production sheet, full body front view, full body side view, full body back view, 360-degree turnaround reference, upper body portrait, expression sheet with 8 emotions, hands and outfit details, ${cleanPrompt}, clean high-end manhwa illustration, no text`;
          const premiumCharacterPrompt = [
            "masterpiece, best quality, ultra detailed character reference sheet",
            "commercial Korean webtoon character design",
            "consistent face across all views, sharp detailed eyes, detailed hair strands",
            "accurate hands, accurate feet, correct anatomy, clean facial structure",
            "detailed outfit seams, fabric folds, accessories, material texture",
            fullImagePrompt,
          ].join(", ");

          const charImgId = `plan-char-image-${char.name}`;
          activeLogId = charImgId;
          
          let imgModel = "Forge/ComfyUI Image Generator";
          if (localImageSettings?.imageProvider === "comfyui") {
            try {
              const comfyModels = await getComfyUiModels(normalizeBaseUrl(localImageSettings.imageEndpoint, "http://127.0.0.1:8188"));
              if (comfyModels?.ckpt_name) imgModel = comfyModels.ckpt_name;
            } catch {}
          } else if (localImageSettings?.imageProvider === "forge") {
            imgModel = "SD WebUI Forge (animagineXL)";
          }

          await updateWorkLog(projectRef, activeLogId, {
            category: 'character',
            stepName: `캐릭터설정: ${char.name} 설정화 이미지 렌더링`,
            model: imgModel,
            prompt: premiumCharacterPrompt,
            status: 'processing',
            estimatedSeconds: 140,
          });

          const localImageUrl = await createLocalImageIfEnabled(
            localImageSettings,
            premiumCharacterPrompt,
            1200,
            1600,
            seed,
            "text, words, caption, watermark, logo, bad anatomy, malformed hands, low quality, bad character sheet, cropped body, duplicated limbs",
            "ultra",
            abortController.signal,
          );
          if (!localImageUrl) {
            throw new Error(`${char.name} 웹툰 이미지는 로컬 ComfyUI/Forge 연결이 필요합니다.`);
          }
          const imageUrl = localImageUrl;
          
          await updateWorkLog(projectRef, activeLogId, {
            category: 'character',
            stepName: `캐릭터설정: ${char.name} 설정화 이미지 렌더링`,
            model: imgModel,
            prompt: premiumCharacterPrompt,
            status: 'completed',
            estimatedSeconds: 140,
            result: imageUrl,
          });
          
          updatedCharacters.push({
            ...char,
            visualPrompt,
            imageUrl
          });
        }

        // ─── 7단계: 프로젝트이미지 생성 ───
        await checkCancel();
        await updateDoc(projectRef, {
          progressMsg: "7단계: 프로젝트 대표 커버 이미지 생성 중...",
        });

        let finalCoverUrl = coverImageUrl || "";
        let finalThumbnailUrl = thumbnailImageUrl || "";

        if (!finalCoverUrl) {
          activeLogId = "plan-project-cover";
          const cleanTitle = cleanPromptText(finalTitle);
          const cleanStyle = cleanPromptText(artStyle);
          const coverPrompt = `${cleanStyle}, premium manhwa cover illustration, masterpiece, best quality, key visual, webtoon promotional poster for "${cleanTitle}". dynamic composition, vivid colors, no text, no words`;

          let imgModel = "Forge/ComfyUI Image Generator";
          if (localImageSettings?.imageProvider === "comfyui") {
            try {
              const comfyModels = await getComfyUiModels(normalizeBaseUrl(localImageSettings.imageEndpoint, "http://127.0.0.1:8188"));
              if (comfyModels?.ckpt_name) imgModel = comfyModels.ckpt_name;
            } catch {}
          } else if (localImageSettings?.imageProvider === "forge") {
            imgModel = "SD WebUI Forge (animagineXL)";
          }

          await updateWorkLog(projectRef, activeLogId, {
            category: 'image',
            stepName: "프로젝트 대표 커버 이미지 생성",
            model: imgModel,
            prompt: coverPrompt,
            status: 'processing',
            estimatedSeconds: 60,
          });

          try {
            const localCoverUrl = await createLocalImageIfEnabled(
              localImageSettings,
              coverPrompt,
              1024,
              1024,
              Math.floor(Math.random() * 1000000),
              "text, words, caption, watermark, logo, bad anatomy, low quality",
              "ultra",
              abortController.signal,
            );
            if (localCoverUrl) {
              finalCoverUrl = localCoverUrl;
              finalThumbnailUrl = localCoverUrl;
              await updateWorkLog(projectRef, activeLogId, {
                category: 'image',
                stepName: "프로젝트 대표 커버 이미지 생성",
                model: imgModel,
                prompt: coverPrompt,
                status: 'completed',
                estimatedSeconds: 60,
                result: finalCoverUrl,
              });
            }
          } catch (coverErr) {
            console.error("Cover image generation failed, using fallback:", coverErr);
            await updateWorkLog(projectRef, activeLogId, {
              category: 'image',
              stepName: "프로젝트 대표 커버 이미지 생성",
              model: imgModel,
              prompt: coverPrompt,
              status: 'failed',
              estimatedSeconds: 60,
              result: String(coverErr),
            });
          }
        }

        // ─── 8단계: 프로젝트 방 완성 ───
        await checkCancel();
        await updateDoc(projectRef, {
          progressMsg: "8단계: 프로젝트 방 완성!",
        });

        await updateDoc(projectRef, {
          webtoonMeta: {
            concept,
            genres: finalGenres,
            artStyle,
            worldview: finalWorldview,
            seasonsPlot,
            selectedSeasonPlot,
            episodesPlot,
            characters: updatedCharacters,
            coverImageUrl: finalCoverUrl || "",
            thumbnailImageUrl: finalThumbnailUrl || "",
            generationSettings: generationSettings || {},
            pendingApproval: {
              type: "characters",
              characters: updatedCharacters,
              vibeMemo: "",
              createdAt: Date.now(),
            },
          },
          imageUrl: finalCoverUrl || updatedCharacters[0]?.imageUrl || "",
          status: "awaiting_character_approval",
          progressMsg: "8단계: 프로젝트 방 완성! 캐릭터 설정화 승인 대기 중입니다.",
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.error("Plan project failed:", err);
        const isCancelled = err.message === "USER_CANCELLED" || abortController.signal.aborted;
        await updateDoc(projectRef, {
          status: "failed",
          progressMsg: isCancelled ? "기획 작업이 중단되었습니다." : `기획 실패: ${err.message}`,
          cancelRequested: false,
          updatedAt: serverTimestamp(),
        });
      } finally {
        unsubCancel();
        if (lastActiveOllamaModel && lastOllamaSettings) {
          console.log("[Webtoon Project Plan] Task complete or cancelled, unloading LLM model...");
          const modelToUnload = lastActiveOllamaModel;
          const settingsToUse = lastOllamaSettings;
          lastActiveOllamaModel = null;
          lastOllamaSettings = null;
          await unloadOllamaModel(settingsToUse, modelToUnload).catch(() => {});
        }
      }
    })();
  });

  // ─── 백그라운드 에피소드 생성 API ───
  app.post("/api/webtoon/generate-episode", async (req, res) => {
    const { projectId, uid, localImageSettings, localTextSettings } = req.body;

    const isOperator = await checkOperatorPermission(uid);
    if (!isOperator) {
      return res.status(403).json({ error: "운영진 권한이 없거나 권한 확인에 실패했습니다." });
    }

    res.json({ status: "processing", message: "에피소드 제작을 시작했습니다." });

    (async () => {
      const projectRef = doc(db, "posts", projectId);
      let activeLogId = "";
      const abortController = new AbortController();

      const unsubCancel = onSnapshot(projectRef, (snap) => {
        if (snap.exists() && snap.data()?.cancelRequested) {
          abortController.abort();
        }
      });

      const checkCancel = async () => {
        if (abortController.signal.aborted) {
          throw new Error("USER_CANCELLED");
        }
        const snap = await getDoc(projectRef);
        if (snap.exists() && snap.data()?.cancelRequested) {
          abortController.abort();
          throw new Error("USER_CANCELLED");
        }
      };

      try {
        await checkCancel();
        await updateDoc(projectRef, {
          status: "generating_episode",
          progressMsg: "1단계: 에피소드 기획안 및 연출 대본 집필 중...",
        });

        const projectSnap = await getDoc(projectRef);
        if (!projectSnap.exists()) throw new Error("프로젝트를 찾을 수 없습니다.");
        const projectData = projectSnap.data();
        const meta = projectData.webtoonMeta || {};
        const generationSettings = meta.generationSettings || {};
        const maxEpisodes = Math.max(1, Number(generationSettings.episodeCount || 10));
        const targetCutCount = Math.max(20, Number(generationSettings.targetCutCount || 24));
        const minPanels = Math.min(5, Math.max(1, Number(generationSettings.minPanelsPerPage || 2)));
        const maxPanels = Math.min(5, Math.max(minPanels, Number(generationSettings.maxPanelsPerPage || 5)));
        const pageTarget = Math.max(4, Math.ceil(targetCutCount / Math.max(1, Math.floor((minPanels + maxPanels) / 2))));
        const approvalMode = generationSettings.approvalMode !== false && generationSettings.publishMode !== "auto";

        // 현재 에피소드 회차 파악
        const epQuery = query(collection(db, `posts/${projectId}/episodes`), orderBy("episodeNumber", "asc"));
        const epSnapshot = await getDocs(epQuery);
        const pastEpisodes = epSnapshot.docs.map(doc => doc.data());
        const episodeNumber = pastEpisodes.length + 1;

        if (episodeNumber > maxEpisodes) {
          throw new Error(`최대 연재 회차(${maxEpisodes}화)를 초과했습니다.`);
        }

        const targetEp = meta.episodesPlot?.find((e: any) => e.episodeNumber === episodeNumber);
        const thisEpSynopsis = targetEp?.synopsis || `제 ${episodeNumber}화의 스펙타클한 전개`;

        const systemInstruction = `당신은 웹툰 전문 스토리 작가이자 만화 연출가입니다.
제공된 세계관과 캐릭터 설정을 바탕으로 웹툰 ${episodeNumber}화의 스크립트(콘티)를 작성해주세요.

⚠️ 절대 지켜야 할 사항:
- **시놉시스 반영**: 이번 화 줄거리인 "${thisEpSynopsis}"를 바탕으로 사건을 점진적으로 전개하세요.
- **다중 패널 연출 (공간 절약 및 만화책 연출)**:
  - 전체 패널 수는 최소 ${targetCutCount}컷 이상이어야 하며, 약 ${pageTarget}장의 세로 페이지로 나누세요.
  - 기본값은 한 장(Cut)의 이미지 안에 ${minPanels}~${maxPanels}개의 만화 칸을 넣는 것입니다. ${generationSettings.allowSinglePanelKeyScenes === false ? "1컷 단독 이미지는 사용하지 마세요." : "1컷 단독 이미지는 강한 클로즈업, 감정 정지 컷, 충격 반전 컷일 때만 예외적으로 사용하세요."}
  - 정사각형 격자만 반복하지 말고 wide top panel, vertical side panel, diagonal split panel, inset close-up, overlapping reaction panel처럼 비대칭 구성을 섞으세요.
  - 각 칸마다 카메라 거리, 인물 위치, 표정, 배경, 효과선(action/speed lines), 집중선, 충격 효과, 분위기 효과를 영어 이미지 프롬프트에 상세히 넣으세요.
  - imagePrompt에는 반드시 "multi-panel comic page, ${minPanels}-${maxPanels} panels, asymmetric diagonal panel layout, clean white gutters, dynamic manhwa composition" 계열 문구를 포함하세요.
- **앱 말풍선 오버레이 + 텍스트 좌표 지정 (x, y 좌표계)**:
  - 앱에서 한국어 대사와 말풍선을 벡터 레이어로 얹을 것이므로 이미지 안에는 읽을 수 있는 글자를 절대 넣지 마세요.
  - 이미지에는 얼굴과 손을 가리지 않는 말풍선용 여백, 속도선, 집중선, 충격 별burst, 스크린톤, 감정 오라를 실제 만화처럼 구성하세요.
  - 가로 x축(5~95, 왼쪽에서 오른쪽) 및 세로 y축(5~95, 위에서 아래) 백분율 값으로 위치를 지정하십시오.
  - x/y는 이미지 속 빈 말풍선 또는 빈 박스의 중심 위치와 반드시 맞추십시오.
  - 대사/나레이션이 인물 얼굴을 가리지 않도록, 인물이 위치한 구도와 분할된 칸(Panel)의 내부 공간을 고려하여 적절한 x, y 값을 소수점 없이 정수로 결정하십시오. (예: 1번째 칸의 인물 대사는 y: 15~25, 2번째 칸의 대사는 y: 45~55, 3번째 칸은 y: 75~85 부근)
- **말풍선 타입 지정**:
  - 각 대사의 톤앤매너에 맞게 타입을 지정하세요: "normal" (일반 말풍선), "shout" (톱니바퀴형 외침 말풍선), "thought" (구름형 생각 말풍선), "narration" (사각 나레이션 박스)
- **글자 생성 억제**: 이미지 내부에 글자가 생성되지 않도록 영어 프롬프트 끝에 "safe negative space for app-rendered speech bubbles, comic SFX shapes without letters, no letters, no readable text, no words"를 반드시 붙이십시오.
- **화풍 일관성**: 지정된 작화 스타일(${meta.artStyle || "webtoon style"})을 프롬프트 처음에 명시하고, 캐릭터 이름과 함께 캐릭터의 상세 비주얼 설정(머리 스타일, 눈매, 옷 등)을 매 컷마다 반드시 묘사하여 일관성을 높이십시오.
- **연출 강도**: ${generationSettings.maturityLevel || "kiss"} ${generationSettings.maturityNote ? `/ 메모: ${generationSettings.maturityNote}` : ""}
- **분량**: 약 ${pageTarget}개의 이미지 페이지로 전체 에피소드를 흥미롭게 배분하세요.

반드시 아래 JSON 포맷으로만 응답해야 합니다. 마크다운(\`\`\`)을 쓰지 말고 순수 JSON 문자열만 반환하세요:
{
  "episode_title": "이번 화의 흥미진진한 제목",
  "cuts": [
    {
      "cutNumber": 1,
      "panelCount": 3,
      "panelLayout": "wide top panel + two diagonal lower panels",
      "effects": ["radial speed lines", "soft glow", "dramatic close-up inset", "impact starburst"],
      "imagePrompt": "영어 이미지 생성 프롬프트 (작화 스타일, 캐릭터 묘사, ${minPanels}~${maxPanels}패널 분할 연출구도, clean gutters, safe negative space for speech bubbles, no readable text)",
      "narration": "나레이션 내용 (없으면 빈값)",
      "dialogues": [
        {
          "speaker": "말하는 캐릭터 이름",
          "text": "대사 내용",
          "type": "normal|shout|thought|narration",
          "bubbleStyle": "normal|shout|thought|narration",
          "x": 35,
          "y": 20
        }
      ]
    }
  ]
}`;

        const charPrompts = (meta.characters || [])
          .map(
            (c: any) => `
[캐릭터: ${c.name}]
외모 설정 및 프롬프트: ${c.visualPrompt || c.description}
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

        const estimatedTextModel = (task: "scenario" | "character" | "storyboard" | "adult", settings: any) => {
          const useGemini = task === "scenario" || settings?.textProvider === "gemini" || !settings?.textEnabled;
          if (useGemini) return "gemini-3.5";
          return resolveWebtoonTextModel(settings, task, generationSettings?.maturityLevel);
        };

        await checkCancel();
        activeLogId = `episode-script-${episodeNumber}`;
        await updateWorkLog(projectRef, activeLogId, {
          category: 'episode',
          stepName: `제 ${episodeNumber}화 연출 콘티 및 대본 작성`,
          model: estimatedTextModel(generationSettings.maturityLevel === "mature" ? "adult" : "storyboard", localTextSettings),
          prompt: systemInstruction + "\n\n" + contextText,
          status: 'processing',
          estimatedSeconds: 20,
        });

        const response = await callWebtoonText(localTextSettings, {
          contents: [{ role: "user", parts: [{ text: systemInstruction + "\n\n" + contextText }] }],
        }, generationSettings.maturityLevel === "mature" ? "adult" : "storyboard", generationSettings.maturityLevel, abortController.signal);

        const responseText = extractText(response).trim();
        const textModel = response.__dongjeonAiSource?.model || "gemini-3.5";

        await updateWorkLog(projectRef, activeLogId, {
          category: 'episode',
          stepName: `제 ${episodeNumber}화 연출 콘티 및 대본 작성`,
          model: textModel,
          prompt: systemInstruction + "\n\n" + contextText,
          status: 'completed',
          estimatedSeconds: 20,
          result: responseText,
        });

        const script = JSON.parse(
          responseText.replace(/```json/g, "").replace(/```/g, "").trim()
        );

        if (!script || !script.cuts) {
          throw new Error("콘티 대본 파싱에 실패했습니다.");
        }

        // 이미지 생성 루프
        const baseSeed =
          Array.from(projectId as string).reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0) +
          episodeNumber * 10;

        const plannedCuts = [];
        for (let i = 0; i < script.cuts.length; i++) {
          const cut = script.cuts[i];
          const seed = baseSeed + i + Math.floor(Math.random() * 1000);
          const cleanStyle = cleanPromptText(meta.artStyle || "webtoon style");
          const characterLock = (meta.characters || [])
            .map((c: any) => `${c.name}: ${c.visualPrompt || c.description}`)
            .filter(Boolean)
            .join(" | ");
          const rawPanelCount = Number(cut.panelCount || maxPanels);
          const panelCount = Math.min(maxPanels, Math.max(generationSettings.allowSinglePanelKeyScenes === false ? minPanels : 1, rawPanelCount));
          const layout = cleanPromptText(cut.panelLayout || "asymmetric diagonal comic panel layout");
          const effects = Array.isArray(cut.effects) ? cut.effects.join(", ") : String(cut.effects || "expressive manga effects");
          const cleanPrompt = cleanPromptText(cut.imagePrompt);
          const finalPrompt = [
            cleanStyle,
            "masterpiece, best quality, premium Korean webtoon page, commercial manhwa production quality",
            "high resolution, crisp clean lineart, rich color grading, cinematic lighting",
            `${panelCount} panels on one vertical comic page`,
            layout,
            "clean white gutters, cinematic manhwa page composition",
            characterLock ? `character consistency lock: ${cleanPromptText(characterLock)}` : "",
            cleanPromptText(meta.worldview || ""),
            cleanPromptText(effects),
            cleanPrompt,
            "detailed eyes, detailed hands, correct fingers, detailed props, detailed background, accurate perspective",
            "consistent face, consistent hairstyle, consistent outfit, consistent body proportions, high-end Korean webtoon production quality",
            "leave clean safe areas for app-rendered speech bubbles, comic SFX shapes without letters, no letters, no readable text, no words"
          ].filter(Boolean).join(", ");
          plannedCuts.push({
            ...cut,
            panelCount,
            panelLayout: cut.panelLayout || layout,
            effects: Array.isArray(cut.effects) ? cut.effects : [],
            renderedBubbles: false,
            textOverlayMode: "vectorBubble",
            finalPrompt,
            seed,
          });
        }

        await updateDoc(projectRef, {
          progressMsg: `2단계: 제 ${episodeNumber}화 첫 1장 미리보기 렌더링 중...`,
        });

        const firstCut = plannedCuts[0];

        // 이미지 모델명 획득
        let imgModel = "Forge/ComfyUI Image Generator";
        if (localImageSettings?.imageProvider === "comfyui") {
          try {
            const comfyModels = await getComfyUiModels(normalizeBaseUrl(localImageSettings.imageEndpoint, "http://127.0.0.1:8188"));
            if (comfyModels?.ckpt_name) imgModel = comfyModels.ckpt_name;
          } catch {}
        } else if (localImageSettings?.imageProvider === "forge") {
          imgModel = "SD WebUI Forge (animagineXL)";
        }

        await checkCancel();
        activeLogId = `episode-${episodeNumber}-cut-1`;
        await updateWorkLog(projectRef, activeLogId, {
          category: 'image',
          stepName: `제 ${episodeNumber}화 1번째 컷 (미리보기) 이미지 렌더링`,
          model: imgModel,
          prompt: firstCut.finalPrompt,
          status: 'processing',
          estimatedSeconds: 160,
        });

        const localImageUrl = await createLocalImageIfEnabled(
          localImageSettings,
          firstCut.finalPrompt,
          1200,
          1800,
          firstCut.seed,
          "letters, readable text, words, watermark, logo, bad anatomy, malformed hands, low quality, blurry, mushy detail, broken panel borders, cluttered composition",
          "ultra",
          abortController.signal,
        );
        if (!localImageUrl) {
          await updateWorkLog(projectRef, activeLogId, {
            category: 'image',
            stepName: `제 ${episodeNumber}화 1번째 컷 (미리보기) 이미지 렌더링`,
            model: imgModel,
            prompt: firstCut.finalPrompt,
            status: 'failed',
            estimatedSeconds: 160,
          });
          throw new Error("웹툰 이미지는 로컬 ComfyUI/Forge 연결이 필요합니다.");
        }

        await updateWorkLog(projectRef, activeLogId, {
          category: 'image',
          stepName: `제 ${episodeNumber}화 1번째 컷 (미리보기) 이미지 렌더링`,
          model: imgModel,
          prompt: firstCut.finalPrompt,
          status: 'completed',
          estimatedSeconds: 160,
          result: localImageUrl,
        });
        const previewCuts = [{ ...firstCut, imageUrl: localImageUrl }];
        const remainingCuts = plannedCuts.slice(1);

        await updateDoc(projectRef, {
          status: "awaiting_episode_approval",
          progressMsg: "에피소드 첫 1장 미리보기 승인 대기 중입니다.",
          webtoonMeta: {
            ...meta,
            pendingApproval: {
              type: "episode_preview",
              episodeNumber,
              episodeTitle: script.episode_title || `제 ${episodeNumber}화`,
              script,
              previewCuts,
              remainingCuts,
              vibeMemo: "",
              createdAt: Date.now(),
            },
          },
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        console.error("Episode generation failed:", err);
        const isCancelled = err.message === "USER_CANCELLED" || abortController.signal.aborted;
        await updateDoc(projectRef, {
          status: "completed",
          progressMsg: isCancelled ? "에피소드 생성이 중단되었습니다." : `에피소드 생성 실패: ${err.message}`,
          cancelRequested: false,
          updatedAt: serverTimestamp(),
        });
      } finally {
        unsubCancel();
        if (lastActiveOllamaModel && lastOllamaSettings) {
          console.log("[Webtoon Episode Gen] Task complete or cancelled, unloading LLM model...");
          const modelToUnload = lastActiveOllamaModel;
          const settingsToUse = lastOllamaSettings;
          lastActiveOllamaModel = null;
          lastOllamaSettings = null;
          await unloadOllamaModel(settingsToUse, modelToUnload).catch(() => {});
        }
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
    // ✅ 에셋 파일은 immutable (hash가 있는 파일), index.html은 절대 캐시 금지
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else if (/\.[a-f0-9]{8,}\./.test(filePath)) {
          // hash가 포함된 에셋 (예: index-abc123.js)
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
