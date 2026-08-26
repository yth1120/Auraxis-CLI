const readline = require('node:readline');

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  let result;
  if (message.method === 'initialize') {
    result = { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake-mcp', version: '1.0.0' } };
  } else if (message.method === 'tools/list') {
    result = {
      tools: [
        {
          name: 'echo',
          description: 'Echo the given text',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
        },
      ],
    };
  } else if (message.method === 'tools/call') {
    const text = message.params?.arguments?.text || '';
    result = { content: [{ type: 'text', text: `echo ${text}` }] };
  } else {
    result = {};
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
});

