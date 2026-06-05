import fs from 'fs';
import readline from 'readline';

const logPath = 'C:/Users/dhvnf/.gemini/antigravity/brain/b446bdb6-ad32-48c3-ab6e-e6580e3d7ede/.system_generated/logs/transcript.jsonl';

const rl = readline.createInterface({
  input: fs.createReadStream(logPath),
  output: process.stdout,
  terminal: false
});

let content = '';

rl.on('line', (line) => {
  if (line.includes('"step_index":3378') || line.includes('"step_index": 3378')) {
    const obj = JSON.parse(line);
    content = obj.content || '';
  }
});

rl.on('close', () => {
  const lines = content.split('\n');
  console.log('Total split lines:', lines.length);
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    console.log(`${i}: [${lines[i]}]`);
  }
});
