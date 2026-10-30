// New passwords only. Existing credentials must remain usable at login.
export function validNewPassword(password) {
  return typeof password === 'string' && [...password].length >= 8 && [...password].length <= 256 && /[0-9]/.test(password);
}
export function requireNewPassword(password) {
  if (!validNewPassword(password)) throw Object.assign(new Error('Invalid new password'), { code: 'weak_password' });
}
