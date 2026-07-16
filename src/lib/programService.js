// Accumu v2 — programs 조회 서비스 (ADR 0003 6번 "추천 쿼리 — 클라이언트 정렬")
// 컴포넌트가 supabase 쿼리를 직접 들고 있지 않도록 이 레이어에 모은다.
import { supabase } from './supabaseClient';
import { todayISO } from './date';

// ADR 0003 6번의 select 목록 그대로. description은 참여 팝업(다음 스펙) 몫이라 가져오지 않는다.
// popularity도 가져오지 않는다 — 이번 스코프에서 표시/정렬 어디에도 쓰지 않으므로(원칙 가드).
const CARD_FIELDS = 'id, category, title, org, date, time, points, career_track, status';

/**
 * 홈 추천 프로그램 목록.
 *
 * 정렬 규칙 (스펙 확정 E + ADR 0003 "케빈 확인 필요 1번 해소"):
 *   (1) profiles.career_interest 와 career_track 이 일치하는 것 우선
 *   (2) 그룹 내부는 최신순(created_at desc) 유지 — 인기순(popularity) 아님
 *   career_interest 가 비어 있으면(NULL) 그대로 최신순 fallback.
 *
 * @param {{career_interest?: string|null}|null} profile AuthContext의 본인 profile
 * @param {number} limit 렌더할 카드 수 (프로토타입 recommended(8)와 동일)
 * @returns {Promise<Array<object & {isMatched: boolean}>>} isMatched = "내 관심 계열" 배지 판단용
 */
export async function fetchRecommendedPrograms(profile, limit = 8) {
  const { data, error } = await supabase
    .from('programs')
    .select(CARD_FIELDS)
    // is_published 조건은 RLS(programs_select_published)와 중복이지만 의도를 코드에 명시한다 (이중 안전장치).
    .eq('is_published', true)
    // 지난 날짜 제외. todayISO()는 로컬(KST) 기준 — toISOString()을 쓰면 KST 오전 9시 이전에 하루 밀린다.
    // `date >= 오늘`이라 "오늘 이미 끝난 프로그램"은 노출된다 — 프로토타입과 동일한 의도적 동작(ADR 0003 6번).
    .gte('date', todayISO())
    .order('created_at', { ascending: false })
    .limit(50) // 안전 상한. 데모 실제 행 수는 16~20.
    ;

  if (error) throw error;

  const rows = data ?? [];
  const interest = profile?.career_interest ?? null;

  if (!interest) {
    // 계열 미설정 -> 최신순 그대로. 배지도 붙지 않는다.
    return rows.slice(0, limit).map((row) => ({ ...row, isMatched: false }));
  }

  // 계열 일치를 앞으로 당긴다. 두 배열 모두 위 order의 최신순을 그대로 물려받는다(안정 분할).
  const matched = [];
  const others = [];
  for (const row of rows) {
    const isMatched = row.career_track === interest;
    (isMatched ? matched : others).push({ ...row, isMatched });
  }
  return matched.concat(others).slice(0, limit);
}
