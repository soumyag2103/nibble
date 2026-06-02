# Milestones Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat milestones list with a theme-grouped summary table + expandable 4-section detail panel (Achieved / Pending / Ahead / Upcoming).

**Architecture:** Pure frontend rewrite of `web/public/index.html` — no server changes. New CSS classes added to the `<style>` block. New JS functions added to the `<script>` block. The `#tab-milestones` HTML skeleton is replaced with new containers. All existing APIs (`/api/milestones-data`, `/api/milestone-achievements`) are reused unchanged.

**Tech Stack:** Vanilla JS + Tailwind CSS (CDN) + existing Express/Node backend

---

## File Map

Only one file changes: `web/public/index.html` (1832 lines total)

Key regions:
- CSS: lines 8–170 (`<style>` block, closing `</style>` at line 170)
- State vars: lines 400–411
- Constants: lines 414–421
- `#tab-milestones` HTML: lines 279–339
- `renderMilestones()`: lines 1583–1630
- Milestone helper functions: lines 1632–1668
- `openMilestoneForm()` and below: lines 1670–1757

---

## Task 1: CSS classes + MILESTONE_CUTOFFS constant + new state variables

**Files:**
- Modify: `web/public/index.html:8-170` (add CSS before `</style>`)
- Modify: `web/public/index.html:409-421` (add state vars + MILESTONE_CUTOFFS constant)

- [ ] **Step 1: Add CSS classes before `</style>` (line 170)**

Insert these lines immediately before `  </style>` at line 170:

```css
    /* Milestones redesign */
    .ms-scope-btn        { flex:1; padding:6px 0; border-radius:20px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.15s; }
    .ms-scope-btn.active { background:var(--peach); color:#fff; border:none; }
    .ms-scope-btn.inactive { background:#fff; color:#6b7280; border:1px solid #e5e7eb; }
    .ms-table            { border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; margin-bottom:14px; }
    .ms-table-header     { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; background:#f9fafb; padding:6px 10px; font-size:10px; color:#6b7280; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; }
    .ms-table-row        { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; padding:9px 10px; border-top:1px solid #f3f4f6; cursor:pointer; transition:background 0.15s; }
    .ms-table-row:hover  { background:#fff8f5; }
    .ms-table-row.active { background:#fff8f5; }
    .ms-detail           { border:1.5px solid #f97316; border-radius:12px; overflow:hidden; }
    .ms-detail-header    { background:#fff8f5; padding:10px 14px; border-bottom:1px solid #fed7aa; display:flex; align-items:center; justify-content:space-between; }
    .ms-section-label    { padding:10px 14px 6px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; }
    .ms-milestone-card   { margin:0 10px 7px; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; }
    .ms-milestone-card.ahead { border-color:#fed7aa; background:#fffbeb; }
    .ms-milestone-card.pending-urgent { border:1.5px solid #fca5a5; }
    .ms-milestone-card.upcoming { border:1px dashed #e5e7eb; opacity:0.75; }
    .ms-timeline-bar     { background:#f3f4f6; border-radius:4px; height:5px; position:relative; margin-top:8px; }
    .ms-timeline-fill    { background:linear-gradient(to right,#16a34a,#f97316,#dc2626); border-radius:4px; height:100%; width:100%; }
    .ms-timeline-marker  { position:absolute; top:-3px; width:2px; height:11px; background:#1a1a1a; border-radius:1px; }
    .ms-now-label        { position:absolute; top:-14px; font-size:8px; font-weight:600; transform:translateX(-50%); }
    .ms-ask-doctor-btn   { background:var(--peach); color:#fff; border:none; border-radius:12px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer; }
```

- [ ] **Step 2: Add `activeTheme` and `milestoneScope` state variables after line 410**

Current line 410 reads:
```js
let achievementsData = [];
```

Add two lines immediately after it so it reads:
```js
let achievementsData = [];
let activeTheme      = null;   // 'Motor'|'Language'|'Social'|'Cognitive'|'Feeding'|null
let milestoneScope   = 'month'; // 'month'|'all'
```

- [ ] **Step 3: Add MILESTONE_CUTOFFS constant and THEMES array after line 421**

Current line 421 reads:
```js
let SLOT_META = {};
```

Insert before that line:

```js
const THEMES = [
  { key:'Motor',     emoji:'🏃', label:'Motor' },
  { key:'Language',  emoji:'🗣', label:'Language' },
  { key:'Social',    emoji:'💬', label:'Social' },
  { key:'Cognitive', emoji:'🧠', label:'Cognitive' },
  { key:'Feeding',   emoji:'🥄', label:'Feeding' },
];

const MILESTONE_CUTOFFS = {
  // Motor
  'm5_1': 7,  'm5_2': 7,  'm5_3': 8,
  'm6_1': 8,  'm6_2': 8,  'm6_3': 7,
  'm7_1': 9,  'm7_2': 10, 'm7_3': 12, 'm7_4': 12,
  'm8_1': 12, 'm8_2': 12, 'm8_3': 12,
  'm9_1': 14, 'm9_2': 12,
  // Language
  'm5_4': 9,  'm5_5': 7,
  'm6_5': 8,
  'm7_7': 10, 'm7_8': 9,
  'm8_4': 12, 'm8_5': 12,
  'm9_3': 14, 'm9_4': 12, 'm9_5': 12,
  // Social
  'm6_4': null, 'm6_7': 9,
  'm7_5': null, 'm7_6': null,
  'm8_7': 12,
  'm9_7': 12,
  // Cognitive
  'm6_8': 9,
  'm7_9': 10, 'm7_10': 9,
  'm8_6': 12,
  'm9_6': 12,
  // Feeding
  'm5_6': 7,
  'm6_6': 8,
  'm7_11': 10,
  'm8_8': 12,
  'm9_8': 14,
};
```

- [ ] **Step 4: Verify server starts without errors**

```bash
cd C:/Users/ADMIN/saahiti-agents/web
node server.js
```

Expected: `Server running on http://localhost:3001` with no syntax errors.

Stop the server (Ctrl+C) after confirming.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/ADMIN/saahiti-agents
git add web/public/index.html
git commit -m "feat(milestones): add CSS classes, MILESTONE_CUTOFFS, state vars"
```

---

## Task 2: Replace `#tab-milestones` HTML skeleton

**Files:**
- Modify: `web/public/index.html:279-339`

- [ ] **Step 1: Replace lines 279–339 with new HTML**

The current block starts with `<div id="tab-milestones"` at line 279 and ends with `</div>` at line 339 (just before the `<!-- ── TAB: PROGRESS` comment at line 341).

Replace the entire block (lines 279–339) with:

```html
  <div id="tab-milestones" class="tab-panel max-w-lg mx-auto px-4 pt-4">

    <!-- Header row -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-base font-bold" style="color:var(--peach-d)">Milestones</h2>
      <button onclick="openMilestoneForm()" class="text-xs font-semibold px-3 py-1.5 rounded-full text-white"
        style="background:var(--peach)">+ Log new</button>
    </div>

    <!-- Scope toggle -->
    <div class="flex gap-2 mb-4">
      <button id="ms-btn-month" class="ms-scope-btn active" onclick="setMilestoneScope('month')">This Month</button>
      <button id="ms-btn-all"   class="ms-scope-btn inactive" onclick="setMilestoneScope('all')">All Time</button>
    </div>

    <!-- Summary table (JS-rendered) -->
    <div id="ms-summary-table"></div>

    <!-- Detail panel (JS-rendered) -->
    <div id="ms-detail-panel" class="mb-4"></div>

    <!-- Log form (unchanged) -->
    <div id="ms-form" class="hidden card p-4 mb-4 slide-down">
      <h3 class="text-sm font-bold mb-1">What did Saahiti do?</h3>
      <p class="text-xs text-gray-400 mb-3">Describe it in your own words — Meredith will classify it.</p>
      <textarea id="ms-text"
        placeholder="e.g. She waved bye-bye when grandma left today…"
        class="w-full bg-gray-50 rounded-xl px-3 py-2 text-sm border border-gray-100 resize-none"
        rows="3"></textarea>
      <div class="flex gap-2 mt-3">
        <button onclick="analyzeMilestone()" id="ms-analyze-btn"
          class="flex-1 py-2 rounded-xl text-white text-sm font-semibold" style="background:var(--peach)">
          Analyze →
        </button>
        <button onclick="closeMilestoneForm()" class="py-2 px-4 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold">Cancel</button>
      </div>
      <div id="ms-analysis-result" class="hidden mt-3"></div>
    </div>

  </div>
```

- [ ] **Step 2: Verify old element IDs removed**

Run this grep — it must return nothing:

```bash
grep -n "ms-achieved-count\|ms-ahead-count\|ms-sig-count\|ms-achieved-list\|ms-current-heading\|ms-current-list\|ms-upcoming-heading\|ms-upcoming-list" C:/Users/ADMIN/saahiti-agents/web/public/index.html
```

Expected: No output.

- [ ] **Step 3: Start server and verify milestones tab loads**

```bash
node C:/Users/ADMIN/saahiti-agents/web/server.js
```

Open `http://localhost:3001`, tap Milestones tab.

Expected: Page loads without JS errors. Milestones tab shows header, two toggle pills ("This Month" / "All Time"), and the "Log new" button. The summary table and detail areas are empty (JS not yet rewritten — that's OK).

Stop the server.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/ADMIN/saahiti-agents
git add web/public/index.html
git commit -m "feat(milestones): replace tab HTML with new skeleton"
```

---

## Task 3: Rewrite `renderMilestones()` — summary table

**Files:**
- Modify: `web/public/index.html:1583-1630`

The current `renderMilestones()` function spans lines 1583–1630. The function before it (`loadMilestones`) ends at line 1581. The function after it (`achievementCardHTML`) starts at line 1632.

Note: Lines 1588–1593 reference DOM elements that were removed in Task 2 (`ms-achieved-count`, `ms-ahead-count`, `ms-sig-count`). The new `renderMilestones()` does not reference them.

- [ ] **Step 1: Replace `renderMilestones()` (lines 1583–1630) with new implementation**

```js
function renderMilestones() {
  const { milestones, age } = milestonesData;

  // Sync toggle button styles
  document.getElementById('ms-btn-month').className = 'ms-scope-btn ' + (milestoneScope === 'month' ? 'active' : 'inactive');
  document.getElementById('ms-btn-all').className   = 'ms-scope-btn ' + (milestoneScope === 'all'   ? 'active' : 'inactive');

  // Build per-theme counts
  const achievedIds = new Set(achievementsData.map(a => a.id));

  const tableHTML = `
    <div class="ms-table">
      <div class="ms-table-header">
        <span>Theme</span>
        <span style="text-align:center">Due</span>
        <span style="text-align:center">Achieved</span>
        <span style="text-align:center">Ahead+</span>
      </div>
      ${THEMES.map(theme => {
        const dueMs    = milestones.filter(m => m.month === age.months && m.category === theme.key);
        const achieved = dueMs.filter(m => achievedIds.has(m.id));
        const ahead    = achievementsData.filter(a => {
          const ms = milestones.find(m => m.id === a.id);
          return ms && ms.category === theme.key && ms.month > age.months;
        });
        const isActive = activeTheme === theme.key;
        return `
          <div class="ms-table-row${isActive ? ' active' : ''}" onclick="openThemeDetail('${theme.key}')">
            <span style="font-size:13px;font-weight:500;${isActive ? 'color:#f97316' : ''}">${theme.emoji} ${theme.label}${isActive ? ' \u25C4' : ''}</span>
            <span style="text-align:center;font-size:13px">${dueMs.length}</span>
            <span style="text-align:center;font-size:13px;${achieved.length > 0 ? 'color:#16a34a;font-weight:600' : 'color:#9ca3af'}">${achieved.length > 0 ? achieved.length : '\u2014'}</span>
            <span style="text-align:center;font-size:13px;${ahead.length > 0 ? 'color:#f97316;font-weight:600' : 'color:#6b7280'}">${ahead.length > 0 ? ahead.length : '\u2014'}</span>
          </div>`;
      }).join('')}
    </div>`;

  document.getElementById('ms-summary-table').innerHTML = tableHTML;

  // Detail panel
  const detailEl = document.getElementById('ms-detail-panel');
  if (!activeTheme) {
    detailEl.innerHTML = '';
    return;
  }
  detailEl.innerHTML = renderThemeDetailHTML(activeTheme, milestones, achievementsData, age);
}
```

- [ ] **Step 2: Add stubs for functions called by renderMilestones (temporarily)**

After `renderMilestones()` and before `achievementCardHTML()`, insert temporary stubs so the page doesn't crash when a theme row is clicked:

```js
function openThemeDetail(theme) {
  activeTheme = (activeTheme === theme) ? null : theme;
  renderMilestones();
  if (activeTheme) {
    setTimeout(() => document.getElementById('ms-detail-panel').scrollIntoView({ behavior:'smooth', block:'start' }), 50);
  }
}

function setMilestoneScope(scope) {
  milestoneScope = scope;
  renderMilestones();
}

function renderThemeDetailHTML(theme, milestones, achievements, age) {
  return `<div class="ms-detail"><div class="ms-detail-header"><div style="font-size:13px;font-weight:700">Loading ${theme}…</div><button onclick="openThemeDetail('${theme}')" style="border:none;background:none;font-size:16px;color:#9ca3af;cursor:pointer">✕</button></div></div>`;
}
```

These stubs will be fully replaced in Tasks 4–6.

- [ ] **Step 3: Start server and verify summary table renders**

```bash
node C:/Users/ADMIN/saahiti-agents/web/server.js
```

Open `http://localhost:3001`, tap Milestones tab.

Expected:
- 5-row table with correct header row (Theme / Due / Achieved / Ahead+)
- Each theme row shows a count in Due (or 0 if baby's age doesn't match)
- Achieved column shows green count or `—`
- Ahead+ column shows orange count or `—`
- Clicking a row shows "Loading Motor…" stub detail panel
- Toggle pills switch visual state when clicked

Stop the server.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/ADMIN/saahiti-agents
git add web/public/index.html
git commit -m "feat(milestones): render theme summary table"
```

---

## Task 4: Implement `renderThemeDetailHTML()` — Sections 1 (Achieved) and 4 (Upcoming)

**Files:**
- Modify: `web/public/index.html` — replace the stub `renderThemeDetailHTML()` added in Task 3

The stub is the function that currently returns `"Loading ${theme}…"`. Replace it entirely.

- [ ] **Step 1: Replace the stub `renderThemeDetailHTML()` with full implementation**

```js
function renderThemeDetailHTML(theme, milestones, achievements, age) {
  const themeEmojis = { Motor:'🏃', Language:'🗣', Social:'💬', Cognitive:'🧠', Feeding:'🥄' };
  const emoji = themeEmojis[theme] || '';

  const achievedIds = new Set(achievements.map(a => a.id));

  // Section 1: current-month milestones that are achieved
  const dueMs       = milestones.filter(m => m.month === age.months && m.category === theme);
  const achievedDue = dueMs
    .filter(m => achievedIds.has(m.id))
    .map(m => achievements.find(a => a.id === m.id));

  // Section 2: current-month milestones NOT yet achieved
  const pendingDue = dueMs.filter(m => !achievedIds.has(m.id));

  // Section 3: future-month achievements for this theme
  const aheadAchievements = achievements.filter(a => {
    const ms = milestones.find(m => m.id === a.id);
    return ms && ms.category === theme && ms.month > age.months;
  });

  // Section 4: next-month milestones for this theme
  const upcomingMs = milestones.filter(m => m.month === age.months + 1 && m.category === theme);

  let html = `
    <div class="ms-detail">
      <div class="ms-detail-header">
        <div>
          <div style="font-size:13px;font-weight:700;color:#1a1a1a">${emoji} ${theme} milestones</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:1px">${age.months} months &middot; ${dueMs.length} due &middot; ${achievedDue.length} achieved &middot; ${aheadAchievements.length} ahead &middot; ${upcomingMs.length} upcoming</div>
        </div>
        <button onclick="openThemeDetail('${theme}')" style="border:none;background:none;font-size:16px;color:#9ca3af;cursor:pointer">&#x2715;</button>
      </div>`;

  // ── Section 1: Achieved this month ──
  html += `<div class="ms-section-label" style="color:#16a34a">&#x2713; Achieved this month &middot; ${achievedDue.length} of ${dueMs.length}</div>`;
  if (achievedDue.length === 0) {
    html += `<div style="padding:8px 14px 12px;font-size:12px;color:#9ca3af">No achievements logged yet for this theme this month.</div>`;
  } else {
    achievedDue.forEach((a, i) => {
      if (i === 0) {
        html += `
          <div class="ms-milestone-card" style="padding:10px 12px;display:flex;align-items:flex-start;gap:8px">
            <div style="width:18px;height:18px;border-radius:50%;background:#16a34a;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px"><span style="color:#fff;font-size:10px">&#x2713;</span></div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${escHtml(a.name)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px">Logged ${escHtml(a.dateLogged)} &middot; On track</div>
              ${a.notes ? `<div style="font-size:11px;color:#374151;margin-top:5px;padding:6px 8px;background:#f9fafb;border-radius:6px;font-style:italic">&ldquo;${escHtml(a.notes)}&rdquo;</div>` : ''}
            </div>
          </div>`;
      } else {
        html += `
          <div class="ms-milestone-card" style="padding:9px 12px;display:flex;align-items:center;gap:8px">
            <div style="width:18px;height:18px;border-radius:50%;background:#16a34a;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#fff;font-size:10px">&#x2713;</span></div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${escHtml(a.name)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:1px">Logged ${escHtml(a.dateLogged)} &middot; On track</div>
            </div>
          </div>`;
      }
    });
  }

  // ── Section 2: Still pending (placeholder — implemented in Task 5) ──
  if (pendingDue.length > 0) {
    html += `<div class="ms-section-label" style="color:#dc2626;border-top:1px solid #f3f4f6">&#x25CB; Still pending &middot; ${pendingDue.length} of ${dueMs.length}</div>`;
    pendingDue.forEach(m => {
      html += `
        <div class="ms-milestone-card" style="padding:9px 12px;display:flex;align-items:center;gap:8px">
          <div style="width:18px;height:18px;border-radius:50%;border:2px solid #d1d5db;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="color:#d1d5db;font-size:10px">&#x25CB;</span></div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${escHtml(m.label)}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:1px">Not yet achieved</div>
          </div>
        </div>`;
    });
  }

  // ── Section 3: Ahead (placeholder — implemented in Task 6) ──
  if (aheadAchievements.length > 0) {
    html += `<div class="ms-section-label" style="color:#f97316;border-top:1px solid #f3f4f6">&#x2B50; Ahead of schedule &middot; ${aheadAchievements.length} bonus</div>`;
    aheadAchievements.forEach(a => {
      html += `
        <div class="ms-milestone-card ahead" style="padding:9px 12px;display:flex;align-items:center;gap:8px">
          <span style="font-size:15px">&#x2B50;</span>
          <div style="flex:1"><div style="font-size:13px;font-weight:600">${escHtml(a.name)}</div></div>
        </div>`;
    });
  }

  // ── Section 4: Upcoming next month ──
  if (upcomingMs.length > 0) {
    html += `<div class="ms-section-label" style="color:#6b7280;border-top:1px solid #f3f4f6">&#x25F7; Upcoming at ${age.months + 1} months &middot; ${upcomingMs.length} ahead</div>`;
    upcomingMs.forEach(m => {
      html += `
        <div class="ms-milestone-card upcoming" style="padding:9px 12px;display:flex;align-items:center;gap:8px">
          <div style="width:18px;height:18px;border-radius:50%;border:2px dashed #d1d5db;flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:12px;color:#6b7280;font-weight:500">${escHtml(m.label)}</div>
            <div style="font-size:10px;color:#9ca3af">Expected at: ${m.month}m</div>
          </div>
        </div>`;
    });
  }

  html += `</div>`;
  return html;
}
```

- [ ] **Step 2: Start server and verify detail panel sections 1 and 4**

```bash
node C:/Users/ADMIN/saahiti-agents/web/server.js
```

Open `http://localhost:3001`, tap Milestones, tap Motor row.

Expected:
- Detail panel opens with orange border
- Header shows `🏃 Motor milestones` + subtitle with counts
- Section 1 "Achieved this month" shows logged achievements (or empty state)
- Section 2 "Still pending" shows basic cards (no timeline bar yet — that's Task 5)
- Section 3 "Ahead of schedule" shows if any ahead achievements exist
- Section 4 "Upcoming" shows next-month milestones as dashed cards
- Tapping the row again or ✕ closes the panel

Stop the server.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/ADMIN/saahiti-agents
git add web/public/index.html
git commit -m "feat(milestones): render detail panel sections 1 (achieved) and 4 (upcoming)"
```

---

## Task 5: Add `renderPendingCardHTML()` — Section 2 with timeline bar

**Files:**
- Modify: `web/public/index.html` — add `renderPendingCardHTML()` function, update Section 2 in `renderThemeDetailHTML()`

- [ ] **Step 1: Add `renderPendingCardHTML()` function**

Insert this new function immediately after `renderThemeDetailHTML()`:

```js
function renderPendingCardHTML(m, age) {
  const cutoff   = MILESTONE_CUTOFFS[m.id];
  const hasCutoff = cutoff !== null && cutoff !== undefined;
  const nearCutoff = hasCutoff && (cutoff - age.months) <= 2;

  let timelineHTML = '';
  if (hasCutoff) {
    const range = cutoff - m.month;
    const markerPct = range > 0
      ? Math.min(100, Math.max(0, Math.round(((age.months - m.month) / range) * 100)))
      : 100;
    timelineHTML = `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:9px;color:#6b7280;margin-bottom:3px;margin-top:8px">
          <span>Expected at: ${m.month}m</span>
          <span style="${nearCutoff ? 'color:#dc2626;font-weight:600' : ''}">Discuss by ${cutoff}m</span>
        </div>
        <div class="ms-timeline-bar">
          <div class="ms-timeline-fill"></div>
          <div class="ms-timeline-marker" style="left:${markerPct}%"></div>
          <div class="ms-now-label" style="left:${markerPct}%">now</div>
        </div>
      </div>`;
  }

  let cardHTML = `
    <div class="ms-milestone-card${nearCutoff ? ' pending-urgent' : ''}">
      <div style="padding:10px 12px;display:flex;align-items:flex-start;gap:8px">
        <div style="width:18px;height:18px;border-radius:50%;border:2px solid #d1d5db;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
          <span style="color:#d1d5db;font-size:10px">&#x25CB;</span>
        </div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${escHtml(m.label)}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px">Not yet achieved</div>
          ${timelineHTML}
        </div>
      </div>`;

  if (nearCutoff) {
    cardHTML += `
      <div style="border-top:1px solid #fca5a5;padding:8px 12px;background:#fff5f5;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:#dc2626">Getting close to cutoff</span>
        <button class="ms-ask-doctor-btn" onclick="askDoctorAbout('${escAttr(m.label)}')">+ Ask doctor</button>
      </div>`;
  }

  cardHTML += `</div>`;
  return cardHTML;
}
```

- [ ] **Step 2: Wire `renderPendingCardHTML()` into Section 2 of `renderThemeDetailHTML()`**

In `renderThemeDetailHTML()`, find the Section 2 block (the `// ── Section 2: Still pending` comment and the loop below it). Replace the entire Section 2 block with:

```js
  // ── Section 2: Still pending ──
  if (pendingDue.length > 0) {
    html += `<div class="ms-section-label" style="color:#dc2626;border-top:1px solid #f3f4f6">&#x25CB; Still pending &middot; ${pendingDue.length} of ${dueMs.length}</div>`;
    pendingDue.forEach(m => {
      html += renderPendingCardHTML(m, age);
    });
  }
```

- [ ] **Step 3: Start server and verify timeline bar**

```bash
node C:/Users/ADMIN/saahiti-agents/web/server.js
```

Open `http://localhost:3001`, tap Milestones, tap any theme row that has pending milestones.

Expected:
- Pending cards show gradient timeline bar (green → orange → red)
- "now" marker (thin black vertical line) is positioned correctly along the bar
- "Expected at: Nm" and "Discuss by: Nm" labels appear above bar
- If baby's current age is within 2m of the cutoff: red "Getting close to cutoff" footer + orange "+ Ask doctor" button
- If not near cutoff: no red footer, no button

Stop the server.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/ADMIN/saahiti-agents
git add web/public/index.html
git commit -m "feat(milestones): pending cards with timeline bar and near-cutoff alert"
```

---

## Task 6: Implement Section 3 (Ahead) + `askDoctorAbout()`

**Files:**
- Modify: `web/public/index.html` — update Section 3 in `renderThemeDetailHTML()`, add `askDoctorAbout()`

- [ ] **Step 1: Replace the Section 3 placeholder in `renderThemeDetailHTML()`**

Find the Section 3 block (the `// ── Section 3: Ahead` comment). Replace the entire Section 3 block with:

```js
  // ── Section 3: Ahead of schedule ──
  if (aheadAchievements.length > 0) {
    html += `<div class="ms-section-label" style="color:#f97316;border-top:1px solid #f3f4f6">&#x2B50; Ahead of schedule &middot; ${aheadAchievements.length} bonus</div>`;
    aheadAchievements.forEach(a => {
      const ms = milestones.find(m => m.id === a.id);
      const monthsEarly = ms ? ms.month - age.months : 0;
      html += `
        <div class="ms-milestone-card ahead" style="padding:9px 12px;display:flex;align-items:center;gap:8px">
          <span style="font-size:15px">&#x2B50;</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${escHtml(a.name)}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:1px">Typical: ${ms ? ms.month : '?'}m &middot; Logged ${escHtml(a.dateLogged)}</div>
          </div>
          <div style="font-size:10px;color:#f97316;font-weight:600">${monthsEarly}m early</div>
        </div>`;
    });
  }
```

- [ ] **Step 2: Add `askDoctorAbout()` function**

Insert this function immediately after `renderPendingCardHTML()`:

```js
function askDoctorAbout(milestoneName) {
  switchTab('chat', document.querySelector('[data-tab=chat]'));
  document.getElementById('chat-input').value = 'I want to ask the doctor about ' + milestoneName;
  document.getElementById('chat-input').focus();
}
```

- [ ] **Step 3: Start server and verify full detail panel**

```bash
node C:/Users/ADMIN/saahiti-agents/web/server.js
```

Open `http://localhost:3001`, tap Milestones, tap Motor row.

Expected:
- Section 1: Achieved milestones (green checkmarks, first card expanded with notes)
- Section 2: Pending milestones (timeline bar + cutoff labels; near-cutoff shows red footer + "Ask doctor")
- Section 3: Ahead of schedule milestones (yellow cards, "Xm early" badge)
- Section 4: Upcoming milestones (dashed cards, grayed out)
- Tapping "+ Ask doctor" switches to Chat tab with input pre-filled

Verify across multiple theme rows (Language, Social, Cognitive, Feeding) — each shows the correct milestones for that theme.

Stop the server.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/ADMIN/saahiti-agents
git add web/public/index.html
git commit -m "feat(milestones): ahead section + askDoctorAbout CTA"
```

---

## Task 7: Smoke test — end-to-end verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Start server**

```bash
node C:/Users/ADMIN/saahiti-agents/web/server.js
```

- [ ] **Step 2: Verify summary table counts are correct**

Open `http://localhost:3001`, tap Milestones.

Mental check: for each theme row, Due count = number of `MILESTONES_DATA` entries where `month === age.months` and `category === theme`. Achieved count = number of those that have been logged. Ahead+ = any achievements from future months in that theme.

If Saahiti is 7 months old:
- Motor Due = 4 (m7_1, m7_2, m7_3, m7_4)
- Language Due = 2 (m7_7, m7_8)
- Social Due = 2 (m7_5, m7_6)
- Cognitive Due = 2 (m7_9, m7_10)
- Feeding Due = 1 (m7_11)

Verify these match what the table shows.

- [ ] **Step 3: Verify toggle**

Tap "All Time" — button turns peach/active. Tap "This Month" — switches back.

(Both currently show the same data — All Time deferred — but the visual toggle should work.)

- [ ] **Step 4: Verify detail panel open/close**

Tap Motor row → detail panel opens. Tap Motor row again → detail panel closes. Tap Language row → Motor closes, Language opens. Tap ✕ → closes.

- [ ] **Step 5: Verify log form still works**

Tap "+ Log new" → log form slides in. Type a milestone description, tap "Analyze →" — Meredith classifies it. Confirm → saves. Check that the achievement now appears in the Motor (or correct theme) row's Achieved count.

- [ ] **Step 6: Verify no JS console errors**

Open browser DevTools, check Console. No red errors.

- [ ] **Step 7: Final commit (if any minor fixes were made)**

```bash
cd C:/Users/ADMIN/saahiti-agents
git add web/public/index.html
git commit -m "fix(milestones): smoke test fixes"
```

If no fixes needed, skip this step.
