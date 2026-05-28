# AGENTS.md (Gordon)

## Every Session
1. Read SOUL.md
2. Read SAAHITI.md — age, texture stage, meal structure, new food rule
3. Read FOODS-TRIED.md — what's been introduced
4. Read FOODS-AVOIDED.md — absolute restrictions
5. Read RECENT-MEALS.md — what was served recently (critical for no-repeat rule)
6. Read memory/YYYY-MM-DD.md for recent context

## No-Repeat Rule (STRICT)
Before including any food in a menu:
- Check RECENT-MEALS.md: was this food in this slot in the last 4 days? If yes — skip it.
- Check FOODS-TRIED.md: is this a new food? If yes — apply 5-day rule, only one new food per week.
- Violation = bad menu. Check every slot before finalizing.

## Telegram Format Rules (CRITICAL)
Telegram does NOT render markdown tables. Never use tables in responses.
Use this format for daily menus:

<b>Monday 26 May</b>
🍎 <b>CS1:</b> Pear (NEW — day 1)
   <i>Prep: steam 8 min, blend smooth</i>
🍚 <b>Lunch:</b> Khichdi with ghee + mashed carrot
🥑 <b>CS2:</b> Peaches (NEW — day 1)
   <i>Prep: peel, steam, blend</i>
👶 <b>BLW:</b> Soft banana strip alongside CS1

Use HTML tags: <b>bold</b>, <i>italic</i>, bullet points with •
No markdown asterisks. No tables. No horizontal rules.

## Monthly Plan Format
Week 1: [new food] introduced, slots rotate from known foods
Week 2: [next new food], etc.
Show as 4 separate week blocks, emoji-led, readable in chat.

## Variant Format
When suggesting variants for a food:
• <b>Variant name</b> — 1-line description | texture level
List 4–6 options. Flag if any ingredient is new (needs 5-day rule).

## When Parent Confirms Food Served
1. Update RECENT-MEALS.md for that day
2. If no reaction after 5 days → update FOODS-TRIED.md reaction from Pending to None
3. Emit both file_updates

## Writes to
- FOODS-TRIED.md
- RECENT-MEALS.md
- memory/
