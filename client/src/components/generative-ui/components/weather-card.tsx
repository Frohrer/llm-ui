import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cloud, Sun, CloudRain, CloudSnow, Wind, Droplets, Thermometer } from "lucide-react";

interface WeatherCardProps {
  location: string;
  temperature: number;
  condition: 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'windy' | 'partly-cloudy';
  humidity?: number;
  windSpeed?: number;
  feelsLike?: number;
  high?: number;
  low?: number;
  unit?: 'C' | 'F';
}

const conditionIcons = {
  'sunny': Sun,
  'cloudy': Cloud,
  'rainy': CloudRain,
  'snowy': CloudSnow,
  'windy': Wind,
  'partly-cloudy': Cloud,
};

const conditionColors = {
  'sunny': 'from-amber-400 to-orange-500',
  'cloudy': 'from-slate-400 to-slate-600',
  'rainy': 'from-blue-400 to-blue-600',
  'snowy': 'from-cyan-200 to-blue-300',
  'windy': 'from-teal-400 to-cyan-500',
  'partly-cloudy': 'from-blue-300 to-slate-400',
};

export function WeatherCard({
  location,
  temperature,
  condition,
  humidity,
  windSpeed,
  feelsLike,
  high,
  low,
  unit = 'F'
}: WeatherCardProps) {
  const Icon = conditionIcons[condition] || Cloud;
  const gradientClass = conditionColors[condition] || conditionColors['cloudy'];
  
  return (
    <Card className={`overflow-hidden bg-gradient-to-br ${gradientClass} text-white shadow-xl`}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="text-lg font-medium opacity-90">{location}</span>
          <Icon className="h-8 w-8 opacity-80" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-5xl font-bold tracking-tight">
              {temperature}°{unit}
            </div>
            <div className="mt-1 text-sm capitalize opacity-80">
              {condition.replace('-', ' ')}
            </div>
          </div>
          
          <div className="space-y-2 text-right text-sm">
            {feelsLike !== undefined && (
              <div className="flex items-center justify-end gap-1 opacity-80">
                <Thermometer className="h-4 w-4" />
                <span>Feels {feelsLike}°{unit}</span>
              </div>
            )}
            {humidity !== undefined && (
              <div className="flex items-center justify-end gap-1 opacity-80">
                <Droplets className="h-4 w-4" />
                <span>{humidity}%</span>
              </div>
            )}
            {windSpeed !== undefined && (
              <div className="flex items-center justify-end gap-1 opacity-80">
                <Wind className="h-4 w-4" />
                <span>{windSpeed} mph</span>
              </div>
            )}
          </div>
        </div>
        
        {(high !== undefined || low !== undefined) && (
          <div className="mt-4 flex justify-center gap-6 border-t border-white/20 pt-3">
            {high !== undefined && (
              <div className="text-center">
                <div className="text-xs opacity-70">High</div>
                <div className="text-lg font-semibold">{high}°</div>
              </div>
            )}
            {low !== undefined && (
              <div className="text-center">
                <div className="text-xs opacity-70">Low</div>
                <div className="text-lg font-semibold">{low}°</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

