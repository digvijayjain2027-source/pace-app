// Pace sync processor — run inside GitHub Actions.
//
// Reads any queued JSON files in sync-queue/, and atomically APPENDS their
// newItems onto the Firestore document at pace/appdata's `tasks` array —
// it never overwrites the whole document. This matters: the app itself
// also reads-and-rewrites the whole document on every change, and a plain
// overwrite here could silently race with that and erase whatever the app
// just saved (this happened for real — see backfill-2026-09-20b.json).
// Firestore's `appendMissingElements` transform is applied server-side
// against whatever the document looks like at that instant, so it can't
// be clobbered by a concurrent write the way a full overwrite can.

const fs = require("fs");
const path = require("path");

const FIREBASE_PROJECT_ID = "on-track-4c880";
const DOC_PATH = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/pace/appdata`;
const FIRESTORE_DOC_URL = `https://firestore.googleapis.com/v1/${DOC_PATH}`;
const FIRESTORE_COMMIT_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`;
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
      if (Array.isArray(parsed.newItems)) newItems = newItems.concat(parsed.newItems);
    } catch (e) {
      console.error(`Failed to parse ${file}:`, e.message);
    }
  }

  if (newItems.length === 0) {
    console.log("Queued files had no items — nothing to sync.");
  } else {
    // Read current tasks only to dedupe by id — a stale read here is safe,
    // because the actual write below is an atomic append, not an overwrite.
    const getResp = await fetch(FIRESTORE_DOC_URL);
    let existingIds = new Set();
    if (getResp.ok) {
      const doc = await getResp.json();
      const tasksField =
        (doc.fields && doc.fields.tasks && doc.fields.tasks.arrayValue && doc.fields.tasks.arrayValue.values) || [];
      tasksField.forEach(v => {
        const idVal = v.mapValue && v.mapValue.fields && v.mapValue.fields.id && v.mapValue.fields.id.stringValue;
        if (idVal) existingIds.add(idVal);
      });
    } else {
      console.error(
        `Warning: could not read current document (status ${getResp.status}) — id dedupe list may be incomplete, but the atomic append below is still safe from data loss.`
      );
    }

    const toAdd = [];
    newItems.forEach(item => {
      const idSource = (item.title || "") + (item.date || "");
      const id =
        "gmailsync_" + require("crypto").createHash("sha256").update(idSource, "utf8").digest("hex").slice(0, 20);
      if (!existingIds.has(id)) {
        toAdd.push({
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
        existingIds.add(id);
      }
    });

    if (toAdd.length === 0) {
      console.log("All queued items already exist in Firestore — nothing new to append.");
    } else {
      const commitResp = await fetch(FIRESTORE_COMMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          writes: [
            {
              transform: {
                document: DOC_PATH,
                fieldTransforms: [
                  {
                    fieldPath: "tasks",
                    appendMissingElements: { values: toAdd.map(toFirestoreValue) }
                  }
                ]
              }
            }
          ]
        })
      });
      if (!commitResp.ok) {
        const errText = await commitResp.text();
        throw new Error(`Firestore atomic append failed: ${errText}`);
      }
      console.log(`Done. Appended ${toAdd.length} new task(s) atomically.`);
    }
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

// ── Generic JS -> Firestore REST typed-value converter ─────────────────────

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
