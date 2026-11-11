const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

initializeApp();
const db = getDatabase();

const { onSchedule } = require("firebase-functions/v2/scheduler");

const MIN_RUN_MS = 0;
const MAX_RUN_MS = 25 * 60 * 60 * 1000;
const GRACE_SECONDS = 10;
const RUN_TTL_MS = 26 * 60 * 60 * 1000;

const TIME_ZONE = "America/New_York";

const opts = { maxInstances: 10, enforceAppCheck: true };

// For Billing Kill Switch
const { onMessagePublished } = require("firebase-functions/v2/pubsub");
const { CloudBillingClient } = require("@google-cloud/billing");
const PROJECT_ID = "mouser-e3cf5";
const KILL_THRESHOLD = 10;

function todayString() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

// PROFANITY FILTER - keep this updated in both places
const BANNED_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "pussy",
  "dick",
  "nigger",
  "nigga",
  "faggot",
  "fag",
  "retard",
];

  // server side high score message sanitization 
  function sanitizeMessage(message) {

    let message1 = message
      .replace(/[<>]/g, "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, "")
      .replace(/[^\p{L}\p{N} .,!?'"\-]/gu, "")
      .replace(/\s+/g, " ")
      .replace(/\b((https?:\/\/)|(www\.)|\w+\.\w{2,})[^\s]*\b/gi, "");

      BANNED_WORDS.forEach(word => {
        const wordRegex = new RegExp(`${word}`, "gi");
        message1 = message1.replace(wordRegex, "***")
      });

    return message1.slice(0, 50).trim();
  }

// issue run ID on game start in hard mode
exports.startRun = onCall(opts, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) {
    console.log("Rejected:", uid, "unauthenticated - Sign in first.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }

  const ref = db.ref("runs").push();
  await ref.set({ uid, startedAt: Date.now(), used: false });

  return { runId: ref.key };
});

// validate and push new high score
exports.submitScore = onCall(opts, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) {
    console.log("Rejected:", uid, "unauthenticated - Sign in first.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }

  const { runId, score, message } = req.data ?? {};

  if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(runId)) {
    console.log("Rejected:", uid, "invalid-argument - Bad run id.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0) {
    console.log("Rejected:", uid, "invalid-argument - Bad score.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }

  const finalScore = Math.round(score * 10) / 10;

  const cleanMessage = sanitizeMessage(String(message ?? ""));

  const runRef = db.ref(`runs/${runId}`);
  const runSnap = await runRef.get();

  if (!runSnap.exists()) {
    console.log("Rejected:", uid, "not-found - Unknown run.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }

  const run = runSnap.val();

  if (run.uid !== uid) {
    console.log("Rejected:", uid, "permission-denied - Not your run.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }

  const elapsed = Date.now() - run.startedAt;
  if (elapsed < MIN_RUN_MS) {
    console.log("Rejected:", uid, "failed-precondition - Run too short.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }
  if (elapsed > MAX_RUN_MS) {
    console.log("Rejected:", uid, "failed-precondition - Run expired.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }
  if (finalScore > elapsed / 1000 + GRACE_SECONDS) {
    console.log("Rejected:", uid, "failed-precondition - Score exceeds elapsed time.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }

  const claim = await runRef.child("used").transaction((used) => {
    if (used === true) return;
    return true;
  });

  if (!claim.committed) {
    console.log("Rejected:", uid, "failed-precondition - Run already submitted.");
    throw new HttpsError("failed-precondition", "Score rejected.");
  }

  const today = todayString();

  const topSnap = await db.ref("dailyHighscore")
    .orderByChild("score")
    .limitToLast(1)
    .get();

  let currentBest = 0;
  topSnap.forEach((child) => { currentBest = child.val().score; });

  const beat = finalScore > currentBest;

  if (beat) {
    await db.ref("dailyHighscore").push({
      score: finalScore,
      message: cleanMessage,
      uid: uid,
      date: today,
      at: Date.now(),
    });
  }

  return { ok: true, beat, score: finalScore };

});

// remove old entries from runs database daily
exports.cleanupRuns = onSchedule(
  { schedule: "30 4 * * *", timeZone: TIME_ZONE, maxInstances: 1 },
  async () => {
    const cutoff = Date.now() - RUN_TTL_MS;
    const snap = await db.ref("runs").orderByChild("startedAt").endAt(cutoff).get();

    if (!snap.exists()) {
      console.log("Cleanup: nothing to remove.");
      return;
    }

    const updates = {};
    snap.forEach((child) => {
      updates[child.key] = null;
    });

    await db.ref("runs").update(updates);
    console.log(`Cleanup: removed ${Object.keys(updates).length} runs.`);
  }
);

// clear high score at midnight daily
exports.dailyReset = onSchedule(
  { schedule: "0 0 * * *", timeZone: TIME_ZONE, maxInstances: 1 },
  async () => {
    await db.ref("dailyHighscore").remove();
    console.log("Daily reset complete.");
  }
);

// Billing Kill Switch
exports.killBilling = onMessagePublished(
  { topic: "billing-alerts", maxInstances: 1 },
  async (event) => {
    const data = event.data.message.json;
    const cost = data.costAmount ?? 0;

    console.log(`Budget alert: cost ${cost}, threshold ${KILL_THRESHOLD}`);

    if (cost < KILL_THRESHOLD) return;

    const billing = new CloudBillingClient();
    const name = `projects/${PROJECT_ID}`;

    const [info] = await billing.getProjectBillingInfo({ name });
    if (!info.billingAccountName) {
      console.log("Billing already disabled.");
      return;
    }

    await billing.updateProjectBillingInfo({
      name,
      projectBillingInfo: { billingAccountName: "" },
    });

    console.log("BILLING DISABLED.");
  }
);

