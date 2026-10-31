export const UNIT_FILE_BUCKET = 'unit-private-files';
export const UNIT_FILE_MAX_BYTES = 5 * 1024 * 1024;
export class UnitFileError extends Error {}
export function validateUnitFile({name, type, size}) {
 if (typeof name !== 'string' || name.length < 5 || name.length > 120 || /[\x00-\x1f\x7f/\\]/.test(name) || !/\.pdf$/i.test(name)) return 'Избери PDF с име до 120 знака, без път или контролни знаци.';
 if (type !== 'application/pdf') return 'Допустим е само application/pdf.';
 if (!Number.isSafeInteger(size) || size < 1 || size > UNIT_FILE_MAX_BYTES) return 'Файлът трябва да е от 1 byte до 5 MiB (5 242 880 bytes).';
 return null;
}
export async function fileDigest(blob) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function assertFileBytes(blob, document) {
 if (blob.size !== Number(document.size_bytes) || await fileDigest(blob) !== document.sha256) throw new UnitFileError('Съдържанието не съвпада със записания размер/SHA-256. Файлът не е запазен.');
}
