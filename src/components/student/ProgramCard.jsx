// Accumu v2 — 프로그램 카드 (Accumu_prototype.html pcardHTML() 815줄 재현)
// 표시 필드: category(그룹·표시명 태그) / title / org / date / time / points / status / isMatched
// popularity는 표시하지 않는다 (ADR 0003 — 이번 스코프에서 표시·정렬 어디에도 쓰지 않음).
import Icon from '../Icon';
import { catOf, statusOf } from '../../lib/taxonomy';
import { fmtDate } from '../../lib/date';

export default function ProgramCard({ program, onOpen }) {
  const c = catOf(program.category);
  const st = statusOf(program.status);

  // 프로토타입은 isJoined/isCompleted로 '신청됨'/'참여 완료'도 구분하지만,
  // participations 테이블이 없어 이번엔 status만으로 라벨/비활성을 정한다.
  const label = st.join ? '참여' : st.label;
  const disabled = !st.join;

  return (
    <div
      className="pcard"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="thumb" style={{ background: `linear-gradient(135deg,${c.soft},#fff)` }}>
        <span className="tag">
          {c.group} · {c.name}
        </span>
        {/* 계열 매칭 배지 — 개인화 표시일 뿐 보상/랭킹 요소가 아니다 (확정 E) */}
        {program.isMatched && (
          <span className="matchbadge">
            <Icon name="ic-target" size={12} />
            내 관심 계열
          </span>
        )}
        <Icon name={c.icon} size={40} color={c.color} />
      </div>

      <div className="body">
        <h4>{program.title}</h4>
        <div className="meta">
          <Icon name="ic-tag" size={13} />
          {program.org}
        </div>
        <div className="meta">
          <Icon name="ic-calendar" size={13} />
          {/* date는 프런트에서 "7월 16일 (목)"으로 포맷. time은 자유 텍스트라 파싱 없이 그대로 출력. */}
          {fmtDate(program.date)} · {program.time}
        </div>
        <div className="foot">
          {/* 포인트 amber는 카드의 이 뱃지에서만 (절대 원칙 4) */}
          <div className="pt">
            +{program.points}
            <em>P</em>
          </div>
          <button
            type="button"
            className="join-btn"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
