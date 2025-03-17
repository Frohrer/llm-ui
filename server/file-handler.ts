import fs from 'fs';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import mammoth from 'mammoth';
import { Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { nanoid } from 'nanoid';

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
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'application/pdf': '.pdf',
        'text/plain': '.txt'
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
    // Allow images, PDFs, Word documents, and text files
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
      return new Error('Invalid file type. Only images, PDFs, Word documents, and text files are allowed.');
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

// Main function to extract text from a file based on its type
export async function extractTextFromFile(filePath: string): Promise<string> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileType = await fileTypeFromBuffer(fileBuffer);
    const ext = path.extname(filePath).toLowerCase();
    
    // Handle different file types
    if (fileType?.mime.startsWith('image/')) {
      // For images, we return a special placeholder
      // The actual image analysis will be handled by AI API
      return `[Image file: ${path.basename(filePath)}]`;
    } else if (ext === '.pdf' || fileType?.mime === 'application/pdf') {
      return await extractTextFromPDF(filePath);
    } else if (ext === '.docx' || ext === '.doc' || 
               fileType?.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
               fileType?.mime === 'application/msword') {
      return await extractTextFromWord(filePath);
    } else if (ext === '.txt' || fileType?.mime === 'text/plain') {
      return extractTextFromTextFile(filePath);
    } else {
      return 'Unsupported file type';
    }
  } catch (error) {
    console.error('Error extracting text from file:', error);
    return 'Error processing file';
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
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
    
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
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'];
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