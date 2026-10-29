export const authBg = Object.freeze({
  unavailable: 'Операцията не е изпълнена. Провери връзката и опитай отново.',
  denied: 'Нямаш право за това действие или получателят не е достъпен.',
  invalid: 'Данните са невалидни или записът вече съществува.',
  credentials: 'Входът е неуспешен. Провери имейла, паролата и потвърждението на акаунта.',
  rateLimit: 'Достигнат е лимитът за заявки. Изчакай преди нов опит.',
  signup: 'Ако регистрацията е допустима, ще получиш писмо за потвърждение. Провери пощата си и отвори връзката в този браузър.',
  pending: 'Акаунтът е създаден. Достъпът очаква проверено назначение. Можеш да подадеш заявка за организация.',
});
export const callbackBg = Object.freeze({
  confirmed: 'Потвърденият акаунт е зареден.',
  confirmed_with_link_error: 'Тази връзка не може да бъде използвана, но текущата ти сесия е за потвърден акаунт. Можеш да продължиш.',
  expired: 'Връзката е изтекла, невалидна или вече използвана. Ако вече потвърди имейла си, влез с имейл и парола. Ново писмо е нужно само ако акаунтът още не е потвърден.',
  session: 'Автоматичното влизане не завърши. Ако имейлът вече е потвърден, влез с имейл и парола. Отваряй новите връзки в браузъра, в който ги поиска.',
  unknown: 'Тази връзка не може да бъде използвана. Ако вече потвърди имейла си, влез с имейл и парола. Ако още не е потвърден, поискай ново писмо.',
});
export function authError(error) {
  if (error.status === 429 || String(error.code).includes('rate_limit')) return authBg.rateLimit;
  if (error.message === 'Липсва конфигурация за връзката.' || error.message === 'Невалиден публичен ключ.') return error.message;
  if (['invalid_credentials', 'email_not_confirmed'].includes(error.code)) return authBg.credentials;
  if (error.code === '42501') return authBg.denied;
  if (['23514', '23505', '23P01', '23503'].includes(error.code)) return authBg.invalid;
  if (error.code === 'over_email_send_rate_limit' || error.code === 'email_address_not_authorized') return 'Писмото не може да бъде изпратено. Провери настройките за доставка или опитай по-късно.';
  return authBg.unavailable;
}
