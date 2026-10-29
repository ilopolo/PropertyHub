// Return only a category. Never retain/reflect callback codes, tokens or server descriptions.
export function readAuthCallback(url) {
  const params = [url.searchParams, new URLSearchParams(url.hash.slice(1))];
  const hasError = params.some(p => ['error', 'error_code', 'error_description'].some(key => p.has(key)));
  const hasCode = url.searchParams.has('code');
  const errorCode = params.map(p => p.get('error_code')).find(Boolean);
  const sessionCodes = ['flow_state_expired', 'flow_state_not_found', 'bad_code_verifier', 'pkce_verifier_not_found'];
  return {
    present: hasError || hasCode,
    hasError,
    hasCode,
    kind: hasError ? sessionCodes.includes(errorCode) ? 'session' : errorCode === 'otp_expired' ? 'expired' : 'unknown' : hasCode ? 'code' : 'none',
  };
}
export function callbackNotice(callback, confirmedSession) {
  if (!callback.present) return null;
  if (confirmedSession) return callback.hasError ? 'confirmed_with_link_error' : 'confirmed';
  return callback.kind === 'expired' ? 'expired' : callback.kind === 'session' || callback.hasCode ? 'session' : 'unknown';
}
