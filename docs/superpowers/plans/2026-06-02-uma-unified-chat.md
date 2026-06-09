# Uma — Unified Parenting Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 3-agent pill selector with Uma, a single warm parenting companion that routes internally to Gordon/Meredith/Bailey and supports food logging, milestone logging, and doctor question queuing via action confirmation cards.

**Architecture:** Two-call hybrid routing — Call 1 is a lightweight classifier (intent + agent + confidence), Call 2 uses the matched agent's existing prompt builder with Uma framing appended. Server parses an `ACTION_JSON` block from Call 2 output and returns `{ response, action, payload }` to the client. Client manages a `pendingAction` state machine for multi-step flows (milestone follow-up).

**Tech Stack:** Node.js/Express (ESM), Groq llama-3.3-70b-versatile, vanilla JS frontend (single index.html)

---

## File Map

| File | Change |
|------|--------|
| `web/server.js` | Add `buildUmaClassifierPrompt()`, `buildUmaFraming()`, update `POST /api/chat`, add `POST /api/log-food`, `POST /api/log-milestone`, `POST /api/log-doctor-question` |
| `web/public/index.html` | Remove agent pills, add Uma header UI, update `sendChat()`, add `pendingAction` state, add `renderActionCard()`, add `confirmFoodLog()`, `confirmMilestone()`, `confirmDoctorQuestion()` |

---

## Task 1: Server — Uma classifier + framing helpers

**Files:**
- Modify: `web/server.js` — after `buildBaileyPrompt()` function (around line 180)

- [ ] **Step 1: Add `buildUmaClassifierPrompt` function**

Insert after `buildBaileyPrompt()` closes (find the closing `}` of that function):

```javascript
function buildUmaClassifierPrompt(profile) {
  const p = profile || loadProfile();
  const age = getBabyAge(p);
  return `You are Uma, a parenting assistant. Classify the parent's message intent.
Return ONLY valid JSON, nothing else:
{"intent":"chat","agent":"gordon","confidence":0.9}

Intent values: "chat" | "log_food" | "log_milestone" | "log_doctor_question"
Agent values: "gordon" | "meredith" | "bailey"

Rules:
- Food questions, what to feed, reactions, food just eaten/tried → log_food, gordon
- Developmental milestone just observed (physical/cognitive action) → log_milestone, meredith
- Health concerns, symptoms, doctor questions, want to ask doctor → log_doctor_question, bailey
- General parenting chat, emotional support, unclear → chat, gordon
- confidence below 0.5 → default to gordon

Baby: ${p.name}, ${age.label} old, DOB: ${p.dob}`;
}

function buildUmaFraming(intent, pendingAction) {
  const actionInstructions = {
    log_food: `
When the parent clearly describes food that was eaten/tried, append this EXACT block at the end (after a blank line):
ACTION_JSON: {"action":"log_food","payload":{"food":"<food name>","date":"<YYYY-MM-DD>","slot":"<Morning Snack|Lunch|Afternoon Snack|General>"}}`,
    log_milestone_followup: `
The parent mentioned a milestone. Ask for timing and notes, then append:
ACTION_JSON: {"action":"log_milestone_followup","payload":{"milestone":"<milestone description>"}}`,
    log_milestone: `
Extract timing and notes from the parent's follow-up. Append:
ACTION_JSON: {"action":"log_milestone","payload":{"milestone":"<description>","date":"<YYYY-MM-DD>","time":"<e.g. morning, 10am>","notes":"<verbatim parent notes>"}}`,
    log_doctor_question: `
After answering, append the question to save:
ACTION_JSON: {"action":"log_doctor_question","payload":{"question":"<concise question for the doctor>"}}`,
    chat: '',
  };

  const activeIntent = pendingAction?.followUpStage === 'awaiting_details' ? 'log_milestone' : (intent || 'chat');

  return `You are speaking as Uma, a warm unified parenting companion. One voice, one persona.
Natural domain framing (use whichever fits):
- Food topics: begin with "On the food front, ..."
- Milestones/development: begin with "Developmentally, ..."
- Doctor/health: begin with "From a health perspective, ..."
Tone: loving, direct, transparent, never clinical. Plain text, no markdown symbols. No bullet points.
${actionInstructions[activeIntent] || ''}`;
}
```

- [ ] **Step 2: Restart server and verify no syntax errors**

```bash
cd C:/Users/ADMIN/saahiti-agents/web
node server.js
```
Expected: server starts on port 3001 without errors. Kill with Ctrl+C.

- [ ] **Step 3: Commit**

```
feat(server): add Uma classifier and framing helpers
```

---

## Task 2: Server — Update POST /api/chat with two-call routing

**Files:**
- Modify: `web/server.js` — replace existing `app.post('/api/chat', ...)` block (around line 490)

- [ ] **Step 1: Replace the /api/chat handler**

Find and replace the entire `app.post('/api/chat', ...)` block with:

```javascript
app.post('/api/chat', async (req, res) => {
  const { question, pendingAction } = req.body;
  const profile = loadProfile();

  // ── Call 1: Classify intent (skip if in milestone follow-up) ──
  let agent = 'gordon';
  let intent = 'chat';

  if (pendingAction?.followUpStage === 'awaiting_details') {
    agent   = 'meredith';
    intent  = 'log_milestone';
  } else {
    try {
      const classify = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: buildUmaClassifierPrompt(profile) },
          { role: 'user',   content: question },
        ],
        max_tokens: 80,
      });
      const parsed = JSON.parse(classify.choices[0].message.content.trim());
      agent  = parsed.agent      || 'gordon';
      intent = parsed.intent     || 'chat';
      const confidence = parsed.confidence ?? 1;
      if (confidence < 0.5) { agent = 'gordon'; intent = 'chat'; }
    } catch {
      agent = 'gordon'; intent = 'chat';
    }
  }

  // ── Call 2: Agent response with Uma framing ──
  const promptBuilders = {
    gordon:   buildGordonPrompt,
    meredith: buildMeredithPrompt,
    bailey:   buildBaileyPrompt,
  };
  const systemPrompt = (promptBuilders[agent] || buildGordonPrompt)(profile)
    + '\n\n' + buildUmaFraming(intent, pendingAction);

  const userMessage = pendingAction?.followUpStage === 'awaiting_details'
    ? `The parent earlier mentioned this milestone: "${pendingAction.payload?.milestone}". They now provide timing/notes: "${question}". Extract details and append ACTION_JSON.`
    : question;

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
      max_tokens: 1024,
    });

    let content = result.choices[0].message.content;

    // Parse and strip ACTION_JSON block
    let action = null, payload = null;
    const actionIdx = content.indexOf('ACTION_JSON:');
    if (actionIdx !== -1) {
      const jsonStr = content.slice(actionIdx + 'ACTION_JSON:'.length).trim();
      try { ({ action, payload } = JSON.parse(jsonStr)); } catch { /* ignore parse error */ }
      content = content.slice(0, actionIdx).trim();
    }

    res.json({ response: content, action, payload });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Test via curl**

Start server, then:
```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"what should Saahiti eat for lunch today?"}' | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.stringify(JSON.parse(d),null,2))"
```
Expected: `{ response: "On the food front, ...", action: null, payload: null }`

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question":"we just gave Saahiti avocado for lunch"}' | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');console.log(JSON.stringify(JSON.parse(d),null,2))"
```
Expected: `{ response: "On the food front, ...", action: "log_food", payload: { food: "avocado", date: "...", slot: "Lunch" } }`

- [ ] **Step 3: Commit**

```
feat(server): two-call Uma routing in /api/chat
```

---

## Task 3: Server — POST /api/log-food

**Files:**
- Modify: `web/server.js` — insert after the `/api/chat` handler

- [ ] **Step 1: Add the endpoint**

```javascript
app.post('/api/log-food', (req, res) => {
  const { food, date, slot } = req.body;
  if (!food || !date) return res.status(400).json({ error: 'food and date required' });

  const foodsPath = path.join(GORDON_DIR, 'FOODS-TRIED.md');
  let content = rf(foodsPath);

  // Map slot label to section header; fall back to General
  const profile = loadProfile();
  const matched = profile.slots.find(s =>
    s.label.toLowerCase() === (slot || '').toLowerCase() ||
    s.id.toLowerCase()    === (slot || '').toLowerCase()
  );
  const section = matched?.label || 'General';
  const newRow  = `| ${food} | ${date} | Pending | Logged via Uma |`;

  const sectionHeader = `## ${section}`;
  if (content.includes(sectionHeader)) {
    // Insert newRow before the next ## section or end of file
    const lines = content.split('\n');
    const secIdx = lines.findIndex(l => l.trim() === sectionHeader);
    let insertIdx = lines.length;
    for (let i = secIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) { insertIdx = i; break; }
    }
    // Insert before the next section (or at end), after last non-empty line in section
    lines.splice(insertIdx, 0, newRow);
    content = lines.join('\n');
  } else {
    content += `\n\n${sectionHeader}\n| Food | First Introduced | Reaction | Notes |\n|------|-----------------|----------|-------|\n${newRow}`;
  }

  content = content.replace(/^Last updated:.*$/m, `Last updated: ${tod()}`);
  wf(foodsPath, content);
  res.json({ ok: true });
});
```

- [ ] **Step 2: Test via curl**

```bash
curl -s -X POST http://localhost:3001/api/log-food \
  -H "Content-Type: application/json" \
  -d '{"food":"Avocado","date":"2026-06-02","slot":"Lunch"}'
```
Expected: `{"ok":true}`

Then verify FOODS-TRIED.md has a new row under `## Lunch`:
```bash
grep -A2 "## Lunch" "C:/Users/ADMIN/saahiti-agents/agents/gordon/FOODS-TRIED.md"
```
Expected: row containing `Avocado | 2026-06-02 | Pending | Logged via Uma`

- [ ] **Step 3: Commit**

```
feat(server): POST /api/log-food writes to FOODS-TRIED.md
```

---

## Task 4: Server — POST /api/log-milestone

**Files:**
- Modify: `web/server.js` — insert after `/api/log-food` handler

- [ ] **Step 1: Add the endpoint**

```javascript
app.post('/api/log-milestone', async (req, res) => {
  const { milestone, date, time, notes } = req.body;
  if (!milestone || !date) return res.status(400).json({ error: 'milestone and date required' });

  const profile = loadProfile();
  const age = getBabyAge(profile);

  // Ask Meredith to classify benchmark range and status
  let benchmarkRange = 'Unknown';
  let statusVsRange  = 'Logged via Uma';
  try {
    const classify = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Baby is ${age.label} old (DOB: ${profile.dob}). Milestone: "${milestone}".
Return ONLY JSON: {"benchmarkRange":"<e.g. 6-8m>","statusVsRange":"<Within range|AHEAD of range|SIGNIFICANTLY AHEAD|Behind range>"}
Use WHO/AAP developmental milestone norms. If unknown, use "Unknown" for both.`,
      }],
      max_tokens: 80,
    });
    const parsed = JSON.parse(classify.choices[0].message.content.trim());
    benchmarkRange = parsed.benchmarkRange || 'Unknown';
    statusVsRange  = parsed.statusVsRange  || 'Logged via Uma';
  } catch { /* keep defaults */ }

  const milestonePath = path.join(MEREDITH_DIR, 'MILESTONE-LOG.md');
  let content = rf(milestonePath);

  const timeLabel  = time  ? `, ${time}` : '';
  const notesText  = notes ? notes       : 'Logged via Uma';
  const newRow = `| ${milestone} | ${benchmarkRange} | ${statusVsRange} | ${date}${timeLabel} | ${notesText} |`;

  // Append row to the Achieved Milestones table
  const tableHeader = '| Milestone | Benchmark Range | Status vs Range | Date Logged | Notes |';
  if (content.includes(tableHeader)) {
    // Find last row of this table and append after it
    const lines = content.split('\n');
    const headerIdx = lines.findIndex(l => l.includes(tableHeader));
    let insertIdx = headerIdx + 2; // skip header + separator
    for (let i = headerIdx + 2; i < lines.length; i++) {
      if (lines[i].startsWith('|')) { insertIdx = i + 1; } else { break; }
    }
    lines.splice(insertIdx, 0, newRow);
    content = lines.join('\n');
  } else {
    content += `\n\n## Achieved Milestones\n${tableHeader}\n|-----------|----------------|----------------|-------------|-------|\n${newRow}`;
  }

  content = content.replace(/^Last updated:.*$/m, `Last updated: ${tod()}`);
  content = content.replace(/^Saahiti's age at last update:.*$/m,
    `Saahiti's age at last update: ${age.months} months, ${age.days} days`);
  wf(milestonePath, content);
  res.json({ ok: true, benchmarkRange, statusVsRange });
});
```

- [ ] **Step 2: Test via curl**

```bash
curl -s -X POST http://localhost:3001/api/log-milestone \
  -H "Content-Type: application/json" \
  -d '{"milestone":"Waved goodbye spontaneously","date":"2026-06-02","time":"morning","notes":"waved at grandma leaving"}'
```
Expected: `{"ok":true,"benchmarkRange":"...","statusVsRange":"..."}`

Verify MILESTONE-LOG.md has new row:
```bash
grep "Waved goodbye" "C:/Users/ADMIN/saahiti-agents/agents/meredith/MILESTONE-LOG.md"
```

- [ ] **Step 3: Commit**

```
feat(server): POST /api/log-milestone writes to MILESTONE-LOG.md with Meredith classification
```

---

## Task 5: Server — POST /api/log-doctor-question

**Files:**
- Modify: `web/server.js` — insert after `/api/log-milestone` handler

- [ ] **Step 1: Add the endpoint**

```javascript
app.post('/api/log-doctor-question', (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  const queuePath = path.join(BAILEY_DIR, 'QUESTIONS-QUEUE.md');
  let content = rf(queuePath);

  // Find current max question number
  const numMatches = [...content.matchAll(/^\| (\d+) \|/gm)];
  const maxNum = numMatches.length > 0
    ? Math.max(...numMatches.map(m => parseInt(m[1])))
    : 0;
  const nextNum = maxNum + 1;

  const newRow = `| ${nextNum} | ${tod()} | Uma | General | ${question} | Medium | Pending |`;

  // Insert into Active Questions table
  const tableHeader = '| # | Date | Added By | Category | Question | Priority | Status |';
  if (content.includes(tableHeader)) {
    const lines = content.split('\n');
    const headerIdx = lines.findIndex(l => l.includes(tableHeader));
    let insertIdx = headerIdx + 2;
    for (let i = headerIdx + 2; i < lines.length; i++) {
      if (lines[i].startsWith('|')) { insertIdx = i + 1; } else { break; }
    }
    lines.splice(insertIdx, 0, newRow);
    content = lines.join('\n');
  } else {
    content += `\n\n## Active Questions\n${tableHeader}\n|---|------|----------|----------|----------|----------|--------|\n${newRow}`;
  }

  content = content.replace(/^Last updated:.*$/m, `Last updated: ${tod()}`);
  wf(queuePath, content);
  res.json({ ok: true, questionNumber: nextNum });
});
```

- [ ] **Step 2: Test via curl**

```bash
curl -s -X POST http://localhost:3001/api/log-doctor-question \
  -H "Content-Type: application/json" \
  -d '{"question":"Ask about iron levels at 7 months"}'
```
Expected: `{"ok":true,"questionNumber":5}` (or whatever next number is)

Verify QUESTIONS-QUEUE.md has new row:
```bash
grep "iron levels" "C:/Users/ADMIN/saahiti-agents/agents/bailey/QUESTIONS-QUEUE.md"
```

- [ ] **Step 3: Commit**

```
feat(server): POST /api/log-doctor-question writes to QUESTIONS-QUEUE.md
```

---

## Task 6: Client — Uma UI shell

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Remove agent pill styles**

Find and delete these CSS rules (around lines 69–74):
```css
.agent-pill.gordon  { background: #FEF3C7; color: #92400E; }
.agent-pill.gordon.active  { border-color: #F59E0B; background: #FDE68A; }
.agent-pill.meredith{ background: #EDE9FE; color: #5B21B6; }
.agent-pill.meredith.active{ border-color: #8B5CF6; background: #DDD6FE; }
.agent-pill.bailey  { background: #DBEAFE; color: #1E3A8A; }
.agent-pill.bailey.active  { border-color: #3B82F6; background: #BFDBFE; }
```

- [ ] **Step 2: Add Uma UI styles**

In the same `<style>` block, add:
```css
.uma-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px 6px; }
.uma-avatar { width: 36px; height: 36px; border-radius: 50%; background: #FDE8D8; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
.uma-header-text h3 { font-size: 14px; font-weight: 700; color: #1a1a1a; margin: 0; }
.uma-header-text p  { font-size: 11px; color: #9ca3af; margin: 0; line-height: 1.4; }
.bubble-uma-label   { font-size: 10px; color: #9ca3af; margin-bottom: 2px; }
.action-card { background: #fff; border: 1.5px solid #e5e7eb; border-radius: 14px; padding: 14px 16px; margin-top: 6px; }
.action-card-title  { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
.action-card-body   { font-size: 14px; color: #1a1a1a; margin-bottom: 12px; line-height: 1.5; }
.action-card-field  { border: none; border-bottom: 1px solid #e5e7eb; outline: none; width: 100%; font-size: 14px; padding: 2px 0; background: transparent; margin-bottom: 4px; }
.action-card-btns   { display: flex; gap: 8px; }
.btn-confirm { flex: 1; background: var(--peach); color: #fff; border: none; border-radius: 20px; padding: 8px 0; font-size: 13px; font-weight: 600; cursor: pointer; }
.btn-edit    { flex: 1; background: #f3f4f6; color: #374151; border: none; border-radius: 20px; padding: 8px 0; font-size: 13px; font-weight: 600; cursor: pointer; }
```

- [ ] **Step 3: Replace the chat tab HTML**

Find the `<div id="tab-chat" ...>` block (around line 238–260) and replace it with:

```html
<div id="tab-chat" class="tab-panel max-w-lg mx-auto flex flex-col" style="height: calc(100vh - 112px)">
  <div class="uma-header">
    <div class="uma-avatar">🌸</div>
    <div class="uma-header-text">
      <h3>Uma</h3>
      <p>Here for every question — food, milestones, health, or anything on your mind.</p>
    </div>
    <button class="ml-auto text-xs text-gray-400 font-medium" onclick="clearChat()">Clear</button>
  </div>
  <div id="chat-messages" class="chat-messages flex-1"></div>
  <div class="p-3 flex gap-2 items-center border-t border-gray-100">
    <input id="chat-input" type="text" placeholder="What's on your mind?"
      class="flex-1 rounded-full border border-gray-200 px-4 py-2 text-sm outline-none focus:border-orange-300"
      onkeydown="if(event.key==='Enter')sendChat()" />
    <button onclick="sendChat()" class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
      style="background:var(--peach)" id="chat-send-btn">→</button>
  </div>
</div>
```

- [ ] **Step 4: Remove JS variables for agent system**

Find and remove (around lines 407–417):
```javascript
let currentAgent  = 'gordon';
```
and:
```javascript
const AGENT_META = {
  gordon:   { icon:'🍳', name:'Gordon', ... },
  meredith: { ... },
  bailey:   { ... },
};
```

- [ ] **Step 5: Update `initChat` and `clearChat` functions**

Find and replace `initChat()` and `clearChat()`:
```javascript
function initChat() {
  if (chatHistory.length === 0) {
    document.getElementById('chat-messages').innerHTML =
      `<div class="text-center text-xs text-gray-300 py-4">🌸 Uma is here. Ask anything about ${appProfile?.name || 'your baby'}.</div>`;
  }
}

function clearChat() {
  chatHistory = [];
  pendingAction = null;
  document.getElementById('chat-messages').innerHTML =
    `<div class="text-center text-xs text-gray-300 py-4">🌸 Uma is here. Ask anything about ${appProfile?.name || 'your baby'}.</div>`;
}
```

Also remove the `selectAgent()` function entirely (find `function selectAgent(agent)` block and delete it).

- [ ] **Step 6: Open browser and verify chat tab renders Uma header with no pill buttons**

Visit `http://localhost:3001`, navigate to Chat tab.
Expected: Uma avatar + name + description, no Gordon/Meredith/Bailey pills.

- [ ] **Step 7: Commit**

```
feat(client): Uma chat shell — remove agent pills, add Uma header and styles
```

---

## Task 7: Client — sendChat() + pendingAction state machine

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Add `pendingAction` state variable**

Find `let chatHistory   = [];` and add below it:
```javascript
let pendingAction = null; // { action, payload, followUpStage }
```

- [ ] **Step 2: Replace `sendChat()` function**

Find and replace the entire `async function sendChat()` block:

```javascript
async function sendChat() {
  const input = document.getElementById('chat-input');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';

  const msgs = document.getElementById('chat-messages');

  // User bubble
  msgs.insertAdjacentHTML('beforeend', `<div class="bubble bubble-user">${escHtml(q)}</div>`);
  msgs.scrollTop = msgs.scrollHeight;

  // Loading bubble
  const loadId = 'load-' + Date.now();
  msgs.insertAdjacentHTML('beforeend',
    `<div class="bubble bubble-agent" id="${loadId}"><span class="loading-dots text-gray-400">Uma is thinking</span></div>`);
  msgs.scrollTop = msgs.scrollHeight;

  let resp;
  try {
    resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, pendingAction }),
    }).then(r => r.json());
  } catch (e) {
    document.getElementById(loadId)?.remove();
    msgs.insertAdjacentHTML('beforeend', `<div class="bubble bubble-agent">Something went wrong. Try again.</div>`);
    msgs.scrollTop = msgs.scrollHeight;
    return;
  }

  // Replace loading bubble with Uma response
  const loadEl = document.getElementById(loadId);
  if (loadEl) {
    loadEl.outerHTML = `
      <div>
        <div class="bubble-uma-label">🌸 Uma</div>
        <div class="bubble bubble-agent">${escHtml(resp.response || resp.error || 'Error')}</div>
        ${resp.action ? renderActionCard(resp.action, resp.payload) : ''}
      </div>`;
  }

  // Update pendingAction state
  if (resp.action === 'log_milestone_followup') {
    pendingAction = { action: 'log_milestone', payload: resp.payload, followUpStage: 'awaiting_details' };
  } else if (resp.action && resp.action !== 'log_milestone_followup') {
    // Action card rendered — pendingAction cleared after confirm/cancel
    pendingAction = null;
  } else {
    pendingAction = null;
  }

  msgs.scrollTop = msgs.scrollHeight;
}
```

- [ ] **Step 3: Verify in browser — basic chat works**

Type "what should Saahiti eat tomorrow?" in the chat input.
Expected: Uma responds starting with "On the food front, ..." with no action card.

- [ ] **Step 4: Commit**

```
feat(client): sendChat updated for Uma two-call routing with pendingAction state
```

---

## Task 8: Client — renderActionCard()

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Add `renderActionCard()` function**

Add after `sendChat()` function:

```javascript
function renderActionCard(action, payload) {
  if (!payload) return '';
  const id = 'card-' + Date.now();

  if (action === 'log_food') {
    const { food = '', date = '', slot = 'General' } = payload;
    const dateLabel = date ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '';
    return `<div class="action-card" id="${id}">
      <div class="action-card-title">🍽 Log this food?</div>
      <div class="action-card-body">
        <input class="action-card-field" id="${id}-food" value="${escHtml(food)}" placeholder="Food name" />
        <input class="action-card-field" id="${id}-slot" value="${escHtml(slot)}" placeholder="Slot (Lunch / Morning Snack / etc)" />
        <input class="action-card-field" id="${id}-date" value="${date}" placeholder="Date (YYYY-MM-DD)" />
      </div>
      <div class="action-card-btns">
        <button class="btn-confirm" onclick="confirmFoodLog('${id}')">Confirm</button>
        <button class="btn-edit" onclick="document.getElementById('${id}').querySelector('.action-card-body').style.display='block'">Edit</button>
      </div>
    </div>`;
  }

  if (action === 'log_milestone') {
    const { milestone = '', date = '', time = '', notes = '' } = payload;
    return `<div class="action-card" id="${id}">
      <div class="action-card-title">🌟 Log this milestone?</div>
      <div class="action-card-body">
        <input class="action-card-field" id="${id}-milestone" value="${escHtml(milestone)}" placeholder="Milestone description" />
        <input class="action-card-field" id="${id}-date" value="${date}" placeholder="Date (YYYY-MM-DD)" />
        <input class="action-card-field" id="${id}-time" value="${escHtml(time)}" placeholder="Time (e.g. morning, 10am)" />
        <input class="action-card-field" id="${id}-notes" value="${escHtml(notes)}" placeholder="Notes" />
      </div>
      <div class="action-card-btns">
        <button class="btn-confirm" onclick="confirmMilestone('${id}')">Confirm</button>
        <button class="btn-edit" onclick="void 0">Edit</button>
      </div>
    </div>`;
  }

  if (action === 'log_doctor_question') {
    const { question = '' } = payload;
    return `<div class="action-card" id="${id}">
      <div class="action-card-title">📋 Add to doctor visit questions?</div>
      <div class="action-card-body">
        <input class="action-card-field" id="${id}-question" value="${escHtml(question)}" placeholder="Question for doctor" />
      </div>
      <div class="action-card-btns">
        <button class="btn-confirm" onclick="confirmDoctorQuestion('${id}')">Confirm</button>
        <button class="btn-edit" onclick="void 0">Edit</button>
      </div>
    </div>`;
  }

  return '';
}
```

- [ ] **Step 2: Test food log card in browser**

Type "we gave Saahiti avocado for lunch just now" in chat.
Expected: Uma response + action card with food/slot/date fields pre-filled and Confirm/Edit buttons.

- [ ] **Step 3: Commit**

```
feat(client): renderActionCard for food, milestone, and doctor question actions
```

---

## Task 9: Client — Confirm handlers + tab invalidation

**Files:**
- Modify: `web/public/index.html`

- [ ] **Step 1: Add confirm handler functions**

Add after `renderActionCard()`:

```javascript
async function confirmFoodLog(cardId) {
  const food  = document.getElementById(`${cardId}-food`)?.value.trim();
  const slot  = document.getElementById(`${cardId}-slot`)?.value.trim();
  const date  = document.getElementById(`${cardId}-date`)?.value.trim();
  if (!food || !date) return;

  const card = document.getElementById(cardId);
  if (card) card.innerHTML = `<div class="text-xs text-gray-400 py-2">Saving...</div>`;

  const resp = await fetch('/api/log-food', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ food, slot, date }),
  }).then(r => r.json());

  if (card) {
    card.innerHTML = resp.ok
      ? `<div class="text-xs text-green-500 py-2">✓ ${food} logged for ${slot || 'General'} on ${date}</div>`
      : `<div class="text-xs text-red-400 py-2">Error saving. Try again.</div>`;
  }

  // Invalidate today + plans tabs
  tabLoaded.today = false;
  tabLoaded.plans = false;
}

async function confirmMilestone(cardId) {
  const milestone = document.getElementById(`${cardId}-milestone`)?.value.trim();
  const date      = document.getElementById(`${cardId}-date`)?.value.trim();
  const time      = document.getElementById(`${cardId}-time`)?.value.trim();
  const notes     = document.getElementById(`${cardId}-notes`)?.value.trim();
  if (!milestone || !date) return;

  const card = document.getElementById(cardId);
  if (card) card.innerHTML = `<div class="text-xs text-gray-400 py-2">Saving...</div>`;

  const resp = await fetch('/api/log-milestone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ milestone, date, time, notes }),
  }).then(r => r.json());

  if (card) {
    card.innerHTML = resp.ok
      ? `<div class="text-xs text-green-500 py-2">✓ Milestone logged: ${milestone}</div>`
      : `<div class="text-xs text-red-400 py-2">Error saving. Try again.</div>`;
  }

  tabLoaded.milestones = false;
}

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

- [ ] **Step 2: End-to-end test — food log**

In browser chat:
1. Type "we gave Saahiti avocado for lunch"
2. Uma responds + food card appears
3. Click Confirm
4. Card shows green "✓ Avocado logged for Lunch on ..."
5. Navigate to Today tab — verify it reloads (not cached)
6. Check `agents/gordon/FOODS-TRIED.md` for new Avocado row

- [ ] **Step 3: End-to-end test — milestone**

1. Type "Saahiti said mama today"
2. Uma asks for time/notes
3. Reply "around 8am, she was looking at me"
4. Card appears with milestone details
5. Click Confirm
6. Card shows green success
7. Check `agents/meredith/MILESTONE-LOG.md` for new row

- [ ] **Step 4: End-to-end test — doctor question**

1. Type "I want to ask the doctor about when to introduce dairy"
2. Uma answers briefly + question card appears
3. Click Confirm
4. Card shows "✓ Added to doctor visit questions (#N)"
5. Check `agents/bailey/QUESTIONS-QUEUE.md` for new row

- [ ] **Step 5: Commit**

```
feat(client): confirm handlers for food/milestone/doctor-question with tab invalidation
```

---

## Self-Review

**Spec coverage check:**
- ✅ Uma avatar + name + header text — Task 6
- ✅ Agent pills removed — Task 6
- ✅ Natural domain framing ("On the food front...") — Task 1 `buildUmaFraming`
- ✅ Two-call hybrid routing — Task 2
- ✅ Food log confirmation card — Tasks 8, 9
- ✅ Milestone follow-up question then card — Tasks 2, 7, 8, 9
- ✅ Doctor question: brief answer + editable preview card — Tasks 8, 9
- ✅ Tab invalidation on confirm — Task 9
- ✅ `pendingAction` state for milestone follow-up — Task 7

**Gaps found:**
- `chatHistory` array is built up in JS but never sent to `/api/chat` for context continuity. The existing code already had this limitation; not in scope for this plan.
- `tabLoaded.milestones` — verify this key exists in the `tabLoaded` object in index.html before Task 9. If it's named differently, match the existing name.

**Type consistency:** `pendingAction.followUpStage === 'awaiting_details'` used consistently in Task 1 (server) and Task 7 (client). `resp.action` values `log_food | log_milestone | log_milestone_followup | log_doctor_question` used consistently across Tasks 2, 7, 8, 9.
