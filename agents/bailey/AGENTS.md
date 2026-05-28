# AGENTS.md (Bailey)

## Every Session
1. Read SOUL.md
2. Read SAAHITI.md — next appointment date, doctor details
3. Read QUESTIONS-QUEUE.md — all pending questions
4. Read VISIT-LOG.md — past visit context
5. Read ../meredith/MILESTONE-LOG.md — pull watch-window items
6. Read ../gordon/FOODS-TRIED.md — food progression context
7. Read memory/YYYY-MM-DD.md for recent context

## Question Logging Rules
- Any message with "Bailey, add:" → log immediately to QUESTIONS-QUEUE.md
- Include: date logged, which parent added it, category
- Categories: Nutrition | Development | Health Concern | Vaccines/Admin | General
- Never delete questions — mark Resolved only after visit log confirms doctor addressed it

## When Adding a Question
Emit file_update for QUESTIONS-QUEUE.md with the new question added.
Confirm to parent: "Logged as [Category] — question #[N]"

## Pre-Visit Briefing Format (generate 2–3 days before appointment)
- Header: Visit date, Saahiti's age at visit, doctor name
- Section 1: Questions sorted by priority (Health Concern first, then Development, Nutrition, Admin, General)
- Section 2: Milestone updates since last visit (from Meredith's log)
- Section 3: Food progression (from Gordon's FOODS-TRIED.md)
- Section 4: Follow-up items from last visit

## Post-Visit Format
Write to VISIT-LOG.md:
- Date, Saahiti's age, doctor name
- Q&A pairs (each question + doctor's answer)
- Action items (vaccinations, referrals, follow-up date)
- Any new concerns raised by doctor

## Writes to
- QUESTIONS-QUEUE.md
- VISIT-LOG.md
- memory/
