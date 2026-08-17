export type Gear = 'P' | 'R' | 'N' | 'D';
export type WeatherMode = 'clear' | 'cloudy' | 'rain' | 'sunset';

export interface Controls {
  steer: number;       // -1 .. 1 (positive = right)
  throttle: number;    // 0..1
  brake: number;       // 0..1
  gear: Gear;
  engineOn: boolean;
  handbrake: boolean;
  indicatorLeft: boolean;
  indicatorRight: boolean;
  hazards: boolean;
  headlights: 0 | 1 | 2; // off / low / high
  horn: boolean;
  lookX: number;   // -1..1 look left/right
  lookY: number;   // -1..1 look up/down
  wipers: boolean;
}

export function defaultControls(): Controls {
  return {
    steer: 0, throttle: 0, brake: 0, gear: 'P', engineOn: false, handbrake: true,
    indicatorLeft: false, indicatorRight: false, hazards: false, headlights: 0,
    horn: false, lookX: 0, lookY: 0, wipers: false,
  };
}

export interface Infraction {
  id: string;
  time: number;
  title: string;
  detail: string;
  penalty: number;
}

export interface Telemetry {
  speed: number;         // km/h
  rpm: number;
  gear: Gear;
  engineOn: boolean;
  handbrake: boolean;
  score: number;
  lessonIndex: number;
  lessonTitle: string;
  lessonStep: string;
  lessonHint: string;
  lessonProgress: number;   // 0..1
  lessons: number;
  speedLimit: number;
  laneStatus: 'ok' | 'wrong' | 'offroad' | 'center';
  distanceToTarget: number;
  targetBearing: number;    // radians relative to car heading
  hasTarget: boolean;
  infractions: Infraction[];
  toast: string | null;
  toastKind: 'good' | 'bad' | 'info';
  lightAhead: 'green' | 'yellow' | 'red' | null;
  lightDistance: number;
  indicatorLeft: boolean;
  indicatorRight: boolean;
  hazards: boolean;
  headlights: 0 | 1 | 2;
  wipers: boolean;
  completed: boolean;
  finalReport: string[] | null;
  odometer: number;
  timeOfDay: 'day' | 'dusk';
  weather: WeatherMode;
}
