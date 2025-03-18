// Test PDF extraction function
console.log('Testing PDF extraction...');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import testPdfExtraction from './test-pdf-extraction-helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPdfTest() {
  try {
    // Check for existing PDF files in the uploads/documents directory
    const documentsDir = path.join(process.cwd(), 'uploads', 'documents');
    
    if (!fs.existsSync(documentsDir)) {
      console.log(`Documents directory does not exist at: ${documentsDir}`);
      fs.mkdirSync(documentsDir, { recursive: true });
      console.log(`Created documents directory`);
      console.log('No PDF files exist yet, try running test-pdf.js first');
      return;
    }
    
    // Look for PDF files
    const files = fs.readdirSync(documentsDir);
    const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
    
    if (pdfFiles.length === 0) {
      console.log('No PDF files found in the documents directory');
      console.log('Run test-pdf.js to create a test PDF file first');
      return;
    }
    
    // Test the first PDF file found
    const pdfPath = path.join(documentsDir, pdfFiles[0]);
    console.log(`Found PDF file: ${pdfPath}`);
    
    // Run the extraction test
    await testPdfExtraction(pdfPath);
    
  } catch (error) {
    console.error('Error running PDF test:', error);
  }
}

// Run the test
await runPdfTest();
console.log('PDF extraction test completed');