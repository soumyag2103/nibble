# Progress Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Progress tab with Appointments (question queue + history), Growth chart (WHO percentile curves), Foods tried (per-food reaction breakdown), and Rejected foods sections.

**Architecture:** Server-side: new REST endpoints in `web/server.js` for appointments, growth, and food summary data. Frontend: rewrite `#tab-progress` HTML and `loadProgress()` / `renderProgress()` in `web/public/index.html`. Uma integration: repurpose the existing `confirmDoctorQuestion()` to save to the new appointments system. Chart.js 4.x added via CDN for growth curves.

**Tech Stack:** Express.js ESM, vanilla JS, Chart.js 4.x (CDN), Tailwind CSS (CDN), WHO growth standard lookup tables (static JSON in server).

---

## Files

- Modify: `web/server.js` — add APPOINTMENTS_PATH, GROWTH_PATH constants; 9 new API endpoints; WHO static data; foods-summary endpoint
- Modify: `web/public/index.html` — replace Progress tab HTML; rewrite loadProgress/renderProgress; add appointments/growth/foods JS functions; update confirmDoctorQuestion; add Chart.js CDN tag
- Modify: `agents/meredith/SOUL.md` — no change needed (Uma already detects `log_doctor_question` intent)

New data files (created automatically at runtime):
- `agents/appointments/APPOINTMENTS.json`
- `agents/growth/GROWTH.json`

---

## Codebase Context

`web/server.js` uses ESM (`import`). Helper functions already defined:
- `rj(path)` — read JSON file, returns null on error
- `wj(path, data)` — write JSON (creates dirs automatically via `wf`)
- `rf(path)` — read text file
- `wf(path, content)` — write text file (mkdir -p)
- `tod()` — returns today's ISO date string `'YYYY-MM-DD'`

`web/public/index.html` is a single-file vanilla JS app. All HTML is inline or built as template literal strings. `escHtml(t)` and `escAttr(t)` are defined at line ~2163.

Progress tab HTML lives at line ~347 inside `<div id="tab-progress">`. `loadProgress()` is at line ~2118. `renderProgress()` is at line ~2124.

The existing `log_doctor_question` chat action already works: Uma detects doctor intent, emits `action: 'log_doctor_question'`, frontend shows action card, `confirmDoctorQuestion(cardId)` currently saves to `agents/bailey/QUESTIONS-QUEUE.md`. Task 8 will redirect this to the new appointments system.

---

## Task 1: Server — Appointments API

**Files:**
- Modify: `web/server.js` (after line 18, add path constants; after line 1222 add endpoints)

- [ ] **Step 1: Add APPOINTMENTS_PATH constant**

Find this block (lines ~12–18):
```js
const GORDON_DIR   = path.join(WORKSPACE, 'agents', 'gordon');
const MEREDITH_DIR = path.join(WORKSPACE, 'agents', 'meredith');
const BAILEY_DIR   = path.join(WORKSPACE, 'agents', 'bailey');
const LOGS_DIR     = path.join(WORKSPACE, 'logs');
const PROFILE_PATH = path.join(WORKSPACE, 'agents', 'profile', 'BABY-PROFILE.json');
const ROADMAP_PATH     = path.join(WORKSPACE, 'agents', 'gordon', 'FOOD-ROADMAP.json');
const WEEK_PLANS_PATH  = path.join(WORKSPACE, 'agents', 'gordon', 'WEEK-PLANS.json');
```

Add two lines after `WEEK_PLANS_PATH`:
```js
const APPOINTMENTS_PATH = path.join(WORKSPACE, 'agents', 'appointments', 'APPOINTMENTS.json');
const GROWTH_PATH       = path.join(WORKSPACE, 'agents', 'growth', 'GROWTH.json');
```

- [ ] **Step 2: Add appointments helper**

Add after the `loadProfile` function definition (around line 30):
```js
function loadAppointments() {
  const data = rj(APPOINTMENTS_PATH) || [];
  return data.sort((a, b) => a.date.localeCompare(b.date));
}
function saveAppointments(data) { wj(APPOINTMENTS_PATH, data); }
function nextAppointment(data) {
  const today = tod();
  return data.find(a => a.date >= today) || null;
}
```

- [ ] **Step 3: Add appointment endpoints**

Find the comment `// ── Week plan generation helper` (around line 1224) and insert all these endpoints immediately before it:

```js
// ── Appointments ──────────────────────────────────────────────────────────────

app.get('/api/appointments', (req, res) => {
  res.json(loadAppointments());
});

app.post('/api/appointments', (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const data = loadAppointments();
  const appt = { id: `appt_${Date.now()}`, date, height: null, weight: null, questions: [] };
  data.push(appt);
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveAppointments(data);
  res.json({ ok: true, appointment: appt });
});

app.patch('/api/appointments/:id', (req, res) => {
  const { date, height, weight } = req.body;
  const data = loadAppointments();
  const idx  = data.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  if (date   !== undefined) data[idx].date   = date;
  if (height !== undefined) data[idx].height = height;
  if (weight !== undefined) data[idx].weight = weight;
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveAppointments(data);
  res.json({ ok: true, appointment: data[idx] });
});

app.post('/api/appointments/:id/questions', (req, res) => {
  const { text, source = 'manual' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const data = loadAppointments();
  const appt = data.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  const q = { id: `q_${Date.now()}`, text, timestamp: new Date().toISOString(), source, answered: false, answer: '' };
  appt.questions.push(q);
  saveAppointments(data);
  res.json({ ok: true, question: q });
});

// Convenience: add question to the next upcoming appointment
app.post('/api/appointments/next/questions', (req, res) => {
  const { text, source = 'chat' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const data = loadAppointments();
  const appt = nextAppointment(data);
  if (!appt) return res.status(404).json({ error: 'no_next_appointment' });
  const q = { id: `q_${Date.now()}`, text, timestamp: new Date().toISOString(), source, answered: false, answer: '' };
  appt.questions.push(q);
  saveAppointments(data);
  res.json({ ok: true, question: q, appointmentId: appt.id });
});

app.patch('/api/appointments/:id/questions/:qid', (req, res) => {
  const { text, answered, answer } = req.body;
  const data = loadAppointments();
  const appt = data.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  const q = appt.questions.find(q => q.id === req.params.qid);
  if (!q) return res.status(404).json({ error: 'question not found' });
  if (text     !== undefined) q.text     = text;
  if (answered !== undefined) q.answered = answered;
  if (answer   !== undefined) q.answer   = answer;
  saveAppointments(data);
  res.json({ ok: true, question: q });
});

app.delete('/api/appointments/:id/questions/:qid', (req, res) => {
  const data = loadAppointments();
  const appt = data.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  appt.questions = appt.questions.filter(q => q.id !== req.params.qid);
  saveAppointments(data);
  res.json({ ok: true });
});

app.post('/api/appointments/:id/questions/:qid/move', (req, res) => {
  const data  = loadAppointments();
  const today = tod();
  const from  = data.find(a => a.id === req.params.id);
  if (!from) return res.status(404).json({ error: 'not found' });
  const q = from.questions.find(q => q.id === req.params.qid);
  if (!q) return res.status(404).json({ error: 'question not found' });
  // Find next upcoming appointment that is NOT this one
  const to = data.find(a => a.date >= today && a.id !== req.params.id);
  if (!to) return res.status(404).json({ error: 'no_next_appointment' });
  from.questions = from.questions.filter(x => x.id !== req.params.qid);
  to.questions.push({ ...q, timestamp: new Date().toISOString() });
  saveAppointments(data);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Verify endpoints with curl**

Start server: `cd web && node server.js &`

```bash
# Create appointment
curl -s -X POST http://localhost:3001/api/appointments \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-20"}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.ok ? 'PASS: ' + d.appointment.id : 'FAIL')"

# List appointments
curl -s http://localhost:3001/api/appointments | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log('Count:', d.length)"
```

Expected: `PASS: appt_<timestamp>` then `Count: 1`

- [ ] **Step 5: Commit**

```bash
git add web/server.js
git commit -m "feat(server): appointments API endpoints"
```

---

## Task 2: Server — Growth API + WHO data

**Files:**
- Modify: `web/server.js`

- [ ] **Step 1: Add WHO static data and growth helper**

Add immediately after the `saveAppointments` function (after Task 1):

```js
// WHO Child Growth Standards — Girls, 0–24 months
const WHO_GIRLS = {
  weight: {
    months: [0,1,2,3,4,5,6,7,8,9,10,11,12,15,18,21,24],
    p3:  [2.4,3.2,3.9,4.5,5.0,5.4,5.7,6.0,6.3,6.6,6.8,7.0,7.1,7.6,8.1,8.6,9.0],
    p15: [2.8,3.6,4.5,5.2,5.7,6.1,6.5,6.8,7.1,7.4,7.7,7.9,8.1,8.7,9.2,9.7,10.2],
    p50: [3.2,4.2,5.1,5.8,6.4,6.9,7.3,7.6,7.9,8.2,8.5,8.7,8.9,9.6,10.2,10.9,11.5],
    p85: [3.7,4.8,5.8,6.6,7.3,7.8,8.3,8.7,9.1,9.4,9.7,10.0,10.2,11.0,11.8,12.5,13.2],
    p97: [4.2,5.5,6.6,7.5,8.2,8.8,9.3,9.8,10.2,10.5,10.9,11.2,11.5,12.4,13.2,14.0,14.8],
  },
  height: {
    months: [0,1,2,3,4,5,6,7,8,9,10,11,12,15,18,21,24],
    p3:  [44.8,48.9,52.4,55.3,57.7,59.6,61.2,62.7,64.0,65.3,66.5,67.6,68.6,72.0,75.0,77.5,80.0],
    p15: [46.1,50.2,53.8,56.7,59.1,61.1,62.7,64.3,65.6,67.0,68.2,69.3,70.4,73.8,76.9,79.6,82.1],
    p50: [49.1,53.7,57.1,59.8,62.1,64.0,65.7,67.3,68.7,70.1,71.5,72.8,74.0,77.5,80.7,83.5,86.4],
    p85: [51.0,55.6,59.1,61.9,64.3,66.2,68.0,69.6,71.1,72.5,73.8,75.2,76.6,80.2,83.5,86.4,89.4],
    p97: [52.9,57.6,61.1,64.0,66.4,68.5,70.3,71.9,73.5,74.9,76.3,77.7,79.2,82.9,86.4,89.3,92.4],
  },
};

function loadGrowth() {
  const data = rj(GROWTH_PATH) || [];
  return data.sort((a, b) => a.date.localeCompare(b.date));
}
function saveGrowth(data) { wj(GROWTH_PATH, data); }
```

- [ ] **Step 2: Add growth endpoints**

Add immediately before the `// ── Week plan generation helper` comment:

```js
// ── Growth tracking ───────────────────────────────────────────────────────────

app.get('/api/growth-curves', (req, res) => {
  res.json(WHO_GIRLS);
});

app.get('/api/growth', (req, res) => {
  res.json(loadGrowth());
});

app.post('/api/growth', (req, res) => {
  const { date, heightCm, weightKg } = req.body;
  if (!date || heightCm == null || weightKg == null)
    return res.status(400).json({ error: 'date, heightCm, weightKg required' });
  const data = loadGrowth();
  const entry = { id: `g_${Date.now()}`, date, heightCm: Number(heightCm), weightKg: Number(weightKg) };
  data.push(entry);
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveGrowth(data);
  res.json({ ok: true, entry });
});

app.patch('/api/growth/:id', (req, res) => {
  const { date, heightCm, weightKg } = req.body;
  const data = loadGrowth();
  const idx  = data.findIndex(e => e.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'not found' });
  if (date     !== undefined) data[idx].date     = date;
  if (heightCm !== undefined) data[idx].heightCm = Number(heightCm);
  if (weightKg !== undefined) data[idx].weightKg = Number(weightKg);
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveGrowth(data);
  res.json({ ok: true, entry: data[idx] });
});

app.delete('/api/growth/:id', (req, res) => {
  const data = loadGrowth();
  const updated = data.filter(e => e.id !== req.params.id);
  saveGrowth(updated);
  res.json({ ok: true });
});
```

- [ ] **Step 3: Verify**

```bash
curl -s http://localhost:3001/api/growth-curves | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log('weight months:', d.weight.months.length, '== 17 ?', d.weight.months.length === 17 ? 'PASS' : 'FAIL')"

curl -s -X POST http://localhost:3001/api/growth \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-06-04","heightCm":65.5,"weightKg":7.2}' | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log(d.ok ? 'PASS' : 'FAIL')"
```

Expected: `weight months: 17 == 17 ? PASS` then `PASS`

- [ ] **Step 4: Commit**

```bash
git add web/server.js
git commit -m "feat(server): growth tracking API + WHO percentile data"
```

---

## Task 3: Server — Foods summary endpoint

**Files:**
- Modify: `web/server.js`

- [ ] **Step 1: Add /api/foods-summary endpoint**

Add immediately before the `// ── Growth tracking` section (from Task 2):

```js
// ── Foods summary ─────────────────────────────────────────────────────────────

app.get('/api/foods-summary', (req, res) => {
  const profile = loadProfile();
  const slotIds = profile.slots.map(s => s.id);
  const map = {}; // lowercase food name → { name, reactions: {Loved,Liked,Neutral,Disliked} }

  // Scan all daily log files
  let files = [];
  try { files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json')); } catch {}

  for (const file of files) {
    const log = rj(path.join(LOGS_DIR, file));
    if (!log) continue;
    for (const slotId of slotIds) {
      const meal = log.meals?.[slotId];
      if (!meal?.food) continue;
      const key  = meal.food.toLowerCase().trim();
      if (!map[key]) map[key] = { name: meal.food.trim(), reactions: { Loved:0, Liked:0, Neutral:0, Disliked:0 } };
      const r = meal.reaction;
      if (r && map[key].reactions[r] !== undefined) map[key].reactions[r]++;
    }
  }

  const foods = Object.values(map).map(f => ({
    name: f.name,
    totalEntries: Object.values(f.reactions).reduce((a, b) => a + b, 0),
    reactions: f.reactions,
    rejected: f.reactions.Disliked > 0,
  }));

  res.json(foods);
});
```

- [ ] **Step 2: Verify**

```bash
curl -s http://localhost:3001/api/foods-summary | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log('Foods:', d.length, 'Rejected:', d.filter(f=>f.rejected).length)"
```

Expected: shows count of foods and rejected count (exact numbers depend on log data, but no error).

- [ ] **Step 3: Commit**

```bash
git add web/server.js
git commit -m "feat(server): foods-summary endpoint aggregates reactions from daily logs"
```

---

## Task 4: Frontend — Replace Progress tab HTML + add Chart.js

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Add Chart.js CDN script**

Find the existing CDN script tag (line ~7):
```html
  <script src="https://cdn.tailwindcss.com"></script>
```

Add Chart.js immediately after it:
```html
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

- [ ] **Step 2: Replace Progress tab HTML**

Find and replace the entire Progress tab content (lines ~347–384):
```html
  <!-- ── TAB: PROGRESS ─────────────────────────────────────────── -->
  <div id="tab-progress" class="tab-panel max-w-lg mx-auto px-4 pt-4 pb-4 space-y-4">

    <!-- Stats row -->
    <div class="grid grid-cols-3 gap-3">
      <div class="card p-3 text-center">
        <div id="prog-days" class="text-2xl font-bold" style="color:var(--peach)">—</div>
        <div class="text-xs text-gray-400 mt-1">Days on solids</div>
      </div>
      <div class="card p-3 text-center">
        <div id="prog-foods" class="text-2xl font-bold" style="color:var(--sage-d)">—</div>
        <div class="text-xs text-gray-400 mt-1">Foods tried</div>
      </div>
      <div class="card p-3 text-center">
        <div id="prog-ms" class="text-2xl font-bold text-purple-500">—</div>
        <div class="text-xs text-gray-400 mt-1">Milestones</div>
      </div>
    </div>

    <!-- Reactions breakdown -->
    <div class="card p-4">
      <h3 class="text-sm font-bold text-gray-600 mb-3">Reactions (last 14 days)</h3>
      <div id="reactions-chart" class="space-y-2"></div>
    </div>

    <!-- Foods tried list -->
    <div class="card p-4">
      <h3 class="text-sm font-bold text-gray-600 mb-3">Foods tried so far</h3>
      <div id="foods-list" class="flex flex-wrap gap-2"></div>
    </div>

    <!-- Milestone breakdown -->
    <div class="card p-4">
      <h3 class="text-sm font-bold text-gray-600 mb-3">Milestone summary</h3>
      <div id="ms-progress-list" class="space-y-2"></div>
    </div>

  </div>
```

Replace with:
```html
  <!-- ── TAB: PROGRESS ─────────────────────────────────────────── -->
  <div id="tab-progress" class="tab-panel max-w-lg mx-auto px-4 pt-4 pb-4 space-y-4">

    <!-- Appointments -->
    <div class="card p-4">
      <h3 class="text-sm font-bold text-gray-700 mb-3">📅 Appointments</h3>
      <div id="appt-next" class="mb-3"></div>
      <div id="appt-past" class="space-y-2"></div>
    </div>

    <!-- Growth chart -->
    <div class="card p-4">
      <h3 class="text-sm font-bold text-gray-700 mb-3">📈 Growth</h3>
      <div id="growth-form" class="mb-4"></div>
      <div id="growth-entries" class="mb-4 space-y-1"></div>
      <div id="growth-chart-wrap">
        <div id="growth-placeholder" class="hidden text-xs text-gray-300 text-center py-6">Add 2 or more measurements to see the chart</div>
        <div id="growth-charts" class="hidden space-y-4">
          <div>
            <div class="text-xs text-gray-400 font-medium mb-1">Height (cm)</div>
            <canvas id="chart-height" height="160"></canvas>
          </div>
          <div>
            <div class="text-xs text-gray-400 font-medium mb-1">Weight (kg)</div>
            <canvas id="chart-weight" height="160"></canvas>
          </div>
        </div>
      </div>
    </div>

    <!-- Foods tried -->
    <div class="card p-4">
      <h3 class="text-sm font-bold text-gray-700 mb-3">🍽 Foods tried</h3>
      <div id="foods-tried-list" class="space-y-2"></div>
    </div>

    <!-- Rejected foods -->
    <div class="card p-4">
      <h3 class="text-sm font-bold text-gray-700 mb-3">😖 Rejected foods</h3>
      <div id="foods-rejected-list" class="space-y-2"></div>
    </div>

  </div>
```

- [ ] **Step 3: Verify JS syntax**

```bash
node -e "
const html = require('fs').readFileSync('web/public/index.html','utf-8');
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi;
let src = '', m;
while ((m = re.exec(html)) !== null) src += m[1] + '\n';
try { new Function(src); console.log('PASS'); } catch(e) { console.error('FAIL:', e.message); }
"
```

Expected: `PASS`

- [ ] **Step 4: Commit**

```bash
git add web/public/index.html
git commit -m "feat(progress): replace tab HTML with appointments/growth/foods sections"
```

---

## Task 5: Frontend — State vars + loadProgress() + appointments rendering

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Add state vars**

Find this block (around line 412):
```js
let activeTheme      = null;
let milestoneScope   = 'month';
let expandedMilestoneId = null;
```

Add three lines after:
```js
let appointmentsData  = [];
let growthData        = [];
let foodsSummaryData  = [];
let growthCurves      = null;
let expandedApptId    = null;   // id of expanded past appointment accordion
let expandedFoodName  = null;   // food name of expanded food accordion
```

- [ ] **Step 2: Rewrite loadProgress()**

Find and replace the entire `loadProgress` function (around line 2118):
```js
async function loadProgress() {
  tabLoaded.progress = true;
  const prog = await fetch('/api/progress').then(r=>r.json());
  renderProgress(prog);
}
```

Replace with:
```js
async function loadProgress() {
  tabLoaded.progress = true;
  [appointmentsData, growthData, growthCurves, foodsSummaryData] = await Promise.all([
    fetch('/api/appointments').then(r => r.json()),
    fetch('/api/growth').then(r => r.json()),
    fetch('/api/growth-curves').then(r => r.json()),
    fetch('/api/foods-summary').then(r => r.json()),
  ]);
  renderAppointments();
  renderGrowthSection();
  renderFoodsSection();
}
```

- [ ] **Step 3: Remove old renderProgress()**

Find and delete the entire `renderProgress` function (lines ~2124–2160):
```js
function renderProgress(prog) {
  document.getElementById('prog-days').textContent  = prog.daysSinceSolids;
  ...
  // (the whole function until its closing brace)
}
```

Delete everything from `function renderProgress(prog) {` through its closing `}`.

- [ ] **Step 4: Add renderAppointments() and helper functions**

Add the following after `loadProgress()`:

```js
function renderAppointments() {
  const today = new Date().toISOString().split('T')[0];
  const upcoming = appointmentsData.find(a => a.date >= today);
  const past     = appointmentsData.filter(a => a.date < today).reverse(); // most recent first

  // Next appointment card
  document.getElementById('appt-next').innerHTML = renderNextApptCard(upcoming);

  // Past appointment cards
  document.getElementById('appt-past').innerHTML = past.length === 0 ? '' :
    past.map(a => renderPastApptCard(a)).join('');
}

function renderNextApptCard(appt) {
  if (!appt) {
    return `
      <div style="background:#f9fafb;border-radius:10px;padding:12px">
        <div class="text-xs text-gray-400 mb-2">No upcoming appointment</div>
        <div class="flex gap-2">
          <input type="date" id="new-appt-date" class="flex-1 bg-white rounded-lg px-3 py-2 text-sm border border-gray-100"
            style="min-width:0">
          <button onclick="createAppointment()" class="text-xs font-semibold px-3 py-2 rounded-lg text-white" style="background:var(--peach)">
            Set date
          </button>
        </div>
      </div>`;
  }

  const unanswered = appt.questions.filter(q => !q.answered);
  const answered   = appt.questions.filter(q => q.answered);

  return `
    <div style="background:#fff8f0;border:1.5px solid #fed7aa;border-radius:12px;padding:12px">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xs font-bold text-orange-600">Next visit</span>
        <input type="date" id="appt-date-${escAttr(appt.id)}" value="${escAttr(appt.date)}"
          onchange="updateApptDate('${escAttr(appt.id)}')"
          class="text-sm font-semibold text-gray-700 border-none bg-transparent cursor-pointer"
          style="outline:none">
      </div>
      <div class="text-xs font-semibold text-gray-500 mb-2">Questions for the doctor</div>
      ${unanswered.map(q => renderQuestion(appt.id, q)).join('')}
      ${answered.length ? `<div class="mt-2 text-xs text-gray-400 font-medium">Answered</div>${answered.map(q => renderQuestion(appt.id, q)).join('')}` : ''}
      <div class="flex gap-2 mt-3">
        <input type="text" id="new-q-${escAttr(appt.id)}" placeholder="Add a question…"
          class="flex-1 bg-white rounded-lg px-3 py-2 text-xs border border-gray-100"
          style="min-width:0"
          onkeydown="if(event.key==='Enter')addQuestion('${escAttr(appt.id)}')">
        <button onclick="addQuestion('${escAttr(appt.id)}')"
          class="text-xs font-semibold px-3 py-2 rounded-lg text-white" style="background:var(--sage)">
          + Add
        </button>
      </div>
    </div>`;
}

function renderQuestion(apptId, q) {
  const ts = new Date(q.timestamp).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
  if (q.answered) {
    return `
      <div style="border-radius:8px;padding:8px 10px;background:#f0fdf4;margin-bottom:4px">
        <div class="text-xs text-gray-600">${escHtml(q.text)}</div>
        ${q.answer ? `<div class="text-xs text-green-700 mt-1 font-medium">"${escHtml(q.answer)}"</div>` : ''}
        <div class="text-xs text-gray-300 mt-1">${ts} · Answered ✓</div>
      </div>`;
  }
  return `
    <div id="qrow-${escAttr(q.id)}" style="border-radius:8px;padding:8px 10px;background:#fff;border:1px solid #f3f4f6;margin-bottom:4px">
      <div class="text-xs text-gray-700 mb-1">${escHtml(q.text)}</div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-300">${ts}</span>
        <button class="text-xs text-green-600 font-medium" onclick="startAnswerQuestion('${escAttr(apptId)}','${escAttr(q.id)}')">✓ Answered</button>
        <button class="text-xs text-blue-400 font-medium" onclick="moveQuestion('${escAttr(apptId)}','${escAttr(q.id)}')">→ Move</button>
        <button class="text-xs text-red-400 font-medium" onclick="deleteQuestion('${escAttr(apptId)}','${escAttr(q.id)}')">🗑</button>
      </div>
      <div id="ans-${escAttr(q.id)}" class="hidden mt-2">
        <input type="text" id="ans-text-${escAttr(q.id)}" placeholder="Add answer (optional)…"
          class="w-full bg-gray-50 rounded-lg px-2 py-1.5 text-xs border border-gray-100 mb-1">
        <button onclick="saveAnswer('${escAttr(apptId)}','${escAttr(q.id)}')"
          class="text-xs font-semibold px-3 py-1 rounded-lg text-white" style="background:var(--sage)">Save</button>
      </div>
    </div>`;
}

function renderPastApptCard(appt) {
  const isOpen = expandedApptId === appt.id;
  const d = new Date(appt.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  const qCount = appt.questions.length;
  const stats = [
    qCount ? `${qCount} question${qCount!==1?'s':''}` : null,
    appt.weight ? `${appt.weight} kg` : null,
    appt.height ? `${appt.height} cm` : null,
  ].filter(Boolean).join(' · ');

  if (!isOpen) {
    return `
      <div class="cursor-pointer" onclick="toggleAppt('${escAttr(appt.id)}')"
        style="border-radius:10px;padding:10px 12px;background:#f9fafb;display:flex;justify-content:space-between;align-items:center">
        <span class="text-sm font-semibold text-gray-700">${d}</span>
        <span class="text-xs text-gray-400">${stats || 'No data'} ›</span>
      </div>`;
  }

  const needsMeasurements = appt.height == null && appt.weight == null;
  return `
    <div style="border-radius:10px;background:#f9fafb;overflow:hidden">
      <div class="cursor-pointer" onclick="toggleAppt('${escAttr(appt.id)}')"
        style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f3f4f6">
        <span class="text-sm font-semibold text-gray-700">${d}</span>
        <span class="text-xs text-gray-400">‹ collapse</span>
      </div>
      <div style="padding:10px 12px">
        ${needsMeasurements ? `
          <div class="text-xs text-gray-400 mb-2">Add measurements</div>
          <div class="flex gap-2 mb-3">
            <input type="number" id="ph-${escAttr(appt.id)}" placeholder="Height cm" step="0.1"
              class="flex-1 bg-white rounded-lg px-2 py-1.5 text-xs border border-gray-100">
            <input type="number" id="pw-${escAttr(appt.id)}" placeholder="Weight kg" step="0.01"
              class="flex-1 bg-white rounded-lg px-2 py-1.5 text-xs border border-gray-100">
            <button onclick="saveMeasurements('${escAttr(appt.id)}')"
              class="text-xs font-semibold px-2 py-1.5 rounded-lg text-white" style="background:var(--peach)">Save</button>
          </div>` : `
          <div class="text-xs text-gray-500 mb-3">${appt.height} cm · ${appt.weight} kg</div>`}
        ${appt.questions.length === 0
          ? '<div class="text-xs text-gray-300">No questions recorded</div>'
          : appt.questions.map(q => `
            <div style="padding:6px 8px;background:#fff;border-radius:6px;margin-bottom:4px">
              <div class="text-xs text-gray-600">${escHtml(q.text)}</div>
              ${q.answered && q.answer ? `<div class="text-xs text-green-600 mt-1">"${escHtml(q.answer)}"</div>` : ''}
            </div>`).join('')}
      </div>
    </div>`;
}
```

- [ ] **Step 5: Add appointment action functions**

Add immediately after the render functions above:

```js
async function createAppointment() {
  const date = document.getElementById('new-appt-date')?.value;
  if (!date) return;
  const resp = await fetch('/api/appointments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  }).then(r => r.json());
  if (resp.ok) {
    appointmentsData = await fetch('/api/appointments').then(r => r.json());
    renderAppointments();
  }
}

async function updateApptDate(apptId) {
  const date = document.getElementById(`appt-date-${apptId}`)?.value;
  if (!date) return;
  await fetch(`/api/appointments/${apptId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  appointmentsData = await fetch('/api/appointments').then(r => r.json());
  renderAppointments();
}

async function addQuestion(apptId) {
  const input = document.getElementById(`new-q-${apptId}`);
  const text  = input?.value.trim();
  if (!text) return;
  await fetch(`/api/appointments/${apptId}/questions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source: 'manual' }),
  });
  input.value = '';
  appointmentsData = await fetch('/api/appointments').then(r => r.json());
  renderAppointments();
}

function startAnswerQuestion(apptId, qid) {
  document.getElementById(`ans-${qid}`)?.classList.remove('hidden');
}

async function saveAnswer(apptId, qid) {
  const answer = document.getElementById(`ans-text-${qid}`)?.value.trim() || '';
  await fetch(`/api/appointments/${apptId}/questions/${qid}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answered: true, answer }),
  });
  appointmentsData = await fetch('/api/appointments').then(r => r.json());
  renderAppointments();
}

async function deleteQuestion(apptId, qid) {
  await fetch(`/api/appointments/${apptId}/questions/${qid}`, { method: 'DELETE' });
  appointmentsData = await fetch('/api/appointments').then(r => r.json());
  renderAppointments();
}

async function moveQuestion(apptId, qid) {
  const resp = await fetch(`/api/appointments/${apptId}/questions/${qid}/move`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(r => r.json());
  if (resp.error === 'no_next_appointment') {
    alert('No next appointment — create one first');
    return;
  }
  appointmentsData = await fetch('/api/appointments').then(r => r.json());
  renderAppointments();
}

async function saveMeasurements(apptId) {
  const height = parseFloat(document.getElementById(`ph-${apptId}`)?.value) || null;
  const weight = parseFloat(document.getElementById(`pw-${apptId}`)?.value) || null;
  if (!height || !weight) return;
  await fetch(`/api/appointments/${apptId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ height, weight }),
  });
  appointmentsData = await fetch('/api/appointments').then(r => r.json());
  renderAppointments();
}

function toggleAppt(apptId) {
  expandedApptId = (expandedApptId === apptId) ? null : apptId;
  renderAppointments();
}
```

- [ ] **Step 6: Verify JS syntax**

```bash
node -e "
const html = require('fs').readFileSync('web/public/index.html','utf-8');
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi;
let src = '', m;
while ((m = re.exec(html)) !== null) src += m[1] + '\n';
try { new Function(src); console.log('PASS'); } catch(e) { console.error('FAIL:', e.message); }
"
```

Expected: `PASS`

- [ ] **Step 7: Commit**

```bash
git add web/public/index.html
git commit -m "feat(progress): appointments section — state, rendering, CRUD"
```

---

## Task 6: Frontend — Growth chart

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Add state for growth chart instances**

Find the state vars added in Task 5 and add below them:
```js
let growthHeightChart = null;
let growthWeightChart = null;
```

- [ ] **Step 2: Add renderGrowthSection()**

Add immediately after `toggleAppt()` from Task 5:

```js
function renderGrowthSection() {
  // Input form
  document.getElementById('growth-form').innerHTML = `
    <div class="grid grid-cols-2 gap-2 mb-2">
      <div>
        <label class="text-xs text-gray-400">Date</label>
        <input type="date" id="gr-date" value="${new Date().toISOString().split('T')[0]}"
          class="w-full bg-gray-50 rounded-lg px-2 py-2 text-xs border border-gray-100 mt-0.5">
      </div>
      <div>
        <label class="text-xs text-gray-400">Height (cm)</label>
        <input type="number" id="gr-height" step="0.1" placeholder="e.g. 65.5"
          class="w-full bg-gray-50 rounded-lg px-2 py-2 text-xs border border-gray-100 mt-0.5">
      </div>
      <div>
        <label class="text-xs text-gray-400">Weight (kg)</label>
        <input type="number" id="gr-weight" step="0.01" placeholder="e.g. 7.2"
          class="w-full bg-gray-50 rounded-lg px-2 py-2 text-xs border border-gray-100 mt-0.5">
      </div>
      <div class="flex items-end">
        <button onclick="addGrowthEntry()"
          class="w-full text-xs font-semibold py-2 rounded-lg text-white" style="background:var(--sage)">
          + Add entry
        </button>
      </div>
    </div>`;

  // Entry list
  document.getElementById('growth-entries').innerHTML = growthData.length === 0
    ? '<div class="text-xs text-gray-300">No entries yet</div>'
    : growthData.map(e => {
        const d = new Date(e.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
        return `
          <div id="gentry-${escAttr(e.id)}" class="flex items-center justify-between text-xs text-gray-600 py-1 border-b border-gray-50">
            <span>${d}</span>
            <span>${e.heightCm} cm · ${e.weightKg} kg</span>
            <button onclick="startEditGrowth('${escAttr(e.id)}')" class="text-gray-300 hover:text-gray-500">✏</button>
          </div>`;
      }).join('');

  // Chart visibility
  const hasEnough = growthData.length >= 2;
  document.getElementById('growth-placeholder').classList.toggle('hidden', hasEnough);
  document.getElementById('growth-charts').classList.toggle('hidden', !hasEnough);

  if (hasEnough) initGrowthCharts();
}

async function addGrowthEntry() {
  const date     = document.getElementById('gr-date')?.value;
  const heightCm = parseFloat(document.getElementById('gr-height')?.value);
  const weightKg = parseFloat(document.getElementById('gr-weight')?.value);
  if (!date || isNaN(heightCm) || isNaN(weightKg)) return;
  await fetch('/api/growth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, heightCm, weightKg }),
  });
  growthData = await fetch('/api/growth').then(r => r.json());
  document.getElementById('gr-height').value = '';
  document.getElementById('gr-weight').value = '';
  renderGrowthSection();
}

function startEditGrowth(id) {
  const entry = growthData.find(e => e.id === id);
  if (!entry) return;
  const d = new Date(entry.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  document.getElementById(`gentry-${id}`).outerHTML = `
    <div id="gentry-${escAttr(id)}" class="flex items-center gap-2 py-1 border-b border-gray-50">
      <input type="date" id="ged-date-${escAttr(id)}" value="${escAttr(entry.date)}"
        class="text-xs border border-gray-100 rounded px-1 py-0.5 bg-gray-50" style="width:110px">
      <input type="number" id="ged-h-${escAttr(id)}" value="${entry.heightCm}" step="0.1"
        class="text-xs border border-gray-100 rounded px-1 py-0.5 bg-gray-50 w-14" placeholder="cm">
      <input type="number" id="ged-w-${escAttr(id)}" value="${entry.weightKg}" step="0.01"
        class="text-xs border border-gray-100 rounded px-1 py-0.5 bg-gray-50 w-14" placeholder="kg">
      <button onclick="saveEditGrowth('${escAttr(id)}')" class="text-xs text-green-600 font-medium">Save</button>
    </div>`;
}

async function saveEditGrowth(id) {
  const date     = document.getElementById(`ged-date-${id}`)?.value;
  const heightCm = parseFloat(document.getElementById(`ged-h-${id}`)?.value);
  const weightKg = parseFloat(document.getElementById(`ged-w-${id}`)?.value);
  if (!date || isNaN(heightCm) || isNaN(weightKg)) return;
  await fetch(`/api/growth/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, heightCm, weightKg }),
  });
  growthData = await fetch('/api/growth').then(r => r.json());
  renderGrowthSection();
}
```

- [ ] **Step 3: Add initGrowthCharts()**

Add immediately after `saveEditGrowth()`:

```js
function initGrowthCharts() {
  const profile = null; // DOB read from server-rendered data not available here
  // DOB is baked into window via the initial data — fall back to fetching profile
  // Actually: dob is embedded in the page on init. Read from a known global or fetch once.
  // We stored it as a module-level const on init:
  const dob = new Date(window._babyDob || '2025-11-11');

  function ageMonths(dateStr) {
    const d = new Date(dateStr);
    return (d - dob) / (30.4375 * 24 * 3600 * 1000);
  }

  const babyHeightPts = growthData.map(e => ({ x: ageMonths(e.date), y: e.heightCm }));
  const babyWeightPts = growthData.map(e => ({ x: ageMonths(e.date), y: e.weightKg }));

  const whoMonths = growthCurves.height.months;

  function whoDataset(pctKey, metric) {
    return growthCurves[metric][pctKey].map((v, i) => ({ x: whoMonths[i], y: v }));
  }

  const sharedOptions = (yLabel) => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { mode: 'index' } },
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Age (months)', font: { size: 10 } },
        ticks: { font: { size: 9 } },
        min: 0, max: 24,
      },
      y: {
        title: { display: true, text: yLabel, font: { size: 10 } },
        ticks: { font: { size: 9 } },
      },
    },
  });

  function bandDatasets(metric, babyPts, babyColor) {
    return [
      { data: whoDataset('p3',  metric), fill: false,  borderWidth: 0.8, borderColor: '#e2e8f0', borderDash: [4,3], pointRadius: 0 },
      { data: whoDataset('p97', metric), fill: '-1',   backgroundColor: 'rgba(226,232,240,0.25)', borderWidth: 0.8, borderColor: '#e2e8f0', borderDash: [4,3], pointRadius: 0 },
      { data: whoDataset('p15', metric), fill: false,  borderWidth: 0,   pointRadius: 0 },
      { data: whoDataset('p85', metric), fill: '-1',   backgroundColor: 'rgba(203,213,225,0.3)',  borderWidth: 0, pointRadius: 0 },
      { data: whoDataset('p50', metric), fill: false,  borderWidth: 1.2, borderColor: 'rgba(148,163,184,0.5)', borderDash: [6,3], pointRadius: 0 },
      { data: babyPts, fill: false, borderColor: babyColor, backgroundColor: babyColor, borderWidth: 2.5, tension: 0.3, pointRadius: 4, pointBackgroundColor: babyColor },
    ];
  }

  // Destroy existing chart instances before recreating
  if (growthHeightChart) { growthHeightChart.destroy(); growthHeightChart = null; }
  if (growthWeightChart) { growthWeightChart.destroy(); growthWeightChart = null; }

  growthHeightChart = new Chart(document.getElementById('chart-height'), {
    type: 'line',
    data: { datasets: bandDatasets('height', babyHeightPts, '#6ca98f') },
    options: sharedOptions('Height (cm)'),
  });

  growthWeightChart = new Chart(document.getElementById('chart-weight'), {
    type: 'line',
    data: { datasets: bandDatasets('weight', babyWeightPts, '#f97316') },
    options: sharedOptions('Weight (kg)'),
  });
}
```

- [ ] **Step 4: Expose DOB to frontend**

The growth chart needs the baby's DOB to compute age in months. Find the `init()` function (around line ~506):
```js
async function init() {
```

Add inside `init()`, before any other line:
```js
  // Expose baby DOB for growth chart age calculation
  const profileData = await fetch('/api/milestones-data').then(r => r.json());
  // milestones-data returns { milestones, age } but not DOB directly.
  // Fetch profile separately:
```

Actually simpler — add a new tiny endpoint. Find the end of server.js before `app.listen(3001)`:

```js
app.get('/api/profile', (req, res) => {
  const p = loadProfile();
  res.json({ name: p.name, dob: p.dob, gender: p.gender });
});
```

Then in `init()` in index.html, after the existing data fetches, add:
```js
  const profileMeta = await fetch('/api/profile').then(r => r.json());
  window._babyDob = profileMeta.dob;
```

Find `init()` around line 506:
```js
async function init() {
  // load today's log + suggestion
  [todayLog, todaySuggest, achievementsData] = await Promise.all([
```

Replace the opening to add the profile fetch:
```js
async function init() {
  // Expose baby profile to window for use in growth chart etc.
  const _profile = await fetch('/api/profile').then(r => r.json());
  window._babyDob = _profile.dob;

  // load today's log + suggestion
  [todayLog, todaySuggest, achievementsData] = await Promise.all([
```

- [ ] **Step 5: Verify JS syntax**

```bash
node -e "
const html = require('fs').readFileSync('web/public/index.html','utf-8');
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi;
let src = '', m;
while ((m = re.exec(html)) !== null) src += m[1] + '\n';
try { new Function(src); console.log('PASS'); } catch(e) { console.error('FAIL:', e.message); }
"
```

Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add web/public/index.html web/server.js
git commit -m "feat(progress): growth chart with WHO percentile bands"
```

---

## Task 7: Frontend — Foods tried + Rejected foods

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Add renderFoodsSection()**

Add immediately after `initGrowthCharts()` from Task 6:

```js
function renderFoodsSection() {
  const tried    = foodsSummaryData.filter(f => !f.rejected);
  const rejected = foodsSummaryData.filter(f => f.rejected);

  document.getElementById('foods-tried-list').innerHTML = tried.length === 0
    ? '<div class="text-xs text-gray-300">No foods logged yet</div>'
    : tried.map(f => renderFoodCard(f)).join('');

  document.getElementById('foods-rejected-list').innerHTML = rejected.length === 0
    ? '<div class="text-xs text-gray-300">No rejected foods yet 🎉</div>'
    : rejected.map(f => renderFoodCard(f)).join('');
}

function renderFoodCard(f) {
  const isOpen = expandedFoodName === f.name.toLowerCase();
  const dominant = Object.entries(f.reactions).sort((a,b) => b[1]-a[1])[0];
  const emoji = { Loved:'😍', Liked:'😊', Neutral:'😐', Disliked:'😖' }[dominant?.[0]] || '🍽';

  if (!isOpen) {
    return `
      <div onclick="toggleFood('${escAttr(f.name.toLowerCase())}')"
        class="cursor-pointer flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
        <span class="text-sm font-medium text-gray-700">${escHtml(f.name)}</span>
        <span class="text-xs text-gray-400">${emoji} ×${f.totalEntries} ›</span>
      </div>`;
  }

  const total = f.totalEntries || 1;
  const rxColors = { Loved:'#FACC15', Liked:'#4ADE80', Neutral:'#94A3B8', Disliked:'#F87171' };
  const bars = Object.entries(f.reactions)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `
      <div class="flex items-center gap-2 mb-1">
        <div class="text-xs text-gray-500 w-14">${k}</div>
        <div class="flex-1 bg-gray-100 rounded-full overflow-hidden" style="height:7px">
          <div style="width:${Math.round(v/total*100)}%;height:7px;background:${rxColors[k]};border-radius:9999px"></div>
        </div>
        <div class="text-xs text-gray-400 w-4 text-right">${v}</div>
      </div>`).join('');

  return `
    <div onclick="toggleFood('${escAttr(f.name.toLowerCase())}')" class="cursor-pointer rounded-lg bg-gray-50 overflow-hidden">
      <div class="flex items-center justify-between py-2 px-3">
        <span class="text-sm font-semibold text-gray-700">${escHtml(f.name)} ×${f.totalEntries}</span>
        <span class="text-xs text-gray-400">‹</span>
      </div>
      <div class="px-3 pb-3" onclick="event.stopPropagation()">
        ${bars}
      </div>
    </div>`;
}

function toggleFood(name) {
  expandedFoodName = (expandedFoodName === name) ? null : name;
  renderFoodsSection();
}
```

- [ ] **Step 2: Verify JS syntax**

```bash
node -e "
const html = require('fs').readFileSync('web/public/index.html','utf-8');
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi;
let src = '', m;
while ((m = re.exec(html)) !== null) src += m[1] + '\n';
try { new Function(src); console.log('PASS'); } catch(e) { console.error('FAIL:', e.message); }
"
```

Expected: `PASS`

- [ ] **Step 3: Commit**

```bash
git add web/public/index.html
git commit -m "feat(progress): foods tried and rejected foods accordion sections"
```

---

## Task 8: Frontend — Uma appointment question integration

**Files:**
- Modify: `web/public/index.html`

**Context:** `confirmDoctorQuestion(cardId)` currently POSTs to `/api/log-doctor-question` (saves to Bailey's QUESTIONS-QUEUE.md). Change it to POST to `/api/appointments/next/questions` instead, and add the "Want to add more details?" follow-up UI.

- [ ] **Step 1: Replace confirmDoctorQuestion()**

Find the entire function (around line 1402):
```js
async function confirmDoctorQuestion(cardId) {
  const question = document.getElementById(`${cardId}-question`)?.value.trim();
  if (!question) return;

  const card = document.getElementById(cardId);
  if (card) card.innerHTML = `<div class="text-xs text-gray-400 py-2">Saving...</div>`;

  const resp = await fetch('/api/log-doctor-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  }).then(r => r.json());

  if (card) {
    card.innerHTML = resp.ok
      ? `<div class="text-xs text-green-500 py-2">✓ Added to doctor visit questions (#${resp.questionNumber})</div>`
      : `<div class="text-xs text-red-400 py-2">Error saving. Try again.</div>`;
  }
}
```

Replace with:
```js
async function confirmDoctorQuestion(cardId) {
  const question = document.getElementById(`${cardId}-question`)?.value.trim();
  if (!question) return;

  const card = document.getElementById(cardId);
  if (card) card.innerHTML = `<div class="text-xs text-gray-400 py-2">Saving...</div>`;

  const resp = await fetch('/api/appointments/next/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: question, source: 'chat' }),
  }).then(r => r.json());

  if (!card) return;

  if (resp.error === 'no_next_appointment') {
    card.innerHTML = `<div class="text-xs text-orange-500 py-2">No upcoming appointment set — add one in Progress tab first</div>`;
    return;
  }

  if (!resp.ok) {
    card.innerHTML = `<div class="text-xs text-red-400 py-2">Error saving. Try again.</div>`;
    return;
  }

  // Success — show "want to add details?" follow-up
  const apptId = resp.appointmentId;
  const qid    = resp.question.id;
  card.innerHTML = `
    <div class="text-xs text-green-600 font-medium mb-2">✓ Added to appointment questions</div>
    <div class="text-xs text-gray-500 mb-1">Want to add more details?</div>
    <div class="flex gap-2">
      <input type="text" id="${cardId}-details" placeholder="Any extra context…"
        class="flex-1 bg-gray-50 rounded-lg px-2 py-1.5 text-xs border border-gray-100" style="min-width:0">
      <button onclick="saveQuestionDetails('${escAttr(apptId)}','${escAttr(qid)}','${cardId}')"
        class="text-xs font-semibold px-3 py-1.5 rounded-lg text-white" style="background:var(--sage)">Save</button>
      <button onclick="document.getElementById('${cardId}').innerHTML='<div class=\\'text-xs text-green-500 py-2\\'>✓ Saved</div>'"
        class="text-xs text-gray-400 py-1.5">Skip</button>
    </div>`;

  // Refresh appointments if Progress tab is loaded
  if (tabLoaded.progress) {
    appointmentsData = await fetch('/api/appointments').then(r => r.json());
    renderAppointments();
  }
}

async function saveQuestionDetails(apptId, qid, cardId) {
  const details = document.getElementById(`${cardId}-details`)?.value.trim();
  if (!details) {
    document.getElementById(cardId).innerHTML = '<div class="text-xs text-green-500 py-2">✓ Saved</div>';
    return;
  }
  // Append details to the question text
  const appt = appointmentsData.find(a => a.id === apptId) ||
    await fetch('/api/appointments').then(r => r.json()).then(d => d.find(a => a.id === apptId));
  const q = appt?.questions.find(q => q.id === qid);
  const updatedText = q ? `${q.text} — ${details}` : details;
  await fetch(`/api/appointments/${apptId}/questions/${qid}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: updatedText }),
  });
  document.getElementById(cardId).innerHTML = '<div class="text-xs text-green-500 py-2">✓ Saved with details</div>';
  if (tabLoaded.progress) {
    appointmentsData = await fetch('/api/appointments').then(r => r.json());
    renderAppointments();
  }
}
```

- [ ] **Step 2: Verify JS syntax**

```bash
node -e "
const html = require('fs').readFileSync('web/public/index.html','utf-8');
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi;
let src = '', m;
while ((m = re.exec(html)) !== null) src += m[1] + '\n';
try { new Function(src); console.log('PASS'); } catch(e) { console.error('FAIL:', e.message); }
"
```

Expected: `PASS`

- [ ] **Step 3: Commit**

```bash
git add web/public/index.html
git commit -m "feat(chat): redirect Uma doctor questions to appointment question queue"
```

---

## Task 9: Smoke test

**Files:** None — verification only.

- [ ] **Step 1: JS syntax check**

```bash
node -e "
const html = require('fs').readFileSync('web/public/index.html','utf-8');
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi;
let src = '', m;
while ((m = re.exec(html)) !== null) src += m[1] + '\n';
try { new Function(src); console.log('PASS'); } catch(e) { console.error('FAIL:', e.message); }
"
```

Expected: `PASS`

- [ ] **Step 2: Server endpoints reachable**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/appointments
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/growth
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/growth-curves
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/foods-summary
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/profile
```

Expected: all `200`

- [ ] **Step 3: Manual browser checks**

Open `http://localhost:3001`, go to Progress tab.

Appointments:
- Shows "No upcoming appointment" with date picker
- Set a date → card appears expanded with question input
- Add a question → appears in list with Answered / Move / Delete actions
- Tap Answered → inline text field appears, save → green chip
- Tap Delete → question removed immediately

Growth chart:
- Shows "Add 2 or more measurements" placeholder initially
- Add first entry → appears in entry list, chart still greyed
- Add second entry → Height and Weight charts appear with WHO percentile bands
- Edit an entry (pencil icon) → fields become editable inline

Foods:
- Foods tried shows accordion, tapping expands to show reaction bars
- Rejected foods shows foods with Disliked reactions

Uma integration:
- In Chat tab, say "I should ask the doctor about head circumference"
- Uma responds + "Add to appointment questions?" card appears
- Tap Confirm → shows "Added ✓ — Want to add more details?"
- Skip → card shows "✓ Saved"
- Switch to Progress → question appears in next appointment's list

- [ ] **Step 4: Commit any fixes**

```bash
git add web/public/index.html web/server.js
git commit -m "fix(progress): smoke test corrections"
```

---

## Self-Review

**Spec coverage:**
- ✅ Appointments section with next (expanded) and past (collapsed accordion) — Tasks 5, 6
- ✅ Create appointment with date picker — `createAppointment()` Task 5
- ✅ Add/answer/delete/move questions — Tasks 5
- ✅ Question timestamp stored — `new Date().toISOString()` in server Task 1
- ✅ Growth chart: input form with date picker, edit per entry, retrofill — Task 6
- ✅ WHO female percentile bands on chart — Task 6 + WHO data Task 2
- ✅ Chart greyed out until 2+ entries — Task 6
- ✅ Foods tried accordion with reaction count + stacked bar — Task 7
- ✅ Rejected foods section (Disliked > 0) — Task 7
- ✅ Uma chat → appointment question queue — Task 8
- ✅ "Want to add more details?" follow-up — Task 8
- ✅ Stats row and reactions bar chart removed — Task 4
- ✅ Milestone summary removed — Task 4
- ✅ `/api/profile` endpoint for DOB — Task 6

**Placeholder scan:** None found.

**Type consistency:** `appointmentsData`, `growthData`, `foodsSummaryData`, `growthCurves` all used consistently. `expandedApptId` and `expandedFoodName` initialized in Task 5, read in Tasks 5 and 7.
