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

// ── Static Data ───────────────────────────────────────────────────────────────

const FOOD_ROADMAP = [
  // Month 6
  { month:6, week:1, slot:'cs1', food:'Banana', tip:'Mash ripe banana with fork. Mix 2 tbsp breast milk to thin.' },
  { month:6, week:1, slot:'cs2', food:'Sweet Potato', tip:'Steam 12 min, blend smooth. Add 1 tsp ghee for healthy fats.' },
  { month:6, week:2, slot:'cs1', food:'Apple', tip:'Steam 10 min, blend smooth. Tiny pinch of cardamom aids digestion.' },
  { month:6, week:2, slot:'cs2', food:'Carrot', tip:'Steam 15 min, blend silky. Mix with potato for creamier texture.' },
  { month:6, week:3, slot:'cs1', food:'Avocado', tip:'Mash ripe avocado with fork — no cooking. Serve immediately, browns quickly.' },
  { month:6, week:3, slot:'cs2', food:'Pumpkin', tip:'Steam 10 min, blend smooth. Naturally sweet, rich in Vitamin A.' },
  { month:6, week:4, slot:'cs1', food:'Papaya', tip:'Use fully ripe papaya only. Natural enzymes prevent constipation.' },
  { month:6, week:4, slot:'cs2', food:'Green Peas', tip:'Boil, blend, strain through fine mesh. Straining removes skins — essential.' },
  // Month 7
  { month:7, week:1, slot:'lunch', food:'Rice Dal Khichdi', tip:'2 tbsp rice + 1 tbsp moong dal, pressure cook 4 whistles with turmeric, add ghee.' },
  { month:7, week:1, slot:'cs2', food:'Zucchini', tip:'Steam 7 min, blend smooth. Mild flavour, high water content.' },
  { month:7, week:2, slot:'cs1', food:'Ragi', tip:'Mix ragi flour into boiling water, cook 7 min stirring. Exceptional calcium source.' },
  { month:7, week:2, slot:'cs2', food:'Spinach', tip:'Blanch 2 min, blend with boiled potato. Potato balances the strong flavour.' },
  { month:7, week:3, slot:'cs1', food:'Mango', tip:'Fully ripe Alphonso or Kesar only. Blend smooth — no fibrous strings.' },
  { month:7, week:4, slot:'cs1', food:'Oats', tip:'Cook rolled oats 5 min stirring. Blend smooth, thin with breast milk.' },
  { month:7, week:4, slot:'cs2', food:'Broccoli', tip:'Steam 8 min, blend smooth. Mix with potato to soften strong flavour.' },
  // Month 8
  { month:8, week:1, slot:'cs1', food:'Pear', tip:'Steam ripe pear 8 min, blend silky smooth. Easiest fruit to digest.' },
  { month:8, week:2, slot:'cs1', food:'Suji (Semolina)', tip:'Roast in ghee 3 min, cook with water 4 min stirring. No sugar needed.' },
  { month:8, week:3, slot:'cs1', food:'Chikoo (Sapodilla)', tip:'Fully ripe chikoo only — unripe is astringent. Mash smooth.' },
  { month:8, week:4, slot:'cs1', food:'Cauliflower', tip:'Steam 10 min, blend smooth. Mix with potato for creamier texture.' },
  { month:8, week:4, slot:'cs2', food:'Daliya (Broken Wheat)', tip:'Roast 2 min, pressure cook 4 whistles with moong dal. Add ghee.' },
  // Month 9
  { month:9, week:1, slot:'cs1', food:'Paneer', tip:'Fresh unsalted paneer only. Mash or blend with a little warm water.' },
  { month:9, week:1, slot:'cs2', food:'Beetroot', tip:'Boil 20 min, blend smooth. Pink nappies are normal and harmless.' },
  { month:9, week:2, slot:'cs1', food:'Kiwi', tip:'Fully ripe kiwi. Mix with banana to neutralise acidity.' },
  { month:9, week:2, slot:'cs2', food:'Mixed Lentils Dal', tip:'Panchmel dal — 5 lentils pressure cooked. Complete amino acid profile.' },
  { month:9, week:3, slot:'cs1', food:'Poha', tip:'Rinse thin poha, cook 4 min stirring. Iron-rich and easily digestible.' },
  { month:9, week:3, slot:'cs2', food:'Tomato', tip:'Always cook tomatoes to reduce acidity. Mix with potato to mellow.' },
  { month:9, week:4, slot:'cs1', food:'Yogurt (Plain)', tip:'Full-fat plain dahi only. Mix with mango or banana. Serve at room temp.' },
  { month:9, week:4, slot:'cs2', food:'Banana Chunks (Finger Food)', tip:'Cut into 1cm pieces. Must squash easily between your fingers. BLW milestone!' },
  // Month 10
  { month:10, week:1, slot:'cs1', food:'Idli', tip:'Steam mini idlis, break into pieces, serve with soft moong dal.' },
  { month:10, week:1, slot:'cs2', food:'Cheese', tip:'Low-salt full-fat soft mozzarella only. Cut into 1cm cubes for finger food.' },
  { month:10, week:2, slot:'cs1', food:'Strawberry', tip:'Blend smooth. Mix with banana to reduce acidity. No added sugar.' },
  { month:10, week:2, slot:'cs2', food:'Corn', tip:'Blend and strain through fine mesh — corn skins are a choking hazard.' },
  { month:10, week:3, slot:'cs1', food:'Bajra (Pearl Millet)', tip:'Cook bajra flour with water 7 min stirring. Add ghee. Warming and iron-rich.' },
  { month:10, week:4, slot:'cs1', food:'Jowar (Sorghum)', tip:'Cook jowar flour 7-8 min stirring. Gluten-free, very nutritious.' },
  { month:10, week:4, slot:'cs2', food:'Lauki (Bottle Gourd)', tip:'Pressure cook with rice + moong dal 4 whistles. Most cooling vegetable.' },
  // Month 11
  { month:11, week:1, slot:'cs1', food:'Soft Roti / Chapati', tip:'Soft enough to squash between fingers. Tear into 2cm pieces with ghee.' },
  { month:11, week:2, slot:'cs2', food:'Rajma (Kidney Beans)', tip:'Soak overnight, pressure cook 8 whistles. Mash with ghee — complete protein.' },
  // Month 12
  { month:12, week:1, slot:'cs1', food:'Family Food Adaptation', tip:'Set aside family dal/sabzi before adding salt and whole spices.' },
  { month:12, week:2, slot:'cs1', food:'Grapes (Quartered)', tip:'Quarter each grape lengthwise — never offer whole. Serious choking hazard.' },
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

// Multi-agent chat
app.post('/api/chat', async (req, res) => {
  const { agent, question } = req.body;
  const prompts = {
    gordon:   buildGordonPrompt,
    meredith: buildMeredithPrompt,
    bailey:   buildBaileyPrompt,
  };
  const buildPrompt = prompts[agent] || buildGordonPrompt;
  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: buildPrompt() },
        { role: 'user',   content: question }
      ],
      max_tokens: 1024,
    });
    res.json({ response: result.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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

// Parse FOODS-TRIED.md for active 5-day introductions (Pending + exact date)
function getActive5DayIntros() {
  const content = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'));
  const active  = {};
  let currentSlot = '';

  for (const line of content.split('\n')) {
    if      (line.startsWith('## CS1'))   currentSlot = 'cs1';
    else if (line.startsWith('## Lunch')) currentSlot = 'lunch';
    else if (line.startsWith('## CS2'))   currentSlot = 'cs2';

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

    if (dayNum >= 1 && dayNum <= 5) {
      active[currentSlot] = { food, slot: currentSlot, dayNumber: dayNum, daysRemaining: 5 - dayNum, introDate: dateMatch[1] };
    }
  }
  return active;
}

const SCHEDULED_PATH = path.join(GORDON_DIR, 'SCHEDULED-MEALS.json');

// POST /api/schedule-meal — save a chosen variation for a future date
app.post('/api/schedule-meal', (req, res) => {
  const { date, slot, food, dayNumber, daysRemaining } = req.body;
  const data = rj(SCHEDULED_PATH) || {};
  if (!data[date]) data[date] = {};
  data[date][slot] = { food, source: 'scheduled', dayNumber, daysRemaining };
  wj(SCHEDULED_PATH, data);
  res.json({ success: true });
});

// GET /api/today-suggestion — pre-populated menu for Today tab
// Priority: scheduled meal > active 5-day intro > Gordon suggestion
app.get('/api/today-suggestion', async (req, res) => {
  const today   = tod();
  const active  = getActive5DayIntros();
  const sched   = (rj(SCHEDULED_PATH) || {})[today] || {};

  const profile = loadProfile();
  const allSlotIds = profile.slots.map(s => s.id);
  const slotsNeedingGordon = allSlotIds.filter(s => !sched[s] && !active[s]);
  let gordonFoods = {};

  if (slotsNeedingGordon.length > 0) {
    const lines = slotsNeedingGordon.map(s => `${s.toUpperCase()}: [food name]`).join('\n');
    const prompt = `${buildGordonPrompt()}

TODAY'S TASK: Suggest one food for each of these slots only: ${slotsNeedingGordon.map(s=>s.toUpperCase()).join(', ')}.
These slots have no active 5-day introduction. Use RECENT-MEALS and PREFERENCES — no repeats, no dislikes.

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
          // Match back to the canonical slot ID by normalising
          const key = m[1].toLowerCase().replace(/\s/g, '_');
          const matched = slotsNeedingGordon.find(s => s === key || s.toUpperCase() === m[1].toUpperCase());
          if (matched) gordonFoods[matched] = m[2].trim().replace(/^\[|\]$/g,'');
        }
      }
    } catch(e) { console.error('Gordon suggestion error:', e.message); }
  }

  const suggestion = {};
  for (const slot of allSlotIds) {
    if (sched[slot]) {
      suggestion[slot] = sched[slot]; // chosen variation wins
    } else if (active[slot]) {
      suggestion[slot] = { food: active[slot].food, source: '5day', dayNumber: active[slot].dayNumber, daysRemaining: active[slot].daysRemaining };
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

// Food roadmap data (vegetarian, with tried status)
app.get('/api/food-roadmap', (req, res) => {
  const content   = rf(path.join(GORDON_DIR, 'FOODS-TRIED.md'));
  const triedSet  = new Set();
  for (const line of content.split('\n')) {
    if (line.startsWith('|') && !line.includes('Food') && !line.includes('---')) {
      const name = line.split('|')[1]?.trim();
      if (name) triedSet.add(name.toLowerCase());
    }
  }
  const age    = getSaahitiAge();
  const result = FOOD_ROADMAP.map(w => ({
    ...w,
    tried: triedSet.has(w.food.toLowerCase()),
    current: w.month === age.months || (w.month === age.months + 1 && age.days >= 21),
    upcoming: w.month > age.months + 1,
  }));
  res.json({ weeks: result, age });
});

// Milestone achievements
const ACHIEVEMENTS_PATH = path.join(MEREDITH_DIR, 'MILESTONE-ACHIEVEMENTS.json');

app.get('/api/milestone-achievements', (req, res) => {
  res.json(rj(ACHIEVEMENTS_PATH) || []);
});

app.post('/api/milestone-achievements', (req, res) => {
  const { id, name, category, month, status, notes } = req.body;
  const data   = rj(ACHIEVEMENTS_PATH) || [];
  const today  = tod();
  const entry  = { id, name, category, month, status: status || 'within', notes: notes || '', dateLogged: today };
  const idx    = data.findIndex(a => a.id === id);
  if (idx >= 0) data[idx] = entry; else data.push(entry);
  wj(ACHIEVEMENTS_PATH, data);

  // Append to MILESTONE-LOG.md
  const logPath  = path.join(MEREDITH_DIR, 'MILESTONE-LOG.md');
  let logContent = rf(logPath);
  const statusLabel = { within:'Within range', ahead:'AHEAD of range', significantly_ahead:'SIGNIFICANTLY AHEAD' }[entry.status] || 'Within range';
  const row = `| ${name} | ${month}m benchmark | ${statusLabel} | ${today} | ${notes || 'Logged via web dashboard'} |`;
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

// POST /api/week-plan — Gordon generates a full 7-day meal plan for a given month+week
app.post('/api/week-plan', async (req, res) => {
  const { month, week } = req.body;
  const profile = loadProfile();
  const age     = getBabyAge(profile);
  const pr      = pronouns(profile);

  const heroFoods = FOOD_ROADMAP.filter(r => r.month === month && r.week === week);
  const heroText  = heroFoods.length
    ? heroFoods.map(r => `- ${r.food} (${r.slot}): ${r.tip}`).join('\n')
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

  const slotsList = profile.slots.map(s => s.id).join(', ');
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

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2500, temperature: 0.3,
    });
    let raw = result.choices[0].message.content.trim()
      .replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```\s*$/,'').trim();
    const plan = JSON.parse(raw);
    res.json(plan);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Profile & Settings ────────────────────────────────────────────────────────

app.get('/api/profile', (req, res) => {
  const profile = rj(PROFILE_PATH);
  if (!profile) return res.json({ exists: false });
  res.json({ exists: true, profile });
});

app.post('/api/profile', (req, res) => {
  const { name, dob, gender, dietary, slots } = req.body;
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
    solidsStartedAt: new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  wj(PROFILE_PATH, profile);
  res.json({ success: true, profile });
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
  res.json({ success: true, profile: updated });
});

app.listen(3001, () => {
  const p = loadProfile();
  console.log(`🍼 ${p.name}'s Firsts → http://localhost:3001`);
});
