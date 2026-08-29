export async function copyTextToClipboard(value, { clipboard, documentRef } = {}) {
  const text = String(value ?? '');
  const resolvedClipboard = clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : null);
  const resolvedDocument = documentRef ?? (typeof document !== 'undefined' ? document : null);
  let clipboardError;

  if (resolvedClipboard?.writeText) {
    try {
      await resolvedClipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (!resolvedDocument?.createElement || !resolvedDocument.body?.appendChild) {
    throw clipboardError ?? new Error('clipboard unavailable');
  }

  const textarea = resolvedDocument.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  resolvedDocument.body.appendChild(textarea);
  try {
    textarea.select();
    if (!resolvedDocument.execCommand?.('copy')) {
      throw clipboardError ?? new Error('clipboard unavailable');
    }
  } finally {
    resolvedDocument.body.removeChild(textarea);
  }
}
