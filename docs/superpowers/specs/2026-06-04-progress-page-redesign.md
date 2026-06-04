# Progress Page Redesign — Design Spec

**Date:** 2026-06-04

---

## Goal

Replace the sparse Progress tab with four purposeful sections: Appointments (question queue + history), Growth chart (WHO curves), Foods tried (per-food reaction breakdown), and Rejected foods. Remove the reactions bar chart and stats row. Add Uma chat integration for queueing doctor questions.

---

## Scope

Files that change:
- `web/public/index.html` — Progress tab HTML + JS
- `web/server.js` — new API endpoints
- `agents/meredith/SOUL.md` — intent detection instruction appended

New data files created at runtime:
- `agents/appointments/APPOINTMENTS.json`
- `agents/growth/GROWTH.json`

New static data in server:
- WHO weight-for-age and length-for-age percentile lookup tables (girls, 0–24m) baked into `server.js`

New CDN dependency:
- Chart.js 4.x via CDN (`<script src="https://cdn.jsdelivr.net/npm/chart.js">`)

---

## Page Structure

Progress tab renders four sections top-to-bottom inside `#tab-progress`:

1. Appointments
2. Growth chart
3. Foods tried
4. Rejected foods

The existing stats row (Days on solids / Foods tried / Milestones cards) and reactions bar chart are removed.

---

## Section 1: Appointments

### Data Model

File: `agents/appointments/APPOINTMENTS.json`

```json
[
  {
    "id": "appt_1748995200000",
    "date": "2026-06-15",
    "height": null,
    "weight": null,
    "questions": [
      {
        "id": "q_1748995200001",
        "text": "Is the crawling timeline normal?",
        "timestamp": "2026-06-04T10:23:00.000Z",
        "source": "manual",
        "answered": false,
        "answer": ""
      }
    ]
  }
]
```

`source`: `"manual"` | `"chat"` (added by Uma).

Appointments sorted by `date` ascending. The first appointment with `date >= today` is "next." All others are "past."

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/appointments` | Return all appointments sorted by date |
| POST | `/api/appointments` | Create appointment `{ date }` → returns new appointment |
| PATCH | `/api/appointments/:id` | Update date, height, weight on an appointment |
| POST | `/api/appointments/:id/questions` | Add question `{ text, source }` → returns new question |
| PATCH | `/api/appointments/:id/questions/:qid` | Update question: `{ answered, answer }` or `{ text }` |
| DELETE | `/api/appointments/:id/questions/:qid` | Delete question |
| POST | `/api/appointments/:id/questions/:qid/move` | Move question to next upcoming appointment |

### Frontend: Next Appointment Card

Renders as an expanded card. Always the topmost appointment card.

```
┌─────────────────────────────────────────┐
│ 📅 Next appointment                     │
│ [____2026-06-15____]  ← date picker     │
│                                         │
│ Questions for the doctor                │
│ ┌─────────────────────────────────────┐ │
│ │ ○ Is crawling timeline normal?      │ │
│ │   4 Jun · ✓ Answered  → Move  🗑   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [________________________] [+ Add]      │
└─────────────────────────────────────────┘
```

**Question list behaviour:**
- Unanswered questions shown first
- Answered questions shown below with green "Answered ✓" chip, collapsed (tap to expand and see answer text)
- `✓ Answered` action: reveals inline textarea "Add answer (optional)" + "Save" button; on save, question gets answered chip
- `→ Move` action: moves question to next-in-line appointment's question list. If no other appointment exists, question stays and shows a toast "No next appointment — create one first"
- `🗑 Delete` action: removes question immediately (no confirm — it's low stakes)

**If no next appointment exists:**
- Card shows "No upcoming appointment — set a date to start" with just the date picker

### Frontend: Past Appointment Cards

Collapsed by default. Accordion, one open at a time.

Collapsed view:
```
▶ 15 Apr 2026  ·  3 questions  ·  6.2 kg  ·  62 cm
```

Expanded view shows:
- Date header
- Height / weight display (or "No measurements recorded" if null)
- Full question list (read-only, answered/unanswered visible)

If `height` and `weight` are null on a past appointment → show a compact inline form to fill them in retrospectively.

### State

```js
let appointmentsData = [];   // loaded on progress tab open
```

`loadProgress()` fetches `/api/appointments` and stores in `appointmentsData`.

---

## Section 2: Growth Chart

### Data Model

File: `agents/growth/GROWTH.json`

```json
[
  {
    "id": "g_1748995200000",
    "date": "2026-06-04",
    "heightCm": 65.5,
    "weightKg": 7.2
  }
]
```

Entries sorted by `date` ascending. Any date allowed (retrofill supported).

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/growth` | Return all entries sorted by date |
| POST | `/api/growth` | Add entry `{ date, heightCm, weightKg }` → returns new entry |
| PATCH | `/api/growth/:id` | Edit entry |
| DELETE | `/api/growth/:id` | Delete entry |
| GET | `/api/growth-curves` | Return WHO percentile tables for girls 0–24m |

### WHO Growth Curves

`GET /api/growth-curves` returns static precomputed data baked into server.js:

```json
{
  "weight": {
    "months": [0,1,2,3,4,5,6,7,8,9,10,11,12,15,18,21,24],
    "p3":  [2.4,3.2,3.9,4.5,5.0,5.4,5.7,6.0,6.3,6.6,6.8,7.0,7.1,7.6,8.1,8.6,9.0],
    "p15": [2.8,3.6,4.5,5.2,5.7,6.1,6.5,6.8,7.1,7.4,7.7,7.9,8.1,8.7,9.2,9.7,10.2],
    "p50": [3.2,4.2,5.1,5.8,6.4,6.9,7.3,7.6,7.9,8.2,8.5,8.7,8.9,9.6,10.2,10.9,11.5],
    "p85": [3.7,4.8,5.8,6.6,7.3,7.8,8.3,8.7,9.1,9.4,9.7,10.0,10.2,11.0,11.8,12.5,13.2],
    "p97": [4.2,5.5,6.6,7.5,8.2,8.8,9.3,9.8,10.2,10.5,10.9,11.2,11.5,12.4,13.2,14.0,14.8]
  },
  "height": {
    "months": [0,1,2,3,4,5,6,7,8,9,10,11,12,15,18,21,24],
    "p3":  [44.8,48.9,52.4,55.3,57.7,59.6,61.2,62.7,64.0,65.3,66.5,67.6,68.6,72.0,75.0,77.5,80.0],
    "p15": [46.1,50.2,53.8,56.7,59.1,61.1,62.7,64.3,65.6,67.0,68.2,69.3,70.4,73.8,76.9,79.6,82.1],
    "p50": [49.1,53.7,57.1,59.8,62.1,64.0,65.7,67.3,68.7,70.1,71.5,72.8,74.0,77.5,80.7,83.5,86.4],
    "p85": [51.0,55.6,59.1,61.9,64.3,66.2,68.0,69.6,71.1,72.5,73.8,75.2,76.6,80.2,83.5,86.4,89.4],
    "p97": [52.9,57.6,61.1,64.0,66.4,68.5,70.3,71.9,73.5,74.9,76.3,77.7,79.2,82.9,86.4,89.3,92.4]
  }
}
```

Source: WHO Child Growth Standards (girls, length/height-for-age and weight-for-age, 0–24 months).

### Frontend: Input Form

Always visible above chart. 2×2 grid layout:

```
Date          Height (cm)
[2026-06-04]  [65.5     ]

Weight (kg)   
[7.2      ]   [+ Add entry]
```

Each saved entry shows inline with a pencil edit icon:
```
4 Jun 2026  ·  65.5 cm  ·  7.2 kg   ✏
```

Edit mode: fields become editable inline, "Save" replaces the pencil.

### Frontend: Chart

Two `<canvas>` elements stacked: Height chart above, Weight chart below. Chart.js 4.x.

Each chart:
- X-axis: age in months (computed as `(entryDate - dob) / 30.44`)
- Y-axis: measurement value
- WHO percentile bands rendered as `fill: true` datasets between p3–p15 (light), p15–p85 (medium), p85–p97 (light)
- Baby's data: bold line, dot per entry, peach colour (weight) / sage colour (height)

**< 2 entries**: canvas hidden, grey placeholder div shown: "Add 2 or more measurements to see the chart"

Chart instance refs stored as `growthHeightChart` and `growthWeightChart` — destroyed and recreated on data change.

---

## Section 3 & 4: Foods Tried + Rejected Foods

### Data Source

Aggregated from daily logs (`logs/YYYY-MM-DD.json`). Server scans all log files, groups meal entries by `meal.food` (lowercased), counts reactions per food. Each meal slot entry has shape `{ food, eaten, reaction, notes }`. Only entries with a non-null `food` are counted.

### New API Endpoint

`GET /api/foods-summary` returns:

```json
[
  {
    "name": "banana",
    "totalEntries": 8,
    "reactions": { "Loved": 5, "Liked": 2, "Neutral": 1, "Disliked": 0 },
    "rejected": false
  },
  {
    "name": "beetroot",
    "totalEntries": 3,
    "reactions": { "Loved": 0, "Liked": 0, "Neutral": 1, "Disliked": 2 },
    "rejected": true
  }
]
```

`rejected: true` when `Disliked > 0`. No "Refused" reaction value exists in logs — only Loved/Liked/Neutral/Disliked are valid reaction values.

### Frontend: Foods Tried Section

All foods where `rejected: false`. Collapsed accordion per food.

**Collapsed:**
```
🍌 banana   😍  ×8   ›
```
Dominant emoji = reaction with highest count.

**Expanded:**
```
🍌 banana   ×8
████████░░  Loved  5
████░░░░░░  Liked  2
██░░░░░░░░  Neutral 1
```
Stacked horizontal bars, proportional widths, color-coded:
- Loved: `#FACC15` (yellow)
- Liked: `#4ADE80` (green)
- Neutral: `#94A3B8` (slate)
- Disliked: `#F87171` (red)

### Frontend: Rejected Foods Section

Same accordion design. Foods where `rejected: true`.

Collapsed shows 😖 emoji. Same expanded breakdown.

If no rejected foods: "No rejected foods yet 🎉"

---

## Uma Chat Integration

### Intent Detection

Uma's system prompt gains this instruction:

```
When the parent mentions wanting to ask the doctor something — phrases like "ask the doctor", "mention to the doctor", "should I check with the doctor", "at the next appointment" — respond normally, then append a JSON block at the very end of your response:

<appointment_question>{"text": "<extracted question in one sentence>"}
```

### Frontend Interception

`renderChatMessage()` checks for `<appointment_question>` block in Uma's response. If found:
- Strips the block from displayed text
- Renders a confirmation card below the message:

```
┌──────────────────────────────────────┐
│ 📋 Add to appointment questions?     │
│ "Is the crawling timeline normal?"   │
│                                      │
│  [Add]  [Dismiss]                   │
└──────────────────────────────────────┘
```

Tapping **Add**:
1. POST to `/api/appointments/:nextApptId/questions` with `{ text, source: "chat" }`
2. Confirmation card updates to show: "Added ✓ — Want to add more details?" with an inline text field + "Save" button (no AI call — purely UI)
3. Parent types details + taps Save → PATCH `/api/appointments/:id/questions/:qid` with updated text
4. Parent dismisses → card collapses, question saved as-is

If no next appointment exists when Add is tapped: toast "Set an upcoming appointment date first"

---

## Edge Cases

- **No appointments yet**: Appointments section shows only "No upcoming appointment — set a date to start" card with date picker
- **Move question, no next appointment**: toast, question stays
- **Growth entry with future date**: allowed (spec a planned measurement), appears on chart at correct age-month position
- **Food name case sensitivity**: server normalises to lowercase when aggregating
- **Uma intent but ambiguous question**: Uma extracts best-effort one-sentence version; parent can edit before saving

---

## What Does NOT Change

- Today tab, Chat tab, Plans tab, Milestones tab — untouched
- Existing `/api/milestone-achievements`, `/api/milestones-data`, food log endpoints — unchanged
- `BABY-PROFILE.json` — `gender: "girl"` already present, no change needed
