#!/usr/bin/env node

// coreline-mcp — stdio-to-HTTP bridge for the Core Line MCP server.
// Reads JSON-RPC from stdin, proxies to the hosted endpoint, writes responses to stdout.

const https = require('https');
const { URL } = require('url');

const ENDPOINT = 'https://api.coreline.app/mcp';
const API_KEY = process.env.CORELINE_API_KEY;

if (!API_KEY) {
  process.stderr.write(
    'Error: CORELINE_API_KEY environment variable is not set.\n\n' +
    'Get your API key from https://app.coreline.app and set it:\n' +
    '  export CORELINE_API_KEY=cl_your_key_here\n\n' +
    'Or configure it in your AI client\'s MCP settings.\n'
  );
  process.exit(1);
}

let sessionId = null;
const pending = [];
let stdinEnded = false;

function postMessage(body) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENDPOINT);
    const payload = JSON.stringify(body);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${API_KEY}`,
    };
    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers,
    };

    const req = https.request(options, (res) => {
      const newSessionId = res.headers['mcp-session-id'];
      if (newSessionId) {
        sessionId = newSessionId;
      }

      // 2xx with no content is fine (e.g. accepted notifications)
      if (res.statusCode === 202 || res.statusCode === 204) {
        res.resume();
        resolve([]);
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        });
        return;
      }

      const contentType = res.headers['content-type'] || '';

      if (contentType.includes('text/event-stream')) {
        let buffer = '';
        const messages = [];

        res.on('data', (chunk) => {
          buffer += chunk.toString();
          let idx;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            let eventData = null;
            for (const line of block.split('\n')) {
              if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              }
            }
            if (eventData) {
              try { messages.push(JSON.parse(eventData)); } catch (_) {}
            }
          }
        });

        res.on('end', () => {
          if (buffer.trim()) {
            let eventData = null;
            for (const line of buffer.split('\n')) {
              if (line.startsWith('data: ')) {
                eventData = line.slice(6);
              }
            }
            if (eventData) {
              try { messages.push(JSON.parse(eventData)); } catch (_) {}
            }
          }
          resolve(messages);
        });

      } else {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (!data.trim()) {
            resolve([]);
            return;
          }
          try {
            resolve([JSON.parse(data)]);
          } catch (_) {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      }
    });

    req.on('error', (err) => reject(err));
    req.end(payload);
  });
}

async function sendWithRetry(message) {
  try {
    return await postMessage(message);
  } catch (err) {
    process.stderr.write(`Retrying after error: ${err.message}\n`);
    return await postMessage(message);
  }
}

function writeError(id, code, message) {
  // Only write error responses for requests (that have an id)
  if (id === undefined || id === null) return;
  const err = {
    jsonrpc: '2.0',
    id: id,
    error: { code, message },
  };
  process.stdout.write(JSON.stringify(err) + '\n');
}

function maybeExit() {
  if (stdinEnded && pending.length === 0) {
    process.exit(0);
  }
}

async function handleMessage(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (_) {
    writeError(null, -32700, 'Parse error');
    return;
  }

  const isNotification = !('id' in msg);

  try {
    const responses = await sendWithRetry(msg);
    for (const response of responses) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err) {
    if (isNotification) {
      // Notifications don't get responses in JSON-RPC. Just log.
      process.stderr.write(`Notification proxy error (ignored): ${err.message}\n`);
    } else {
      process.stderr.write(`Error proxying request: ${err.message}\n`);
      writeError(msg.id, -32603, `Bridge error: ${err.message}`);
    }
  }
}

function enqueue(line) {
  const p = handleMessage(line).finally(() => {
    pending.splice(pending.indexOf(p), 1);
    maybeExit();
  });
  pending.push(p);
}

let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) enqueue(line);
  }
});

process.stdin.on('end', () => {
  const line = buffer.trim();
  if (line) enqueue(line);
  stdinEnded = true;
  maybeExit();
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
