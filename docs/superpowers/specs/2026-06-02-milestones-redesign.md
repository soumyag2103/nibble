# Milestones Page Redesign — Design Spec

**Goal:** Replace the flat achieved/upcoming list with a theme-grouped summary table + expandable 4-section detail panel, giving parents a clear picture of where their child stands across all developmental domains this month.

**Date:** 2026-06-02

---

## Overview

Current milestones page: summary strip (3 big numbers) + flat "Achieved" list + "Month N check-in" list + "Month N+1 coming up" list. No theme grouping, no urgency signalling, no ahead-of-schedule visibility.

New milestones page:
1. Toggle (This Month / All Time) at top
2. Theme summary table — one row per theme, clickable
3. Detail panel — 4 sections — opens below table when a theme row is tapped
4. No separate next-month preview card at the page bottom

---

## Data Model

### Existing Data (no server changes needed)

**`MILESTONES_DATA`** (44 items, months 5–9):
```js
{ id, month, label, category }  // category: 'Motor'|'Language'|'Social'|'Cognitive'|'Feeding'
```

**Achievement records** (`/api/milestone-achievements`):
```js
{ id, name, category, month, status, dateLogged, notes }
// status: 'within' | 'ahead' | 'significantly_ahead'
```

### Derived values (computed in `renderMilestones()`)

For a given theme and `age.months` (current age):

| Column | Derivation |
|--------|-----------|
| **Due** | `MILESTONES_DATA.filter(m => m.month === age.months && m.category === theme).length` |
| **Achieved** | `achievements.filter(a => a.category === theme && MILESTONES_DATA.find(m => m.id === a.id && m.month === age.months))` — i.e., achievements that map to a current-month milestone |
| **Ahead+** | `achievements.filter(a => a.category === theme && MILESTONES_DATA.find(m => m.id === a.id && m.month > age.months))` — future-month milestones already logged |

Ahead+ is additive and independent of Due. A milestone in Ahead+ cannot also be in Due (different months).

### Cutoff dates

Hardcoded map per milestone id, derived from MILESTONE-MASTER.md. Stored in a `MILESTONE_CUTOFFS` object in index.html:
Full map in the "Milestone Cutoffs Map" section below.

"Near cutoff" = baby is within 2 months of the cutoff age. At age 7m, a milestone with cutoff 10m is NOT near cutoff. A milestone with cutoff 9m IS near cutoff. Show "Ask doctor" CTA only when near cutoff.

---

## UI Structure

### Toggle

Two-pill toggle at top of milestones tab:
- **This Month** — default active (peach fill)
- **All Time** — inactive (white + border)

In This Month view: Due column = current month only, detail panel shows current-month sections.
In All Time view: Due column = all months up to and including current age, detail panel shows lifetime achievements grouped by theme.

> **Scope note:** All Time view changes the summary table counts only — the detail panel always shows the same 4 sections (Achieved / Pending / Ahead / Upcoming), just with All Time counts. This is a stretch goal; implement This Month view first, gate All Time for later.

### Summary Table

```
[ Theme  ]  [ Due ]  [ Achieved ]  [ Ahead+ ]
  🏃 Motor     4          3           2
  💬 Social    3          3           —
  🗣 Language  2          1           —
  🧠 Cognitive 2          2           1
  🥄 Feeding   2          1           —
```

- Header row: gray background, 10px uppercase labels
- Data rows: tappable, hover highlight (warm peach tint)
- Active row (detail open): orange text + orange left indicator `◀`
- Achieved column: green if count > 0, gray if 0
- Ahead+ column: orange if count > 0, `—` (em-dash) if 0 (display only, not typography em-dash)
- Due column: neutral black

Themes rendered in order: Motor → Language → Social → Cognitive → Feeding.

### Detail Panel

Opens below the summary table when a theme row is tapped. Closes on `✕` tap or tapping same row again.

Border: `1.5px solid #f97316` (orange). Corner radius 12px.

**Header:**
```
🏃 Motor milestones              ✕
7 months · 4 due · 3 achieved · 2 ahead · 3 upcoming
```

---

#### Section 1 — Achieved this month

Label: `✓ Achieved this month · N of M` (green)

One card per achievement from this month's Due list. First card expanded (shows parent note if present), rest collapsed.

Expanded card:
```
[✓ green circle]  Sits unsupported
                  Logged 27 May 2026 · On track
                  "Sitting for 5 minutes without support today"
```

Collapsed card:
```
[✓ green circle]  Rolls in both directions
                  Logged 26 May 2026 · On track
```

If 0 achieved: show `No achievements logged yet for this theme this month.` in gray.

---

#### Section 2 — Still pending

Label: `○ Still pending · N of M` (red if N > 0, gray if 0)

One card per current-month Due milestone NOT yet in achievements.

**Standard pending card** (milestone not near cutoff):
```
[○ circle]  Pincer grasp
            Not yet achieved
            [gradient timeline bar: green → orange → red]
            Expected at: 7m               Discuss by 12m
```

**Near-cutoff pending card** (baby within 2m of cutoff):
```
[○ circle]  Pincer grasp
            Not yet achieved
            [gradient timeline bar with "now" marker]
            Expected at: 7m               Discuss by 9m
            ─────────────────────────────────────────
            Getting close to cutoff              [+ Ask doctor]
```

The "now" marker is a thin black vertical line positioned at `((age.months - m.month) / (MILESTONE_CUTOFFS[m.id] - m.month)) * 100%` along the bar, where `m.month` is the MILESTONES_DATA entry's month (the typical start) and `MILESTONE_CUTOFFS[m.id]` is the discuss-by cutoff. Clamp result to 0–100%.

"+ Ask doctor" button: orange, rounded. Tapping it pre-fills the doctor questions queue chat flow (just sends a message to Uma: `"I want to ask about [milestone name]"` — not wired to a separate endpoint, just pre-fills chat input and switches to chat tab).

If 0 pending: omit this section entirely (don't show the label).

---

#### Section 3 — Ahead of schedule

Label: `⭐ Ahead of schedule · N bonus` (orange)

One card per Ahead+ achievement for this theme.

```
[⭐]  Pulls to stand                    2m early
      Typical: 8–10m · Logged 26 May
```

`Xm early` = `m.month - age.months` (the month difference). If logged month equals `age.months + 1`, show `1m early`, etc.

Background: warm yellow (`#fffbeb`), border: `#fed7aa`.

If 0 ahead: omit this section entirely.

---

#### Section 4 — Upcoming at N+1 months

Label: `◷ Upcoming at N+1 months` (gray)

MILESTONES_DATA items for this theme where `m.month === age.months + 1`. These are NOT achievements — they're just the next-month preview.

```
[○ dashed circle]  Cruises along furniture
                   Window: 8–10m
```

Style: dashed border card, grayed out text, opacity 0.75.

If 0 upcoming for this theme at N+1: omit this section.

---

## State Management

```js
let milestonesData    = null;   // { milestones, age } from /api/milestones-data
let achievementsData  = null;   // [] from /api/milestone-achievements
let activeTheme       = null;   // 'Motor'|'Language'|'Social'|'Cognitive'|'Feeding'|null
let milestoneScope    = 'month'; // 'month'|'all'
```

`openThemeDetail(theme)`:
- If `activeTheme === theme` → close (set to null), re-render
- Else set `activeTheme = theme`, re-render
- Scroll detail panel into view with `scrollIntoView({ behavior: 'smooth', block: 'start' })`

`setMilestoneScope(scope)`:
- Set `milestoneScope = scope`, re-render

---

## Functions to Add/Replace

| Function | Action | Location |
|---------|--------|---------|
| `renderMilestones()` | Full rewrite | index.html |
| `openThemeDetail(theme)` | New | index.html |
| `setMilestoneScope(scope)` | New | index.html |
| `renderThemeDetailHTML(theme, milestones, achievements, age)` | New | index.html |
| `renderPendingCardHTML(milestone, age)` | New | index.html |
| `askDoctorAbout(milestoneName)` | New | index.html |

Keep existing functions: `loadMilestones()`, `quickLogMilestone()`, `deleteMilestone()`, `openMilestoneForm()`, `closeMilestoneForm()`, `analyzeMilestone()`, `achievementCardHTML()`.

---

## HTML Structure (replace `#tab-milestones` inner content)

```html
<div id="tab-milestones" class="tab-panel max-w-lg mx-auto px-4 pt-4">

  <!-- Header row -->
  <div class="flex items-center justify-between mb-4">
    <h2 style="color:var(--peach-d)">Milestones</h2>
    <button onclick="openMilestoneForm()">+ Log new</button>
  </div>

  <!-- Toggle -->
  <div id="ms-toggle" class="flex gap-2 mb-4">
    <button id="ms-btn-month" onclick="setMilestoneScope('month')">This Month</button>
    <button id="ms-btn-all"   onclick="setMilestoneScope('all')">All Time</button>
  </div>

  <!-- Summary table (rendered by JS) -->
  <div id="ms-summary-table" class="mb-4"></div>

  <!-- Detail panel (rendered by JS, hidden when activeTheme null) -->
  <div id="ms-detail-panel" class="mb-4"></div>

  <!-- Log form (unchanged) -->
  <div id="ms-form" class="hidden card p-4 mb-4 slide-down">
    ...existing form unchanged...
  </div>

</div>
```

Remove: `#ms-achieved-count`, `#ms-ahead-count`, `#ms-sig-count`, `#ms-achieved-list`, `#ms-current-heading`, `#ms-current-list`, `#ms-upcoming-heading`, `#ms-upcoming-list` (all replaced by the new table + detail panel).

---

## CSS Additions

```css
/* Toggle pills */
.ms-scope-btn       { flex:1; padding:6px 0; border-radius:20px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.ms-scope-btn.active { background:var(--peach); color:#fff; border:none; }
.ms-scope-btn.inactive { background:#fff; color:#6b7280; border:1px solid #e5e7eb; }

/* Summary table */
.ms-table           { border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; }
.ms-table-header    { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; background:#f9fafb; padding:6px 10px; font-size:10px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; }
.ms-table-row       { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; padding:9px 10px; border-top:1px solid #f3f4f6; cursor:pointer; transition:background 0.15s; }
.ms-table-row:hover { background:#fff8f5; }
.ms-table-row.active { background:#fff8f5; }

/* Detail panel */
.ms-detail          { border:1.5px solid #f97316; border-radius:12px; overflow:hidden; }
.ms-detail-header   { background:#fff8f5; padding:10px 14px; border-bottom:1px solid #fed7aa; display:flex; align-items:center; justify-content:space-between; }
.ms-section-label   { padding:10px 14px 6px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; }
.ms-milestone-card  { margin:0 10px 7px; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; }
.ms-milestone-card.ahead { border-color:#fed7aa; background:#fffbeb; }
.ms-milestone-card.pending-urgent { border:1.5px solid #fca5a5; }
.ms-milestone-card.upcoming { border:1px dashed #e5e7eb; opacity:0.75; }
.ms-timeline-bar    { background:#f3f4f6; border-radius:4px; height:5px; position:relative; }
.ms-timeline-fill   { background:linear-gradient(to right,#16a34a,#f97316,#dc2626); border-radius:4px; height:100%; width:100%; }
.ms-timeline-marker { position:absolute; top:-3px; width:2px; height:11px; background:#1a1a1a; border-radius:1px; }
.ms-now-label       { position:absolute; top:-14px; font-size:8px; font-weight:600; }
.ms-ask-doctor-btn  { background:var(--peach); color:#fff; border:none; border-radius:12px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer; }
```

---

## Milestone Cutoffs Map

Inline in index.html, derived from MILESTONE-MASTER.md:

```js
const MILESTONE_CUTOFFS = {
  // Motor
  'm5_1': 7,  // Rolls
  'm5_2': 7,  // Sits with support
  'm5_3': 8,  // Transfers objects
  'm6_1': 8,  // Sits without support briefly
  'm6_2': 8,  // Stands with support
  'm6_3': 7,  // Rolls as locomotion
  'm7_1': 9,  // Sits steadily
  'm7_2': 10, // Crawls
  'm7_3': 12, // Pulls to stand
  'm7_4': 12, // Pincer grasp
  'm8_1': 12, // Pulls to stand confidently
  'm8_2': 12, // Cruises
  'm8_3': 12, // Pincer improving
  'm9_1': 14, // Stands alone
  'm9_2': 12, // Cruises confidently
  // Language
  'm5_4': 9,  // Responds to name
  'm5_5': 7,  // Blows raspberries
  'm6_5': 8,  // Babbles
  'm7_7': 10, // Waves bye-bye
  'm7_8': 9,  // Babbles longer strings
  'm8_4': 12, // Mama/dada with intent
  'm8_5': 12, // Points
  'm9_3': 14, // First words
  'm9_4': 12, // Waves intentionally
  'm9_5': 12, // Follows instructions
  // Social
  'm6_4': null, // Stranger anxiety (not a concern if later)
  'm6_7': 9,    // Shows affection
  'm7_5': null, // Stranger anxiety more pronounced
  'm7_6': null, // Separation anxiety
  'm8_7': 12,   // Plays independently
  'm9_7': 12,   // Social referencing
  // Cognitive
  'm6_8': 9,  // Explores objects
  'm7_9': 10, // Peek-a-boo
  'm7_10': 9, // Understands "no"
  'm8_6': 12, // Object permanence
  'm9_6': 12, // Imitates actions
  // Feeding
  'm5_6': 7,  // Shows interest in solids
  'm6_6': 8,  // Ready for solids
  'm7_11': 10,// Wider textures
  'm8_8': 12, // Self-feeding finger foods
  'm9_8': 14, // Wide variety family foods
};
```

Milestones with `null` cutoff: no timeline bar, no "Ask doctor" CTA shown.

---

## Scope: What Does NOT Change

- `loadMilestones()` function — unchanged
- `/api/milestones-data` endpoint — unchanged
- `/api/milestone-achievements` GET/POST/DELETE — unchanged
- Log form (textarea → analyze → confirm) — unchanged
- `achievementCardHTML()` — can be kept as-is internally; new `renderMilestones` won't use it in the main view but it's not deleted
- `quickLogMilestone()`, `deleteMilestone()` — unchanged
- All other tabs — untouched

---

## "Ask Doctor" Flow

When parent taps "+ Ask doctor" on a near-cutoff pending milestone:
1. Switch to chat tab: `switchTab('chat', document.querySelector('[data-tab=chat]'))`
2. Pre-fill chat input: `document.getElementById('chat-input').value = 'I want to ask the doctor about ' + milestoneName`
3. Focus input — parent sends it themselves (no auto-send)

This avoids a new endpoint and reuses the Uma chat flow naturally.

---

## Edge Cases

- **Baby at month 9 (max data month):** Upcoming section shows nothing (no month 10 in MILESTONES_DATA). Section omitted silently.
- **All milestones achieved:** Pending section omitted. Achieved section shows all. Cheerful tone.
- **No achievements at all:** Achieved section shows empty state message. Pending section shows all current-month milestones as pending.
- **Theme with 0 Due (e.g., a category that has no milestones at this age):** Due shows 0, row still clickable. Detail panel shows only Upcoming section.
- **custom_ prefixed achievement ids:** These come from the analyze-milestone flow. They won't match any MILESTONES_DATA id. Show them in an "Other logged milestones" section at the bottom of the detail panel, or simply exclude from theme table counts (they lack a known month/theme pairing in MILESTONES_DATA).

For MVP: custom_ achievements are excluded from the summary table. They remain visible in the existing achieved list if user opens the log form. This can be improved later.
