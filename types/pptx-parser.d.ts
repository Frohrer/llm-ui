declare module 'pptx-parser' {
  export function parseAsync(data: Buffer | Uint8Array): Promise<{
    coreProperties?: {
      title?: string;
      creator?: string;
      description?: string;
      lastModifiedBy?: string;
      created?: string;
      modified?: string;
      category?: string;
      contentStatus?: string;
    };
    slides: Array<{
      title?: string;
      texts: Array<{
        text: string;
        type?: string;
        style?: any;
      }>;
      images?: Array<{
        type: string;
        data: Buffer;
      }>;
    }>;
  }>;
}