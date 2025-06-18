import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { nanoid } from 'nanoid';

// Declare global type for screenshots storage
declare global {
  var screenshots: {
    [key: string]: {
      data: Buffer;
      contentType: string;
      timestamp: number;
      url: string;
    }
  };
}

export const screenshotTool = {
  name: 'take_screenshot',
  description: 'Takes a screenshot of a specified website URL and saves it as an image that can be displayed in the chat',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL of the website to screenshot (must include http:// or https://)',
      }
    },
    required: ['url'],
  },
  execute: async (params: any) => {
    const { 
      url
    } = params;
    
    // Get API key from environment variables
    const apiKey = process.env.SCREENSHOTONE_KEY;
    if (!apiKey) {
      return {
        success: false,
        message: 'SCREENSHOTONE_KEY environment variable is not set',
      };
    }
    
    // Validate URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('URL must start with http:// or https://');
    }
    
    try {
      // Ensure screenshots directory exists
      const screenshotsDir = path.join(process.cwd(), 'uploads', 'screenshots');
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
      }
      
      // Build ScreenshotOne API URL
      const baseUrl = 'https://api.screenshotone.com/take';
      
      // Build URL in the format that works with the API
      const requestUrl = `${baseUrl}?url=${encodeURIComponent(url)}&access_key=${apiKey}&format=jpg&block_cookie_banners=true&block_trackers=true&timeout=60&image_quality=80`;
      
      // Get the screenshot
      const response = await axios({
        method: 'get',
        url: requestUrl,
        responseType: 'arraybuffer'
      });
      
      // Generate a unique ID and filename for this screenshot
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const randomId = nanoid(6);
      const filename = `screenshot-${timestamp}-${randomId}.jpg`;
      const filePath = path.join(screenshotsDir, filename);
      
      // Save the screenshot to file
      fs.writeFileSync(filePath, response.data);
      
      // Generate the URL path for the screenshot
      const relativePath = `/uploads/screenshots/${filename}`;
      
      // Return information about the saved screenshot
      return {
        success: true,
        message: 'Screenshot captured successfully of ' + url,
        imageId: filename,
        contentType: 'image/jpeg',
        filePath: filePath,
        url: relativePath,
        // Add URL for direct markdown use
        markdownImage: `![Screenshot of ${url}](${relativePath})`,
        // Use special image reference format recognized by the UI
        image: {
          type: 'screenshot',
          id: filename,
          url: url
        }
      };
    } catch (error) {
      console.error('Screenshot API error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
}; 