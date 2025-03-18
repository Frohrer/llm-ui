// Test script for PDF extraction
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testPdfExtraction() {
  try {
    console.log('Testing PDF extraction...');
    
    // Import the pdf.js library with correct namespace
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
    
    console.log('PDF.js library imported successfully');
    
    // Configure the worker with proper error handling
    try {
      console.log('Configuring PDF.js worker...');
      // Check if GlobalWorkerOptions exists
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.js';
        console.log('PDF.js worker configured successfully');
      } else {
        // If there's no GlobalWorkerOptions, try to access it through the default export
        if (pdfjsLib.default && pdfjsLib.default.GlobalWorkerOptions) {
          pdfjsLib.default.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.js';
          console.log('PDF.js worker configured through default export');
        } else {
          console.warn('Could not find GlobalWorkerOptions in PDF.js library');
        }
      }
    } catch (workerError) {
      console.warn('Error configuring PDF.js worker:', workerError);
    }
    
    // Check if uploads directory exists and create if needed
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const imagesDir = path.join(uploadsDir, 'images');
    const documentsDir = path.join(uploadsDir, 'documents');
    
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log(`Created directory: ${uploadsDir}`);
    }
    
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
      console.log(`Created directory: ${imagesDir}`);
    }
    
    if (!fs.existsSync(documentsDir)) {
      fs.mkdirSync(documentsDir, { recursive: true });
      console.log(`Created directory: ${documentsDir}`);
    }
    
    // List PDF files in uploads directory if any
    if (fs.existsSync(documentsDir)) {
      console.log('Checking for existing PDF files...');
      const files = fs.readdirSync(documentsDir);
      const pdfFiles = files.filter(file => file.toLowerCase().endsWith('.pdf'));
      
      if (pdfFiles.length > 0) {
        console.log(`Found ${pdfFiles.length} PDF files: ${pdfFiles.join(', ')}`);
        
        // Try to process the first PDF file
        const pdfPath = path.join(documentsDir, pdfFiles[0]);
        console.log(`Attempting to extract text from: ${pdfPath}`);
        
        try {
          // Read PDF file
          const data = new Uint8Array(fs.readFileSync(pdfPath));
          console.log(`Successfully read PDF file of size: ${data.length} bytes`);
          
          // Process the PDF
          console.log('Creating PDF document loading task...');
          const loadingTask = pdfjsLib.getDocument({ data });
          console.log('Waiting for PDF to load...');
          const pdf = await loadingTask.promise;
          console.log(`PDF loaded successfully with ${pdf.numPages} pages`);
          
          // Extract text from first page
          console.log('Getting page 1...');
          const page = await pdf.getPage(1);
          console.log('Getting text content...');
          const content = await page.getTextContent();
          
          if (content && content.items) {
            const pageText = content.items
              .filter(item => 'str' in item)
              .map(item => item.str)
              .join(' ');
              
            console.log('Successfully extracted text:');
            console.log('----------------------------');
            console.log(pageText);
            console.log('----------------------------');
          } else {
            console.log('No text content found in the PDF');
          }
        } catch (pdfError) {
          console.error('Error processing PDF:', pdfError);
        }
      } else {
        console.log('No PDF files found in the documents directory');
      }
    }
    
    console.log('PDF extraction test completed');
  } catch (error) {
    console.error('Error in PDF extraction test:', error);
  }
}

// Run the test
testPdfExtraction().catch(console.error);