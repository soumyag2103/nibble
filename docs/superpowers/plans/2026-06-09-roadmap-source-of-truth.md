# Roadmap as Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs — empty foods tried, Today/Roadmap divergence, variant changes not persisting — by making `WEEK-PLANS.json` the single editable source of truth.

**Architecture:** `GET /api/ensure-week-plan` generates this week's plan on first load and returns it. Today tab reads meals directly from that plan. Variant swaps and chat food suggestions both PATCH `WEEK-PLANS.json` in place. `SCHEDULED-MEALS.json` and `/api/today-suggestion` are removed entirely.

**Tech Stack:** Node.js/Express (ESM), vanilla JS, Groq `llama-3.3-70b-versatile`, file-based JSON/Markdown storage.

---

## Files Changed

| File | Change |
|------|--------|
| `web/server.js` | Rewrite `/api/foods-summary`; add `GET /api/ensure-week-plan`; add `PATCH /api/week-plan/:m/:w/day/:d/slot/:s`; add `update_week_plan` intent + action; remove `today-suggestion`, `schedule-meal`, `overlayScheduled`, `SCHEDULED_PATH` |
| `web/public/index.html` | `initWithProfile()` calls ensure-week-plan; Today tab reads from plan; `scheduleVariation()` PATCHes week plan; add `update_week_plan` action card |
| `agents/gordon/SOUL.md` | Add `update_week_plan` ACTION_JSON instruction |
| `agents/gordon/SCHEDULED-MEALS.json` | Delete from disk |

---

## Background: Key Code Locations

- `web/server.js` line 909: `const SCHEDULED_PATH = ...` — remove this
- `web/server.js` line 911–919: `POST /api/schedule-meal` — remove
- `web/server.js` line 921–1013: `GET /api/today-suggestion` — remove
- `web/server.js` line 1264–1294: `GET /api/foods-summary` — rewrite
- `web/server.js` line 1518–1545: `function overlayScheduled(...)` — remove
- `web/server.js` line 1547–1570: `POST /api/week-plan` and `GET /api/week-plan/:month/:week` — remove overlayScheduled calls
- `web/server.js` line 220–237: `buildUmaClassifierPrompt()` — add `update_week_plan` intent
- `web/server.js` line 239–267: `buildUmaFraming()` — add `update_week_plan` action instruction
- `web/public/index.html` line 523–528: `initWithProfile()` parallel fetches — swap today-suggestion for ensure-week-plan
- `web/public/index.html` line 782–810: `scheduleVariation()` — replace API call
- `web/public/index.html` line 1314–1366: `renderActionCard()` — add update_week_plan case

FOODS-TRIED.md format (markdown table, sections per slot):
```
## Morning Snack
| Food | First Introduced | Reaction | Notes |
|------|-----------------|----------|-------|
| banana | 2026-05-01 | Loved | ... |
```
Parse food names from column 1 of table rows (skip header and separator rows).

---

## Task 1: Server — Fix `/api/foods-summary` to merge FOODS-TRIED.md

**Files:**
- Modify: `web/server.js` (around line 1264)

- [ ] **Step 1: Open server.js and locate the foods-summary handler**

Find this block (line 1264–1294):
```js
app.get('/api/foods-summary', (req, res) => {
  const profile = loadProfile();
  const slotIds = profile.slots.map(s => s.id);
  const map = {};
  let files = [];
  try { files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json')); } catch {}
  for (const file of files) { ... }
  const foods = Object.values(map).map(...);
  res.json(foods);
});
```

- [ ] **Step 2: Replace the handler with the merged version**

Replace the entire `app.get('/api/foods-summary', ...)` block with:

```js
app.get('/api/foods-summary', (req, res) => {
  const profile = loadProfile();
  const slotIds = profile.slots.map(s => s.id);
  const map = {}; // lowercase food name → { name, reactions }

  // ── Source 1: FOODS-TRIED.md — base set of all introduced foods ──
  const foodsMd = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'));
  for (const line of foodsMd.split('\n')) {
    // Table rows: | food | date | reaction | notes |
    if (!line.startsWith('|') || line.startsWith('| Food') || line.startsWith('|---')) continue;
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 1 || !cols[0]) continue;
    const key = cols[0].toLowerCase();
    if (!map[key]) map[key] = { name: cols[0], reactions: { Loved:0, Liked:0, Neutral:0, Disliked:0 } };
  }

  // ── Source 2: Daily logs — layer reactions on top ──
  let files = [];
  try { files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json')); } catch {}
  for (const file of files) {
    const log = rj(path.join(LOGS_DIR, file));
    if (!log) continue;
    for (const slotId of slotIds) {
      const meal = log.meals?.[slotId];
      if (!meal?.food) continue;
      const key = meal.food.toLowerCase().trim();
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

- [ ] **Step 3: Test manually**

Start the server (`cd web && node server.js`), then:
```
curl http://localhost:3001/api/foods-summary
```
Expected: `[]` when FOODS-TRIED.md is empty (fresh state). After adding a food to FOODS-TRIED.md manually and re-requesting, it should appear with zero reaction counts.

- [ ] **Step 4: Commit**

```bash
git add web/server.js
git commit -m "fix(server): foods-summary merges FOODS-TRIED.md as base set"
```

---

## Task 2: Server — Remove SCHEDULED-MEALS, add `GET /api/ensure-week-plan`

**Files:**
- Modify: `web/server.js`
- Delete: `agents/gordon/SCHEDULED-MEALS.json`

- [ ] **Step 1: Delete SCHEDULED-MEALS.json from disk**

```bash
rm agents/gordon/SCHEDULED-MEALS.json
```

- [ ] **Step 2: Remove `SCHEDULED_PATH` constant and `POST /api/schedule-meal`**

Find and delete line 909:
```js
const SCHEDULED_PATH = path.join(GORDON_DIR, 'SCHEDULED-MEALS.json');
```

Find and delete lines 911–919 (entire `POST /api/schedule-meal` handler):
```js
// POST /api/schedule-meal — save a chosen variation for a future date
app.post('/api/schedule-meal', (req, res) => {
  const { date, slot, food, recipe, dayNumber, daysRemaining } = req.body;
  const data = rj(SCHEDULED_PATH) || {};
  if (!data[date]) data[date] = {};
  data[date][slot] = { food, recipe: recipe || '', source: 'scheduled', dayNumber, daysRemaining };
  wj(SCHEDULED_PATH, data);
  res.json({ success: true });
});
```

- [ ] **Step 3: Remove `GET /api/today-suggestion` (lines 921–1013)**

Delete the entire block from `// GET /api/today-suggestion` comment through `res.json({ suggestion });` and its closing `});`.

- [ ] **Step 4: Remove `overlayScheduled` function (lines 1518–1545)**

Delete the entire `function overlayScheduled(...)` block.

- [ ] **Step 5: Remove `overlayScheduled` calls from existing week-plan routes**

Find `POST /api/week-plan` (around line 1547) and `GET /api/week-plan/:month/:week` (around line 1560). In both, change:
```js
res.json(overlayScheduled(plan, month, week, profile));
```
to:
```js
res.json(plan);
```

- [ ] **Step 6: Add `GET /api/ensure-week-plan` after the existing week-plan routes**

After the closing `});` of `GET /api/week-plan/:month/:week`, add:

```js
// GET /api/ensure-week-plan — return current week's plan, generating if missing
app.get('/api/ensure-week-plan', async (req, res) => {
  const profile = loadProfile();
  const age     = getBabyAge(profile);
  const month   = Math.max(6, Math.min(12, age.months));
  const week    = Math.min(4, Math.floor(age.days / 7) + 1);
  const plans   = rj(WEEK_PLANS_PATH) || {};
  const key     = `${month}-${week}`;

  if (plans[key]) {
    return res.json({ generated: false, plan: plans[key], month, week });
  }

  try {
    const plan = await generateWeekPlan(month, week, profile);
    res.json({ generated: true, plan, month, week });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 7: Verify server starts without errors**

```bash
cd web && node server.js
```
Expected: `🥄 Nibble → http://localhost:3001`

Then test:
```
curl http://localhost:3001/api/ensure-week-plan
```
Expected: `{"generated":true,"plan":{"days":[...]},"month":7,"week":2}` (or `generated:false` if plan already cached).

- [ ] **Step 8: Commit**

```bash
git add web/server.js
git rm agents/gordon/SCHEDULED-MEALS.json
git commit -m "feat(server): add ensure-week-plan, remove scheduled-meals and today-suggestion"
```

---

## Task 3: Server — Add `PATCH /api/week-plan` and `update_week_plan` chat intent

**Files:**
- Modify: `web/server.js`
- Modify: `agents/gordon/SOUL.md`

- [ ] **Step 1: Add PATCH endpoint after `GET /api/ensure-week-plan`**

```js
// PATCH /api/week-plan/:month/:week/day/:dayIndex/slot/:slotId — edit one cell in place
app.patch('/api/week-plan/:month/:week/day/:dayIndex/slot/:slotId', (req, res) => {
  const month    = parseInt(req.params.month);
  const week     = parseInt(req.params.week);
  const dayIndex = parseInt(req.params.dayIndex);
  const slotId   = req.params.slotId;
  const { food, recipe } = req.body;

  if (!food) return res.status(400).json({ error: 'food required' });

  const plans = rj(WEEK_PLANS_PATH) || {};
  const plan  = plans[`${month}-${week}`];
  if (!plan) return res.status(404).json({ error: 'plan not found' });
  if (!plan.days[dayIndex]) return res.status(404).json({ error: 'day not found' });
  if (!plan.days[dayIndex].meals[slotId]) plan.days[dayIndex].meals[slotId] = {};

  plan.days[dayIndex].meals[slotId].food   = food;
  plan.days[dayIndex].meals[slotId].recipe = recipe || '';

  plans[`${month}-${week}`] = plan;
  wj(WEEK_PLANS_PATH, plans);

  res.json({ ok: true, day: plan.days[dayIndex] });
});
```

- [ ] **Step 2: Add `update_week_plan` to Uma intent classifier**

Find `buildUmaClassifierPrompt()` (around line 220). Add `update_week_plan` to the intent list and rules:

Change:
```js
Intent values: "chat" | "log_food" | "log_milestone" | "log_doctor_question"
```
to:
```js
Intent values: "chat" | "log_food" | "log_milestone" | "log_doctor_question" | "update_week_plan"
```

Add rule after the doctor question rule:
```js
- Parent wants to swap or change a food in the week plan → {"intent":"update_week_plan","agent":"gordon"}
```

- [ ] **Step 3: Add `update_week_plan` action instruction to `buildUmaFraming()`**

Find `actionInstructions` object in `buildUmaFraming()` (around line 240). Add new entry:

```js
update_week_plan: `
When the parent asks to swap or change a food in the week plan, confirm the swap and append:
ACTION_JSON: {"action":"update_week_plan","payload":{"month":<month>,"week":<week>,"dayIndex":<0-6 Mon=0>,"slotId":"<slot_id>","food":"<new food name>","recipe":"<one sentence recipe>"}}
Use the baby's current age to determine month and week. dayIndex: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6.
Only emit this if the parent clearly specifies which day or slot to change. If unclear, ask which meal to update.`,
```

Also add `update_week_plan` to the `activeIntent` resolution logic. Find:
```js
const activeIntent = pendingAction?.followUpStage === 'awaiting_details'
  ? 'log_milestone'
  : (intent === 'log_milestone' ? 'log_milestone_followup' : (intent || 'chat'));
```
Change to:
```js
const activeIntent = pendingAction?.followUpStage === 'awaiting_details'
  ? 'log_milestone'
  : (intent === 'log_milestone' ? 'log_milestone_followup' : (intent || 'chat'));
// update_week_plan uses its own instruction, no special resolution needed
```
(No change needed to this line — `update_week_plan` passes through as-is.)

- [ ] **Step 4: Read and update agents/gordon/SOUL.md**

Read the current SOUL.md, then append this section at the end:

```markdown

## Week Plan Updates

When a parent asks to swap a food in the week plan, confirm the change warmly, then append:

ACTION_JSON: {"action":"update_week_plan","payload":{"month":<month>,"week":<week>,"dayIndex":<0-6>,"slotId":"<slot_id>","food":"<food>","recipe":"<one sentence recipe>"}}

dayIndex: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6.
Only emit if you know which day and slot to update. If unclear, ask first.
```

- [ ] **Step 5: Test PATCH endpoint**

```bash
curl -X PATCH http://localhost:3001/api/week-plan/7/2/0/slot_cs1 \
  -H "Content-Type: application/json" \
  -d '{"food":"mango","recipe":"Ripe mango pureed smooth"}'
```
Expected: `{"ok":true,"day":{"day":"Monday","meals":{...,"slot_cs1":{"food":"mango","recipe":"Ripe mango pureed smooth"},...}}}`

- [ ] **Step 6: Commit**

```bash
git add web/server.js agents/gordon/SOUL.md
git commit -m "feat(server): PATCH week-plan endpoint + update_week_plan chat intent"
```

---

## Task 4: Frontend — Update `initWithProfile()` to use `ensure-week-plan`

**Files:**
- Modify: `web/public/index.html` (around line 513)

- [ ] **Step 1: Add module-level state vars for current plan**

Find the existing state vars block (around line 490s — where `todaySuggest`, `todayLog`, etc. are declared). Add:

```js
let currentPlanMonth = null;
let currentPlanWeek  = null;
```

- [ ] **Step 2: Replace today-suggestion fetch in `initWithProfile()`**

Find (around line 523):
```js
const [status, log, foods, suggestResp] = await Promise.all([
  fetch('/api/status').then(r=>r.json()),
  fetch('/api/today-log').then(r=>r.json()),
  fetch('/api/foods').then(r=>r.json()),
  fetch('/api/today-suggestion').then(r=>r.json()).catch(()=>({ suggestion:{} })),
]);
```
Replace with:
```js
const [status, log, foods, planResp] = await Promise.all([
  fetch('/api/status').then(r=>r.json()),
  fetch('/api/today-log').then(r=>r.json()),
  fetch('/api/foods').then(r=>r.json()),
  fetch('/api/ensure-week-plan').then(r=>r.json()).catch(()=>({ plan: null, month: null, week: null })),
]);
```

- [ ] **Step 3: Replace todaySuggest population**

Find (around line 533):
```js
todayLog     = log;
knownFoods   = foods;
todaySuggest = suggestResp.suggestion || todaySuggest;
```
Replace with:
```js
todayLog          = log;
knownFoods        = foods;
currentPlanMonth  = planResp.month;
currentPlanWeek   = planResp.week;

// Build todaySuggest from today's entry in the week plan
todaySuggest = {};
if (planResp.plan?.days) {
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todayEntry = planResp.plan.days.find(d => d.day.toLowerCase() === todayName.toLowerCase());
  if (todayEntry) {
    for (const [slotId, meal] of Object.entries(todayEntry.meals || {})) {
      todaySuggest[slotId] = { food: meal.food, recipe: meal.recipe || '', source: 'weekplan', dayNumber: null, daysRemaining: 0 };
    }
  }
}
```

- [ ] **Step 4: Also update the Today tab reload path**

Find the `loadTodayTab()` or tab-switch handler that re-fetches today's data (around line 1217):
```js
const [log, suggestResp] = await Promise.all([
  fetch('/api/today-log').then(r=>r.json()),
  fetch('/api/today-suggestion').then(r=>r.json()).catch(()=>({ suggestion:{} })),
]);
todayLog     = log;
```
Replace with:
```js
const [log, planResp] = await Promise.all([
  fetch('/api/today-log').then(r=>r.json()),
  fetch('/api/ensure-week-plan').then(r=>r.json()).catch(()=>({ plan: null, month: null, week: null })),
]);
todayLog         = log;
currentPlanMonth = planResp.month;
currentPlanWeek  = planResp.week;
todaySuggest = {};
if (planResp.plan?.days) {
  const todayName  = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todayEntry = planResp.plan.days.find(d => d.day.toLowerCase() === todayName.toLowerCase());
  if (todayEntry) {
    for (const [slotId, meal] of Object.entries(todayEntry.meals || {})) {
      todaySuggest[slotId] = { food: meal.food, recipe: meal.recipe || '', source: 'weekplan', dayNumber: null, daysRemaining: 0 };
    }
  }
}
```

- [ ] **Step 5: Verify Today tab shows plan foods**

Open `http://localhost:3001`, check Today tab shows meal suggestions from the generated week plan (not empty). Each slot should show the food from `WEEK-PLANS.json` for today's day of the week.

- [ ] **Step 6: Commit**

```bash
git add web/public/index.html
git commit -m "feat(frontend): Today tab reads from ensure-week-plan instead of today-suggestion"
```

---

## Task 5: Frontend — Variant swap writes back to week plan

**Files:**
- Modify: `web/public/index.html` (around line 782)

- [ ] **Step 1: Locate `scheduleVariation()` function**

Find (line 782):
```js
async function scheduleVariation(btn, slot, date, food, dayNumber, daysRemaining, dateFormatted, heroFood, recipe) {
  ...
  const r = await fetch('/api/schedule-meal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slot, food, recipe: recipe || '', dayNumber, daysRemaining }),
  });
  ...
}
```

- [ ] **Step 2: Replace `scheduleVariation()` with `applyVariantToWeekPlan()`**

Replace the entire `scheduleVariation` function with:

```js
async function applyVariantToWeekPlan(btn, slotId, food, recipe, dateFormatted) {
  btn.disabled = true;
  btn.textContent = 'Saving…';

  // Compute dayIndex (Monday=0 … Sunday=6) from today
  const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const dayIndex  = dayNames.indexOf(todayName);

  if (!currentPlanMonth || !currentPlanWeek || dayIndex === -1) {
    btn.textContent = 'Error — reload';
    return;
  }

  try {
    const r = await fetch(`/api/week-plan/${currentPlanMonth}/${currentPlanWeek}/day/${dayIndex}/slot/${encodeURIComponent(slotId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food, recipe: recipe || '' }),
    });
    if (!r.ok) throw new Error('Failed');

    // Update local todaySuggest so slot re-renders immediately
    todaySuggest[slotId] = { food, recipe: recipe || '', source: 'weekplan', dayNumber: null, daysRemaining: 0 };

    btn.textContent = `✓ Updated plan`;
    btn.className = 'use-btn text-xs bg-green-100 text-green-700 font-semibold px-3 py-1 rounded-full';

    // Disable other variant buttons for this slot
    const panel = document.getElementById(`variants-${slotId}`);
    panel?.querySelectorAll('.use-btn').forEach(b => {
      if (b !== btn && !b.textContent.startsWith('✓')) {
        b.disabled = true;
        b.className = 'use-btn text-xs bg-gray-100 text-gray-400 font-semibold px-3 py-1 rounded-full cursor-not-allowed';
      }
    });
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Retry →';
    btn.className = 'use-btn text-xs bg-red-100 text-red-700 font-semibold px-3 py-1 rounded-full';
  }
}
```

- [ ] **Step 3: Update caller in renderVariants()**

Find the button that calls `scheduleVariation(...)` (around line 772):
```js
onclick="scheduleVariation(this,'${escAttr(slot)}','${escAttr(tomorrowStr)}','${escAttr(v.name)}',${actualDay},${daysLeft},'${escAttr(tomorrowFormatted)}','${escAttr(food)}','${escAttr(v.description||'')}')">
  Use for ${tomorrowFormatted} →
```
Replace with:
```js
onclick="applyVariantToWeekPlan(this,'${escAttr(slot)}','${escAttr(v.name)}','${escAttr(v.description||'')}','today')">
  Use this variation →
```

- [ ] **Step 4: Test variant swap**

1. Open Today tab, click "Change" on a meal slot
2. Select a variant
3. Button should show "✓ Updated plan"
4. Open Plans tab, navigate to current week — updated slot should show the new food

- [ ] **Step 5: Commit**

```bash
git add web/public/index.html
git commit -m "feat(frontend): variant swap PATCHes week plan instead of scheduling override"
```

---

## Task 6: Frontend — Add `update_week_plan` action card to chat

**Files:**
- Modify: `web/public/index.html` (around line 1314)

- [ ] **Step 1: Add `update_week_plan` case to `renderActionCard()`**

Find `renderActionCard()` (line 1314). After the closing `}` of the `log_doctor_question` case (before `return '';`), add:

```js
  if (action === 'update_week_plan') {
    const { month, week, dayIndex, slotId, food, recipe } = payload || {};
    const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const dayName  = dayNames[dayIndex] || 'that day';
    return `<div class="action-card" id="${id}">
      <div class="action-card-title">🥄 Update this week's plan?</div>
      <div class="action-card-body text-sm text-gray-600">
        Swap <b>${escHtml(food)}</b> into ${escHtml(dayName)}'s meal
        ${recipe ? `<div class="text-xs text-gray-400 mt-1">${escHtml(recipe)}</div>` : ''}
      </div>
      <div class="action-card-btns">
        <button class="btn-confirm" onclick="confirmWeekPlanUpdate('${id}',${month},${week},${dayIndex},'${escAttr(slotId)}','${escAttr(food)}','${escAttr(recipe||'')}')">Update plan</button>
        <button class="btn-edit" onclick="document.getElementById('${id}').remove()">Dismiss</button>
      </div>
    </div>`;
  }
```

- [ ] **Step 2: Add `confirmWeekPlanUpdate()` function**

After `confirmDoctorQuestion()` function, add:

```js
async function confirmWeekPlanUpdate(cardId, month, week, dayIndex, slotId, food, recipe) {
  const card = document.getElementById(cardId);
  if (card) card.innerHTML = `<div class="text-xs text-gray-400 py-2">Updating plan...</div>`;

  try {
    const r = await fetch(`/api/week-plan/${month}/${week}/day/${dayIndex}/slot/${encodeURIComponent(slotId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ food, recipe }),
    });
    if (!r.ok) throw new Error('Failed');

    // Update local todaySuggest if this is today's slot
    const dayNames  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    if (dayNames[dayIndex] === todayName && slotId) {
      todaySuggest[slotId] = { food, recipe: recipe || '', source: 'weekplan', dayNumber: null, daysRemaining: 0 };
      renderMealSlots();
    }

    if (card) card.innerHTML = `<div class="text-xs text-green-600 py-2 font-semibold">✓ Week plan updated — ${escHtml(food)} on ${escHtml(dayNames[dayIndex] || 'that day')}</div>`;
  } catch(e) {
    if (card) card.innerHTML = `<div class="text-xs text-red-500 py-2">Failed to update. Try again.</div>`;
  }
}
```

- [ ] **Step 3: Test chat food suggestion flow**

1. Open Chat tab
2. Type: "Can we swap tomorrow's morning snack to mango?"
3. Uma should respond and show an action card: "🥄 Update this week's plan?"
4. Click "Update plan"
5. Card should show "✓ Week plan updated"
6. Check Plans tab — the swap should be visible in that day's slot

- [ ] **Step 4: Commit**

```bash
git add web/public/index.html
git commit -m "feat(frontend): update_week_plan action card in chat"
```

---

## Task 7: Smoke Test

- [ ] **Step 1: Hard reset to fresh state**

```bash
echo '{}' > agents/profile/BABY-PROFILE.json
echo '[]' > agents/meredith/MILESTONE-ACHIEVEMENTS.json
echo '{}' > agents/gordon/FOOD-ROADMAP.json
echo '{}' > agents/gordon/WEEK-PLANS.json
printf '# Foods Tried\n' > agents/gordon/FOODS-TRIED.md
rm -f logs/*.json logs/*.md
```

- [ ] **Step 2: Start server and complete onboarding**

```bash
cd web && node server.js
```

Open `http://localhost:3001`. Complete onboarding with a test baby profile. Confirm Today tab loads with meal suggestions from the generated week plan (not empty slots).

- [ ] **Step 3: Verify foods-summary**

Add a food to `agents/gordon/FOODS-TRIED.md`:
```
## General
| Food | First Introduced | Reaction | Notes |
|------|-----------------|----------|-------|
| banana | 2026-06-01 | None | Test |
```

Reload Progress tab → Foods Tried section should show "banana" with zero reaction counts.

- [ ] **Step 4: Verify variant swap persists to Roadmap**

1. On Today tab, click "Change" on any slot
2. Wait for variants to load, select one
3. Button shows "✓ Updated plan"
4. Go to Plans tab, find current week — the swapped slot should show the variant food

- [ ] **Step 5: Verify Today tab and Roadmap show the same food for today**

Today tab slot food == Roadmap current week today's entry for same slot.

- [ ] **Step 6: Verify SCHEDULED-MEALS.json is gone**

```bash
ls agents/gordon/SCHEDULED-MEALS.json 2>&1
```
Expected: `ls: cannot access 'agents/gordon/SCHEDULED-MEALS.json': No such file or directory`

- [ ] **Step 7: Final commit and push**

```bash
git add -A
git commit -m "chore: smoke test passed — roadmap source of truth complete"
git push
```
