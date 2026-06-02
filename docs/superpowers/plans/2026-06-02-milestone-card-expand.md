# Milestone Card Inline Expand + Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping any milestone card expands it inline (accordion) to show an edit/complete form; the log-new form gains a date picker.

**Architecture:** Pure frontend changes to `web/public/index.html` (new state var, 3 new functions, card HTML rewrites) plus one server.js line fix to accept client-supplied `dateLogged`. No new files, no new endpoints.

**Tech Stack:** Vanilla JS, inline HTML string templates, native `<input type="date">`, Express.js server.

---

## Files

- Modify: `web/server.js:1150,1153` — destructure and honour `dateLogged` from request body
- Modify: `web/public/index.html` — state var, 3 new functions, card HTML in `renderThemeDetailHTML` and `renderPendingCardHTML`, log-form HTML, `openMilestoneForm`, `closeMilestoneForm`, `confirmSaveMilestone`

---

### Task 1: Server — honour client-supplied dateLogged

**Files:**
- Modify: `web/server.js:1149-1168`

- [ ] **Step 1: Read the current POST handler**

Open `web/server.js` and find lines 1149–1168. They currently read:

```js
app.post('/api/milestone-achievements', (req, res) => {
  const { id, name, category, month, status, notes } = req.body;
  const data   = rj(ACHIEVEMENTS_PATH) || [];
  const today  = tod();
  const entry  = { id, name, category, month, status: status || 'within', notes: notes || '', dateLogged: today };
```

- [ ] **Step 2: Replace lines 1150 and 1153**

Change the destructure to include `dateLogged`, and use it with a fallback:

```js
app.post('/api/milestone-achievements', (req, res) => {
  const { id, name, category, month, status, notes, dateLogged } = req.body;
  const data   = rj(ACHIEVEMENTS_PATH) || [];
  const today  = tod();
  const entry  = { id, name, category, month, status: status || 'within', notes: notes || '', dateLogged: dateLogged || today };
```

Everything else in the handler stays unchanged.

- [ ] **Step 3: Verify manually**

Server is running at `http://localhost:3001`. Run:
```bash
curl -s -X POST http://localhost:3001/api/milestone-achievements \
  -H "Content-Type: application/json" \
  -d '{"id":"test_date_fix","name":"Test","category":"Motor","month":6,"dateLogged":"2026-05-01"}' \
  | node -e "const d=require('fs').readFileSync('/dev/stdin','utf-8');const r=JSON.parse(d);console.log(r.entry.dateLogged === '2026-05-01' ? 'PASS' : 'FAIL: got ' + r.entry.dateLogged)"
```
Expected: `PASS`

Then clean up:
```bash
curl -s -X DELETE http://localhost:3001/api/milestone-achievements/test_date_fix
```

- [ ] **Step 4: Commit**

```bash
git add web/server.js
git commit -m "fix(server): honour client-supplied dateLogged in milestone POST"
```

---

### Task 2: New state var + 3 new functions

**Files:**
- Modify: `web/public/index.html:413` — add state var after `milestoneScope`
- Modify: `web/public/index.html` — add 3 functions after `setMilestoneScope`

- [ ] **Step 1: Add expandedMilestoneId state var**

Find this block (around line 412):
```js
let activeTheme      = null;   // 'Motor'|'Language'|'Social'|'Cognitive'|'Feeding'|null
let milestoneScope   = 'month'; // 'month'|'all'
```

Add one line after it:
```js
let activeTheme      = null;   // 'Motor'|'Language'|'Social'|'Cognitive'|'Feeding'|null
let milestoneScope   = 'month'; // 'month'|'all'
let expandedMilestoneId = null; // id string of currently expanded card, or null
```

- [ ] **Step 2: Add toggleMilestoneCard after setMilestoneScope**

Find `setMilestoneScope` (around line 1680):
```js
function setMilestoneScope(scope) {
  milestoneScope = scope;
  renderMilestones();
}
```

Add immediately after it:
```js
function toggleMilestoneCard(id) {
  expandedMilestoneId = (expandedMilestoneId === id) ? null : id;
  renderMilestones();
}

async function saveMilestoneEdit(id) {
  const btn = document.getElementById('ms-exp-btn-' + id);
  if (btn) btn.disabled = true;
  const date  = document.getElementById('ms-exp-date-' + id).value
                || new Date().toISOString().split('T')[0];
  const notes = document.getElementById('ms-exp-notes-' + id).value;
  const existing = achievementsData.find(a => a.id === id);
  if (!existing) return;
  await fetch('/api/milestone-achievements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...existing, dateLogged: date, notes }),
  });
  achievementsData = await fetch('/api/milestone-achievements').then(r => r.json());
  expandedMilestoneId = null;
  renderMilestones();
}

async function completeMilestone(id, name, category, month, isUpcoming) {
  const btn = document.getElementById('ms-exp-btn-' + id);
  if (btn) btn.disabled = true;
  const date  = document.getElementById('ms-exp-date-' + id).value
                || new Date().toISOString().split('T')[0];
  const notes = document.getElementById('ms-exp-notes-' + id).value;
  const status = isUpcoming ? 'ahead' : 'within';
  await fetch('/api/milestone-achievements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, category, month: Number(month), status, notes, dateLogged: date }),
  });
  if (btn) { btn.textContent = '✓ Saved!'; btn.style.background = '#16a34a'; }
  achievementsData = await fetch('/api/milestone-achievements').then(r => r.json());
  setTimeout(() => { expandedMilestoneId = null; renderMilestones(); }, 600);
}
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
git commit -m "feat(milestones): add expandedMilestoneId state + toggle/save/complete functions"
```

---

### Task 3: Section 1 (Achieved) + Section 3 (Ahead) cards — tappable with edit form

**Files:**
- Modify: `web/public/index.html:1724-1771` — sections 1 and 3 inside `renderThemeDetailHTML`

Context: `renderThemeDetailHTML` builds card HTML by concatenating to `html`. The achieved section loops `achievedDue.forEach((a, i) => { ... })`. The ahead section loops `aheadAchievements.forEach(a => { ... })`.

- [ ] **Step 1: Replace the Section 1 forEach block**

Find this block (lines ~1724–1746):
```js
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
```

Replace with:
```js
    achievedDue.forEach((a, i) => {
      const isExpanded = expandedMilestoneId === a.id;
      const today = new Date().toISOString().split('T')[0];
      html += `
        <div class="ms-milestone-card">
          <div onclick="toggleMilestoneCard('${escAttr(a.id)}')" style="padding:${i === 0 ? '10px' : '9px'} 12px;display:flex;align-items:${i === 0 ? 'flex-start' : 'center'};gap:8px;cursor:pointer">
            <div style="width:18px;height:18px;border-radius:50%;background:#16a34a;display:flex;align-items:center;justify-content:center;flex-shrink:0;${i === 0 ? 'margin-top:1px' : ''}"><span style="color:#fff;font-size:10px">&#x2713;</span></div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${escHtml(a.name)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:${i === 0 ? '2' : '1'}px">Logged ${escHtml(a.dateLogged)} &middot; On track</div>
              ${i === 0 && a.notes ? `<div style="font-size:11px;color:#374151;margin-top:5px;padding:6px 8px;background:#f9fafb;border-radius:6px;font-style:italic">&ldquo;${escHtml(a.notes)}&rdquo;</div>` : ''}
            </div>
          </div>
          ${isExpanded ? `
          <div onclick="event.stopPropagation()" style="border-top:1px solid #f3f4f6;padding:10px 12px;background:#fafafa">
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Date logged</label>
            <input type="date" id="ms-exp-date-${escAttr(a.id)}" value="${escAttr(a.dateLogged || today)}"
              style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;margin-bottom:7px;box-sizing:border-box">
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Notes</label>
            <textarea id="ms-exp-notes-${escAttr(a.id)}" rows="2"
              style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;resize:none;margin-bottom:7px;box-sizing:border-box"
              placeholder="Add a note…">${escHtml(a.notes || '')}</textarea>
            <button id="ms-exp-btn-${escAttr(a.id)}" onclick="saveMilestoneEdit('${escAttr(a.id)}')"
              style="width:100%;background:#f97316;color:#fff;border:none;border-radius:10px;padding:7px;font-size:12px;font-weight:600;cursor:pointer">
              Save
            </button>
          </div>` : ''}
        </div>`;
    });
```

- [ ] **Step 2: Replace the Section 3 (Ahead) forEach block**

Find this block (lines ~1759–1771):
```js
    aheadAchievements.forEach(a => {
      const ms = milestones.find(m => m.id === a.id);
      const monthsEarly = ms ? ms.month - age.months : 0;
      html += `
        <div class="ms-milestone-card ahead" style="padding:9px 12px;display:flex;align-items:center;gap:8px">
          <span style="font-size:15px">&#x2B50;</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${escHtml(a.name)}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:1px">Typical: ${Number(ms ? ms.month : 0)}m &middot; Logged ${escHtml(a.dateLogged)}</div>
          </div>
          <div style="font-size:10px;color:#f97316;font-weight:600">${Number(monthsEarly)}m early</div>
        </div>`;
    });
```

Replace with:
```js
    aheadAchievements.forEach(a => {
      const ms = milestones.find(m => m.id === a.id);
      const monthsEarly = ms ? ms.month - age.months : 0;
      const isExpanded = expandedMilestoneId === a.id;
      const today = new Date().toISOString().split('T')[0];
      html += `
        <div class="ms-milestone-card ahead">
          <div onclick="toggleMilestoneCard('${escAttr(a.id)}')" style="padding:9px 12px;display:flex;align-items:center;gap:8px;cursor:pointer">
            <span style="font-size:15px">&#x2B50;</span>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600">${escHtml(a.name)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:1px">Typical: ${Number(ms ? ms.month : 0)}m &middot; Logged ${escHtml(a.dateLogged)}</div>
            </div>
            <div style="font-size:10px;color:#f97316;font-weight:600">${Number(monthsEarly)}m early</div>
          </div>
          ${isExpanded ? `
          <div onclick="event.stopPropagation()" style="border-top:1px solid #fed7aa;padding:10px 12px;background:#fff8f0">
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Date logged</label>
            <input type="date" id="ms-exp-date-${escAttr(a.id)}" value="${escAttr(a.dateLogged || today)}"
              style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;margin-bottom:7px;box-sizing:border-box">
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Notes</label>
            <textarea id="ms-exp-notes-${escAttr(a.id)}" rows="2"
              style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;resize:none;margin-bottom:7px;box-sizing:border-box"
              placeholder="Add a note…">${escHtml(a.notes || '')}</textarea>
            <button id="ms-exp-btn-${escAttr(a.id)}" onclick="saveMilestoneEdit('${escAttr(a.id)}')"
              style="width:100%;background:#f97316;color:#fff;border:none;border-radius:10px;padding:7px;font-size:12px;font-weight:600;cursor:pointer">
              Save
            </button>
          </div>` : ''}
        </div>`;
    });
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
git commit -m "feat(milestones): achieved + ahead cards tappable with inline edit form"
```

---

### Task 4: Section 2 (Pending) — renderPendingCardHTML — tappable with complete form

**Files:**
- Modify: `web/public/index.html:1793-1842` — `renderPendingCardHTML`

Context: `renderPendingCardHTML(m, age)` builds card HTML. It has two parts: the main flex row, and an optional urgent footer (`nearCutoff || pastCutoff`). The expand form goes between the urgent footer and the closing `</div>`.

- [ ] **Step 1: Add `onclick` to the main content div and append expand form**

Find the line inside `renderPendingCardHTML`:
```js
  let cardHTML = `
    <div class="ms-milestone-card${(nearCutoff || pastCutoff) ? ' pending-urgent' : ''}">
      <div style="padding:10px 12px;display:flex;align-items:flex-start;gap:8px">
```

Replace that opening `<div style="padding...` with one that has `onclick` and `cursor:pointer`:
```js
  let cardHTML = `
    <div class="ms-milestone-card${(nearCutoff || pastCutoff) ? ' pending-urgent' : ''}">
      <div onclick="toggleMilestoneCard('${escAttr(m.id)}')" style="padding:10px 12px;display:flex;align-items:flex-start;gap:8px;cursor:pointer">
```

- [ ] **Step 2: Append the expand form before the closing tag**

Find the end of `renderPendingCardHTML` (lines ~1832–1841):
```js
  if (nearCutoff || pastCutoff) {
    cardHTML += `
      <div style="border-top:1px solid #fca5a5;padding:8px 12px;background:#fff5f5;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:#dc2626">${pastCutoff ? 'Past recommended window' : 'Getting close to cutoff'}</span>
        <button class="ms-ask-doctor-btn" onclick="askDoctorAbout('${escAttr(m.label)}')">+ Ask doctor</button>
      </div>`;
  }

  cardHTML += `</div>`;
  return cardHTML;
```

Replace with:
```js
  if (nearCutoff || pastCutoff) {
    cardHTML += `
      <div style="border-top:1px solid #fca5a5;padding:8px 12px;background:#fff5f5;display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:11px;color:#dc2626">${pastCutoff ? 'Past recommended window' : 'Getting close to cutoff'}</span>
        <button class="ms-ask-doctor-btn" onclick="askDoctorAbout('${escAttr(m.label)}')">+ Ask doctor</button>
      </div>`;
  }

  if (expandedMilestoneId === m.id) {
    const today = new Date().toISOString().split('T')[0];
    cardHTML += `
      <div onclick="event.stopPropagation()" style="border-top:1px solid #f3f4f6;padding:10px 12px;background:#fafafa">
        <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Date achieved</label>
        <input type="date" id="ms-exp-date-${escAttr(m.id)}" value="${today}"
          style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;margin-bottom:7px;box-sizing:border-box">
        <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Notes</label>
        <textarea id="ms-exp-notes-${escAttr(m.id)}" rows="2"
          style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;resize:none;margin-bottom:7px;box-sizing:border-box"
          placeholder="What did you observe?"></textarea>
        <button id="ms-exp-btn-${escAttr(m.id)}" onclick="completeMilestone('${escAttr(m.id)}','${escAttr(m.label)}','${escAttr(m.category)}',${Number(m.month)},false)"
          style="width:100%;background:#16a34a;color:#fff;border:none;border-radius:10px;padding:7px;font-size:12px;font-weight:600;cursor:pointer">
          Mark as completed
        </button>
      </div>`;
  }

  cardHTML += `</div>`;
  return cardHTML;
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
git commit -m "feat(milestones): pending cards tappable with inline mark-as-completed form"
```

---

### Task 5: Section 4 (Upcoming) cards — tappable with complete form

**Files:**
- Modify: `web/public/index.html:1777-1786` — Section 4 forEach in `renderThemeDetailHTML`

- [ ] **Step 1: Replace the Section 4 forEach block**

Find this block (lines ~1777–1786):
```js
    upcomingMs.forEach(m => {
      html += `
        <div class="ms-milestone-card upcoming" style="padding:9px 12px;display:flex;align-items:center;gap:8px">
          <div style="width:18px;height:18px;border-radius:50%;border:2px dashed #d1d5db;flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:12px;color:#6b7280;font-weight:500">${escHtml(m.label)}</div>
            <div style="font-size:10px;color:#9ca3af">Expected at: ${Number(m.month)}m</div>
          </div>
        </div>`;
    });
```

Replace with:
```js
    upcomingMs.forEach(m => {
      const isExpanded = expandedMilestoneId === m.id;
      const today = new Date().toISOString().split('T')[0];
      html += `
        <div class="ms-milestone-card upcoming" style="${isExpanded ? 'opacity:1' : ''}">
          <div onclick="toggleMilestoneCard('${escAttr(m.id)}')" style="padding:9px 12px;display:flex;align-items:center;gap:8px;cursor:pointer">
            <div style="width:18px;height:18px;border-radius:50%;border:2px dashed #d1d5db;flex-shrink:0"></div>
            <div style="flex:1">
              <div style="font-size:12px;color:#6b7280;font-weight:500">${escHtml(m.label)}</div>
              <div style="font-size:10px;color:#9ca3af">Expected at: ${Number(m.month)}m</div>
            </div>
          </div>
          ${isExpanded ? `
          <div onclick="event.stopPropagation()" style="border-top:1px solid #e5e7eb;padding:10px 12px;background:#fafafa">
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Date achieved</label>
            <input type="date" id="ms-exp-date-${escAttr(m.id)}" value="${today}"
              style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;margin-bottom:7px;box-sizing:border-box">
            <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Notes</label>
            <textarea id="ms-exp-notes-${escAttr(m.id)}" rows="2"
              style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;resize:none;margin-bottom:7px;box-sizing:border-box"
              placeholder="What did you observe?"></textarea>
            <button id="ms-exp-btn-${escAttr(m.id)}" onclick="completeMilestone('${escAttr(m.id)}','${escAttr(m.label)}','${escAttr(m.category)}',${Number(m.month)},true)"
              style="width:100%;background:#16a34a;color:#fff;border:none;border-radius:10px;padding:7px;font-size:12px;font-weight:600;cursor:pointer">
              Mark as completed
            </button>
          </div>` : ''}
        </div>`;
    });
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
git commit -m "feat(milestones): upcoming cards tappable with inline mark-as-completed form"
```

---

### Task 6: Log new form — date input + wire through confirm

**Files:**
- Modify: `web/public/index.html:326-338` — add date field to form HTML
- Modify: `web/public/index.html:1888-1898` — `openMilestoneForm` + `closeMilestoneForm`
- Modify: `web/public/index.html:1979-1991` — `confirmSaveMilestone`

- [ ] **Step 1: Add date input to #ms-form HTML**

Find this block (lines ~326–337):
```html
      <textarea id="ms-text"
        placeholder="e.g. She waved bye-bye when grandma left today…"
        class="w-full bg-gray-50 rounded-xl px-3 py-2 text-sm border border-gray-100 resize-none"
        rows="3"></textarea>
      <div class="flex gap-2 mt-3">
```

Replace with:
```html
      <textarea id="ms-text"
        placeholder="e.g. She waved bye-bye when grandma left today…"
        class="w-full bg-gray-50 rounded-xl px-3 py-2 text-sm border border-gray-100 resize-none"
        rows="3"></textarea>
      <div class="mt-2">
        <label class="text-xs text-gray-500 font-medium">Date achieved</label>
        <input id="ms-date" type="date"
          class="w-full bg-gray-50 rounded-xl px-3 py-2 text-sm border border-gray-100 mt-1">
      </div>
      <div class="flex gap-2 mt-3">
```

- [ ] **Step 2: Update openMilestoneForm to set today's date**

Find (lines ~1888–1891):
```js
function openMilestoneForm() {
  document.getElementById('ms-form').classList.remove('hidden');
  document.getElementById('ms-form').scrollIntoView({ behavior:'smooth' });
}
```

Replace with:
```js
function openMilestoneForm() {
  document.getElementById('ms-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('ms-form').classList.remove('hidden');
  document.getElementById('ms-form').scrollIntoView({ behavior:'smooth' });
}
```

- [ ] **Step 3: Update closeMilestoneForm to clear date**

Find (lines ~1893–1898):
```js
function closeMilestoneForm() {
  document.getElementById('ms-form').classList.add('hidden');
  document.getElementById('ms-text').value = '';
  document.getElementById('ms-analysis-result').classList.add('hidden');
  document.getElementById('ms-analysis-result').innerHTML = '';
}
```

Replace with:
```js
function closeMilestoneForm() {
  document.getElementById('ms-form').classList.add('hidden');
  document.getElementById('ms-text').value = '';
  document.getElementById('ms-date').value = '';
  document.getElementById('ms-analysis-result').classList.add('hidden');
  document.getElementById('ms-analysis-result').innerHTML = '';
}
```

- [ ] **Step 4: Update confirmSaveMilestone to include dateLogged**

Find (lines ~1979–1991):
```js
async function confirmSaveMilestone() {
  const result  = document.getElementById('ms-analysis-result');
  const pending = JSON.parse(result.dataset.pending || '{}');
  if (!pending.name) return;

  await fetch('/api/milestone-achievements', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify(pending)
  });
  achievementsData = await fetch('/api/milestone-achievements').then(r=>r.json());
  renderMilestones();
  closeMilestoneForm();
}
```

Replace with:
```js
async function confirmSaveMilestone() {
  const result  = document.getElementById('ms-analysis-result');
  const pending = JSON.parse(result.dataset.pending || '{}');
  if (!pending.name) return;

  const dateLogged = document.getElementById('ms-date').value
                     || new Date().toISOString().split('T')[0];

  await fetch('/api/milestone-achievements', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ ...pending, dateLogged })
  });
  achievementsData = await fetch('/api/milestone-achievements').then(r=>r.json());
  renderMilestones();
  closeMilestoneForm();
}
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
git add web/public/index.html
git commit -m "feat(milestones): add date picker to log-new form"
```

---

### Task 7: Smoke test

**Files:** None — verification only.

- [ ] **Step 1: Verify server running**

```bash
curl -s http://localhost:3001/api/milestones-data | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));console.log('age:',d.age.months,'m, milestones:',d.milestones.length)"
```
Expected: `age: 6 m, milestones: 41`

- [ ] **Step 2: JS syntax clean**

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

- [ ] **Step 3: Manual browser checks**

Open `http://localhost:3001`, go to Milestones tab.

Check accordion behaviour:
- Tap a Motor achieved card → form expands
- Tap a different achieved card → first collapses, second expands
- Tap same card again → collapses
- Tap ✕ on the theme panel → closes; no JS errors in console

Check achieved card edit:
- Expand an achieved card → date field pre-filled with logged date, notes pre-filled
- Change the date → tap Save → card collapses, date shown on card updates

Check pending card complete:
- Expand a pending card → date defaults to today, notes empty
- Fill in notes, tap "Mark as completed" → button shows `✓ Saved!` briefly, card moves to Achieved section

Check upcoming card complete:
- Expand an upcoming card → form shows "Mark as completed" (green button)
- Complete it → moves to Ahead section (since `isUpcoming=true` → status `'ahead'`)

Check log new form:
- Tap `+ Log new` → date input shows today's date with calendar picker on click
- Change date, describe a milestone, Analyze → Confirm → achievement logged with correct date

- [ ] **Step 4: Commit any fixes**

```bash
git add web/public/index.html web/server.js
git commit -m "fix(milestones): smoke test corrections"
```

---

## Self-Review

**Spec coverage:**
- ✅ Accordion (one card open at a time) — `toggleMilestoneCard` + `expandedMilestoneId`
- ✅ Achieved cards: date + notes edit — Task 3 Section 1
- ✅ Ahead cards: date + notes edit — Task 3 Section 3
- ✅ Pending cards: complete with date + notes — Task 4
- ✅ Upcoming cards: tappable, complete — Task 5; `isUpcoming=true` → status `'ahead'`
- ✅ Brief success tick on complete — `completeMilestone` button text swap + 600ms delay
- ✅ Log new form date picker — Task 6
- ✅ Server accepts client dateLogged — Task 1
- ✅ Double-submit guard — `btn.disabled = true` at start of `saveMilestoneEdit` and `completeMilestone`
- ✅ `escAttr` on all string values in onclick attributes — present in all card HTML
- ✅ `Number(m.month)` guard — present in all `completeMilestone` call sites
- ✅ Upcoming card opacity restored when expanded — `style="${isExpanded ? 'opacity:1' : ''}"`
- ✅ `event.stopPropagation()` on expand form divs — prevents card toggle when clicking inside form

**Placeholder scan:** No TBDs. All code complete.

**Type consistency:** `expandedMilestoneId` set/read consistently as a string id or null. `toggleMilestoneCard(id)` called with `escAttr(a.id)` or `escAttr(m.id)` everywhere.
