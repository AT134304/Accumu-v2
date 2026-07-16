// Accumu v2 — 날짜 유틸 (로컬 타임존 기준)
//
// [왜 별도 모듈인가] "오늘"의 소스가 한 곳이어야 한다.
//   - 캘린더 기본값 = 실제 오늘 (CLAUDE.md 9장, docs/specs/student-home.md 인수 조건)
//   - 추천 쿼리의 `date >= 오늘` (ADR 0003 6번)
//   - 마일스톤 스택의 최근 5개월 캡션 (스펙 확정 G)
// 세 곳이 각자 오늘을 계산하면 서로 어긋날 수 있어 여기로 모은다.
//
// [toISOString() 금지] `new Date().toISOString().slice(0,10)`은 UTC로 변환하므로
//   KST 오전 9시 이전에 날짜가 하루 밀린다. 아래 todayISO()는 로컬 필드(getFullYear 등)만 쓴다.
//   ADR 0003 6번 "타임존 주의" 참고.

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

const pad2 = (n) => String(n).padStart(2, '0');

/** 로컬(KST) 기준 오늘 'YYYY-MM-DD'. Postgres `date` 컬럼과 문자열 비교에 그대로 쓴다. */
export function todayISO(base = new Date()) {
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

/**
 * 'YYYY-MM-DD' -> '7월 16일 (목)' (Accumu_prototype.html 718줄 fmtDate 재현)
 * DB의 date 값은 프런트에서 이 포맷으로 만든다 (ADR 0003 5번).
 */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  // 로컬 자정으로 생성 — new Date('2026-07-16')은 UTC 파싱이라 요일이 밀릴 수 있다.
  const dt = new Date(y, m - 1, d);
  return `${m}월 ${d}일 (${DOW[dt.getDay()]})`;
}

/** '2026년 7월' — 캘린더 팝업 헤더용. 기준일은 항상 실제 오늘(하드코딩 금지). */
export function monthTitle(base = new Date()) {
  return `${base.getFullYear()}년 ${base.getMonth() + 1}월`;
}

/**
 * 실제 오늘 기준 최근 count개월 캡션. 가장 오른쪽(마지막)이 '이번 달'.
 * 예: 2026-07 기준 -> ['3월','4월','5월','6월','이번 달']
 *
 * 프로토타입 buildStack()(854줄)의 ['3월','4월','5월','6월','이번 달']은
 * TODAY_ISO='2026-07-02' 고정 전제의 하드코딩이라 그대로 쓰지 않는다 (스펙 확정 G).
 * Date 생성자가 month 음수를 자동으로 연도 이월 처리하므로 1~2월에도 안전하다.
 */
export function recentMonthCaptions(count = 5, base = new Date()) {
  const caps = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    caps.push(i === 0 ? '이번 달' : `${d.getMonth() + 1}월`);
  }
  return caps;
}
