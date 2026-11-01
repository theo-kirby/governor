import type { HubColours, HubTheme } from "./HubCanvas";
import type { HubSettings } from "./hub-settings";

// Open, broken, blocked, working, done, records. Distinct hues preserve status cues.
const hues = {
  ocean: [45, 5, 275, 175, 215, 200],
  forest: [48, 12, 290, 135, 85, 165],
  sunset: [35, 350, 280, 170, 20, 320],
  neon: [60, 335, 275, 150, 220, 185],
  aurora: [55, 330, 265, 155, 205, 285],
  lavender: [38, 345, 275, 165, 225, 255],
  desert: [42, 8, 320, 100, 28, 185],
  candy: [45, 350, 285, 165, 220, 325],
  glacier: [45, 355, 260, 175, 215, 195],
  botanical: [48, 15, 305, 135, 80, 155],
} as const;

export function paletteColours(palette: HubSettings["palette"], theme: HubTheme): HubColours | undefined {
  if (palette === "classic") return undefined;
  const dark = theme === "dark";
  const saturation = {
    ocean: 60, forest: 60, sunset: 60, neon: 90,
    aurora: 78, lavender: 40, desert: 48, candy: 82, glacier: 38, botanical: 45,
  }[palette];
  const hue = hues[palette];
  const ink = (h: number) => `hsl(${h} ${saturation}% ${dark ? 70 : 35}%)`;
  const tint = (h: number) => `hsl(${h} ${Math.round(saturation * (dark ? 0.5 : 0.75))}% ${dark ? 15 : 92}%)`;
  const statuses = ["open", "broken", "blocked", "working", "done"] as const;
  return {
    citation: ink(hue[5]),
    status: Object.fromEntries(statuses.map((status, i) => [status, ink(hue[i])])),
    tint: Object.fromEntries([...statuses, "record"].map((status, i) => [status, tint(hue[i])])),
    records: Array.from({ length: 32 }, (_, i) => `hsl(${hue[5]} ${saturation}% ${dark ? 75 - 32 * i / 31 : 32 + 40 * i / 31}%)`),
  };
}
