import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { readFileSync } from "fs";
import path from "path";

async function debugFirestore() {
  const firebaseConfig = JSON.parse(
    readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf-8")
  );
  const firebaseApp = initializeApp(firebaseConfig);
  const db = getFirestore(firebaseApp);

  console.log("Fetching webtoon projects...");
  const postsSnap = await getDocs(collection(db, "posts"));
  postsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.channelId === "webtoon" || doc.id === "AI 기획 웹툰 프로젝트") {
      console.log(`\nProject ID: ${doc.id}`);
      console.log(`Title: ${data.title}`);
      console.log(`Status: ${data.status}`);
      console.log(`Progress Message: ${data.progressMsg}`);
      console.log(`Meta:`, JSON.stringify(data.webtoonMeta, null, 2));
      console.log(`Work Logs:`, JSON.stringify(data.workLogs, null, 2));
    }
  });
}

debugFirestore().catch(console.error);
