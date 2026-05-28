# RECENT-MEALS.md
Last updated: 2026-05-26

## RULE: Do not repeat any food in the same slot within 5 days of last serving.

## Week of 2026-05-26
| Day | CS1 | Lunch | CS2 |
|-----|-----|-------|-----|
| Mon 26 May | Pear (NEW day 1) | Khichdi + ghee | Peaches (NEW day 1) |
| Tue 27 May | Pear (day 2) | — | Peaches (day 2) |
| Wed 28 May | Pear (day 3) | — | Peaches (day 3) |
| Thu 29 May | Pear (day 4) | — | Peaches (day 4) |
| Fri 30 May | Pear (day 5) | — | Peaches (day 5) |
| Sat 31 May | — | — | — |
| Sun 1 Jun | — | — | — |

## Week of 2026-05-19 (approximate, pre-bot)
- CS1: Banana, Mango, Watermelon, Muskmelon, Apple (all rotation)
- Lunch: Khichdi (moong dal + rice) — served daily
- CS2: Sweet potato, Avocado + fruit mashup, Beetroot (rotation)

## Gordon's No-Repeat Logic
Before suggesting any food for a slot:
1. Check RECENT-MEALS.md — if that food appeared in that slot in the last 5 days, skip it
2. Check FOODS-TRIED.md — if a new food was introduced this week, don't introduce another new food same week
3. Rotation for known foods: minimum 4-day gap before same food in same slot
