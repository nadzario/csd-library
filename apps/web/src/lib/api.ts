const configured = String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const localFallback = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? 'http://localhost:3000'
  : '';

export const apiUrl = configured || localFallback;

export function requireApiUrl() {
  if (!apiUrl) throw new Error('Сервис приёма материалов ещё не подключён. Попробуйте позже.');
  return apiUrl;
}
