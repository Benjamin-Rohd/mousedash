import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-analytics.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-functions.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app-check.js";

const firebaseConfig = {
  apiKey: "AIzaSyDGYoH04YIgh0JW6VLHByhFzGkUKqhBohs",
  authDomain: "mouser-e3cf5.firebaseapp.com",
  databaseURL: "https://mouser-e3cf5-default-rtdb.firebaseio.com",
  projectId: "mouser-e3cf5",
  storageBucket: "mouser-e3cf5.firebasestorage.app",
  messagingSenderId: "842886539734",
  appId: "1:842886539734:web:0fa5f3720fc1479b4f9c77",
  measurementId: "G-0FEE9YHHWF"
};

const TIME_ZONE = "America/New_York";

const app = initializeApp(firebaseConfig);

if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6LeiSZUtAAAAAN-fWuhtR29WjlLko7hVjJsd7fDA"), // site key
  isTokenAutoRefreshEnabled: true,
});

const analytics = getAnalytics(app);
const database = getDatabase(app);
const auth = getAuth(app);
const functions = getFunctions(app);

const startRunFn = httpsCallable(functions, "startRun");
const submitScoreFn = httpsCallable(functions, "submitScore");

const ready = signInAnonymously(auth).catch((err) => {
  console.error("Sign-in failed:", err);
});

let currentRunId = null;

function todayString() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

export async function beginGame() {
  currentRunId = null;
  try {
    await ready;
    const res = await startRunFn();
    currentRunId = res.data.runId;
    //console.log("Run started:", currentRunId);
  } catch (err) {
    console.error("Could not start run:", err.code, err.message);
  }
}

export async function endGame(score, message) {
  if (!currentRunId) {
    console.warn("No run in progress; score not submitted.");
    return { ok: false };
  }
  const runId = currentRunId;
  currentRunId = null;

  try {
    const res = await submitScoreFn({
      runId,
      score,
      message: message ?? "",
    });
    return res.data;
  } catch (err) {
    console.error("Score rejected:", err.code, err.message);
    return { ok: false, error: err.message };
  }
}

export function watchHighscore(callback) {
  onValue(ref(database, "dailyHighscore"), (snap) => {
    const rec = snap.val();
    if (!rec || rec.day !== todayString()) {
      callback(null);
    } else {
      callback(rec);
    }
  });
}

export { app, analytics, database };