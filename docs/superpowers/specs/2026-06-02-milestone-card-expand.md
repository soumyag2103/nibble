# Milestone Card Expand — Design Spec

**Date:** 2026-06-02

---

## Goal

Tapping any milestone card in the detail panel expands it inline to show an edit form. Achieved/ahead cards let parents update date and notes. Pending/upcoming cards let parents mark the milestone as completed. The log-new form gains a date picker.

---

## Scope

Only `web/public/index.html` and `web/server.js` change. No new endpoints. No new files.

---

## Behaviour

### Accordion

One card expanded at a time. State var `expandedMilestoneId` (null or a milestone id string).

`toggleMilestoneCard(id)`:
- If `expandedMilestoneId === id` → set to null (collapse), re-render
- Else → set to id (expand new, collapse old), re-render

No smooth animation needed — re-render is instant enough at this data scale.

### Expanded card — Achieved / Ahead (edit mode)

Injected below the existing card content when `expandedMilestoneId === a.id`:

```
Date logged:  [____2026-05-27____]   ← <input type="date"> pre-filled with a.dateLogged
Notes:        [________________________]
              [________________________]   ← textarea, pre-filled with a.notes
              [        Save        ]   ← calls saveMilestoneEdit(a.id)
```

On Save:
1. POST `/api/milestone-achievements` with `{ id, name, category, month, status, notes, dateLogged }` (all fields from existing achievement, date/notes from form)
2. Update `achievementsData` in memory
3. `renderMilestones()` (accordion collapses since re-render resets expandedMilestoneId — see State Reset below)

### Expanded card — Pending / Upcoming (complete mode)

Same layout, fields blank (date defaults to today's ISO date):

```
Date achieved: [____2026-06-02____]   ← <input type="date"> defaulting to today
Notes:         [________________________]
               [________________________]   ← textarea, empty
               [  Mark as completed  ]   ← calls completeMilestone(...)
```

On "Mark as completed":
1. POST `/api/milestone-achievements` with `{ id, name, category, month, status: 'within', notes, dateLogged }`
   - For upcoming cards (not in MILESTONES_DATA as pending): status = 'ahead' since the baby hit a future-month milestone
2. Briefly show a green tick inline (replace button with `✓ Saved!` for 600ms)
3. Reload achievements: `achievementsData = await fetch('/api/milestone-achievements').then(r=>r.json())`
4. `renderMilestones()` — card moves from pending/upcoming to achieved section

### State Reset on Re-render

`expandedMilestoneId` is NOT reset by `renderMilestones()` itself. It is reset by:
- `toggleMilestoneCard(id)` when same id clicked (explicit collapse)
- After save/complete: explicitly set `expandedMilestoneId = null` before calling `renderMilestones()`

This means tapping Save collapses the form and the card returns to its collapsed state.

### Upcoming card status on completion

Upcoming milestones (section 4) are future-month items. When a parent marks one as completed:
- The milestone id exists in MILESTONES_DATA with `m.month > age.months`
- Save with `status: 'ahead'` (baby achieved a future-month milestone)
- After re-render, it appears in Section 3 (Ahead of schedule)

---

## Log New Milestone — Date Field

Add `<input type="date">` to the existing `#ms-form`, below the textarea, above the buttons. Default value: today's ISO date (set via JS on `openMilestoneForm()`).

```html
<div class="mt-2">
  <label class="text-xs text-gray-500 font-medium">Date achieved</label>
  <input id="ms-date" type="date"
    class="w-full bg-gray-50 rounded-xl px-3 py-2 text-sm border border-gray-100 mt-1">
</div>
```

`openMilestoneForm()`: add `document.getElementById('ms-date').value = new Date().toISOString().split('T')[0]`

`confirmSaveMilestone()`: read `document.getElementById('ms-date').value` and include as `dateLogged` in the POST body.

---

## Server Change

`POST /api/milestone-achievements` — line currently reads:

```js
const entry = { id, name, category, month, status: status || 'within', notes: notes || '', dateLogged: today };
```

Change to:

```js
const { id, name, category, month, status, notes, dateLogged } = req.body;
const entry = { id, name, category, month, status: status || 'within', notes: notes || '', dateLogged: dateLogged || today };
```

No other server changes needed.

---

## New State Variable

```js
let expandedMilestoneId = null;  // id string or null
```

Add alongside `activeTheme` and `milestoneScope`.

---

## New Functions

| Function | Purpose |
|----------|---------|
| `toggleMilestoneCard(id)` | Accordion toggle — expand or collapse |
| `saveMilestoneEdit(id)` | Save date + notes for an achieved/ahead card |
| `completeMilestone(id, name, category, month, isUpcoming)` | Mark pending/upcoming as done — reads form, POSTs, ticks, re-renders |

---

## Functions to Modify

| Function | Change |
|----------|--------|
| `renderThemeDetailHTML()` | Pass `expandedMilestoneId` into each section's card rendering; add `onclick="toggleMilestoneCard(...)"` to each card wrapper |
| `renderPendingCardHTML(m, age)` | Append expand form HTML when `expandedMilestoneId === m.id` |
| Section 1 (Achieved) card HTML | Append expand form HTML when `expandedMilestoneId === a.id` |
| Section 3 (Ahead) card HTML | Append expand form HTML when `expandedMilestoneId === a.id` |
| Section 4 (Upcoming) card HTML | Append expand form HTML when `expandedMilestoneId === m.id` |
| `openMilestoneForm()` | Set `#ms-date` to today |
| `confirmSaveMilestone()` | Include `dateLogged` from `#ms-date` in POST |

---

## Expanded Form HTML (reusable structure)

Two variants — same visual structure, different labels and button text:

**Edit variant** (achieved / ahead):
```html
<div class="ms-expand-form" style="border-top:1px solid #f3f4f6;padding:10px 12px;background:#fafafa">
  <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Date logged</label>
  <input type="date" id="ms-exp-date-${id}" value="${escAttr(dateLogged)}"
    style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;margin-bottom:7px;box-sizing:border-box">
  <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Notes</label>
  <textarea id="ms-exp-notes-${id}" rows="2"
    style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;resize:none;margin-bottom:7px;box-sizing:border-box"
    placeholder="Add a note…">${escHtml(notes)}</textarea>
  <button id="ms-exp-btn-${id}" onclick="saveMilestoneEdit('${escAttr(id)}')"
    style="width:100%;background:#f97316;color:#fff;border:none;border-radius:10px;padding:7px;font-size:12px;font-weight:600;cursor:pointer">
    Save
  </button>
</div>
```

**Complete variant** (pending / upcoming):
```html
<div class="ms-expand-form" style="border-top:1px solid #f3f4f6;padding:10px 12px;background:#fafafa">
  <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Date achieved</label>
  <input type="date" id="ms-exp-date-${id}" value="${today}"
    style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;margin-bottom:7px;box-sizing:border-box">
  <label style="font-size:10px;color:#6b7280;font-weight:600;display:block;margin-bottom:3px">Notes</label>
  <textarea id="ms-exp-notes-${id}" rows="2"
    style="width:100%;border:1px solid #e5e7eb;border-radius:8px;padding:5px 8px;font-size:12px;resize:none;margin-bottom:7px;box-sizing:border-box"
    placeholder="What did you observe?"></textarea>
  <button id="ms-exp-btn-${id}" onclick="completeMilestone('${escAttr(id)}','${escAttr(name)}','${escAttr(category)}',${month},${isUpcoming})"
    style="width:100%;background:#16a34a;color:#fff;border:none;border-radius:10px;padding:7px;font-size:12px;font-weight:600;cursor:pointer">
    Mark as completed
  </button>
</div>
```

---

## Edge Cases

- **custom_ ids in achieved cards**: They have no MILESTONES_DATA entry. `saveMilestoneEdit` still works — just POST with the existing achievement's fields. Month and category come from the achievement record, not MILESTONES_DATA.
- **Upcoming card id not in achievements**: `completeMilestone` builds the payload from MILESTONES_DATA (the milestone object has `id`, `label`, `category`, `month`). Status = `'ahead'`.
- **Pending card id not in achievements**: Same as above — payload from MILESTONES_DATA. Status = `'within'`.
- **Double-tap Save**: Disable the button immediately on first click (`document.getElementById('ms-exp-btn-' + id).disabled = true`) to prevent double-POST.
- **Date field empty**: Fallback to today before POSTing (`dateLogged || new Date().toISOString().split('T')[0]`).
- **escAttr in onclick strings**: All string values passed into `onclick="..."` attributes go through `escAttr()`. Numeric `month` interpolated with `Number()`.

---

## What Does NOT Change

- `loadMilestones()` — unchanged
- All API endpoints except the POST date fix
- `analyzeMilestone()` analysis logic — unchanged (only `confirmSaveMilestone` reads the new date field)
- `quickLogMilestone()`, `deleteMilestone()` — unchanged
- Summary table rendering — unchanged
- All other tabs — untouched
