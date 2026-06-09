import { Bot } from 'grammy';
import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, '..');

const bot = new Bot(process.env.TELEGRAM_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── File helpers ──────────────────────────────────────────────────────────────

function readFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); }
  catch { return ''; }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ── Agent routing ─────────────────────────────────────────────────────────────

function detectAgent(message) {
  const msg = message.toLowerCase();

  // Explicit prefix — highest priority
  if (msg.startsWith('gordon')) return 'gordon';
  if (msg.startsWith('meredith')) return 'meredith';
  if (msg.startsWith('bailey')) return 'bailey';

  // Keyword routing
  const foodWords = ['food', 'eat', 'menu', 'feed', 'puree', 'meal', 'recipe',
    'allergen', 'blw', 'solids', 'khichdi', 'ragi', 'fruit', 'vegetable',
    'introduce', 'pear', 'banana', 'carrot', 'avocado', 'sweet potato',
    'beetroot', 'mango', 'apple', 'paneer', 'dahi', 'ghee', 'dal'];

  const milestoneWords = ['milestone', 'crawl', 'stand', 'roll', 'babble',
    'talk', 'walk', 'sit', 'grasp', 'motor', 'development', 'skill',
    'she did', 'she can', 'she learned', 'she now', 'rolling', 'standing',
    'sitting', 'clapping', 'waving', 'pointing'];

  const doctorWords = ['doctor', 'appointment', 'question', 'visit',
    'pediatrician', 'worried', 'concern', 'spot', 'rash', 'symptom',
    'june 10', 'add question', 'add:', 'ask doctor', 'fever', 'sick',
    'vomit', 'diarrhea', 'constipat', 'eye', 'ear', 'nose', 'throat'];

  if (foodWords.some(w => msg.includes(w))) return 'gordon';
  if (milestoneWords.some(w => msg.includes(w))) return 'meredith';
  if (doctorWords.some(w => msg.includes(w))) return 'bailey';

  // Default to Gordon (most frequent use case)
  return 'gordon';
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(agent) {
  const agentDir = path.join(WORKSPACE, 'agents', agent);
  const today = todayStr();
  const yesterday = yesterdayStr();

  const soul      = readFile(path.join(agentDir, 'SOUL.md'));
  const agentsMd  = readFile(path.join(agentDir, 'AGENTS.md'));
  const rootRules = readFile(path.join(WORKSPACE, 'AGENTS.md'));
  const saahiti   = readFile(path.join(WORKSPACE, 'SAAHITI.md'));
  const todayLog  = readFile(path.join(WORKSPACE, 'logs', `${today}.md`));
  const yestLog   = readFile(path.join(WORKSPACE, 'logs', `${yesterday}.md`));

  let agentFiles = '';

  if (agent === 'gordon') {
    agentFiles =
      '### FOODS-TRIED.md\n' + readFile(path.join(agentDir, 'FOODS-TRIED.md')) +
      '\n\n### FOODS-AVOIDED.md\n' + readFile(path.join(agentDir, 'FOODS-AVOIDED.md'));
  }

  if (agent === 'meredith') {
    agentFiles =
      '### MILESTONE-LOG.md\n' + readFile(path.join(agentDir, 'MILESTONE-LOG.md')) +
      '\n\n### MILESTONE-MASTER.md\n' + readFile(path.join(agentDir, 'MILESTONE-MASTER.md'));
  }

  if (agent === 'bailey') {
    agentFiles =
      '### QUESTIONS-QUEUE.md\n' + readFile(path.join(agentDir, 'QUESTIONS-QUEUE.md')) +
      '\n\n### VISIT-LOG.md\n' + readFile(path.join(agentDir, 'VISIT-LOG.md')) +
      '\n\n### Meredith MILESTONE-LOG.md\n' + readFile(path.join(WORKSPACE, 'agents', 'meredith', 'MILESTONE-LOG.md')) +
      '\n\n### Gordon FOODS-TRIED.md\n' + readFile(path.join(WORKSPACE, 'agents', 'gordon', 'FOODS-TRIED.md'));
  }

  return `You are ${agent.charAt(0).toUpperCase() + agent.slice(1)}, an AI agent helping Soumya and Abhinav parent their infant daughter Saahiti (DOB: 2025-11-05). Today is ${today}.

${soul}

--- ROOT BEHAVIOR RULES ---
${rootRules}

--- YOUR BEHAVIOR RULES ---
${agentsMd}

--- SAAHITI PROFILE ---
${saahiti}

--- TODAY'S LOG (${today}) ---
${todayLog || 'No entries yet today.'}

--- YESTERDAY'S LOG (${yesterday}) ---
${yestLog || 'No entries.'}

--- YOUR FILES ---
${agentFiles}

=== TELEGRAM RESPONSE RULES ===
- Telegram chat interface. Keep responses SHORT and scannable.
- Use HTML formatting ONLY — no markdown asterisks, no tables (Telegram ignores them).
- HTML tags available: <b>bold</b>, <i>italic</i>, <u>underline</u>, <code>code</code>
- Use bullet points with • character for lists.
- For menus: one day per block, emoji-led, no tables.
- When you update a file, confirm in 1 line: "📝 Logged X to Y"
- If you need to update a file, end your response with this EXACT format (no HTML inside):
<file_update path="agents/${agent}/FILENAME.md">
[complete new file contents here]
</file_update>
- file_update blocks are stripped before sending to Telegram — safe to include.
- Only emit file_update when content genuinely changed.
- NEVER diagnose medical conditions. Always flag for pediatrician.
- NEVER make up information not in your files.`;
}

// ── File update parser ────────────────────────────────────────────────────────

function applyFileUpdates(responseText) {
  const regex = /<file_update path="([^"]+)">([\s\S]*?)<\/file_update>/g;
  let match;
  const updated = [];

  while ((match = regex.exec(responseText)) !== null) {
    const relPath = match[1];
    const content = match[2].trim();
    const absPath = path.join(WORKSPACE, relPath);

    try {
      writeFile(absPath, content);
      updated.push(relPath);
      console.log(`[FILE] Updated: ${relPath}`);
    } catch (e) {
      console.error(`[FILE] Failed to write ${absPath}:`, e.message);
    }
  }

  const clean = responseText
    .replace(/<file_update[\s\S]*?<\/file_update>/g, '')
    .trim();

  return { clean, updated };
}

// ── Message handler ───────────────────────────────────────────────────────────

bot.on('message:text', async (ctx) => {
  const message = ctx.message.text;
  const senderName = ctx.message.from.first_name || 'Parent';

  // Skip bot commands
  if (message.startsWith('/')) return;

  const agent = detectAgent(message);
  const emoji = { gordon: '🍳', meredith: '📊', bailey: '📋' }[agent];
  const title = agent.charAt(0).toUpperCase() + agent.slice(1);

  console.log(`[MSG] ${senderName}: "${message}" → routed to ${title}`);

  try {
    await ctx.replyWithChatAction('typing');

    const systemPrompt = buildSystemPrompt(agent);

    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Message from ${senderName}: ${message}` }
      ],
      max_tokens: 1024,
    });

    const rawText = result.choices[0].message.content;
    const { clean, updated } = applyFileUpdates(rawText);

    let reply = `${emoji} <b>${title}:</b>\n\n${clean}`;

    if (updated.length > 0) {
      reply += `\n\n<i>📝 Updated: ${updated.map(p => path.basename(p)).join(', ')}</i>`;
    }

    await ctx.reply(reply, { parse_mode: 'HTML' });

  } catch (error) {
    console.error('[ERROR]', error.message);
    await ctx.reply(
      `Something went wrong. Check the terminal.\n<code>${error.message}</code>`,
      { parse_mode: 'HTML' }
    );
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

bot.start({
  onStart: () => console.log('✅ Nibble bot running. Waiting for messages...'),
});
