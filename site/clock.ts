// GNOME's own top-bar format: short weekday, short month, unpadded day,
// 24-hour time. Kept out of demo.ts so it can be tested without a DOM.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function clockText(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()} ${hours}:${minutes}`
}
