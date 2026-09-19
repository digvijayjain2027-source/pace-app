// Pace reminder sender — run inside GitHub Actions every ~15 minutes.
// Reads pace/appdata from Firestore, finds tasks whose reminder window has
// arrived and haven't been push-notified yet, and sends a real Web Push
// notification (works even if the phone/browser is closed) via web-push.

const webpush = require("web-push");

const FIREBASE_PROJECT_ID = "on-track-4c880";
const FIRESTORE_DOC_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pace/appdata`;

const VAPID_PUBLIC_KEY = "BBS-NBvXETo4YN8_eTL8l6XyHv84crYV-NS3pnkhhOf59tsaDnkbK07t70a_BW0DQe_vJsV7KxXVcYc1ygJKwbY";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!VAPID_PRIVATE_KEY) {
  console.error("VAPID_PRIVATE_KEY env var is missing — set it as a GitHub Actions secret.");
  process.exit(1);
}

webpush.setVapidDetails("mailto:digvijay.jain2027@mastersunion.org", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function main() {
  const getResp = await fetch(FIRESTORE_DOC_URL);
  if (!getResp.ok) {
    console.error("Failed to read Firestore doc:", await getResp.text());
    process.exit(1);
  }
  const doc = await getResp.json();
  const current = fromFirestoreFields(doc.fields || {});
  const tasks = current.tasks || [];
  const subscription = current.pushSubscription;

  if (!subscription || !subscription.endpoint) {
    console.log("No push subscription saved yet — nothing to send.");
    return;
  }

  const now = new Date();
  let changed = false;
  let sentCount = 0;
  let subscriptionExpired = false;

  for (const t of tasks) {
    if (t.done || !t.date || t.pushNotified) continue;
    const dt = new Date(t.date + "T" + (t.time || "09:00"));
    const lead = t.type === "reminder" ? (t.remindMinutesBefore ?? 60) : 60;
    const diffMin = (dt - now) / 60000;

    // Window: due within the lead time, and not more than ~20 min overdue
    // (covers the gap between 15-min cron runs without spamming old tasks).
    if (diffMin <= lead && diffMin > -20) {
      const prefix = t.type === "reminder" ? "🔔 Reminder: " : "Due soon: ";
      const payload = JSON.stringify({
        title: prefix + t.title,
        body: t.notes || "Open Pace to see details.",
        url: "./",
        tag: "pace-" + t.id
      });

      try {
        await webpush.sendNotification(subscription, payload);
        console.log(`Sent push for: ${t.title}`);
        t.pushNotified = true;
        changed = true;
        sentCount++;
      } catch (err) {
        console.error(`Push failed for "${t.title}":`, err.statusCode, err.body || err.message);
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription is gone (user revoked, browser data cleared, etc).
          subscriptionExpired = true;
        }
      }
    }
  }

  if (subscriptionExpired) {
    current.pushSubscription = null;
    changed = true;
    console.log("Subscription expired/invalid — cleared it. User needs to re-enable notifications.");
  }

  if (changed) {
    current.tasks = tasks;
    const fields = toFirestoreFields(current);
    const patchResp = await fetch(FIRESTORE_DOC_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    if (!patchResp.ok) {
      console.error("Failed to write back updated doc:", await patchResp.text());
      process.exit(1);
    }
  }

  console.log(`Done. Sent ${sentCount} notification(s).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

// ── Generic JS <-> Firestore REST typed-value converters ──────────────────

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFirestoreFields(v) } };
  return { stringValue: String(v) };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const key of Object.keys(obj)) {
    fields[key] = toFirestoreValue(obj[key]);
  }
  return fields;
}

function fromFirestoreValue(v) {
  if (v.nullValue !== undefined) return null;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if (v.mapValue !== undefined) return fromFirestoreFields(v.mapValue.fields || {});
  return null;
}

function fromFirestoreFields(fields) {
  const obj = {};
  for (const key of Object.keys(fields)) {
    obj[key] = fromFirestoreValue(fields[key]);
  }
  return obj;
}
