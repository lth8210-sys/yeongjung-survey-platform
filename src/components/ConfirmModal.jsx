function ConfirmModal({ isOpen, onConfirm, onCancel, title, message, confirmLabel = '확인', cancelLabel = '취소' }) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal-panel"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-message"
      >
        {title && (
          <h2 id="confirm-modal-title" style={{ marginTop: 0, marginBottom: '12px', fontSize: '1.05rem' }}>
            {title}
          </h2>
        )}
        <p id="confirm-modal-message" style={{ margin: '0 0 24px', lineHeight: 1.6, color: '#3a4a5c' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="secondary-button" onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button className="primary-button" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
