import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudMoonRain,
  CloudRain,
  CloudSnow,
  CloudSun,
  CloudSunRain,
  Droplets,
  Haze,
  Moon,
  Snowflake,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  ThermometerSnowflake,
  ThermometerSun,
  Tornado,
  TriangleAlert,
  Umbrella,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import type { CardIcon } from '../../shared/addons';

/** Icônes des cartes et de l'affichage permanent : une entrée par nom de `cardIcons`. */
const cardIconComponents: Record<CardIcon, LucideIcon> = {
  cloud: Cloud,
  'cloud-drizzle': CloudDrizzle,
  'cloud-fog': CloudFog,
  'cloud-hail': CloudHail,
  'cloud-lightning': CloudLightning,
  'cloud-moon': CloudMoon,
  'cloud-moon-rain': CloudMoonRain,
  'cloud-rain': CloudRain,
  'cloud-snow': CloudSnow,
  'cloud-sun': CloudSun,
  'cloud-sun-rain': CloudSunRain,
  droplets: Droplets,
  haze: Haze,
  moon: Moon,
  snowflake: Snowflake,
  sun: Sun,
  sunrise: Sunrise,
  sunset: Sunset,
  thermometer: Thermometer,
  'thermometer-snowflake': ThermometerSnowflake,
  'thermometer-sun': ThermometerSun,
  tornado: Tornado,
  'triangle-alert': TriangleAlert,
  umbrella: Umbrella,
  wind: Wind,
};

/** Icône décorative : le texte qui la suit dit déjà la même chose. */
export function CardIconView({ name }: { name: CardIcon }) {
  const Icon = cardIconComponents[name];
  return Icon ? <Icon className="card-icon" aria-hidden="true" data-icon={name} /> : null;
}
