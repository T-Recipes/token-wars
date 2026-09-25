'use strict';
// Rehearsal mode (terminal only, no on-screen indicator): a stand-in fetch that imitates the Messages API, including
// prompt-cache accounting. Makes no network calls and needs no key.
const crypto = require('crypto');
const { estimateTokens } = require('../public/shared/cost.js');

function createMockFetch({ pricing, latencyMs = [500, 1100] } = {}) {
  const cache = new Map(); // hash -> expiry

  return async function mockFetch(url, init) {
    const body = JSON.parse(init.body);
    const question = String(body.messages[0].content || '');
    const signal = init.signal;

    await new Promise((resolve, reject) => {
      if (/simulate timeout/i.test(question)) {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        return;
      }
      const [lo, hi] = latencyMs;
      setTimeout(resolve, lo + Math.random() * (hi - lo));
    });

    if (/simulate error/i.test(question)) {
      return response(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    }

    const model = pricing.models[body.model] || {};
    const min = model.minCacheableTokens || 1024;
    const blocks = body.system || [];
    const now = Date.now();

    let cumulative = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let covered = 0;
    const prefix = [];
    for (const b of blocks) {
      prefix.push(b.text);
      cumulative += estimateTokens(b.text);
      if (!b.cache_control || cumulative < min) continue;
      const key = crypto.createHash('sha256').update(body.model + '\u0000' + prefix.join('\u0000')).digest('hex');
      const hit = cache.get(key);
      if (hit && hit > now) {
        cacheRead = cumulative;
        cacheWrite = 0;
      } else {
        cacheWrite = cumulative - cacheRead;
      }
      cache.set(key, now + 5 * 60 * 1000);
      covered = cumulative;
    }
    const total = cumulative + estimateTokens(question) + 8;
    const input = total - covered;

    const answer = body.max_tokens <= 16 ? 'OK' : cannedAnswer(question);
    // Higher effort means more (hidden) thinking, which is billed as output.
    const effort = (body.output_config && body.output_config.effort) || 'low';
    const thinking = body.max_tokens <= 16 ? 0 : Math.round(estimateTokens(answer) * ({ low: 0, medium: 1.5, high: 4 }[effort] || 0));

    return response(200, {
      id: 'msg_mock',
      type: 'message',
      role: 'assistant',
      model: body.model,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: answer }],
      usage: {
        input_tokens: input,
        output_tokens: estimateTokens(answer) + thinking,
        cache_creation_input_tokens: cacheWrite,
        cache_read_input_tokens: cacheRead,
      },
    });
  };
}

// Offline rehearsal answers, written to match data/demo_campaigns.json. Nothing
// here is shown as a label; the terminal banner is the only rehearsal indicator.
const CANNED = [
  [/complet|finish|watch/i,
    'Summer Fizz for Fernhollow Sparkling Water led on completion at 94%, because its 30-second spot ran mostly on a premium streaming app where viewers rarely skip. Open Road for Kestrel Motors spent the most, $281,200, but finished at only 72%, so a large share of that spend is at risk. Move part of the Open Road budget into the Summer Fizz placements. Should I pull the numbers behind this?'],
  [/thousand|cpm|overpay|price|paying/i,
    'Glow Daily for Solstice Skincare is paying the most at a $41.00 CPM, with Open Road for Kestrel Motors close behind at $38.00, compared with a $29.25 average across all ten campaigns. Both lean on the same premium streaming app, which is the priciest inventory in the plan. Test shifting a slice of each to the news and lifestyle channels, which deliver at $22 to $26. Should I pull the numbers behind this?'],
  [/repeat|frequency|same ad|household|many times/i,
    'Level Up for Pixelnest Games is showing its ad 7.5 times per household, and Peace of Mind for Brightwell Insurance is at 6.0, both well above the healthy range of 3 to 5. At that level recall stops improving, so extra impressions add cost without adding impact. Cap frequency on both and use the savings to reach new households. Should I pull the numbers behind this?'],
  [/budget|move|shift|spend|ten percent|10%/i,
    'Move the ten percent, about $117,000, out of Open Road for Kestrel Motors and Level Up for Pixelnest Games, which combine high cost or heavy repetition with the weakest completion rates. Put it into Summer Fizz and Make It Yours, which finish above 90% at moderate prices. You give up some reach on the two cut campaigns this quarter, but those impressions are already the least effective in the plan. Should I pull the numbers behind this?'],
];

function cannedAnswer(question) {
  const hit = CANNED.find(([re]) => re.test(question));
  if (hit) return hit[1];
  return 'Across the ten campaigns, Summer Fizz for Fernhollow Sparkling Water is the standout, finishing 94% of views at a $28.50 CPM. Open Road for Kestrel Motors is the one to watch, with the largest budget at $281,200 and one of the lowest completion rates at 72%. Start by reviewing where Open Road runs before adding more spend. Should I pull the numbers behind this?';
}

function response(status, json) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  };
}

module.exports = { createMockFetch };
