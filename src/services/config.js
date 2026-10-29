export function getBackendStatus() {
  const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  return configured
    ? 'Има локална конфигурация. Връзката и достъпът още не са проверени.'
    : 'Няма свързана база данни. Не се зареждат и записват данни.';
}
