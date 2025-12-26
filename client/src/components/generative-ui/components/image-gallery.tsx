import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageItem {
  url: string;
  alt?: string;
  caption?: string;
}

interface ImageGalleryProps {
  title?: string;
  images: ImageItem[];
  columns?: 2 | 3 | 4;
  aspectRatio?: 'square' | 'video' | 'portrait';
}

const gridCols = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

const aspectRatios = {
  square: 'aspect-square',
  video: 'aspect-video',
  portrait: 'aspect-[3/4]',
};

export function ImageGallery({
  title,
  images,
  columns = 3,
  aspectRatio = 'square'
}: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  
  const openLightbox = (index: number) => setSelectedIndex(index);
  const closeLightbox = () => setSelectedIndex(null);
  
  const goNext = () => {
    if (selectedIndex !== null) {
      setSelectedIndex((selectedIndex + 1) % images.length);
    }
  };
  
  const goPrev = () => {
    if (selectedIndex !== null) {
      setSelectedIndex((selectedIndex - 1 + images.length) % images.length);
    }
  };
  
  return (
    <>
      <Card>
        {title && (
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">{title}</CardTitle>
          </CardHeader>
        )}
        <CardContent className={title ? '' : 'pt-6'}>
          <div className={cn("grid gap-2", gridCols[columns])}>
            {images.map((image, index) => (
              <button
                key={index}
                onClick={() => openLightbox(index)}
                className={cn(
                  "relative overflow-hidden rounded-lg group cursor-pointer",
                  aspectRatios[aspectRatio]
                )}
              >
                <img
                  src={image.url}
                  alt={image.alt || `Image ${index + 1}`}
                  className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                  <Maximize2 className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                {image.caption && (
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
                    <p className="text-white text-xs truncate">{image.caption}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Lightbox */}
      <Dialog open={selectedIndex !== null} onOpenChange={() => closeLightbox()}>
        <DialogContent className="max-w-4xl p-0 bg-black/95 border-none">
          <DialogTitle className="sr-only">
            {selectedIndex !== null ? images[selectedIndex]?.alt || `Image ${selectedIndex + 1}` : 'Image Gallery'}
          </DialogTitle>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 z-10 text-white hover:bg-white/20"
              onClick={closeLightbox}
            >
              <X className="h-5 w-5" />
            </Button>
            
            {images.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-10 text-white hover:bg-white/20"
                  onClick={goPrev}
                >
                  <ChevronLeft className="h-8 w-8" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 z-10 text-white hover:bg-white/20"
                  onClick={goNext}
                >
                  <ChevronRight className="h-8 w-8" />
                </Button>
              </>
            )}
            
            {selectedIndex !== null && (
              <div className="flex flex-col items-center p-4">
                <img
                  src={images[selectedIndex].url}
                  alt={images[selectedIndex].alt || `Image ${selectedIndex + 1}`}
                  className="max-h-[70vh] object-contain"
                />
                {images[selectedIndex].caption && (
                  <p className="mt-4 text-white text-center">
                    {images[selectedIndex].caption}
                  </p>
                )}
                <p className="mt-2 text-white/60 text-sm">
                  {selectedIndex + 1} / {images.length}
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

