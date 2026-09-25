// Plain-language error messages for the stage. Never include upstream text,
// request details, or credentials: these strings are projected to an audience.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.TW = root.TW || {}).errors = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MESSAGES = {
    no_key: {
      title: 'Not connected yet',
      message: 'No API key is set up. Add it, then try again.',
    },
    auth: {
      title: 'Key not accepted',
      message: 'The AI service did not accept the API key. Check the key and try again.',
    },
    permission: {
      title: 'Not allowed',
      message: 'This API key is not allowed to use the selected model.',
    },
    not_found: {
      title: 'That AI model is not available',
      message: 'The AI service did not recognise the selected model. Pick a different one.',
    },
    rate_limit: {
      title: 'Too many requests',
      message: 'The AI service asked us to slow down. Wait a few seconds and try again.',
    },
    overloaded: {
      title: 'AI service is busy',
      message: 'The AI service is overloaded right now. Try again in a moment.',
    },
    server: {
      title: 'AI service problem',
      message: 'The AI service had a temporary problem. Try again in a moment.',
    },
    bad_request: {
      title: 'Request not accepted',
      message: 'The AI service rejected the request. Try again, or pick a different model.',
    },
    too_large: {
      title: 'Too much text',
      message: 'The instructions and reference pages are too long for this AI. Try sending only what is needed.',
    },
    timeout: {
      title: 'No answer in time',
      message: 'The AI took too long to answer. Try again.',
    },
    network: {
      title: 'Can\u2019t reach the AI service',
      message: 'Check the internet connection and try again.',
    },
    empty: {
      title: 'No answer came back',
      message: 'The AI ran out of room before it finished. Try again or ask a shorter question.',
    },
    busy: {
      title: 'One moment',
      message: 'A question is already running. Wait for it to finish.',
    },
    content: {
      title: 'Something is missing',
      message: 'Part of this page could not be loaded. Check the files and restart Token Wars.',
    },
    input: {
      title: 'Missing question',
      message: 'Type or pick a question first.',
    },
    unknown: {
      title: 'Something went wrong',
      message: 'That did not work. Try again.',
    },
  };

  function friendly(kind) {
    const m = MESSAGES[kind] || MESSAGES.unknown;
    return { kind: MESSAGES[kind] ? kind : 'unknown', title: m.title, message: m.message };
  }

  function classifyStatus(status, errorType) {
    if (status === 401) return 'auth';
    if (status === 403) return 'permission';
    if (status === 404) return 'not_found';
    if (status === 413) return 'too_large';
    if (status === 429) return 'rate_limit';
    if (status === 529 || errorType === 'overloaded_error') return 'overloaded';
    if (status >= 500) return 'server';
    if (status === 400) return 'bad_request';
    return 'unknown';
  }

  class DemoError extends Error {
    constructor(kind, detail) {
      super(friendly(kind).message);
      this.name = 'DemoError';
      this.kind = friendly(kind).kind;
      // Internal diagnostic only (already redacted by the caller); never shown on stage.
      this.detail = detail || '';
    }
  }

  return { friendly, classifyStatus, DemoError, MESSAGES };
});
