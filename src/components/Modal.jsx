// Accumu v2 — 공용 모달 (Accumu_prototype.html .overlay/.modal 재현)
// 프로토타입은 display:none <-> .on 토글이지만, React에서는 열릴 때만 마운트하므로 항상 열린 상태로 렌더한다.
import { useEffect } from 'react';
import Icon from './Icon';

export default function Modal({ onClose, labelledBy, children }) {
  // Esc로 닫기 (프로토타입에는 없지만 접근성 기본. 오버레이 클릭 닫기는 프로토타입 closeOverlay 동작 그대로)
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <button type="button" className="mclose" onClick={onClose} aria-label="닫기">
          <Icon name="ic-close" size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
