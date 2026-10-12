export function isGreeting(text: string): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();
  if (t.length > 20) return false;
  return /^(hi|hey|hello|hola|heyy|hii|good morning|good afternoon|good evening|morning|afternoon|evening|howdy)\b.*$/.test(t) || /^(hi|hey|hello)\s*\.?$/.test(t);
}
