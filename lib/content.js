'use strict';
// Loads demo content from disk on each request, so content files can be
// swapped without restarting. Only files inside this repo are ever read.
const fs = require('fs');
const path = require('path');
const { DemoError } = require('../public/shared/errors.js');
const { estimateTokens } = require('../public/shared/cost.js');

const ROOT = path.resolve(__dirname, '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge');

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    throw new DemoError('content', 'cannot read ' + rel);
  }
}

function readJSON(rel) {
  const text = readText(rel);
  try {
    return JSON.parse(text);
  } catch {
    throw new DemoError('content', 'invalid JSON in ' + rel);
  }
}

function loadPage(category, rel) {
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(KNOWLEDGE_DIR + path.sep)) {
    throw new DemoError('content', 'knowledge file outside knowledge/: ' + rel);
  }
  const text = readText(path.relative(ROOT, abs));
  const heading = text.match(/^#\s+(.+)$/m);
  return { category: category.id, title: heading ? heading[1].trim() : path.basename(rel), text };
}

function readOptionalJSON(rel) {
  return fs.existsSync(path.join(ROOT, rel)) ? readJSON(rel) : null;
}

function loadContent() {
  const demo = readJSON('config/demo.json');
  const pricing = readJSON('config/pricing.json');
  const knowledge = readJSON('config/knowledge_center.json');
  const conflicts = readJSON('conflicts.json');
  const campaigns = readJSON('data/demo_campaigns.json');
  const getStarted = readJSON('config/get_started.json');
  const atScale = readOptionalJSON('config/at_scale.json');
  const before = readText('prompts/prompt_before_cleanup.md');
  const after = readText('prompts/prompt_after_cleanup.md');

  const categories = (knowledge.categories || []).map((c) => {
    const pages = (c.files || []).map((f) => loadPage(c, f));
    return { ...c, pages, sentTokens: pages.reduce((n, p) => n + estimateTokens(p.text), 0) };
  });

  const placeholders = [];
  const flag = (obj, name) => { if (obj && obj.placeholder) placeholders.push(name); };
  flag(demo, 'config/demo.json');
  flag(knowledge, 'config/knowledge_center.json');
  flag(conflicts, 'conflicts.json');
  flag(campaigns, 'data/demo_campaigns.json');
  if (/^PLACEHOLDER/m.test(before)) placeholders.push('prompts/prompt_before_cleanup.md');
  if (/^PLACEHOLDER/m.test(after)) placeholders.push('prompts/prompt_after_cleanup.md');

  return {
    demo,
    pricing,
    knowledge: { ...knowledge, categories },
    conflicts,
    campaigns,
    campaignText: JSON.stringify(campaigns.campaigns || campaigns, null, 1),
    getStarted,
    atScale,
    prompts: { before, after },
    placeholders,
  };
}

module.exports = { loadContent, ROOT };
