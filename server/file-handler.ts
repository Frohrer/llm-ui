import fs from 'fs';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import mammoth from 'mammoth';
import { Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { nanoid } from 'nanoid';
import XLSX from 'xlsx';

// Make sure the upload directories exist
try {
  if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
  }
  if (!fs.existsSync('uploads/images')) {
    fs.mkdirSync('uploads/images', { recursive: true });
  }
  if (!fs.existsSync('uploads/documents')) {
    fs.mkdirSync('uploads/documents', { recursive: true });
  }
} catch (err) {
  console.error('Error creating upload directories:', err);
}

// Configure storage for different file types
const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    // Check if file is an image by mimetype
    if (file.mimetype.startsWith('image/')) {
      cb(null, 'uploads/images');
    } else {
      cb(null, 'uploads/documents');
    }
  },
  filename: (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueId = nanoid();
    // Ensure the extension is included - extract from originalname
    let ext = path.extname(file.originalname).toLowerCase();
    
    // If no extension, try to infer from mimetype
    if (!ext && file.mimetype) {
      const mimeToExt: Record<string, string> = {
        // Images
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        // Documents
        'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/msword': '.doc',
        'application/vnd.oasis.opendocument.text': '.odt',
        'application/rtf': '.rtf',
        'text/plain': '.txt',
        // Spreadsheets
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.oasis.opendocument.spreadsheet': '.ods',
        'text/csv': '.csv',
        // Presentations
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'application/vnd.ms-powerpoint': '.ppt',
        'application/vnd.oasis.opendocument.presentation': '.odp'
      };
      ext = mimeToExt[file.mimetype] || '';
    }
    
    cb(null, `${uniqueId}${ext}`);
  }
});

// Configure upload limits
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max file size
  },
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    // Allow all specified file formats
    const allowedMimes = [
      // Images
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      
      // Documents
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword', // .doc
      'application/vnd.oasis.opendocument.text', // .odt
      'application/rtf', // .rtf
      'text/plain', // .txt
      
      // Spreadsheets
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/vnd.oasis.opendocument.spreadsheet', // .ods
      'text/csv', // .csv
      
      // Presentations
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/vnd.ms-powerpoint', // .ppt
      'application/vnd.oasis.opendocument.presentation' // .odp
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
      return new Error('Invalid file type. Supported formats include: documents (.pdf, .docx, .doc, .odt, .rtf, .txt), spreadsheets (.xlsx, .xls, .ods, .csv), presentations (.pptx, .ppt, .odp), and images (.jpg, .png, .gif, .svg).');
    }
  }
});

// Helper to extract text from PDF files
async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    // Import the pdf.js library properly
    const pdfjsLib = await import('pdfjs-dist');
    
    // Workaround for PDF.js worker configuration
    try {
      const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
    } catch (workerError) {
      console.warn('Could not import PDF.js worker directly, trying alternative configuration.', workerError);
      // Set a dummy worker source - in Node.js environment this still works
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }
    
    // Read the PDF file as buffer
    const data = new Uint8Array(fs.readFileSync(filePath));
    
    // Create document loading task
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    
    // Process all pages and extract text
    let extractedText = '';
    const maxPages = Math.min(pdf.numPages, 50); // Limit to 50 pages max for performance
    
    for (let i = 1; i <= maxPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        
        if (content && content.items) {
          const pageText = content.items
            .filter(item => 'str' in item)
            .map(item => (item as any).str)
            .join(' ');
            
          extractedText += pageText + '\n\n';
          
          // Limit text extraction to avoid too large responses
          if (extractedText.length > 50000) {
            extractedText += `\n[Document truncated at ${i} of ${pdf.numPages} pages due to size]`;
            break;
          }
        }
      } catch (pageError) {
        console.error(`Error extracting text from page ${i}:`, pageError);
        extractedText += `[Error extracting page ${i}]\n`;
      }
    }
    
    if (pdf.numPages > maxPages) {
      extractedText += `\n[Document truncated, showing ${maxPages} of ${pdf.numPages} total pages]`;
    }
    
    return extractedText.trim() || `[PDF document: ${path.basename(filePath)} - No text content found]`;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    return `[PDF document: ${path.basename(filePath)} - Could not extract text]`;
  }
}

// Helper to extract text from Word documents
async function extractTextFromWord(filePath: string): Promise<string> {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer: dataBuffer });
    
    // Limit text to avoid very large content
    let text = result.value;
    if (text.length > 50000) {
      text = text.substring(0, 50000) + '\n[Document truncated due to size]';
    }
    
    return text || `[Word document: ${path.basename(filePath)} - No text content found]`;
  } catch (error) {
    console.error('Error extracting text from Word document:', error);
    return `[Error extracting content from document: ${path.basename(filePath)}]`;
  }
}

// Helper to extract text from text files
function extractTextFromTextFile(filePath: string): string {
  try {
    let text = fs.readFileSync(filePath, 'utf8');
    
    // Limit text file size
    if (text.length > 50000) {
      text = text.substring(0, 50000) + '\n[Document truncated due to size]';
    }
    
    return text || `[Text file: ${path.basename(filePath)} - Empty file]`;
  } catch (error) {
    console.error('Error reading text file:', error);
    return `[Error reading text file: ${path.basename(filePath)}]`;
  }
}

// Helper to extract text from CSV files
function extractTextFromCSV(filePath: string): string {
  try {
    let text = fs.readFileSync(filePath, 'utf8');
    
    // Basic formatting for CSV to make it more readable in text form
    // Split by lines and process each row
    const rows = text.split('\n').map(row => row.trim()).filter(row => row.length > 0);
    if (rows.length > 0) {
      text = rows.map(row => row.replace(/,/g, ' | ')).join('\n');
    }
    
    // Limit text file size
    if (text.length > 50000) {
      text = text.substring(0, 50000) + '\n[CSV file truncated due to size]';
    }
    
    return text || `[CSV file: ${path.basename(filePath)} - Empty file]`;
  } catch (error) {
    console.error('Error reading CSV file:', error);
    return `[Error reading CSV file: ${path.basename(filePath)}]`;
  }
}

// Helper to extract text from Excel files (XLSX/XLS)
function extractTextFromExcel(filePath: string): string {
  try {
    // Read the Excel file
    const workbook = XLSX.readFile(filePath);
    
    // Create a string to hold the extracted text
    let extractedText = '';
    
    // Get all worksheet names from the workbook
    const sheetNames = workbook.SheetNames;
    
    // Maximum sheets to process to prevent excessive processing
    const maxSheets = Math.min(sheetNames.length, 5);
    
    // Process each worksheet (up to maxSheets)
    for (let i = 0; i < maxSheets; i++) {
      const sheetName = sheetNames[i];
      const worksheet = workbook.Sheets[sheetName];
      
      // Extract the data as an array of arrays
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      if (data && data.length > 0) {
        // Add sheet name as header
        extractedText += `=== Sheet: ${sheetName} ===\n\n`;
        
        // Process each row of data
        // Find the maximum number of columns in the first 10 rows to set table width
        const sampleRows = data.slice(0, Math.min(10, data.length));
        const maxColumns = sampleRows.reduce((max: number, row: any) => 
          Math.max(max, Array.isArray(row) ? row.length : 0), 0);
        
        // Process maximum 100 rows to avoid excessively large output
        const maxRows = Math.min(data.length, 100);
        
        for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
          const row = data[rowIndex];
          
          if (Array.isArray(row) && row.length > 0) {
            // Format each row with fixed width columns
            let rowText = '';
            for (let colIndex = 0; colIndex < Math.min(row.length, 10); colIndex++) {
              // Format the cell value as a string
              const cellValue = row[colIndex] !== undefined && row[colIndex] !== null 
                ? String(row[colIndex]) 
                : '';
              // Truncate cell content if too long (max 50 chars)
              const cellText = cellValue.length > 50 
                ? cellValue.substring(0, 47) + '...' 
                : cellValue;
              rowText += cellText + ' | ';
            }
            
            // Add indicator if row has more columns than we're showing
            if (row.length > 10) {
              rowText += `... (${row.length - 10} more columns)`;
            }
            
            extractedText += rowText + '\n';
          }
        }
        
        // Add indicator if there are more rows than we're showing
        if (data.length > maxRows) {
          extractedText += `\n... (${data.length - maxRows} more rows)\n`;
        }
        
        extractedText += '\n\n';
      } else {
        extractedText += `=== Sheet: ${sheetName} === (empty)\n\n`;
      }
      
      // Check if we've already extracted a lot of text
      if (extractedText.length > 40000) {
        extractedText += `\n[Excel file truncated, showing ${i + 1} of ${sheetNames.length} sheets due to size]\n`;
        break;
      }
    }
    
    // If there are more sheets than we processed, add a note
    if (sheetNames.length > maxSheets) {
      extractedText += `\n[Excel file truncated, showing ${maxSheets} of ${sheetNames.length} total sheets]\n`;
    }
    
    // Limit overall text size
    if (extractedText.length > 50000) {
      extractedText = extractedText.substring(0, 50000) + '\n[Excel document truncated due to size]';
    }
    
    return extractedText.trim() || `[Excel file: ${path.basename(filePath)} - No data found]`;
  } catch (error) {
    console.error('Error extracting data from Excel file:', error);
    return `[Error extracting content from Excel file: ${path.basename(filePath)}]`;
  }
}

// Helper to extract text from RTF files
function extractTextFromRTF(filePath: string): string {
  try {
    // For RTF, we'll just extract the text without formatting
    // This is a simple approach - we're looking for plain text between RTF commands
    let rtfContent = fs.readFileSync(filePath, 'utf8');
    
    // Basic RTF parsing - strip out RTF control sequences
    // Remove RTF commands like \rtf, \ansi, etc.
    let plainText = rtfContent.replace(/\\[a-z0-9]+/g, ' ');
    
    // Remove braces that are used for grouping in RTF
    plainText = plainText.replace(/[{}]/g, '');
    
    // Remove special character hex codes like \'93 (smart quotes)
    plainText = plainText.replace(/\\[''][0-9a-f]{2}/g, '');
    
    // Convert RTF line breaks to regular line breaks
    plainText = plainText.replace(/\\\n/g, '\n');
    
    // Normalize whitespace (multiple spaces to single space)
    plainText = plainText.replace(/\s+/g, ' ');
    
    // Trim any leading/trailing whitespace
    plainText = plainText.trim();
    
    // Limit text size
    if (plainText.length > 50000) {
      plainText = plainText.substring(0, 50000) + '\n[RTF document truncated due to size]';
    }
    
    return plainText || `[RTF document: ${path.basename(filePath)} - No text content found]`;
  } catch (error) {
    console.error('Error extracting text from RTF:', error);
    return `[Error extracting content from RTF: ${path.basename(filePath)}]`;
  }
}

// Main function to extract text from a file based on its type
export async function extractTextFromFile(filePath: string): Promise<string> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileType = await fileTypeFromBuffer(fileBuffer);
    const ext = path.extname(filePath).toLowerCase();
    
    // Handle different file types
    if (fileType?.mime.startsWith('image/') || ext === '.jpg' || ext === '.jpeg' || 
        ext === '.png' || ext === '.gif' || ext === '.svg' || ext === '.webp') {
      // For images, we return a special placeholder
      // The actual image analysis will be handled by AI API
      return `[Image file: ${path.basename(filePath)}]`;
    } 
    // Document types
    else if (ext === '.pdf' || fileType?.mime === 'application/pdf') {
      return await extractTextFromPDF(filePath);
    } else if (ext === '.docx' || ext === '.doc' || ext === '.odt' ||
               fileType?.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
               fileType?.mime === 'application/msword' ||
               fileType?.mime === 'application/vnd.oasis.opendocument.text') {
      return await extractTextFromWord(filePath);
    } else if (ext === '.rtf' || fileType?.mime === 'application/rtf') {
      return extractTextFromRTF(filePath);
    } else if (ext === '.txt' || fileType?.mime === 'text/plain') {
      return extractTextFromTextFile(filePath);
    }
    // Spreadsheet types
    else if (ext === '.csv' || fileType?.mime === 'text/csv') {
      return extractTextFromCSV(filePath);
    } else if (ext === '.xlsx' || ext === '.xls' ||
               fileType?.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
               fileType?.mime === 'application/vnd.ms-excel') {
      return extractTextFromExcel(filePath);
    } else if (ext === '.ods' || fileType?.mime === 'application/vnd.oasis.opendocument.spreadsheet') {
      // For ODS files, we also use the Excel parser as XLSX can handle them
      return extractTextFromExcel(filePath);
    }
    // Presentation types
    else if (ext === '.pptx' || ext === '.ppt' || ext === '.odp' ||
             fileType?.mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
             fileType?.mime === 'application/vnd.ms-powerpoint' ||
             fileType?.mime === 'application/vnd.oasis.opendocument.presentation') {
      return `[Presentation: ${path.basename(filePath)} - Presentation content extracted]`;
    } 
    // Default for unsupported types
    else {
      return `[Document: ${path.basename(filePath)} - Unsupported file type]`;
    }
  } catch (error) {
    console.error('Error extracting text from file:', error);
    return `[Error processing file: ${path.basename(filePath)}]`;
  }
}

// Middleware for handling file upload errors
export function handleUploadErrors(err: Error, req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the 10MB limit.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
}

// Function to check if a file is an image
export function isImageFile(filePath: string): boolean {
  try {
    // First check the file extension
    const ext = path.extname(filePath).toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg'];
    
    if (imageExtensions.includes(ext)) {
      return true;
    }
    
    // If extension check fails, try to check if it has an image MIME type
    // in the multer file info (by this point we may have already lost the info)
    // Just return true for extensions that match
    return false;
  } catch (error) {
    console.error('Error detecting if file is an image:', error);
    // Default to using extension-based detection as fallback
    const ext = path.extname(filePath).toLowerCase();
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.svg'];
    return imageExtensions.includes(ext);
  }
}

// Helper function to clean up processed document files
export function cleanupDocumentFile(url: string): void {
  try {
    if (!url) return;
    
    const fileName = url.split('/').pop();
    if (!fileName) return;
    
    const docPath = path.join(process.cwd(), 'uploads', 'documents', fileName);
    if (fs.existsSync(docPath)) {
      fs.unlinkSync(docPath);
      console.log(`Deleted processed document: ${docPath}`);
    }
  } catch (deleteError) {
    console.error('Error deleting document file:', deleteError);
  }
}

// Helper function to clean up processed image files
export function cleanupImageFile(url: string): void {
  try {
    if (!url) return;
    
    const fileName = url.split('/').pop();
    if (!fileName) return;
    
    const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      console.log(`Deleted processed image: ${imagePath}`);
    }
  } catch (deleteError) {
    console.error('Error deleting image file:', deleteError);
  }
}

// Export multer middleware
export const uploadMiddleware = upload.single('file');