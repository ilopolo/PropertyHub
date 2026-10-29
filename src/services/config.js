export function getBackendStatus() {
  const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  return configured
    ? 'Конфигурирана е Supabase връзка. Влез в акаунта си за проверен достъп до данни.'
    : 'Няма свързана база данни. Не се зареждат и записват данни.';
}
