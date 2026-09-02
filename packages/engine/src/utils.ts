/** Parse "HH:MM" clock string into minute-of-day */
export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}
