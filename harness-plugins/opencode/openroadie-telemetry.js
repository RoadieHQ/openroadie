// OpenCode telemetry plugin for openroadie.
// Posts session events to the telemetry endpoint so the audit log
// shows prompts, model, and tool context.
//
// Install: copy this file into .opencode/plugins/ (project) or
// ~/.config/opencode/plugins/ (global). Files load automatically at startup.
//
// The OPENROADIE_URL env var (or the url below) must point to the
// openroadie instance, e.g. "https://portal.example.com".

const TELEMETRY_ENDPOINT =
  (process.env.OPENROADIE_URL ?? 'http://localhost:7008') +
  '/api/mcp/session-telemetry/opencode';

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => typeof p === 'string' || p.type === 'text')
      .map(p => (typeof p === 'string' ? p : p.text))
      .join('\n');
  }
  return undefined;
}

function sid(event) {
  return (
    event.session_id ||
    event.sessionID ||
    event.properties?.session_id ||
    event.properties?.sessionID
  );
}

function extractModel(m) {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') return m.modelID || m.model || m.id;
  return undefined;
}

async function sendEvent(type, data) {
  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: type, ...data }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Silent failure — telemetry must never break the session.
  }
}

// Session/message events go through a single "event" handler (opencode >= 1.15).
// Tool hooks remain as direct top-level keys.
export const OpenroadieTelemetry = async _ctx => {
  let sessionModel;
  const userMsgMeta = new Map();

  return {
    event: async ({ event }) => {
      const type = event.type;
      const sessionId = sid(event);
      const props = event.properties || {};

      const rawModel =
        props.model || event.model || props.info?.model || props.session?.model;
      const model = extractModel(rawModel);
      if (model) sessionModel = model;

      if (type === 'session.created' && sessionId) {
        await sendEvent('session.created', {
          sessionId,
          model: model || sessionModel,
        });
      } else if (type === 'session.updated' && sessionId) {
        await sendEvent('session.created', {
          sessionId,
          model: model || sessionModel,
        });
      } else if (type === 'session.deleted' && sessionId) {
        await sendEvent('session.deleted', { sessionId });
      } else if (type === 'session.idle' && sessionId) {
        await sendEvent('session.idle', { sessionId });
      } else if (type === 'message.updated') {
        const info = props.info || {};
        if (info.role === 'user') {
          const msgSid = info.sessionID || info.session_id || sessionId;
          const m = extractModel(info.model) || model || sessionModel;
          const text = extractText(info.content);
          if (text && msgSid) {
            await sendEvent('message.updated', {
              sessionId: msgSid,
              messageId: info.id,
              model: m,
              user_prompt: text,
            });
          } else if (msgSid && info.id) {
            userMsgMeta.set(info.id, { sessionId: msgSid, model: m });
          }
        }
      } else if (type === 'message.part.updated') {
        const part = props.part || {};
        const meta = userMsgMeta.get(part.messageID);
        if (meta) {
          const text = extractText(part.text ?? part.content);
          if (text) {
            userMsgMeta.delete(part.messageID);
            await sendEvent('message.updated', {
              sessionId: meta.sessionId,
              messageId: part.messageID,
              model: meta.model,
              user_prompt: text,
            });
          }
        }
      }
    },

    'tool.execute.before': async input => {
      const sessionId = input.sessionID || input.session_id;
      if (sessionId) {
        await sendEvent('tool.execute.before', {
          sessionId,
          toolName: input.tool,
        });
      }
    },

    'tool.execute.after': async input => {
      const sessionId = input.sessionID || input.session_id;
      if (sessionId) {
        await sendEvent('tool.execute.after', {
          sessionId,
          toolName: input.tool,
        });
      }
    },
  };
};
