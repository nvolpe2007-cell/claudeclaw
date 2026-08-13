export const RANKS = [
  { name: 'Rookie', hours: 0 },
  { name: 'Scripter', hours: 5 },
  { name: 'Dev', hours: 20 },
  { name: 'Hacker', hours: 50 },
  { name: 'Pro', hours: 100 },
  { name: 'Elite', hours: 250 },
  { name: 'Legendary', hours: 500 },
  { name: 'God Mode', hours: 1000 },
];

export function getRankInfo(totalHours) {
  let current = RANKS[0];
  let next = RANKS[1] ?? null;

  for (let i = 0; i < RANKS.length; i += 1) {
    if (totalHours >= RANKS[i].hours) {
      current = RANKS[i];
      next = RANKS[i + 1] ?? null;
    }
  }

  let progress = 1;
  if (next) {
    const span = next.hours - current.hours;
    progress = span > 0 ? (totalHours - current.hours) / span : 1;
    progress = Math.max(0, Math.min(1, progress));
  }

  return { current, next, progress };
}
