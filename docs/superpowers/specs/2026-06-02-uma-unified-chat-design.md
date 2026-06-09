# Uma — Unified Parenting Chat Design

**Date:** 2026-06-02  
**Status:** Approved  

---

## Overview

Replace the current 3-agent pill selector (Gordon / Meredith / Bailey) with Uma — a single warm, unified parenting companion. Parents chat naturally; Uma internally routes to the right specialist agent and speaks in one coherent voice. Chat becomes a multi-purpose input surface: questions, food logs, milestone records, and doctor question queues all flow through Uma.

---

## UI Shell

- Remove agent pills entirely from chat tab header
- Uma avatar (🌸) + name displayed top-left
- Header text: *"Uma is here for every question, big or small. Ask about what Saahiti ate, a milestone you noticed, something to ask the doctor — or anything on your mind."*
- Input placeholder: `"What's on your mind?"`
- Clear button stays top-right
- Chat bubbles: Uma's responses labelled `🌸 Uma` instead of agent name
- No agent attribution shown to parent (Uma speaks as one voice)

---

## Architecture: Hybrid Two-Call Routing

### Call 1 — Intent Classifier (lightweight)

**System prompt** (small — only baby profile, no agent files):
```
You are Uma, a parenting assistant. Classify the parent's message intent.
Return JSON only:
{
  "intent": "chat" | "log_food" | "log_milestone" | "log_doctor_question",
  "agent": "gordon" | "meredith" | "bailey",
  "confidence": 0.0–1.0
}
Baby: {name}, {age}, {dob}
```

**Routing rules:**
- Food questions / food logging → `gordon`
- Developmental questions / milestone logging → `meredith`
- Health concerns / doctor questions → `bailey`
- Ambiguous (confidence < 0.7) → answer from both relevant angles in Uma's voice
- confidence < 0.5 → default to `gordon` (primary use case at this stage)

### Call 2 — Agent Response (full context)

Routes to existing prompt builder: `buildGordonPrompt`, `buildMeredithPrompt`, or `buildBaileyPrompt`.

Uma framing instruction appended to system prompt:
```
You are answering as Uma, a warm unified parenting companion.
Frame naturally by domain:
- Food topics: begin with "On the food front, ..."
- Milestones: begin with "Developmentally, ..."
- Doctor/health: begin with "From a health perspective, ..."
Tone: loving, direct, never clinical. Plain text, no markdown.
When intent is not 'chat', also return a JSON action block after your response:
ACTION_JSON: { "action": "<intent>", "payload": { ... } }
```

**Response structure from Call 2:**
```json
{
  "response": "On the food front, avocado is a great fat source...",
  "action": "log_food",
  "payload": { "food": "avocado", "date": "2026-06-01", "slot": "lunch" }
}
```

Server parses `ACTION_JSON` block from LLM text output using a delimiter pattern (`ACTION_JSON: {...}`). The JSON block is stripped before sending `response` to client. Client renders appropriate action card based on `action` field.

---

## Action Cards

### Food Log Card (`log_food`)
Rendered after Uma's response. Parent must confirm before any write.

```
🍽 Log this food?
Avocado · Lunch · 1 Jun 2026
[Edit]  [Confirm]
```

- **Confirm** → `POST /api/log-food` → appends to FOODS-TRIED.md → `tabLoaded.today = false`, `tabLoaded.plans = false`
- **Edit** → inline editable fields (food name, slot, date)

### Milestone Card (`log_milestone`)
Uma asks a follow-up question first before showing the card:

> *"When did this happen — roughly what time? Any notes you want to remember?"*

Parent replies → Uma generates card:

```
🌟 Log this milestone?
Stood independently · 2 Jun 2026, morning · "held for 3 seconds"
[Edit]  [Confirm]
```

- **Confirm** → `POST /api/log-milestone` → appends to MILESTONE-LOG.md with timestamp and notes → `tabLoaded.milestones = false`
- Milestone record format: `{milestone, date, time, notes}`

### Doctor Question Card (`log_doctor_question`)
Uma answers the health question briefly first, then shows the card:

```
📋 Add to doctor visit questions?
"Ask about iron levels at 8 months"
[Edit]  [Confirm]
```

- **Confirm** → `POST /api/log-doctor-question` → appends to QUESTIONS-QUEUE.md
- **Edit** → inline editable text field

---

## New API Endpoints

| Method | Path | Action |
|--------|------|--------|
| POST | `/api/chat` | Updated — two-call Uma routing, returns `{ response, action?, payload? }` |
| POST | `/api/log-food` | New — writes to FOODS-TRIED.md |
| POST | `/api/log-milestone` | New — writes to MILESTONE-LOG.md with date/time/notes |
| POST | `/api/log-doctor-question` | New — appends to QUESTIONS-QUEUE.md |

---

## Tab Invalidation

On action confirm, set `tabLoaded.X = false` so next tab switch fetches fresh data:

| Action | Tabs invalidated |
|--------|-----------------|
| log_food | today, plans |
| log_milestone | milestones |
| log_doctor_question | (no tab yet, future) |

---

## Chat State

- `chatHistory` array preserved as-is (in-memory per session)
- `currentAgent` variable removed (Uma handles routing internally)
- `pendingAction` new state variable: holds `{ action, payload, followUpStage }` while waiting for parent confirmation or follow-up reply
- Follow-up replies (e.g. milestone time/notes) detected by checking `pendingAction.followUpStage === 'awaiting_details'`

---

## Out of Scope

- Persisting chat history across sessions
- Uma handling food roadmap schedule changes (covered by existing variation/dislike flow in Today tab)
- Program tab updates from chat
