import fs from 'fs';

let content = fs.readFileSync('subagent_findings.md', 'utf8');

// If the content is wrapped in quotes, unwrap it
if (content.startsWith('"') && content.endsWith('"')) {
  content = content.slice(1, -1);
}

// Replace literal \n with real newlines, and literal \" with double quotes
content = content.replace(/\\n/g, '\n');
content = content.replace(/\\"/g, '"');
content = content.replace(/\\t/g, '\t');

fs.writeFileSync('subagent_findings.md', content, 'utf8');
console.log('Formatted subagent findings successfully!');
