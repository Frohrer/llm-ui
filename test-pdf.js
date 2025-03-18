// Create a test PDF file for extraction testing
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Make sure uploads directory exists
const documentsDir = path.join(process.cwd(), 'uploads', 'documents');
if (!fs.existsSync(documentsDir)) {
  fs.mkdirSync(documentsDir, { recursive: true });
  console.log(`Created directory: ${documentsDir}`);
}

// Create a PDF file
const pdfPath = path.join(documentsDir, 'test-document.pdf');
console.log(`Creating PDF at: ${pdfPath}`);

// Create a document
const doc = new PDFDocument();

// Pipe its output to a file
const stream = fs.createWriteStream(pdfPath);
doc.pipe(stream);

// Add content to the PDF
doc.fontSize(25).text('Testing PDF Extraction', {
  align: 'center'
});

doc.moveDown();
doc.fontSize(14).text('This is a test PDF document created with PDFKit.');
doc.moveDown();

doc.fontSize(12).text('This document tests our PDF extraction functionality with the following features:');
doc.moveDown(0.5);
doc.list([
  'Basic text extraction', 
  'Multiline text content',
  'Formatted text with different font sizes',
  'Special characters: é è ç à ö',
  'Numbers and symbols: 12345 !@#$%'
]);

doc.moveDown();
doc.text('The PDF extraction functionality should handle this content correctly.');

// Finalize PDF file
doc.end();

// Event handling for stream completion
stream.on('finish', () => {
  console.log('PDF has been created successfully.');
  console.log('Running text extraction test...');
  
  // Import our test function
  import('./test-pdf-extraction-helper.js')
    .then(module => {
      if (module.default) {
        module.default(pdfPath);
      } else {
        console.log('Module loaded but no default export found.');
      }
    })
    .catch(err => {
      console.error('Error importing test module:', err);
    });
});

stream.on('error', (err) => {
  console.error('Error writing PDF:', err);
});