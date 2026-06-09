# Nibble — Baby First Foods Tracker

> Big milestones start with tiny bites.

Track your baby's solids journey with AI-powered guidance. Two phases: a Telegram bot first, then a full web app.

---

## Phase 1: Telegram Bot (`bot/`)

WhatsApp-style chat interface for real-time logging from the phone.

```
bot/
├── bot.js          # Grammy bot — message handler + agent routing
├── .env            # TELEGRAM_TOKEN, GROQ_API_KEY
├── package.json
└── start.bat       # Windows launcher
```

**Run:** `cd bot && node bot.js`

Features:
- Message any agent by name prefix (`gordon`, `meredith`, `bailey`) or free text
- Keyword routing: food words → Gordon, milestone words → Meredith, health words → Bailey
- Reads and writes shared `agents/` data files
- File update protocol: agents emit `<file_update>` blocks, bot applies them

---

## Phase 2: Web App (`web/`)

Full-featured browser app. Runs locally at `http://localhost:3001`.

```
web/
├── server.js       # Express API + Groq agent calls
├── public/
│   └── index.html  # Single-file vanilla JS app (no build step)
├── package.json
└── start.bat       # Windows launcher
```

**Run:** `cd web && node server.js`

Tabs: Today · Chat · Plans · Milestones · Progress

---

## Shared: Agents + Data (`agents/`)

Both phases read/write the same agent memory and data files.

```
agents/
├── profile/
│   └── BABY-PROFILE.json       # name, dob, gender, dietary, meal slots
├── gordon/                     # Food + nutrition agent
│   ├── SOUL.md                 # Gordon's personality + rules
│   ├── FOODS-TRIED.md          # Running list of introduced foods
│   ├── FOODS-AVOIDED.md        # Foods to skip and why
│   ├── RECENT-MEALS.md         # Last ~14 days of meals
│   ├── PREFERENCES.md          # Texture stage, dietary notes
│   ├── FOOD-ROADMAP.json       # Long-term food introduction plan
│   ├── WEEK-PLANS.json         # Generated week-by-week meal plans
│   └── SCHEDULED-MEALS.json    # Upcoming scheduled meals
├── meredith/                   # Developmental milestones agent
│   ├── SOUL.md
│   ├── MILESTONE-MASTER.md     # WHO/AAP benchmark definitions
│   ├── MILESTONE-LOG.md        # Free-text milestone observations
│   └── MILESTONE-ACHIEVEMENTS.json  # Classified + dated achievements
├── bailey/                     # Doctor appointments agent
│   ├── SOUL.md
│   ├── QUESTIONS-QUEUE.md      # Pending questions for pediatrician
│   └── VISIT-LOG.md            # Post-visit notes + answers
├── appointments/
│   └── APPOINTMENTS.json       # Appointment dates + questions
└── growth/
    └── GROWTH.json             # Height + weight measurements over time
```

---

## Daily Logs (`logs/`)

One file per day. Written by the web app; readable by both phases.

```
logs/
└── YYYY-MM-DD.json   # { date, meals: { slot_id: { food, eaten, reaction, notes } } }
```

---

## Root Files

```
SAAHITI.md          # Baby profile: family context, solids history, health notes
AGENTS.md           # Rules every agent follows: memory protocol, safety rules
FOODS-TRIED.md      # Legacy root copy (Gordon's copy in agents/gordon/ is canonical)
QUESTIONS-QUEUE.md  # Legacy root copy (Bailey's copy in agents/bailey/ is canonical)
```

---

## Tech Stack

| Layer | Tech |
|-------|------|
| AI    | Groq (llama-3.3-70b / gemma2-9b) |
| Bot   | Grammy (Telegram) |
| API   | Express.js (ESM) |
| UI    | Vanilla JS, Chart.js 4.x |
| Data  | JSON files + Markdown (no database) |
