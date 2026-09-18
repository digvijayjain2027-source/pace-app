// Pace sync processor — run inside GitHub Actions.
// Reads any queued JSON files in sync-queue/, merges their newItems into
// the Firestore document at pace/appdata, then lets the workflow delete
// the processed files so they aren't reprocessed next run.

const fs = require("fs");
const path = require("path");

const FIREBASE_PROJECT_ID = "on-track-4c880";
const FIRESTORE_DOC_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pace/appdata`;

const QUEUE_DIR = path.join(process.cwd(), "sync-queue");

async function main() {
  if (!fs.existsSync(QUEUE_DIR)) {
    console.log("No sync-queue directory found — nothing to do.");
    return;
  }

  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No queued files — nothing to do.");
    return;
  }

  let newItems = [];
  for (const file of files) {
    const full = path.join(QUEUE_DIR, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
      if (Array.isArray(parsed.newItems)) {
        newItems = newItems.concat(parsed.newItems);
      }
    } catch (e) {
      console.error(`Failed to parse ${file}:`, e.message);
    }
  }

  if (newItems.length === 0) {
    console.log("Queued files had no items — nothing to sync.");
  } else {
    console.log(`Syncing ${newItems.length} item(s) to Firestore...`);

    const getResp = await fetch(FIRESTORE_DOC_URL);
    let current = { tasks: [], folders: [], stats: { xp: 0, level: 1, streak: 0, lastCompletionDate: null }, syncedFlags: {} };
    if (getResp.ok) {
      const doc = await getResp.json();
      current = fromFirestoreFields(doc.fields || {});
    }
    if (!current.tasks) current.tasks = [];
    if (!current.folders) current.folders = [];
    if (!current.stats) current.stats = { xp: 0, level: 1, streak: 0, lastCompletionDate: null };
    if (!current.syncedFlags) current.syncedFlags = {};

    let addedCount = 0;
    newItems.forEach(item => {
      const idSource = (item.title || "") + (item.date || "");
      const id = "gmailsync_" + Buffer.from(idSource, "utf8").toString("base64").slice(0, 16).replace(/[^a-zA-Z0-9]/g, "");
      if (!current.tasks.find(t => t.id === id)) {
        current.tasks.push({
          id,
          title: item.title || "Untitled",
          folder: item.folder || "inbox",
          date: item.date || "",
          time: item.time || "",
          notes: item.notes || "",
          type: item.type || "quest",
          remindMinutesBefore: item.remindMinutesBefore ?? 60,
          done: false,
          notified: false
        });
        addedCount++;
      }
    });

    const fields = toFirestoreFields(current);
    const patchResp = await fetch(FIRESTORE_DOC_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });

    if (!patchResp.ok) {
      const errText = await patchResp.text();
      throw new Error(`Firestore PATCH failed: ${errText}`);
    }

    console.log(`Done. Added ${addedCount} new task(s). Total tasks now: ${current.tasks.length}.`);
  }

  // Remove processed queue files so the next run doesn't resend them.
  for (const file of files) {
    fs.unlinkSync(path.join(QUEUE_DIR, file));
  }
  console.log(`Cleared ${files.length} processed queue file(s).`);
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
