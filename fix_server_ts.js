import fs from 'fs';

const filePath = 'c:/Users/dhvnf/Downloads/동전커피/server.ts';
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split(/\r?\n/);
const targetLine = lines[379]; // 380th line (0-indexed)
console.log('Line 380 content:', targetLine);
console.log('Line 380 char codes:');
if (targetLine) {
  for (let i = 0; i < targetLine.length; i++) {
    console.log(`${targetLine[i]}: ${targetLine.charCodeAt(i)}`);
  }
}
