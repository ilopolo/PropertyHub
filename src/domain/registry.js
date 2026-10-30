// Calendar dates, independent of the browser's local timezone. Periods are [from,to).
export function registryDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000') || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new RangeError('Invalid registry date');
  return value;
}
export function registryToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function calendarLabel(value) {
  return value ? registryDate(value).split('-').reverse().join('.') : 'неустановена дата';
}
