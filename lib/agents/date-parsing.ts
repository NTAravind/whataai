import * as chrono from "chrono-node";

export function hasDateIndicator(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /(\b(date|day|tomorrow|today|yesterday|tonight|morning|evening|afternoon|time|slot)\b|on\s+\d{1,2}(st|nd|rd|th)?|next\s+(mon|tue|wed|thu|fri|sat|sun|week|month)|this\s+(mon|tue|wed|thu|fri|sat|sun|week|month)|\d{1,2}\/\d{1,2}(\/\d{2,4})?|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}:\d{2}|\d{1,2}(st|nd|rd|th)\b)/.test(lower);
}

export function expandBareOrdinals(text: string, referenceDate: Date = new Date()): string {
  if (!text) return text;
  const ordinals = ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th","13th","14th","15th","16th","17th","18th","19th","20th","21st","22nd","23rd","24th","25th","26th","27th","28th","29th","30th","31st"];
  const lower = text.toLowerCase();
  for (const o of ordinals) {
    const re = new RegExp(`\\b${o}\\b`, "i");
    if (re.test(lower)) {
      const ref = new Date(referenceDate);
      const month = ref.toLocaleString("en-US", { month: "long" });
      const year = ref.getFullYear();
      return text.replace(new RegExp(`\\b${o}\\b`, "gi"), `${o} of ${month} ${year}`);
    }
  }
  return text;
}
