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

const opts = { maxInstances: 10 };

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

  function sanitizeMessage(message) {

    let message1 = message
      .replace(/[<>]/g, "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, "")
      .replace(/[^\p{L}\p{N} .,!?'"\-]/gu, "")
      .replace(/\s+/g, " ")
      .replace(/\b((https?:\/\/)|(www\.)|\w+\.\w{2,})[^\s]*\b/gi, "");

    //const message2 = filter.clean(message1);
      BANNED_WORDS.forEach(word => {
        const wordRegex = new RegExp(`${word}`, "gi");
        message1 = message1.replace(wordRegex, "***")
      });

    return message1.slice(0, 50).trim();
  }

exports.startRun = onCall(opts, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const ref = db.ref("runs").push();
  await ref.set({ uid, startedAt: Date.now(), used: false });

  return { runId: ref.key };
});

exports.submitScore = onCall(opts, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

  const { runId, score, message } = req.data ?? {};

  if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(runId)) {
    throw new HttpsError("invalid-argument", "Bad run id.");
  }
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0) {
    throw new HttpsError("invalid-argument", "Bad score.");
  }

  const finalScore = Math.round(score * 10) / 10;

  // const cleanMessage = String(message ?? "")
  //   .replace(/[\u0000-\u001F\u007F]/g, "")
  //   .slice(0, 100)
  //   .trim();
  const cleanMessage = sanitizeMessage(String(message ?? ""));

  const runRef = db.ref(`runs/${runId}`);
  const runSnap = await runRef.get();

  if (!runSnap.exists()) {
    throw new HttpsError("not-found", "Unknown run.");
  }

  const run = runSnap.val();

  if (run.uid !== uid) {
    throw new HttpsError("permission-denied", "Not your run.");
  }

  const elapsed = Date.now() - run.startedAt;
  if (elapsed < MIN_RUN_MS) {
    throw new HttpsError("failed-precondition", "Run too short.");
  }
  if (elapsed > MAX_RUN_MS) {
    throw new HttpsError("failed-precondition", "Run expired.");
  }
  if (finalScore > elapsed / 1000 + GRACE_SECONDS) {
    throw new HttpsError("failed-precondition", "Score exceeds elapsed time.");
  }

  const claim = await runRef.child("used").transaction((used) => {
    if (used === true) return;
    return true;
  });

  if (!claim.committed) {
    throw new HttpsError("failed-precondition", "Run already submitted.");
  }

  const today = todayString();
  let beat = false;

  await db.ref("dailyHighscore").transaction((cur) => {
    if (cur && cur.day === today && cur.score >= finalScore) {
      beat = false;
      return;
    }
    beat = true;
    return { day: today, message: cleanMessage, score: finalScore, at: Date.now() };
  });

  return { ok: true, beat, score: finalScore };
});



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

