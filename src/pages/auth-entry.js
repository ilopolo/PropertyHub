import './main.js';
import { login, register, resendConfirmation, requestPasswordReset } from '../services/auth.js';
import { bindForm, message } from '../ui/forms.js';
import { authBg, recoveryBg } from '../i18n/auth-bg.js';
const field = (data, name) => String(data.get(name) || '').trim();
bindForm('#login', async (data, form) => {
  await login(field(data, 'email'), String(data.get('password')));
  form.reset(); location.assign('/pages/account.html');
});
bindForm('#register', async (data, form) => {
  const password = String(data.get('password'));
  if (password !== String(data.get('password-confirm'))) { message('Паролите не съвпадат.', true); return; }
  await register(field(data, 'email'), password, field(data, 'name'));
  form.reset(); message(authBg.signup);
});
bindForm('#resend', async data => { await resendConfirmation(field(data, 'email')); message('Ако заявката е допустима, ще получиш ново писмо за потвърждение.'); });
bindForm('#password-reset-request', async (data, form) => {
  await requestPasswordReset(field(data, 'email'));
  form.reset();
  message(recoveryBg.requested);
});
