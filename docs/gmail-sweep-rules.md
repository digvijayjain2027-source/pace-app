# Gmail Sweep Rules

Categorization rules for the hourly Gmail → Pace sync task. Applied to messages
in `digvijay.jain2027@mastersunion.org`'s inbox received in the last hour.

For each rule below, "surface as a task" means the sync should produce an item
with `"type": "quest"` (or another task-shaped type); "show as a reminder"
means a lighter-weight, non-task item. "Ignore completely" / "ignore entirely"
means the email produces no item at all — do not include it in the output.

1. **Unstop / career-services competition and opportunity emails** — always
   surface as a task.
2. **Club / social invites** (e.g. Frat Gala, welcome events) — always surface
   as a task.
3. **Newsletter-style reads** (The Ken, Nas.io, Unstop.news marketing blasts)
   — ignore completely; do not show.
4. **Routine "Upcoming Class Alert" 1hr-before-session reminders** — ignore
   entirely.
5. **Submission / feedback confirmations** — show only if the assignment or
   feedback is still pending; once completion is confirmed, do not show.
6. **Room-booked confirmations** — show as a simple reminder, not a task.
7. **Admin deadline forms** (domain preference, logistics with close dates)
   — always show as a task, regardless of time remaining.
8. **Unstop.news bulk promos mentioning opportunities** — ignore; only
   career-services-sourced opportunities count (rule 1), not bulk promo
   mentions.

## Notes for the sync task

- Rule 8 disambiguates rule 1: an opportunity mentioned inside an
  Unstop.news bulk promotional blast does not qualify — only opportunities
  sourced directly from career services do.
- When a rule says "ignore," the email must not produce an item in the
  sync-queue output at all.
