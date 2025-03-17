import fs from 'fs';

// Read the routes file
const fileName = 'server/routes.ts';
const fileContent = fs.readFileSync(fileName, 'utf8').split('\n');

// Update Anthropic document handling (around line 573)
let anthropicLine = -1;
for (let i = 570; i < 580; i++) {
  if (fileContent[i].includes("} else if (attachment && attachment.type === 'document' && attachment.text)")) {
    anthropicLine = i;
    break;
  }
}

if (anthropicLine > 0) {
  const endOfBlock = anthropicLine + 3;
  fileContent.splice(endOfBlock, 0, '        ', '        // Clean up the document file', '        if (attachment.url) {', '          cleanupDocumentFile(attachment.url);', '        }');
}

// Update DeepSeek document handling (around line 829)
let deepseekLine = -1;
for (let i = 825; i < 835; i++) {
  if (fileContent[i].includes("} else if (attachment && attachment.type === 'document' && attachment.text)")) {
    deepseekLine = i;
    break;
  }
}

if (deepseekLine > 0) {
  const endOfBlock = deepseekLine + 3;
  fileContent.splice(endOfBlock, 0, '        ', '        // Clean up the document file', '        if (attachment.url) {', '          cleanupDocumentFile(attachment.url);', '        }');
}

// Save the file
fs.writeFileSync(fileName, fileContent.join('\n'));
console.log('Document cleanup added for Anthropic and DeepSeek');
