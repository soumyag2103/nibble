# Roadmap as Source of Truth — Design Spec

**Date:** 2026-06-09

---

## Goal

Fix three bugs and unify the data model so `WEEK-PLANS.json` is the single editable source of truth for what the baby eats. Today tab and Roadmap tab always show the same data. Changes made anywhere write back to the week plan.

---

## Bugs Fixed

1. **Foods tried empty on Progress tab** — `/api/foods-summary` only read `logs/*.json`. Empty after reset = empty list. Fix: merge `FOODS-TRIED.md` as base, layer log reactions on top.
2. **Today tab and Roadmap diverge** — Today tab had its own suggestion fallback chain (Scheduled → Week Plan → Roadmap → AI). Fix: week plan always generated before Today tab renders, Today tab reads only from it.
3. **Variant changes not reflected in Roadmap** — Variants wrote to `SCHEDULED-MEALS.json` (date-specific override), never to the week plan. Fix: variant swaps and chat suggestions PATCH `WEEK-PLANS.json` directly.

---

## Data Model

### Source of truth hierarchy

| File | Role | Mutable? |
|------|------|----------|
| `FOOD-ROADMAP.json` | 6–12 month curriculum (what food, which week) | No — read-only input to plan generation |
| `WEEK-PLANS.json` | 7-day meal plans with recipes — **single editable source** | Yes — all edits write here |
| `logs/YYYY-MM-DD.json` | Actual logged meals with reactions | Yes — written when meals are logged |
| `FOODS-TRIED.md` | All introduced foods including pre-onboarding | Yes — updated by Gordon |

### Removed

`SCHEDULED-MEALS.json` — deleted from disk and all server references removed. Its role (day-specific overrides) is absorbed by direct edits to `WEEK-PLANS.json`.

### WEEK-PLANS.json structure (unchanged)

```json
{
  "6-2": {
    "days": [
      {
        "day": "Monday",
        "meals": {
          "slot_cs1": { "food": "banana", "recipe": "Mashed banana with ghee" },
          "slot_lunch": { "food": "dal khichdi", "recipe": "Soft dal khichdi, mashed smooth" },
          "slot_cs2": { "food": "sweet potato", "recipe": "Steamed and mashed" }
        }
      }
    ]
  }
}
```

Key format: `"${month}-${week}"` (e.g., `"6-2"` = month 6 week 2).

---

## Section 1: Foods Summary Fix

### Current behaviour
`GET /api/foods-summary` scans `logs/*.json` only. After reset, logs are empty → Progress shows no foods.

### New behaviour
Merge two sources:

1. Parse `agents/gordon/FOODS-TRIED.md` — extract all food names as base set (reaction counts default to zero)
2. Scan `logs/*.json` — aggregate reactions per food name (lowercased)
3. Merge: FOODS-TRIED.md foods get log reactions overlaid; log foods not in FOODS-TRIED.md also included

Result: every food the baby has ever been introduced to appears, with reactions if logged.

### API unchanged
`GET /api/foods-summary` — same response shape, new data source logic.

---

## Section 2: Week Plan Eager Generation

### New endpoint

`GET /api/ensure-week-plan`

- Computes current month (age-based) and week (1–4 within month)
- Checks `WEEK-PLANS.json` for key `"${month}-${week}"`
- If exists: returns `{ generated: false, plan: <existing plan> }`
- If missing: calls `generateWeekPlan(month, week, profile)`, saves to `WEEK-PLANS.json`, returns `{ generated: true, plan: <new plan> }`

Fast path (plan exists): ~5ms. Slow path (generation): ~2–3s Groq call.

### App init flow

```
init()
  → GET /api/profile          (if no profile → show onboarding, stop)
  → GET /api/ensure-week-plan (blocking — Today tab waits for this)
  → render Today tab from returned plan
  → load other tabs normally
```

Today tab shows "Preparing this week's plan..." only when `generated: true` (first open of a new week).

### Week rollover

Same call — new week = missing key = auto-generate. No manual action needed.

### Removed

`GET /api/today-suggestion` endpoint removed entirely. No more fallback chain (Scheduled → Week Plan → Roadmap → AI).

---

## Section 3: Edits Write Back to Week Plan

### New endpoint

`PATCH /api/week-plan/:month/:week/day/:dayIndex/slot/:slotId`

Body: `{ food, recipe }`

- Loads `WEEK-PLANS.json`
- Finds plan at key `"${month}-${week}"`
- Updates `plan.days[dayIndex].meals[slotId]` with `{ food, recipe }`
- Saves and returns updated day object

### Today tab variant swap

1. User clicks "Change" on a meal slot → variant options shown (existing flow unchanged)
2. User selects variant → frontend computes `month`, `week`, `dayIndex` from today's date → calls PATCH endpoint
3. Today tab re-renders that slot from response
4. Roadmap tab reads same `WEEK-PLANS.json` → already in sync

### Chat food suggestion (Uma integration)

When Gordon/Uma discusses a food change in chat (e.g., "let's swap banana for mango this week"), Uma appends a structured block at the end of the response:

```
<food_suggestion>{"month":6,"week":2,"dayIndex":1,"slotId":"slot_cs1","food":"mango","recipe":"Ripe mango pureed smooth"}
```

Frontend `renderChatMessage()` intercepts `<food_suggestion>` blocks (same pattern as `<appointment_question>`):
- Strips block from displayed text
- Renders confirmation card below the message:

```
┌──────────────────────────────────────┐
│ 🥄 Update this week's plan?          │
│ Swap banana → mango (Tue snack)      │
│                                      │
│  [Update plan]  [Dismiss]            │
└──────────────────────────────────────┘
```

On **Update plan**: calls PATCH endpoint → card updates to "✓ Week plan updated"
On **Dismiss**: no change, card collapses

### Meredith SOUL.md update

Uma's system prompt gains instruction to emit `<food_suggestion>` blocks when a food swap is discussed. Same pattern as `<appointment_question>` already in place.

---

## Files That Change

| File | Change |
|------|--------|
| `web/server.js` | Add `GET /api/ensure-week-plan`; add `PATCH /api/week-plan/:m/:w/day/:d/slot/:s`; rewrite `GET /api/foods-summary` to merge FOODS-TRIED.md; remove `GET /api/today-suggestion`; remove all SCHEDULED-MEALS references |
| `web/public/index.html` | `init()` calls ensure-week-plan; Today tab reads from plan not suggestion; variant swap calls PATCH; chat intercepts `<food_suggestion>`; remove scheduled-meal API calls |
| `agents/gordon/SOUL.md` | Add `<food_suggestion>` emit instruction |
| `agents/gordon/SCHEDULED-MEALS.json` | Deleted |

---

## What Does Not Change

- `FOOD-ROADMAP.json` generation logic — unchanged
- `WEEK-PLANS.json` generation logic (`generateWeekPlan()`) — unchanged
- Roadmap tab UI — already reads from `WEEK-PLANS.json`, will now reflect edits automatically
- All appointment, growth, milestone endpoints — untouched
- Log meal flow (`POST /api/log-meal`) — untouched
