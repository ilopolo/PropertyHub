// Only short local validation hints may pass; raw provider/network/debug messages never do.
export function userError(error,fallback='Операцията не е потвърдена. Обнови състоянието преди повторение.'){
 if(error?.code)return fallback;const text=error?.message;
 return typeof text==='string'&&text.length<=260&&/^[А-Яа-я]/.test(text)&&!/(?:\b(?:RPC|SQL|UUID|JWT|Auth|PT409|FND-|CALC-|[a-z]+_[a-z_]+)\b|https?:|[a-f0-9]{8}-[a-f0-9-]{27,}|[A-Z]:\\|\.local\/)/i.test(text)?text:fallback;
}
