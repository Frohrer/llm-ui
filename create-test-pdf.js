// Create a simple PDF file for testing
import fs from 'fs';
import path from 'path';
import officegen from 'officegen';

// Make sure uploads directory exists
const documentsDir = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(documentsDir)) {
  fs.mkdirSync(documentsDir, { recursive: true });
  console.log(`Created directory: ${documentsDir}`);
}

// Create a text file first (since we can't easily create PDFs directly)
const textFilePath = path.join(documentsDir, 'test-content.txt');
const pdfFilePath = path.join(documentsDir, 'test-document.pdf');

try {
  // Create a test text file
  fs.writeFileSync(textFilePath, `
Test Document for PDF Extraction
================================

This is a test document to verify if our PDF extraction function is working properly.

Key features to test:
1. Basic text extraction
2. Line breaks
3. Special characters: àéêöç
4. Numbers: 12345
5. Formatted text: *bold* _italic_

End of test document.
`);
  
  console.log(`Created test text file at: ${textFilePath}`);
  console.log(`Due to limitations in our environment, we can't easily create a PDF directly.`);
  console.log(`Please use the text file for testing or upload a real PDF file.`);
} catch (error) {
  console.error('Error creating test files:', error);
}