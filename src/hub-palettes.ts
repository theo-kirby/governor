import type { HubColours, HubTheme } from "./HubCanvas";
import type { HubSettings } from "./hub-settings";

// Open, broken, blocked, working, done, records. Distinct hues preserve status cues.
const hues = {
  ocean: [45, 5, 275, 175, 215, 200],
  forest: [48, 12, 290, 135, 85, 165],
  sunset: [35, 350, 280, 170, 20, 320],
  neon: [60, 335, 275, 150, 220, 185],
} as const;

export function paletteColours(palette: HubSettings["palette"], theme: HubTheme): HubColours | undefined {
  if (palette === "classic") return undefined;
  const dark = theme === "dark";
  const saturation = palette === "neon" ? 90 : 60;
  const hue = hues[palette];
  const ink = (h: number) => `hsl(${h} ${saturation}% ${dark ? 70 : 35}%)`;
  const tint = (h: number) => `hsl(${h} ${dark ? 30 : 45}% ${dark ? 15 : 92}%)`;
  const statuses = ["open", "broken", "blocked", "working", "done"] as const;
  return {
    citation: ink(hue[5]),
    status: Object.fromEntries(statuses.map((status, i) => [status, ink(hue[i])])),
    tint: Object.fromEntries([...statuses, "record"].map((status, i) => [status, tint(hue[i])])),
    records: Array.from({ length: 32 }, (_, i) => `hsl(${hue[5]} ${saturation}% ${dark ? 75 - 32 * i / 31 : 32 + 40 * i / 31}%)`),
  };
}
