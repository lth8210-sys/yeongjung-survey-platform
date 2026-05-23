import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

function QrModal({ isOpen, onClose, url, title }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!isOpen || !url) {
      setDataUrl('');
      return;
    }

    async function generate() {
      const nextDataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 280,
      });
      setDataUrl(nextDataUrl);
    }

    generate();
  }, [isOpen, url]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-panel" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="builder-header-row">
          <h2>{title || 'QR 코드'}</h2>
          <button className="text-button danger-text" onClick={onClose} type="button">
            닫기
          </button>
        </div>
        {dataUrl && <img alt="설문 QR 코드" className="qr-image" src={dataUrl} />}
        <div className="field">
          <span>공개 링크</span>
          <input readOnly type="text" value={url} />
        </div>
        {dataUrl && (
          <a className="secondary-button" download="survey-qr.png" href={dataUrl}>
            QR 이미지 저장
          </a>
        )}
      </div>
    </div>
  );
}

export default QrModal;
