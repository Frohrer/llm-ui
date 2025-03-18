// Helper module for testing PDF extraction
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testPdfExtraction(pdfPath) {
  try {
    console.log(`Testing PDF extraction on: ${pdfPath}`);
    
    // Import the pdf.js library properly using the legacy build for Node.js compatibility
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
    
    console.log('PDF.js library imported successfully');
    
    // Configure the worker with proper error handling
    try {
      console.log('Configuring PDF.js worker...');
      // Check if GlobalWorkerOptions exists
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.js';
        console.log('PDF.js worker configured successfully');
      } else if (pdfjsLib.default && pdfjsLib.default.GlobalWorkerOptions) {
        // If GlobalWorkerOptions is on the default export
        pdfjsLib.default.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.js';
        console.log('PDF.js worker configured through default export');
      } else {
        console.warn('Could not find GlobalWorkerOptions in PDF.js library');
      }
    } catch (workerError) {
      console.warn('Error configuring PDF.js worker:', workerError);
    }
    
    if (!fs.existsSync(pdfPath)) {
      console.error(`PDF file does not exist at path: ${pdfPath}`);
      return;
    }
    
    try {
      // Read PDF file
      const data = new Uint8Array(fs.readFileSync(pdfPath));
      console.log(`Successfully read PDF file of size: ${data.length} bytes`);
      
      // Process the PDF - handle both direct and default exports
      const getDocument = pdfjsLib.getDocument || pdfjsLib.default?.getDocument;
      if (!getDocument) {
        throw new Error('Could not find getDocument function in PDF.js library');
      }
      
      console.log('Creating PDF document loading task...');
      const loadingTask = getDocument({ data });
      console.log('Waiting for PDF to load...');
      const pdf = await loadingTask.promise;
      console.log(`PDF loaded successfully with ${pdf.numPages} pages`);
      
      // Extract text from all pages
      let extractedText = '';
      const maxPages = Math.min(pdf.numPages, 50); // Limit to 50 pages max
      
      for (let i = 1; i <= maxPages; i++) {
        try {
          console.log(`Getting page ${i}...`);
          const page = await pdf.getPage(i);
          console.log(`Getting text content for page ${i}...`);
          const content = await page.getTextContent();
          
          if (content && content.items) {
            const pageText = content.items
              .filter(item => 'str' in item)
              .map(item => item.str)
              .join(' ');
              
            console.log(`Extracted ${pageText.length} characters from page ${i}`);
            extractedText += pageText + '\n\n';
          } else {
            console.log(`No text content found on page ${i}`);
          }
        } catch (pageError) {
          console.error(`Error extracting text from page ${i}:`, pageError);
        }
      }
      
      console.log('\nExtracted Text:');
      console.log('-------------------------------------------');
      console.log(extractedText);
      console.log('-------------------------------------------');
      console.log(`Total extracted text length: ${extractedText.length} characters`);
      
    } catch (pdfError) {
      console.error('Error processing PDF:', pdfError);
    }
    
  } catch (error) {
    console.error('Error in PDF extraction test:', error);
  }
}

export default testPdfExtraction;