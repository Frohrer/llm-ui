import fs from 'fs';

// Read the routes file
const fileName = 'server/routes.ts';
const fileContent = fs.readFileSync(fileName, 'utf8');

// Find and replace all instances of manual document cleanup with helper function calls
let updatedContent = fileContent.replace(
  /try {\s+if \(attachment\.url\) {\s+const fileName = attachment\.url\.split\("\/"\)\.pop\(\);\s+if \(fileName\) {\s+const docPath = path\.join\(process\.cwd\(\), "uploads", "documents", fileName\);\s+if \(fs\.existsSync\(docPath\)\) {\s+fs\.unlinkSync\(docPath\);\s+console\.log\(`Deleted processed document: \${docPath}`\);\s+}\s+}\s+}\s+} catch \(deleteError\) {\s+console\.error\("Error deleting document file:", deleteError\);\s+}/g,
  'if (attachment.url) {\n          cleanupDocumentFile(attachment.url);\n        }'
);

// Find and replace any manual image cleanup with helper function calls
updatedContent = updatedContent.replace(
  /try {\s+fs\.unlinkSync\(imagePath\);\s+console\.log\(`Deleted processed image: \${imagePath}`\);\s+} catch \(deleteError\) {\s+console\.error\(`Error deleting processed image \${imagePath}:`, deleteError\);\s+}/g,
  'cleanupImageFile(attachment.url);'
);

// Make sure all document cleanup blocks have apiMessages.push
updatedContent = updatedContent.replace(
  /} else if \(attachment && attachment\.type === 'document' && attachment\.text\) {\s+\/\/ Handle document attachment\s+const userContent = `\${message}\\n\\nDocument content: \${attachment\.text}`;\s+\s+\/\/ Clean up the document file/g,
  "} else if (attachment && attachment.type === 'document' && attachment.text) {\n        // Handle document attachment\n        const userContent = `${message}\\n\\nDocument content: ${attachment.text}`;\n        apiMessages.push({ role: \"user\", content: userContent });\n\n        // Clean up the document file"
);

// Save the file
fs.writeFileSync(fileName, updatedContent);
console.log('Document and image cleanup code standardized across all providers');
