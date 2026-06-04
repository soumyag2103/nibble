import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config({ path: '../bot/.env' });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE    = path.resolve(__dirname, '..');
const GORDON_DIR   = path.join(WORKSPACE, 'agents', 'gordon');
const MEREDITH_DIR = path.join(WORKSPACE, 'agents', 'meredith');
const BAILEY_DIR   = path.join(WORKSPACE, 'agents', 'bailey');
const LOGS_DIR     = path.join(WORKSPACE, 'logs');
const PROFILE_PATH = path.join(WORKSPACE, 'agents', 'profile', 'BABY-PROFILE.json');
const ROADMAP_PATH     = path.join(WORKSPACE, 'agents', 'gordon', 'FOOD-ROADMAP.json');
const WEEK_PLANS_PATH  = path.join(WORKSPACE, 'agents', 'gordon', 'WEEK-PLANS.json');
const APPOINTMENTS_PATH = path.join(WORKSPACE, 'agents', 'appointments', 'APPOINTMENTS.json');
const GROWTH_PATH       = path.join(WORKSPACE, 'agents', 'growth', 'GROWTH.json');

const DEFAULT_PROFILE = {
  name: 'Baby', dob: new Date().toISOString().split('T')[0], gender: 'other',
  dietary: 'vegetarian', solidsStartedAt: null,
  slots: [
    { id:'cs1',   label:'Morning Snack',    time:'10:00' },
    { id:'lunch', label:'Lunch',            time:'12:30' },
    { id:'cs2',   label:'Afternoon Snack',  time:'15:30' },
  ],
};

function loadProfile() { return rj(PROFILE_PATH) || DEFAULT_PROFILE; }
function loadAppointments() {
  const data = rj(APPOINTMENTS_PATH) || [];
  return data.sort((a, b) => a.date.localeCompare(b.date));
}
function saveAppointments(data) { wj(APPOINTMENTS_PATH, data); }

// WHO Child Growth Standards — Girls, 0–24 months
const WHO_GIRLS = {
  weight: {
    months: [0,1,2,3,4,5,6,7,8,9,10,11,12,15,18,21,24],
    p3:  [2.4,3.2,3.9,4.5,5.0,5.4,5.7,6.0,6.3,6.6,6.8,7.0,7.1,7.6,8.1,8.6,9.0],
    p15: [2.8,3.6,4.5,5.2,5.7,6.1,6.5,6.8,7.1,7.4,7.7,7.9,8.1,8.7,9.2,9.7,10.2],
    p50: [3.2,4.2,5.1,5.8,6.4,6.9,7.3,7.6,7.9,8.2,8.5,8.7,8.9,9.6,10.2,10.9,11.5],
    p85: [3.7,4.8,5.8,6.6,7.3,7.8,8.3,8.7,9.1,9.4,9.7,10.0,10.2,11.0,11.8,12.5,13.2],
    p97: [4.2,5.5,6.6,7.5,8.2,8.8,9.3,9.8,10.2,10.5,10.9,11.2,11.5,12.4,13.2,14.0,14.8],
  },
  height: {
    months: [0,1,2,3,4,5,6,7,8,9,10,11,12,15,18,21,24],
    p3:  [44.8,48.9,52.4,55.3,57.7,59.6,61.2,62.7,64.0,65.3,66.5,67.6,68.6,72.0,75.0,77.5,80.0],
    p15: [46.1,50.2,53.8,56.7,59.1,61.1,62.7,64.3,65.6,67.0,68.2,69.3,70.4,73.8,76.9,79.6,82.1],
    p50: [49.1,53.7,57.1,59.8,62.1,64.0,65.7,67.3,68.7,70.1,71.5,72.8,74.0,77.5,80.7,83.5,86.4],
    p85: [51.0,55.6,59.1,61.9,64.3,66.2,68.0,69.6,71.1,72.5,73.8,75.2,76.6,80.2,83.5,86.4,89.4],
    p97: [52.9,57.6,61.1,64.0,66.4,68.5,70.3,71.9,73.5,74.9,76.3,77.7,79.2,82.9,86.4,89.3,92.4],
  },
};

function loadGrowth() {
  const data = rj(GROWTH_PATH) || [];
  return data.sort((a, b) => a.date.localeCompare(b.date));
}
function saveGrowth(data) { wj(GROWTH_PATH, data); }

function nextAppointment(data) {
  const today = tod();
  return data.find(a => a.date >= today) || null;
}

function slugify(label, existing = []) {
  let base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g,'');
  let slug = base; let n = 2;
  while (existing.includes(slug)) { slug = `${base}_${n++}`; }
  return slug;
}

function pronouns(p) {
  if (p.gender === 'boy')   return { sub:'he', obj:'him', pos:'his',   noun:'son' };
  if (p.gender === 'other') return { sub:'they', obj:'them', pos:'their', noun:'child' };
  return { sub:'she', obj:'her', pos:'her', noun:'daughter' };
}

const app  = express();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────

const rf  = p => { try { return fs.readFileSync(p, 'utf-8'); } catch { return ''; } };
const wf  = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, 'utf-8'); };
const rj  = p => { try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; } };
const wj  = (p, d) => wf(p, JSON.stringify(d, null, 2));
const tod = () => new Date().toISOString().split('T')[0];

function getBabyAge(profile) {
  const dob  = new Date(profile?.dob || loadProfile().dob);
  const now  = new Date();
  let months = (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  let days   = now.getDate() - dob.getDate();
  if (days < 0) { months--; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  return { months, days, label: `${months}m ${days}d` };
}
// Convenience for routes that don't pass profile (reads fresh each call)
function getSaahitiAge() { return getBabyAge(loadProfile()); }

// Convert a day's JSON log → markdown for agent context
function jsonToMd(log, profile) {
  if (!log) return '';
  const p = profile || loadProfile();
  let md = `# Daily Log — ${log.date}\n\n`;
  for (const slot of p.slots) {
    const m = log.meals?.[slot.id];
    if (!m?.food) continue;
    md += `## ${slot.label}\n`;
    md += `- Food: ${m.food}\n`;
    md += `- Reaction: ${m.reaction || '—'}\n`;
    md += `- Notes: ${m.notes || '—'}\n\n`;
  }
  return md;
}

// ── Agent Prompt Builders ─────────────────────────────────────────────────────

function buildGordonPrompt(profile) {
  const p = profile || loadProfile();
  const pr = pronouns(p);
  const age = getBabyAge(p);
  const today = tod();
  const logs7 = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const dayLog = rj(path.join(LOGS_DIR, `${ds}.json`));
    if (dayLog) logs7.push(jsonToMd(dayLog, p));
  }
  const dietMap = {
    'vegetarian':     'Family is vegetarian. No eggs, meat, or fish.',
    'eggetarian':     'Family is eggetarian. Eggs are fine; no meat or fish.',
    'pescatarian':    'Family is pescatarian. Fish and eggs are fine; no meat.',
    'non-vegetarian': 'Family is non-vegetarian. Include eggs, chicken, fish when age-appropriate.',
  };
  const dietContext = dietMap[p.dietary] || `Family dietary preference: ${p.dietary}.`;
  return `You are Gordon, an AI agent helping parents of ${p.name} (DOB: ${p.dob}, currently ${age.label} old). ${p.name} uses ${pr.pos} pronouns. Today is ${today}. ${dietContext}

${rf(path.join(GORDON_DIR, 'SOUL.md'))}
${rf(path.join(WORKSPACE, 'AGENTS.md'))}

--- SAAHITI PROFILE ---
${rf(path.join(WORKSPACE, 'SAAHITI.md'))}

--- FOODS TRIED ---
${rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'))}

--- FOODS AVOIDED ---
${rf(path.join(GORDON_DIR, 'FOODS-AVOIDED.md'))}

--- RECENT MEALS ---
${rf(path.join(GORDON_DIR, 'RECENT-MEALS.md'))}

--- PREFERENCES (Likes & Dislikes) ---
${rf(path.join(GORDON_DIR, 'PREFERENCES.md'))}

--- LAST 7 DAYS OF LOGS ---
${logs7.join('\n---\n') || 'No logs yet.'}

Respond in plain readable text. No markdown symbols. Use line breaks. Be concise and direct.`;
}

function buildMeredithPrompt(profile) {
  const p = profile || loadProfile();
  const pr = pronouns(p);
  const age = getBabyAge(p);
  const today = tod();
  return `You are Meredith, a developmental milestone tracker helping parents of ${p.name} (DOB: ${p.dob}, currently ${age.label} old). ${p.name} uses ${pr.pos} pronouns. Today is ${today}.

${rf(path.join(MEREDITH_DIR, 'SOUL.md'))}

--- SAAHITI PROFILE ---
${rf(path.join(WORKSPACE, 'SAAHITI.md'))}

--- MILESTONE LOG (Achieved) ---
${rf(path.join(MEREDITH_DIR, 'MILESTONE-LOG.md'))}

--- MILESTONE MASTER LIST (WHO/AAP) ---
${rf(path.join(MEREDITH_DIR, 'MILESTONE-MASTER.md'))}

Respond in plain readable text. No markdown symbols. Use line breaks. Be concise and direct.`;
}

function buildBaileyPrompt(profile) {
  const p = profile || loadProfile();
  const pr = pronouns(p);
  const age = getBabyAge(p);
  const today = tod();
  return `You are Bailey, a clinical appointment organizer helping parents prepare for ${p.name}'s pediatric visits (DOB: ${p.dob}, currently ${age.label} old). ${p.name} uses ${pr.pos} pronouns. Today is ${today}.

${rf(path.join(BAILEY_DIR, 'SOUL.md'))}

--- SAAHITI PROFILE ---
${rf(path.join(WORKSPACE, 'SAAHITI.md'))}

--- QUESTIONS QUEUE ---
${rf(path.join(BAILEY_DIR, 'QUESTIONS-QUEUE.md'))}

--- VISIT LOG ---
${rf(path.join(BAILEY_DIR, 'VISIT-LOG.md'))}

--- MEREDITH'S MILESTONE LOG ---
${rf(path.join(MEREDITH_DIR, 'MILESTONE-LOG.md'))}

--- GORDON'S FOODS TRIED ---
${rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'))}

Respond in plain readable text. No markdown symbols. Use line breaks. Be concise and direct.`;
}

function buildUmaClassifierPrompt(profile) {
  const p = profile || loadProfile();
  const age = getBabyAge(p);
  return `You are Uma, a parenting assistant. Classify the parent's message intent.
Return ONLY valid JSON, nothing else:
{"intent":"chat","agent":"gordon","confidence":0.9}

Intent values: "chat" | "log_food" | "log_milestone" | "log_doctor_question"
Agent values: "gordon" | "meredith" | "bailey"

Rules:
- Food questions, what to feed, reactions, food just eaten/tried → {"intent":"log_food","agent":"gordon"}
- Developmental milestone just observed (physical/cognitive action) → {"intent":"log_milestone","agent":"meredith"}
- Health concerns, symptoms, doctor questions, want to ask doctor → {"intent":"log_doctor_question","agent":"bailey"}
- General parenting chat, emotional support, anything unclear → {"intent":"chat","agent":"gordon"}
- If confidence below 0.5, use {"intent":"chat","agent":"gordon"}

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

  const activeIntent = pendingAction?.followUpStage === 'awaiting_details'
    ? 'log_milestone'
    : (intent === 'log_milestone' ? 'log_milestone_followup' : (intent || 'chat'));

  return `You are speaking as Uma, a warm unified parenting companion. One voice, one persona.
Natural domain framing (use whichever fits):
- Food topics: begin with "On the food front, ..."
- Milestones/development: begin with "Developmentally, ..."
- Doctor/health: begin with "From a health perspective, ..."
Tone: loving, direct, transparent, never clinical. Plain text, no markdown symbols. No bullet points.
${actionInstructions[activeIntent] || ''}`;
}

// ── Roadmap Generation (Gordon-driven) ───────────────────────────────────────

async function generateRoadmap(profile) {
  const p   = profile || loadProfile();
  const pr  = pronouns(p);
  const age = getBabyAge(p);
  const dietMap = {
    'vegetarian':     'strict vegetarian — no eggs, meat, or fish',
    'eggetarian':     'eggetarian — eggs are fine, no meat or fish',
    'pescatarian':    'pescatarian — fish and eggs are fine, no meat',
    'non-vegetarian': 'non-vegetarian — include eggs, chicken, fish at appropriate ages',
  };
  const dietNote = dietMap[p.dietary] || p.dietary;
  const foodsTried = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md')) || 'None yet.';

  // Build template so Gordon knows exactly what structure to fill
  const months = [6,7,8,9,10,11,12];
  const weeks  = [1,2,3,4];
  const slots  = ['snack1','lunch','snack2'];
  const template = months.flatMap(m => weeks.flatMap(w => slots.map(s =>
    `{"month":${m},"week":${w},"slot":"${s}","food":"...","tip":"..."}`
  ))).join(',\n');

  const prompt = `You are Gordon, an expert Indian infant nutrition consultant. Generate a complete food introduction roadmap for ${p.name} (DOB: ${p.dob}, currently ${age.label} old, ${pr.pos} pronouns). Family is ${dietNote}.

FOODS ALREADY TRIED:
${foodsTried}

Generate a structured roadmap for months 6 through 12, covering 4 weeks per month. Use these 3 semantic slot names:
- "snack1" = first snack (morning)
- "lunch" = main midday meal
- "snack2" = second snack (afternoon)

RULES:
- Introduce ONE new food per week maximum per slot. Different new food each slot.
- Foods tried already can still appear as rotations — label them clearly in the tip.
- No salt, sugar, honey, whole nuts. Ghee and mild Indian spices (cumin, turmeric, ajwain, coriander) are fine.
- Age-appropriate textures: smooth puree at 6m, mashed at 7-8m, soft lumps at 9-10m, finger food at 11-12m.
- Indian home kitchen style throughout.
- Diet: ${dietNote}. Respect this strictly for every entry.
- Not every slot needs a new food every week — use null food for rotation weeks.
- Each tip: max 2 sentences. Practical prep instructions.

Return ONLY valid JSON — no markdown fences, no explanation:
{"roadmap":[
${template}
]}`;

  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4000, temperature: 0.3,
  });
  let raw = result.choices[0].message.content.trim()
    .replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
  const parsed = JSON.parse(raw);
  // Filter out null/placeholder entries
  parsed.roadmap = parsed.roadmap.filter(r => r.food && r.food !== '...' && r.food !== 'null' && r.food !== null);
  wj(ROADMAP_PATH, { generated: new Date().toISOString(), dietary: p.dietary, roadmap: parsed.roadmap });
  return parsed.roadmap;
}

function loadRoadmap() {
  const cached = rj(ROADMAP_PATH);
  if (cached?.roadmap) return cached.roadmap;
  return null; // not yet generated
}

// Map profile slot ID → semantic name (snack1/lunch/snack2) by position
function slotToSemantic(profile) {
  const map = {};
  profile.slots.forEach((s, i) => {
    map[s.id] = i === 0 ? 'snack1' : i === 1 ? 'lunch' : 'snack2';
  });
  return map;
}

// Get current roadmap food for a given profile slot ID
// Fallback chain: exact week → any week same month → previous month any week
function getRoadmapFood(profile, slotId) {
  const roadmap = loadRoadmap();
  if (!roadmap) return null;
  const age    = getBabyAge(profile);
  const month  = Math.max(6, Math.min(12, age.months));
  const week   = Math.min(4, Math.floor(age.days / 7) + 1);
  const semMap = slotToSemantic(profile);
  const sem    = semMap[slotId];
  if (!sem) return null;

  // 1. Exact match
  let entry = roadmap.find(r => r.month === month && r.week === week && r.slot === sem);
  if (entry?.food) return entry.food;

  // 2. Any week in same month, same slot (pick highest week ≤ current week, else lowest)
  const sameMonth = roadmap.filter(r => r.month === month && r.slot === sem).sort((a,b) => b.week - a.week);
  entry = sameMonth.find(r => r.week <= week) || sameMonth[sameMonth.length - 1];
  if (entry?.food) return entry.food;

  // 3. Previous month, same slot
  for (let m = month - 1; m >= 6; m--) {
    const prev = roadmap.filter(r => r.month === m && r.slot === sem).sort((a,b) => b.week - a.week)[0];
    if (prev?.food) return prev.food;
  }

  return null;
}

// ── Static Data ───────────────────────────────────────────────────────────────

// slot field uses semantic names: 'snack1' (first slot), 'lunch' (main meal), 'snack2' (third slot)
// dietary field (optional): array of dietary keys that include this food; absent = all diets
const FOOD_ROADMAP = [
  // Month 6
  { month:6, week:1, slot:'snack1', food:'Banana', tip:'Mash ripe banana with fork. Mix 2 tbsp breast milk to thin.' },
  { month:6, week:1, slot:'snack2', food:'Sweet Potato', tip:'Steam 12 min, blend smooth. Add 1 tsp ghee for healthy fats.' },
  { month:6, week:2, slot:'snack1', food:'Apple', tip:'Steam 10 min, blend smooth. Tiny pinch of cardamom aids digestion.' },
  { month:6, week:2, slot:'snack2', food:'Carrot', tip:'Steam 15 min, blend silky. Mix with potato for creamier texture.' },
  { month:6, week:3, slot:'snack1', food:'Avocado', tip:'Mash ripe avocado with fork — no cooking. Serve immediately, browns quickly.' },
  { month:6, week:3, slot:'snack2', food:'Pumpkin', tip:'Steam 10 min, blend smooth. Naturally sweet, rich in Vitamin A.' },
  { month:6, week:4, slot:'snack1', food:'Papaya', tip:'Use fully ripe papaya only. Natural enzymes prevent constipation.' },
  { month:6, week:4, slot:'snack2', food:'Green Peas', tip:'Boil, blend, strain through fine mesh. Straining removes skins — essential.' },
  // Month 7
  { month:7, week:1, slot:'lunch', food:'Rice Dal Khichdi', tip:'2 tbsp rice + 1 tbsp moong dal, pressure cook 4 whistles with turmeric, add ghee.' },
  { month:7, week:1, slot:'snack2', food:'Zucchini', tip:'Steam 7 min, blend smooth. Mild flavour, high water content.' },
  { month:7, week:2, slot:'snack1', food:'Ragi', tip:'Mix ragi flour into boiling water, cook 7 min stirring. Exceptional calcium source.' },
  { month:7, week:2, slot:'snack2', food:'Spinach', tip:'Blanch 2 min, blend with boiled potato. Potato balances the strong flavour.' },
  { month:7, week:3, slot:'snack1', food:'Mango', tip:'Fully ripe Alphonso or Kesar only. Blend smooth — no fibrous strings.' },
  { month:7, week:4, slot:'snack1', food:'Oats', tip:'Cook rolled oats 5 min stirring. Blend smooth, thin with breast milk.' },
  { month:7, week:4, slot:'snack2', food:'Broccoli', tip:'Steam 8 min, blend smooth. Mix with potato to soften strong flavour.' },
  // Month 8
  { month:8, week:1, slot:'snack1', food:'Pear', tip:'Steam ripe pear 8 min, blend silky smooth. Easiest fruit to digest.' },
  { month:8, week:1, slot:'lunch', food:'Egg Yolk Dal', tip:'Hard boil, mash yolk into moong dal. Excellent iron + choline for brain.', dietary:['eggetarian','non-vegetarian'] },
  { month:8, week:2, slot:'snack1', food:'Suji (Semolina)', tip:'Roast in ghee 3 min, cook with water 4 min stirring. No sugar needed.' },
  { month:8, week:2, slot:'lunch', food:'Chicken Broth Khichdi', tip:'Pressure cook mild chicken broth with rice and moong dal. Strain before serving.', dietary:['non-vegetarian'] },
  { month:8, week:3, slot:'snack1', food:'Chikoo (Sapodilla)', tip:'Fully ripe chikoo only — unripe is astringent. Mash smooth.' },
  { month:8, week:4, slot:'snack1', food:'Cauliflower', tip:'Steam 10 min, blend smooth. Mix with potato for creamier texture.' },
  { month:8, week:4, slot:'snack2', food:'Daliya (Broken Wheat)', tip:'Roast 2 min, pressure cook 4 whistles with moong dal. Add ghee.' },
  // Month 9
  { month:9, week:1, slot:'snack1', food:'Paneer', tip:'Fresh unsalted paneer only. Mash or blend with a little warm water.' },
  { month:9, week:1, slot:'snack2', food:'Beetroot', tip:'Boil 20 min, blend smooth. Pink nappies are normal and harmless.' },
  { month:9, week:1, slot:'lunch', food:'Fish Puree', tip:'Steam white fish (rohu/pomfret) 8 min, blend smooth. No bones — check twice.', dietary:['pescatarian','non-vegetarian'] },
  { month:9, week:2, slot:'snack1', food:'Kiwi', tip:'Fully ripe kiwi. Mix with banana to neutralise acidity.' },
  { month:9, week:2, slot:'snack2', food:'Mixed Lentils Dal', tip:'Panchmel dal — 5 lentils pressure cooked. Complete amino acid profile.' },
  { month:9, week:3, slot:'snack1', food:'Poha', tip:'Rinse thin poha, cook 4 min stirring. Iron-rich and easily digestible.' },
  { month:9, week:3, slot:'snack2', food:'Tomato', tip:'Always cook tomatoes to reduce acidity. Mix with potato to mellow.' },
  { month:9, week:4, slot:'snack1', food:'Yogurt (Plain)', tip:'Full-fat plain dahi only. Mix with mango or banana. Serve at room temp.' },
  { month:9, week:4, slot:'snack2', food:'Banana Chunks (Finger Food)', tip:'Cut into 1cm pieces. Must squash easily between your fingers. BLW milestone!' },
  // Month 10
  { month:10, week:1, slot:'snack1', food:'Idli', tip:'Steam mini idlis, break into pieces, serve with soft moong dal.' },
  { month:10, week:1, slot:'snack2', food:'Cheese', tip:'Low-salt full-fat soft mozzarella only. Cut into 1cm cubes for finger food.' },
  { month:10, week:2, slot:'snack1', food:'Strawberry', tip:'Blend smooth. Mix with banana to reduce acidity. No added sugar.' },
  { month:10, week:2, slot:'snack2', food:'Corn', tip:'Blend and strain through fine mesh — corn skins are a choking hazard.' },
  { month:10, week:2, slot:'lunch', food:'Scrambled Egg', tip:'Scramble with ghee on low heat until just set. Small soft pieces only.', dietary:['eggetarian','non-vegetarian'] },
  { month:10, week:3, slot:'snack1', food:'Bajra (Pearl Millet)', tip:'Cook bajra flour with water 7 min stirring. Add ghee. Warming and iron-rich.' },
  { month:10, week:3, slot:'lunch', food:'Chicken Keema (Mild)', tip:'Mince finely, cook with turmeric + ghee, no salt. Mash with dal before serving.', dietary:['non-vegetarian'] },
  { month:10, week:4, slot:'snack1', food:'Jowar (Sorghum)', tip:'Cook jowar flour 7-8 min stirring. Gluten-free, very nutritious.' },
  { month:10, week:4, slot:'snack2', food:'Lauki (Bottle Gourd)', tip:'Pressure cook with rice + moong dal 4 whistles. Most cooling vegetable.' },
  // Month 11
  { month:11, week:1, slot:'snack1', food:'Soft Roti / Chapati', tip:'Soft enough to squash between fingers. Tear into 2cm pieces with ghee.' },
  { month:11, week:2, slot:'snack2', food:'Rajma (Kidney Beans)', tip:'Soak overnight, pressure cook 8 whistles. Mash with ghee — complete protein.' },
  { month:11, week:3, slot:'lunch', food:'Fish Finger Food', tip:'Steam soft white fish chunk — must flake easily. Remove all bones carefully.', dietary:['pescatarian','non-vegetarian'] },
  // Month 12
  { month:12, week:1, slot:'snack1', food:'Family Food Adaptation', tip:'Set aside family dal/sabzi before adding salt and whole spices.' },
  { month:12, week:2, slot:'snack1', food:'Grapes (Quartered)', tip:'Quarter each grape lengthwise — never offer whole. Serious choking hazard.' },
];

const MILESTONES_DATA = [
  // Month 5 (already passed — for context)
  { id:'m5_1', month:5, label:'Rolls confidently, uses rolling to move', category:'Motor' },
  { id:'m5_2', month:5, label:'Sits with minimal support (tripod sit)', category:'Motor' },
  { id:'m5_3', month:5, label:'Transfers objects hand to hand', category:'Motor' },
  { id:'m5_4', month:5, label:'Responds to own name', category:'Language' },
  { id:'m5_5', month:5, label:'Blows raspberries', category:'Language' },
  { id:'m5_6', month:5, label:'Shows interest in solid foods, reaches for food', category:'Feeding' },
  // Month 6
  { id:'m6_1', month:6, label:'Sits without support briefly (10–30 sec)', category:'Motor' },
  { id:'m6_2', month:6, label:'Stands with support when held', category:'Motor' },
  { id:'m6_3', month:6, label:'Rolls confidently as main locomotion', category:'Motor' },
  { id:'m6_4', month:6, label:'Stranger anxiety begins', category:'Social' },
  { id:'m6_5', month:6, label:'Babbles consonant-vowel combos (ba-ba, ma-ma)', category:'Language' },
  { id:'m6_6', month:6, label:'Ready to start solids', category:'Feeding' },
  { id:'m6_7', month:6, label:'Shows affection: reaches for caregivers', category:'Social' },
  { id:'m6_8', month:6, label:'Explores objects by mouthing, banging, shaking', category:'Cognitive' },
  // Month 7
  { id:'m7_1', month:7, label:'Sits without support steadily', category:'Motor' },
  { id:'m7_2', month:7, label:'Begins crawling (or scooting/rolling/army crawl)', category:'Motor' },
  { id:'m7_3', month:7, label:'Pulls to stand holding furniture or hands', category:'Motor' },
  { id:'m7_4', month:7, label:'Pincer grasp developing (thumb and forefinger)', category:'Motor' },
  { id:'m7_5', month:7, label:'Stranger anxiety more pronounced', category:'Social' },
  { id:'m7_6', month:7, label:'Separation anxiety begins', category:'Social' },
  { id:'m7_7', month:7, label:'Waves bye-bye (may begin)', category:'Language' },
  { id:'m7_8', month:7, label:'Babbles in longer strings: ba-ba-ba, ma-ma-ma', category:'Language' },
  { id:'m7_9', month:7, label:'Plays peek-a-boo, loves repetition', category:'Cognitive' },
  { id:'m7_10', month:7, label:'Understands "no" from tone of voice', category:'Cognitive' },
  { id:'m7_11', month:7, label:'Accepting wider range of textures and flavours', category:'Feeding' },
  // Month 8
  { id:'m8_1', month:8, label:'Pulls to stand confidently using furniture', category:'Motor' },
  { id:'m8_2', month:8, label:'Cruises along furniture', category:'Motor' },
  { id:'m8_3', month:8, label:'Pincer grasp improving significantly', category:'Motor' },
  { id:'m8_4', month:8, label:'Says mama and dada with intent', category:'Language' },
  { id:'m8_5', month:8, label:'Points at objects of interest', category:'Language' },
  { id:'m8_6', month:8, label:'Object permanence solid: looks for hidden objects', category:'Cognitive' },
  { id:'m8_7', month:8, label:'Plays independently for short periods', category:'Social' },
  { id:'m8_8', month:8, label:'Self-feeding finger foods with both hands', category:'Feeding' },
  // Month 9
  { id:'m9_1', month:9, label:'Stands alone briefly', category:'Motor' },
  { id:'m9_2', month:9, label:'Cruises confidently and fast', category:'Motor' },
  { id:'m9_3', month:9, label:'First words beyond mama/dada emerging', category:'Language' },
  { id:'m9_4', month:9, label:'Waves hello and bye intentionally', category:'Language' },
  { id:'m9_5', month:9, label:'Follows simple one-step instructions', category:'Language' },
  { id:'m9_6', month:9, label:'Imitates actions and sounds (clapping, patting)', category:'Cognitive' },
  { id:'m9_7', month:9, label:'Social referencing: looks at your face for cues', category:'Social' },
  { id:'m9_8', month:9, label:'Eating a wide variety of family foods', category:'Feeding' },
];

// ── API Routes ────────────────────────────────────────────────────────────────

// Status: date + age
app.get('/api/status', (req, res) => {
  const today = tod();
  const fmt   = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  res.json({ today, formatted: fmt, age: getSaahitiAge() });
});

// Today's log
app.get('/api/today-log', (req, res) => {
  const profile = loadProfile();
  const emptyMeals = Object.fromEntries(profile.slots.map(s => [s.id, {}]));
  const log = rj(path.join(LOGS_DIR, `${tod()}.json`));
  res.json(log || { date: tod(), meals: emptyMeals });
});

// Save a meal
app.post('/api/log-meal', (req, res) => {
  const { slot, food, eaten, reaction, notes } = req.body;
  const today   = tod();
  const profile = loadProfile();
  const logPath = path.join(LOGS_DIR, `${today}.json`);
  const emptyMeals = Object.fromEntries(profile.slots.map(s => [s.id, {}]));
  const log     = rj(logPath) || { date: today, meals: emptyMeals };

  log.meals[slot] = { food, eaten, reaction, notes, savedAt: new Date().toISOString() };
  wj(logPath, log);
  wf(path.join(LOGS_DIR, `${today}.md`), jsonToMd(log, profile));

  // Update PREFERENCES.md
  if (food && reaction) {
    const prefPath = path.join(GORDON_DIR, 'PREFERENCES.md');
    let prefs = rf(prefPath) || '# PREFERENCES.md\n\n## Likes\n\n## Dislikes\n';
    const escaped     = food.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alreadyLogged = new RegExp(`- ${escaped}:`).test(prefs);
    if (!alreadyLogged) {
      if (reaction === 'Disliked') {
        prefs = prefs.replace('## Dislikes\n', `## Dislikes\n- ${food}: Disliked (${today})\n`);
      } else if (reaction === 'Loved' || reaction === 'Liked') {
        prefs = prefs.replace('## Likes\n', `## Likes\n- ${food}: ${reaction} (${today})\n`);
      }
      wf(prefPath, prefs);
    }
  }

  res.json({ success: true });
});

// Week summary (last 7 days)
app.get('/api/week-summary', (req, res) => {
  const week = [];
  for (let i = 0; i < 7; i++) {
    const d   = new Date(); d.setDate(d.getDate() - i);
    const ds  = d.toISOString().split('T')[0];
    const fmt = d.toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' });
    const log = rj(path.join(LOGS_DIR, `${ds}.json`));
    week.push({ date: ds, formatted: fmt, log: log || null });
  }
  res.json(week);
});

// Known foods for autocomplete
app.get('/api/foods', (req, res) => {
  const content = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'));
  const foods   = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('|') && !line.includes('Food') && !line.includes('---')) {
      const name = line.split('|')[1]?.trim();
      if (name) foods.push(name);
    }
  }
  res.json([...new Set(foods)]);
});

// Ask Gordon (kept for backward compat)
app.post('/api/ask-gordon', async (req, res) => {
  const { question } = req.body;
  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: buildGordonPrompt() },
        { role: 'user',   content: question }
      ],
      max_tokens: 1024,
    });
    res.json({ response: result.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Multi-agent chat (Uma unified routing)
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

// Task 3: Log a food introduction via Uma chat
app.post('/api/log-food', (req, res) => {
  const { food, date, slot } = req.body;
  if (!food || !date) return res.status(400).json({ error: 'food and date required' });

  const foodsPath = path.join(GORDON_DIR, 'FOODS-TRIED.md');
  let content = rf(foodsPath);

  const profile = loadProfile();
  const matched = profile.slots.find(s =>
    s.label.toLowerCase() === (slot || '').toLowerCase() ||
    s.id.toLowerCase()    === (slot || '').toLowerCase()
  );
  const section = matched?.label || 'General';
  const newRow  = `| ${food} | ${date} | Pending | Logged via Uma |`;

  const sectionHeader = `## ${section}`;
  if (content.includes(sectionHeader)) {
    const lines = content.split('\n');
    const secIdx = lines.findIndex(l => l.trim() === sectionHeader);
    let insertIdx = lines.length;
    for (let i = secIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) { insertIdx = i; break; }
    }
    lines.splice(insertIdx, 0, newRow);
    content = lines.join('\n');
  } else {
    content += `\n\n${sectionHeader}\n| Food | First Introduced | Reaction | Notes |\n|------|-----------------|----------|-------|\n${newRow}`;
  }

  content = content.replace(/^Last updated:.*$/m, `Last updated: ${tod()}`);
  wf(foodsPath, content);
  res.json({ ok: true });
});

// Task 4: Log a developmental milestone via Uma chat
app.post('/api/log-milestone', async (req, res) => {
  const { milestone, date, time, notes } = req.body;
  if (!milestone || !date) return res.status(400).json({ error: 'milestone and date required' });

  const profile = loadProfile();
  const age = getBabyAge(profile);

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

  const tableHeader = '| Milestone | Benchmark Range | Status vs Range | Date Logged | Notes |';
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
    content += `\n\n## Achieved Milestones\n${tableHeader}\n|-----------|----------------|----------------|-------------|-------|\n${newRow}`;
  }

  content = content.replace(/^Last updated:.*$/m, `Last updated: ${tod()}`);
  content = content.replace(/^Saahiti's age at last update:.*$/m,
    `Saahiti's age at last update: ${age.months} months, ${age.days} days`);
  wf(milestonePath, content);
  res.json({ ok: true, benchmarkRange, statusVsRange });
});

// Task 5: Log a doctor question via Uma chat
app.post('/api/log-doctor-question', (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  const queuePath = path.join(BAILEY_DIR, 'QUESTIONS-QUEUE.md');
  let content = rf(queuePath);

  const numMatches = [...content.matchAll(/^\| (\d+) \|/gm)];
  const maxNum = numMatches.length > 0
    ? Math.max(...numMatches.map(m => parseInt(m[1])))
    : 0;
  const nextNum = maxNum + 1;

  const newRow = `| ${nextNum} | ${tod()} | Uma | General | ${question} | Medium | Pending |`;

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

// Variants for a disliked food
app.get('/api/variants/:food', async (req, res) => {
  const foodName = decodeURIComponent(req.params.food);
  const age      = getSaahitiAge();
  const prompt   = `You are Gordon, expert in Indian vegetarian infant nutrition. Saahiti is ${age.months} months ${age.days} days old and just showed dislike for: ${foodName}.

Suggest exactly 5 variant preparations. Indian vegetarian context. Smooth to mashed textures.
Avoid: honey, salt, sugar, whole nuts, pork.

Return ONLY 5 lines, each in this format:
VARIANT NAME | one-line description | texture (smooth/mashed/soft lumps)

No intro text. No numbering. Just the 5 lines.`;
  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    });
    const lines    = result.choices[0].message.content.split('\n').filter(l => l.includes('|'));
    const variants = lines.map(l => {
      const p = l.split('|').map(x => x.trim());
      return { name: p[0], description: p[1], texture: p[2] };
    }).filter(v => v.name);
    res.json(variants);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Parse FOODS-TRIED.md for active introductions (Pending + exact date)
// Uses profile slot labels/ids for section header detection
function getActive5DayIntros(profile) {
  const p       = profile || loadProfile();
  const expDays = p.exposureDays || 5;
  const content = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'));
  const active  = {};
  let currentSlot = '';

  // Build header → slotId map from profile (label and id both match)
  const headerMap = {};
  p.slots.forEach(s => {
    headerMap[s.label.toLowerCase()] = s.id;
    headerMap[s.id.toLowerCase().replace(/_/g,' ')] = s.id;
    headerMap[s.id.toLowerCase()] = s.id;
  });
  // Legacy Saahiti mappings
  if (!headerMap['cs1']) headerMap['cs1'] = p.slots[0]?.id || 'cs1';
  if (!headerMap['lunch']) headerMap['lunch'] = p.slots[1]?.id || 'lunch';
  if (!headerMap['cs2']) headerMap['cs2'] = p.slots[2]?.id || 'cs2';

  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      const header = line.slice(3).split('—')[0].trim().toLowerCase();
      // Find first matching slot key inside the header string
      currentSlot = Object.entries(headerMap).find(([k]) => header.includes(k))?.[1] || '';
    }

    if (!line.startsWith('|') || line.includes('Food') || line.includes('---')) continue;
    const parts = line.split('|').map(x => x.trim()).filter(Boolean);
    if (parts.length < 3) continue;

    const [food, dateStr, reaction] = parts;
    if (reaction?.toLowerCase() !== 'pending') continue;

    const dateMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (!dateMatch) continue;

    const introDate = new Date(dateMatch[1]);
    const today     = new Date(tod());
    const dayNum    = Math.floor((today - introDate) / 86400000) + 1;

    if (dayNum >= 1 && dayNum <= expDays) {
      const slotKey = currentSlot || p.slots[0]?.id || 'snack1';
      active[slotKey] = { food, slot: slotKey, dayNumber: dayNum, daysRemaining: expDays - dayNum, introDate: dateMatch[1] };
    }
  }
  return active;
}

// Write initial FOODS-TRIED.md from onboarding data
function writeFoodsTriedFromOnboarding(profile, foodsIntroduced, activeIntros) {
  const today  = tod();
  const p      = profile;
  let md = `# FOODS-TRIED.md\n\nLast updated: ${today}\n\n`;

  // Group all foods (introduced + active) by slot if known, else generic
  const bySlot = {};
  p.slots.forEach(s => { bySlot[s.id] = []; });
  const unslotted = [];

  for (const food of foodsIntroduced) {
    if (food?.trim()) unslotted.push({ food: food.trim(), date: `~${today}`, reaction: 'None', notes: 'Introduced before onboarding' });
  }

  for (const intro of activeIntros) {
    if (!intro.food?.trim()) continue;
    const introDate = new Date();
    introDate.setDate(introDate.getDate() - (intro.day - 1));
    const introDateStr = introDate.toISOString().split('T')[0];
    const entry = { food: intro.food.trim(), date: introDateStr, reaction: 'Pending', notes: `Day ${intro.day} of ${p.exposureDays || 5}` };
    // Match slotId by id OR label
    const matchedSlot = p.slots.find(s => s.id === intro.slotId || s.label === intro.slotId);
    if (matchedSlot && bySlot[matchedSlot.id]) {
      bySlot[matchedSlot.id].push(entry);
    } else {
      unslotted.push(entry);
    }
  }

  // Write slot sections
  for (const slot of p.slots) {
    const entries = bySlot[slot.id] || [];
    md += `## ${slot.label}\n`;
    md += `| Food | First Introduced | Reaction | Notes |\n`;
    md += `|------|-----------------|----------|-------|\n`;
    for (const e of entries) {
      md += `| ${e.food} | ${e.date} | ${e.reaction} | ${e.notes} |\n`;
    }
    md += '\n';
  }

  // Unslotted foods
  if (unslotted.length) {
    md += `## General\n`;
    md += `| Food | First Introduced | Reaction | Notes |\n`;
    md += `|------|-----------------|----------|-------|\n`;
    for (const e of unslotted) {
      md += `| ${e.food} | ${e.date} | ${e.reaction} | ${e.notes} |\n`;
    }
    md += '\n';
  }

  wf(path.join(GORDON_DIR, 'FOODS-TRIED.md'), md);
}

const SCHEDULED_PATH = path.join(GORDON_DIR, 'SCHEDULED-MEALS.json');

// POST /api/schedule-meal — save a chosen variation for a future date
app.post('/api/schedule-meal', (req, res) => {
  const { date, slot, food, recipe, dayNumber, daysRemaining } = req.body;
  const data = rj(SCHEDULED_PATH) || {};
  if (!data[date]) data[date] = {};
  data[date][slot] = { food, recipe: recipe || '', source: 'scheduled', dayNumber, daysRemaining };
  wj(SCHEDULED_PATH, data);
  res.json({ success: true });
});

// GET /api/today-suggestion — pre-populated menu for Today tab
// Priority: scheduled > week plan > active 5-day intro > roadmap > Gordon fallback
app.get('/api/today-suggestion', async (req, res) => {
  const today      = tod();
  const profile    = loadProfile();
  const active     = getActive5DayIntros(profile);
  const sched      = (rj(SCHEDULED_PATH) || {})[today] || {};
  const allSlotIds = profile.slots.map(s => s.id);

  // Load cached week plan for today's date
  const weekPlans   = rj(WEEK_PLANS_PATH) || {};
  const ageNow      = getBabyAge(profile);
  const planMonth   = Math.max(6, Math.min(12, ageNow.months));
  const planWeek    = Math.min(4, Math.floor(ageNow.days / 7) + 1);
  const weekPlan    = weekPlans[`${planMonth}-${planWeek}`];
  const todayName   = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todayEntry  = weekPlan?.days?.find(d => d.day.toLowerCase() === todayName.toLowerCase());

  // Week plan checked first for all unscheduled slots — it IS the source of truth
  const weekPlanFoods = {};
  const slotsAfterPlan = [];
  for (const slot of allSlotIds.filter(s => !sched[s])) {
    const food = todayEntry?.meals?.[slot]?.food;
    if (food && food !== '...') weekPlanFoods[slot] = food;
    else slotsAfterPlan.push(slot);
  }

  const roadmapFoods = {};
  const slotsNeedingGordon = [];

  // Roadmap fallback for slots not covered by week plan
  for (const slot of slotsAfterPlan.filter(s => !active[s])) {
    const food = getRoadmapFood(profile, slot);
    if (food) {
      roadmapFoods[slot] = food;
    } else {
      slotsNeedingGordon.push(slot);
    }
  }

  // Gordon fallback only for slots with no roadmap entry this week
  let gordonFoods = {};
  if (slotsNeedingGordon.length > 0) {
    const lines = slotsNeedingGordon.map(s => `${s.toUpperCase()}: [food name]`).join('\n');
    const prompt = `${buildGordonPrompt()}

TODAY'S TASK: Suggest one food for each of these slots only: ${slotsNeedingGordon.map(s=>s.toUpperCase()).join(', ')}.
These slots have no active 5-day introduction and no roadmap entry this week. Use RECENT-MEALS and PREFERENCES — no repeats, no dislikes.

Return ONLY these lines, nothing else:
${lines}`;

    try {
      const result = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 80, temperature: 0.2,
      });
      const slotPattern = new RegExp(`^(${slotsNeedingGordon.map(s => s.toUpperCase().replace(/_/g, '[_ ]?')).join('|')}):\\s*(.+)`, 'i');
      for (const line of result.choices[0].message.content.split('\n')) {
        const m = line.match(slotPattern);
        if (m) {
          const key     = m[1].toLowerCase().replace(/\s/g, '_');
          const matched = slotsNeedingGordon.find(s => s === key || s.toUpperCase() === m[1].toUpperCase());
          if (matched) gordonFoods[matched] = m[2].trim().replace(/^\[|\]$/g,'');
        }
      }
    } catch(e) { console.error('Gordon fallback suggestion error:', e.message); }
  }

  const suggestion = {};
  for (const slot of allSlotIds) {
    if (sched[slot]) {
      suggestion[slot] = sched[slot];
    } else if (weekPlanFoods[slot]) {
      // Week plan = source of truth; carry 5-day metadata if applicable so UI still shows day counter
      const a = active[slot];
      suggestion[slot] = {
        food: weekPlanFoods[slot],
        recipe: todayEntry?.meals?.[slot]?.recipe || '',
        source: 'weekplan',
        dayNumber: a?.dayNumber || null, daysRemaining: a?.daysRemaining ?? 0,
      };
    } else if (active[slot]) {
      suggestion[slot] = { food: active[slot].food, source: '5day', dayNumber: active[slot].dayNumber, daysRemaining: active[slot].daysRemaining };
    } else if (roadmapFoods[slot]) {
      suggestion[slot] = { food: roadmapFoods[slot], source: 'roadmap', dayNumber: null, daysRemaining: 0 };
    } else {
      suggestion[slot] = { food: gordonFoods[slot] || '', source: 'gordon', dayNumber: null, daysRemaining: 0 };
    }
  }
  res.json({ suggestion });
});

// POST /api/dislike-variations — day-by-day variation schedule for remaining 5-day window
app.post('/api/dislike-variations', async (req, res) => {
  const { food, daysRemaining } = req.body;
  const profile = loadProfile();
  const age = getBabyAge(profile);
  const pr = pronouns(profile);
  if (!daysRemaining || daysRemaining < 1) return res.json({ variations: [] });
  const dietLabels = { vegetarian:'family is vegetarian', eggetarian:'family is eggetarian (eggs ok, no meat)', pescatarian:'family is pescatarian (fish+eggs ok, no meat)', 'non-vegetarian':'family eats non-vegetarian' };
  const dietLabel = dietLabels[profile.dietary] || `family dietary: ${profile.dietary}`;

  const prompt = `You are Gordon, infant nutrition expert. ${profile.name} is ${age.months} months ${age.days} days old. ${dietLabel}.

${pr.sub.charAt(0).toUpperCase() + pr.sub.slice(1)} showed dislike for: ${food}.
The 5-day rule requires ${daysRemaining} more day(s) of exposure to ${food} — do NOT switch to a different food.
Generate exactly ${daysRemaining} day-by-day variation(s) using ${food} as the hero ingredient to improve acceptance.
Different preparation each day. Indian vegetarian. Smooth to mashed. No salt, sugar, honey, whole nuts.

Return EXACTLY ${daysRemaining} line(s) and nothing else:
Day [N]: VARIATION NAME | one-line preparation tip`;

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250, temperature: 0.3,
    });
    const variations = result.choices[0].message.content
      .split('\n')
      .filter(l => /Day\s*\d+:/i.test(l))
      .map(l => {
        const m = l.match(/Day\s*(\d+):\s*(.+)/i);
        if (!m) return null;
        const [name, description] = m[2].split('|').map(x => x.trim());
        return { dayLabel: `Day ${m[1]}`, name, description: description || '' };
      }).filter(Boolean);
    res.json({ variations, food, daysRemaining });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Analyze a free-text milestone report via Meredith AI
app.post('/api/analyze-milestone', async (req, res) => {
  const { text } = req.body;
  const profile = loadProfile();
  const age = getBabyAge(profile);
  const achievements = rj(ACHIEVEMENTS_PATH) || [];

  const milestoneList = MILESTONES_DATA.map(m =>
    `- [${m.id}] Month ${m.month} | ${m.category} | ${m.label}`
  ).join('\n');

  const achievedList = achievements.map(a =>
    `- [${a.id}] "${a.name}" (${a.category}, logged ${a.dateLogged})`
  ).join('\n') || 'None yet.';

  const prompt = `You are Meredith, developmental milestone tracker for ${profile.name} (DOB: ${profile.dob}, currently ${age.months} months ${age.days} days old = ${age.months + Math.round(age.days/30.4 * 10)/10} months total). Today is ${tod()}.

Parent reported: "${text}"

KNOWN MILESTONE LIST (id | benchmark month | category | description):
${milestoneList}

ALREADY LOGGED:
${achievedList}

Your job:
1. Is this a real developmental milestone? (look for motor, language, social, cognitive, feeding, sleep skills)
2. If yes: match to closest item in the known list, or name it if genuinely new
3. Determine: category, benchmark month, is ${profile.name} ahead/on-track/behind?
4. ${profile.name}'s age in months: ${age.months + age.days/30.4} — compare to benchmark month
   - "on_track": within the expected month window (±3 weeks)
   - "ahead": achieving 1-4 weeks before benchmark
   - "significantly_ahead": achieving 5+ weeks before benchmark
   - "monitor": not yet achieved but past the typical window
5. Check if already logged (fuzzy match on name)

Respond ONLY in this exact JSON (no prose, no markdown fences):
{
  "isMilestone": true,
  "milestoneId": "m7_2",
  "name": "exact name",
  "category": "Motor",
  "benchmarkMonth": 7,
  "benchmarkRange": "7-9m",
  "status": "ahead",
  "weeksEarly": 2,
  "weeksBehind": 0,
  "statusDetail": "~2 weeks ahead of the 7m benchmark",
  "alreadyLogged": false,
  "alreadyLoggedAs": "",
  "note": ""
}

If not a milestone:
{
  "isMilestone": false,
  "note": "brief explanation"
}`;

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.1,
    });
    let raw = result.choices[0].message.content.trim();
    // Strip markdown fences if model includes them
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/,'').trim();
    const parsed = JSON.parse(raw);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Food roadmap — Gordon-generated, cached in FOOD-ROADMAP.json
app.get('/api/food-roadmap', async (req, res) => {
  const profile = loadProfile();
  const age     = getBabyAge(profile);

  let roadmap = loadRoadmap();
  if (!roadmap) {
    try { roadmap = await generateRoadmap(profile); }
    catch(e) { return res.status(500).json({ error: 'Roadmap generation failed: ' + e.message }); }
  }

  // Map semantic slot names → actual profile slot IDs
  const slotMap = {
    snack1: profile.slots[0]?.id || 'snack1',
    lunch:  profile.slots[1]?.id || 'lunch',
    snack2: profile.slots[2]?.id || 'snack2',
  };

  const content  = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'));
  const triedSet = new Set();
  for (const line of content.split('\n')) {
    if (line.startsWith('|') && !line.includes('Food') && !line.includes('---')) {
      const name = line.split('|')[1]?.trim();
      if (name) triedSet.add(name.toLowerCase());
    }
  }

  const result = roadmap.map(w => ({
    ...w,
    slot:     slotMap[w.slot] || w.slot,
    tried:    triedSet.has(w.food.toLowerCase()),
    current:  w.month === age.months || (w.month === age.months + 1 && age.days >= 21),
    upcoming: w.month > age.months + 1,
  }));
  res.json({ weeks: result, age });
});

// Force-regenerate roadmap (called after dietary change in settings)
app.post('/api/food-roadmap/regenerate', async (req, res) => {
  const profile = loadProfile();
  try {
    // Delete cached file so generateRoadmap writes fresh
    try { fs.unlinkSync(ROADMAP_PATH); } catch {}
    const roadmap = await generateRoadmap(profile);
    res.json({ success: true, count: roadmap.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Milestone achievements
const ACHIEVEMENTS_PATH = path.join(MEREDITH_DIR, 'MILESTONE-ACHIEVEMENTS.json');

app.get('/api/milestone-achievements', (req, res) => {
  res.json(rj(ACHIEVEMENTS_PATH) || []);
});

app.post('/api/milestone-achievements', (req, res) => {
  const { id, name, category, month, status, notes, dateLogged } = req.body;
  const data   = rj(ACHIEVEMENTS_PATH) || [];
  const today  = tod();
  const entry  = { id, name, category, month, status: status || 'within', notes: notes || '', dateLogged: dateLogged || today };
  const idx    = data.findIndex(a => a.id === id);
  if (idx >= 0) data[idx] = entry; else data.push(entry);
  wj(ACHIEVEMENTS_PATH, data);

  // Append to MILESTONE-LOG.md
  const logPath  = path.join(MEREDITH_DIR, 'MILESTONE-LOG.md');
  let logContent = rf(logPath);
  const statusLabel = { within:'Within range', ahead:'AHEAD of range', significantly_ahead:'SIGNIFICANTLY AHEAD' }[entry.status] || 'Within range';
  const row = `| ${name} | ${month}m benchmark | ${statusLabel} | ${entry.dateLogged} | ${notes || 'Logged via web dashboard'} |`;
  logContent = logContent.replace('## Achieved Milestones\n\n| Milestone', `## Achieved Milestones\n\n| Milestone`)
    .replace(/(\| Milestone.*\n\|[-| ]+\n)/, `$1${row}\n`);
  wf(logPath, logContent);

  res.json({ success: true, entry });
});

// Delete a milestone achievement
app.delete('/api/milestone-achievements/:id', (req, res) => {
  const data    = rj(ACHIEVEMENTS_PATH) || [];
  const updated = data.filter(a => a.id !== req.params.id);
  wj(ACHIEVEMENTS_PATH, updated);
  res.json({ success: true });
});

// Milestone master data (static)
app.get('/api/milestones-data', (req, res) => {
  const age = getSaahitiAge();
  res.json({ milestones: MILESTONES_DATA, age });
});

// Progress stats
app.get('/api/progress', (req, res) => {
  const content  = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'));
  const foods    = [];
  for (const line of content.split('\n')) {
    if (line.startsWith('|') && !line.includes('Food') && !line.includes('---')) {
      const parts = line.split('|').map(x => x.trim()).filter(Boolean);
      if (parts[0]) foods.push({ name: parts[0], slot: parts[1] || '', date: parts[2] || '' });
    }
  }

  const achievements = rj(ACHIEVEMENTS_PATH) || [];

  const profile = loadProfile();
  const rawStart = profile.solidsStartedAt || '2026-04-19';
  const solidsStart   = new Date(rawStart);
  const daysSinceSolids = Math.floor((Date.now() - solidsStart) / 86400000);
  const slotIds = profile.slots.map(s => s.id);

  const reactions = { Loved:0, Liked:0, Neutral:0, Disliked:0 };
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const log = rj(path.join(LOGS_DIR, `${d.toISOString().split('T')[0]}.json`));
    if (!log) continue;
    slotIds.forEach(slot => {
      const r = log.meals?.[slot]?.reaction;
      if (r && reactions[r] !== undefined) reactions[r]++;
    });
  }

  res.json({
    foodCount: foods.length,
    foods,
    milestoneCount: achievements.length,
    daysSinceSolids,
    reactions,
    age: getBabyAge(profile),
  });
});

// ── Foods summary ─────────────────────────────────────────────────────────────

app.get('/api/foods-summary', (req, res) => {
  const profile = loadProfile();
  const slotIds = profile.slots.map(s => s.id);
  const map = {}; // lowercase food name → { name, reactions: {Loved,Liked,Neutral,Disliked} }

  // Scan all daily log files
  let files = [];
  try { files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.json')); } catch {}

  for (const file of files) {
    const log = rj(path.join(LOGS_DIR, file));
    if (!log) continue;
    for (const slotId of slotIds) {
      const meal = log.meals?.[slotId];
      if (!meal?.food) continue;
      const key  = meal.food.toLowerCase().trim();
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

// ── Growth tracking ───────────────────────────────────────────────────────────

app.get('/api/growth-curves', (req, res) => {
  res.json(WHO_GIRLS);
});

app.get('/api/growth', (req, res) => {
  res.json(loadGrowth());
});

app.post('/api/growth', (req, res) => {
  const { date, heightCm, weightKg } = req.body;
  if (!date || heightCm == null || weightKg == null)
    return res.status(400).json({ error: 'date, heightCm, weightKg required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const data = loadGrowth();
  const entry = { id: `g_${Date.now()}`, date, heightCm: Number(heightCm), weightKg: Number(weightKg) };
  data.push(entry);
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveGrowth(data);
  res.json({ ok: true, entry });
});

app.patch('/api/growth/:id', (req, res) => {
  const { date, heightCm, weightKg } = req.body;
  const data = loadGrowth();
  const entry = data.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    entry.date = date;
  }
  if (heightCm !== undefined) entry.heightCm = Number(heightCm);
  if (weightKg !== undefined) entry.weightKg = Number(weightKg);
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveGrowth(data);
  res.json({ ok: true, entry });
});

app.delete('/api/growth/:id', (req, res) => {
  const data = loadGrowth();
  const updated = data.filter(e => e.id !== req.params.id);
  if (updated.length === data.length) return res.status(404).json({ error: 'not found' });
  saveGrowth(updated);
  res.json({ ok: true });
});

// ── Appointments ──────────────────────────────────────────────────────────────

app.get('/api/appointments', (req, res) => {
  res.json(loadAppointments());
});

app.post('/api/appointments', (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const data = loadAppointments();
  const appt = { id: `appt_${Date.now()}`, date, height: null, weight: null, questions: [] };
  data.push(appt);
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveAppointments(data);
  res.json({ ok: true, appointment: appt });
});

app.patch('/api/appointments/:id', (req, res) => {
  const { date, height, weight } = req.body;
  const data = loadAppointments();
  const appt = data.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  if (date   !== undefined) appt.date   = date;
  if (height !== undefined) appt.height = height;
  if (weight !== undefined) appt.weight = weight;
  data.sort((a, b) => a.date.localeCompare(b.date));
  saveAppointments(data);
  res.json({ ok: true, appointment: appt });
});

// Convenience: add question to the next upcoming appointment
app.post('/api/appointments/next/questions', (req, res) => {
  const { text, source = 'chat' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const data = loadAppointments();
  const appt = nextAppointment(data);
  if (!appt) return res.status(404).json({ error: 'no_next_appointment' });
  const q = { id: `q_${Date.now()}`, text, timestamp: new Date().toISOString(), source, answered: false, answer: '' };
  appt.questions.push(q);
  saveAppointments(data);
  res.json({ ok: true, question: q, appointmentId: appt.id });
});

app.post('/api/appointments/:id/questions', (req, res) => {
  const { text, source = 'manual' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const data = loadAppointments();
  const appt = data.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  const q = { id: `q_${Date.now()}`, text, timestamp: new Date().toISOString(), source, answered: false, answer: '' };
  appt.questions.push(q);
  saveAppointments(data);
  res.json({ ok: true, question: q });
});

app.patch('/api/appointments/:id/questions/:qid', (req, res) => {
  const { text, answered, answer } = req.body;
  const data = loadAppointments();
  const appt = data.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  const q = appt.questions.find(q => q.id === req.params.qid);
  if (!q) return res.status(404).json({ error: 'question not found' });
  if (text     !== undefined) q.text     = text;
  if (answered !== undefined) q.answered = answered;
  if (answer   !== undefined) q.answer   = answer;
  saveAppointments(data);
  res.json({ ok: true, question: q });
});

app.delete('/api/appointments/:id/questions/:qid', (req, res) => {
  const data = loadAppointments();
  const appt = data.find(a => a.id === req.params.id);
  if (!appt) return res.status(404).json({ error: 'not found' });
  appt.questions = appt.questions.filter(q => q.id !== req.params.qid);
  saveAppointments(data);
  res.json({ ok: true });
});

app.post('/api/appointments/:id/questions/:qid/move', (req, res) => {
  const data  = loadAppointments();
  const today = tod();
  const from  = data.find(a => a.id === req.params.id);
  if (!from) return res.status(404).json({ error: 'not found' });
  const q = from.questions.find(q => q.id === req.params.qid);
  if (!q) return res.status(404).json({ error: 'question not found' });
  // Find next upcoming appointment that is NOT this one
  const to = data.find(a => a.date >= today && a.id !== req.params.id);
  if (!to) return res.status(404).json({ error: 'no_next_appointment' });
  from.questions = from.questions.filter(x => x.id !== req.params.qid);
  to.questions.push({ ...q, timestamp: new Date().toISOString() });
  saveAppointments(data);
  res.json({ ok: true });
});

// ── Week plan generation helper ───────────────────────────────────────────────
async function generateWeekPlan(month, week, profile) {
  const age  = getBabyAge(profile);
  const pr   = pronouns(profile);

  const slotLabelMap = { snack1: profile.slots[0]?.label || 'Snack 1', lunch: profile.slots[1]?.label || 'Lunch', snack2: profile.slots[2]?.label || 'Snack 2' };
  const roadmap  = loadRoadmap() || [];
  const heroFoods = roadmap.filter(r => r.month === month && r.week === week);
  const heroText  = heroFoods.length
    ? heroFoods.map(r => `- ${r.food} (${slotLabelMap[r.slot] || r.slot}): ${r.tip}`).join('\n')
    : '- Rotate previously-liked foods with minor variations';

  const foodsTried  = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md')) || 'None yet.';
  const preferences = rf(path.join(GORDON_DIR, 'PREFERENCES.md')) || 'None yet.';

  const dietMap = {
    'vegetarian':     'strict vegetarian, no eggs/meat/fish',
    'eggetarian':     'eggetarian — eggs ok, no meat/fish',
    'pescatarian':    'pescatarian — fish and eggs ok, no meat',
    'non-vegetarian': 'non-vegetarian, include eggs/chicken/fish when age-appropriate',
  };
  const dietNote = dietMap[profile.dietary] || profile.dietary;
  const slotsDesc = profile.slots.map(s => `"${s.id}" (${s.label} at ${s.time})`).join(', ');

  const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const dayTemplate = dayNames.map(d =>
    `{"day":"${d}","meals":{${profile.slots.map(s => `"${s.id}":{"food":"...","recipe":"..."}`).join(',')}}}`
  ).join(',\n');

  const prompt = `You are Gordon, an expert Indian infant nutrition consultant. You are helping parents plan a full week of meals for ${profile.name} (${age.months} months ${age.days} days old, ${pr.pos} pronouns). Family is ${dietNote}.

This is Week ${week} of Month ${month} of introducing solids.

HERO FOODS FOR THIS WEEK (introduce or build on these):
${heroText}

FOODS ALREADY TRIED:
${foodsTried}

PREFERENCES (likes/dislikes):
${preferences}

MEAL SLOTS: ${slotsDesc}

RULES:
- Each recipe max 2 sentences. Practical, Indian home kitchen style.
- Vary the preparation each day — not the same recipe repeated.
- If a slot has no hero food, use a previously-tried food the baby likes.
- No salt, sugar, honey, or whole nuts. Ghee and mild spices (cumin, turmeric, ajwain) are fine.
- Only include foods appropriate for ${age.months} months old.
- Diet: ${dietNote}

Return ONLY valid JSON — no markdown fences, no explanation:
{"days":[
${dayTemplate}
]}`;

  const result = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2500, temperature: 0.3,
  });
  let raw = result.choices[0].message.content.trim()
    .replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
  const plan = JSON.parse(raw);

  // Persist to WEEK-PLANS.json
  const plans = rj(WEEK_PLANS_PATH) || {};
  plans[`${month}-${week}`] = plan;
  wj(WEEK_PLANS_PATH, plans);

  console.log(`[week-plan] Generated and cached month=${month} week=${week}`);
  return plan;
}

// Overlay SCHEDULED-MEALS on top of a week plan (mutates a deep-cloned copy)
function overlayScheduled(plan, month, week, profile) {
  const scheduled = rj(SCHEDULED_PATH) || {};
  const dob = new Date(profile.dob + 'T00:00:00');
  const anchor = new Date(dob);
  anchor.setMonth(anchor.getMonth() + month);
  anchor.setDate(anchor.getDate() + (week - 1) * 7);
  const dow = anchor.getDay();
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - (dow === 0 ? 6 : dow - 1));

  const result = JSON.parse(JSON.stringify(plan)); // deep clone
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  result.days.forEach((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = localDate(d);
    const schedDay = scheduled[dateStr];
    if (!schedDay) return;
    for (const [slot, meal] of Object.entries(schedDay)) {
      if (!result.days[i].meals[slot]) result.days[i].meals[slot] = {};
      result.days[i].meals[slot].food     = meal.food;
      result.days[i].meals[slot].recipe   = meal.recipe || '';
      result.days[i].meals[slot].scheduled = true;
    }
  });
  return result;
}

// POST /api/week-plan — serve cached or generate
app.post('/api/week-plan', async (req, res) => {
  const { month, week } = req.body;
  const profile = loadProfile();
  let plan = (rj(WEEK_PLANS_PATH) || {})[`${month}-${week}`];
  if (!plan) {
    try { plan = await generateWeekPlan(month, week, profile); }
    catch(e) { return res.status(500).json({ error: e.message }); }
  }
  res.json(overlayScheduled(plan, month, week, profile));
});

// GET /api/week-plan/:month/:week — return cached plan or generate on demand
app.get('/api/week-plan/:month/:week', async (req, res) => {
  const month = parseInt(req.params.month);
  const week  = parseInt(req.params.week);
  const profile = loadProfile();
  let plan = (rj(WEEK_PLANS_PATH) || {})[`${month}-${week}`];
  if (!plan) {
    try { plan = await generateWeekPlan(month, week, profile); }
    catch(e) { return res.status(500).json({ error: e.message }); }
  }
  res.json(overlayScheduled(plan, month, week, profile));
});

// ── Profile & Settings ────────────────────────────────────────────────────────

app.get('/api/profile', (req, res) => {
  const p = loadProfile();
  res.json({ name: p.name, dob: p.dob, gender: p.gender, slots: p.slots });
});

app.post('/api/profile', (req, res) => {
  const { name, dob, gender, dietary, slots, solidsStarted, foodsIntroduced, exposureDays, activeIntros } = req.body;
  if (!name?.trim() || !dob || !gender || !dietary || !slots?.length)
    return res.status(400).json({ error: 'Missing required fields' });

  const existingIds = [];
  const processedSlots = slots.map(s => {
    const id = s.id || slugify(s.label, existingIds);
    existingIds.push(id);
    return { id, label: s.label.trim(), time: s.time || '12:00' };
  });

  const profile = {
    name: name.trim(), dob, gender, dietary,
    slots: processedSlots,
    exposureDays: Number(exposureDays) || 5,
    solidsStartedAt: solidsStarted === 'yes' ? new Date().toISOString().split('T')[0] : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  wj(PROFILE_PATH, profile);

  // Write FOODS-TRIED.md if onboarding provided food history
  const tried   = Array.isArray(foodsIntroduced) ? foodsIntroduced.filter(Boolean) : [];
  const actives = Array.isArray(activeIntros)    ? activeIntros.filter(a => a.food?.trim()) : [];
  if (tried.length || actives.length) {
    writeFoodsTriedFromOnboarding(profile, tried, actives);
  }

  // Clear roadmap and week plans so they regenerate for the new baby's profile
  try { fs.unlinkSync(ROADMAP_PATH); } catch {}
  try { fs.unlinkSync(WEEK_PLANS_PATH); } catch {}
  res.json({ success: true, profile });

  // Async: generate roadmap then current week plan so Plans tab loads instantly
  setImmediate(async () => {
    try {
      if (!fs.existsSync(ROADMAP_PATH)) await generateRoadmap(profile);
      const age   = getBabyAge(profile);
      const month = Math.max(6, Math.min(12, age.months));
      const week  = Math.min(4, Math.floor(age.days / 7) + 1);
      await generateWeekPlan(month, week, profile);
      console.log(`[onboarding] Week plan pre-generated for month ${month} week ${week}`);
    } catch(e) { console.error('[onboarding] async plan generation failed:', e.message); }
  });
});

app.put('/api/settings', (req, res) => {
  const { dietary, slots } = req.body;
  if (!dietary || !slots?.length)
    return res.status(400).json({ error: 'Missing dietary or slots' });

  const current = loadProfile();
  const existingIds = current.slots.map(s => s.id);
  const newIds = [];

  const processedSlots = slots.map(s => {
    // Preserve existing ID if provided, else generate new slug
    let id = s.id && existingIds.includes(s.id) ? s.id : slugify(s.label, newIds);
    newIds.push(id);
    return { id, label: s.label.trim(), time: s.time || '12:00' };
  });

  // Warn about removed slots
  const removed = existingIds.filter(id => !newIds.includes(id));
  if (removed.length) console.warn(`[settings] Slots removed from profile: ${removed.join(', ')} — historical log data preserved`);

  const updated = { ...current, dietary, slots: processedSlots, updatedAt: new Date().toISOString() };
  wj(PROFILE_PATH, updated);

  // Invalidate roadmap cache if dietary preference changed
  if (dietary !== current.dietary) {
    try { fs.unlinkSync(ROADMAP_PATH); } catch {}
    console.log(`[settings] Dietary changed ${current.dietary} → ${dietary}. Roadmap cache cleared.`);
  }

  res.json({ success: true, profile: updated });
});

app.listen(3001, () => {
  const p = loadProfile();
  console.log(`🍼 ${p.name}'s Firsts → http://localhost:3001`);
});
