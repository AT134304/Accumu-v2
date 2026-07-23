// Accumu v2 — programs / participations 서비스 (ADR 0003 6번, ADR 0004 "구현 가이드 → frontend-agent")
// 컴포넌트가 supabase 쿼리를 직접 들고 있지 않도록 이 레이어에 모은다.
import { supabase } from './supabaseClient';
import { todayISO } from './date';

// ADR 0003 6번의 select 목록 그대로. 홈 카드가 그리는 필드만 가져온다.
const CARD_FIELDS = 'id, category, title, org, date, time, points, career_track, status';

// 프로그램 선택 화면용. 카드 필드 + 팝업(description) + 클라이언트 정렬 입력(popularity/created_at).
//
// [정렬을 클라이언트에서 하므로 popularity/created_at을 페이로드에 실어야 한다]
//   서버 .order()로 처리하면 정렬을 바꿀 때마다 재조회가 된다(20행 규모에 불필요한 왕복).
// [원칙 가드 — popularity] 이 값은 "인기순" 정렬의 입력으로만 쓴다.
//   숫자를 화면에 렌더하지 않는다. "TOP 3"/"인기 1위"/"N명 신청" 같은 순위·과열 라벨도 만들지 않는다
//   (docs/specs/student-programs.md "절대 원칙 체크", CLAUDE.md 2장 1번).
//   홈(fetchRecommendedPrograms)은 이 필드를 계속 가져오지 않는다 — 거기선 정렬 기준이 아니다.
const LIST_FIELDS = `${CARD_FIELDS}, description, popularity, created_at`;

/**
 * 프로그램 선택 화면용 전체 목록.
 *
 * [홈과 다른 점] `date >= 오늘` 필터를 걸지 않는다 — 지난 프로그램을 별도 그룹("날짜 지난 프로그램")으로
 * 보여줘야 하기 때문이다 (docs/specs/student-programs.md A절).
 * 검색·필터·정렬은 전부 클라이언트에서 한다 (데모 20행 규모. Supabase full-text 도입 금지 — ADR 0003 6번).
 */
export async function fetchAllPrograms() {
  const { data, error } = await supabase
    .from('programs')
    .select(LIST_FIELDS)
    // is_published 조건은 RLS(programs_select_published)와 중복이지만 의도를 코드에 명시한다 (이중 안전장치).
    .eq('is_published', true)
    .limit(200); // 안전 상한. 데모 실제 행 수는 16~20.

  if (error) throw error;
  return data ?? [];
}

/**
 * 본인의 신청 목록.
 *
 * [student_id 필터를 클라이언트에서 걸지 않는다] RLS(participations_select_own)가 본인 행만 내려준다.
 *   걸어도 무해하지만 경계의 소유자는 RLS라는 점을 코드에서 흐리지 않는다 (ADR 0004 구현 가이드).
 * [status를 화면 로직에 쓰지 않는다] 이번 스코프에서 값은 항상 'applied'이고, 이 컬럼의 의미는 QR 스펙에서
 *   확정된다. "신청됨" 판정은 오로지 행의 존재 여부로만 한다 (ADR 0004 구현 가이드 4번).
 */
export async function fetchMyParticipations() {
  const { data, error } = await supabase.from('participations').select('id, program_id, status');
  if (error) throw error;
  return data ?? [];
}

/**
 * 이미 신청한 program_id Set. 조회 실패 시 화면 전체를 죽이지 않고 빈 Set으로 축약한다.
 *
 * [왜 실패를 삼키나] participations 마이그레이션이 아직 적용되지 않은 환경에서도 프로그램 목록/홈 추천은
 *   떠야 한다. "신청됨" 표시가 빠지는 것은 열화된 표시일 뿐이고, 실제 중복 신청 방어는
 *   DB unique 제약(23505/409)이 담당하므로 안전 경계가 무너지지 않는다.
 *   대신 조용히 넘어가지 않도록 콘솔에 원본 에러를 남긴다.
 */
export async function fetchAppliedProgramIds() {
  try {
    const rows = await fetchMyParticipations();
    return new Set(rows.map((r) => r.program_id));
  } catch (err) {
    console.warn('[programService] 신청 목록 조회 실패 — "신청됨" 표시 없이 진행합니다:', err);
    return new Set();
  }
}

/**
 * 참여 신청.
 *
 * [보내는 컬럼은 student_id / program_id 둘뿐이다 — 다른 컬럼을 추가하지 말 것]
 *   RLS participations_insert_own 의 with check 가 status='applied', entry_at/exit_at/entry_token/exit_token
 *   is null 을 요구한다. status 는 DB default('applied')가 채우고, created_at 도 DB default 에 맡긴다.
 *   여기에 컬럼을 하나 더 실으면 원인 불명의 403(42501)이 난다 (ADR 0004 "알려진 틈" / 구현 가이드 1번).
 * [포인트를 건드리지 않는다] 신청만으로는 1P도 지급되지 않는다. 지급 시점은 QR 퇴장 인증
 *   (CLAUDE.md 2장 3번 / 6장 3번). 이 함수에 points_balance/point_transactions 경로를 만들지 말 것.
 *
 * @param {{studentId: string, programId: string}} args studentId 는 AuthContext 의 본인 id (= auth.uid())
 * @returns {Promise<'created'|'duplicate'>} 'duplicate' = DB unique 제약(23505/409). 에러가 아니라 상태 동기화 신호로 다룬다.
 * @throws 그 외 실패(RLS 42501 / 네트워크 등)는 그대로 던진다 — 호출부가 사용자에게 알린다.
 */
export async function applyToProgram({ studentId, programId }) {
  const { error } = await supabase
    .from('participations')
    .insert({ student_id: studentId, program_id: programId });

  if (!error) return 'created';

  // 중복 신청: 클라이언트 방어(버튼 비활성)를 새로고침·두 탭·개발자도구로 우회해도 DB가 막는다.
  // 사용자에게 실패 팝업을 띄울 상황이 아니라 "이미 신청됨"으로 화면을 맞추면 되는 상황이다.
  if (error.code === '23505') return 'duplicate';

  throw error;
}

/* ==========================================================================
   관리자 홈 (ADR 0005 결정 7-5 — 새 RLS 정책 0개)
   ========================================================================== */

// 관리자 홈이 그리는 필드 + created_by(본인 필터용). is_published 는 상태 표시가 아니라
// "왜 이 행이 보이는가"를 코드에서 설명하기 위해 함께 가져온다.
const ADMIN_FIELDS = 'id, category, title, org, date, time, points, is_published, created_by';

/**
 * 관리자 홈용 프로그램 조회 — "오늘 진행" + "예정".
 *
 * [새 정책 없이 성립한다] 기존 programs_select_published + programs_select_own_as_admin 로 충분하다.
 * [created_by 필터를 프런트가 거는 이유] 확정 H-1 때문에 남의 프로그램은 스캔이 항상 실패한다.
 *   목록에 띄우면 "누르면 반드시 실패하는 버튼"이 된다 (ADR 0005 결정 7-5).
 * [날짜는 todayISO()(로컬/KST)로 거른다] DB 의 current_date 로 거르지 않는다 — 그러면 "오늘"의 소스가
 *   프런트와 DB 로 갈린다 (ADR 0003 6번 / ADR 0004 타임존 판단 유지).
 * [원칙 1·6 가드] 참여자 수·신청자 명단·출석률·랭킹을 조회하지 않는다. 관리자에게 그 데이터를 주는
 *   RLS 정책 자체가 없다 (ADR 0005 결정 7-2(d)).
 *
 * @param {string} adminId 로그인한 관리자의 profile id (= auth.uid())
 * @returns {Promise<{today: object[], upcoming: object[]}>}
 */
export async function fetchAdminHomePrograms(adminId) {
  const { data, error } = await supabase.from('programs').select(ADMIN_FIELDS).limit(200);
  if (error) throw error;

  const iso = todayISO();
  const mine = (data ?? []).filter((p) => p.created_by && p.created_by === adminId);

  const byDateAsc = (a, b) => String(a.date).localeCompare(String(b.date));
  return {
    today: mine.filter((p) => p.date === iso).sort(byDateAsc),
    upcoming: mine.filter((p) => String(p.date) > iso).sort(byDateAsc).slice(0, 5),
  };
}

/**
 * 스캔 화면의 문맥 표시용 프로그램 1건. 조회에 실패해도 스캔은 그대로 동작해야 하므로 null 로 축약한다.
 * (검증은 토큰 하나로만 이뤄지며 program_id 를 서버에 넘기지 않는다 — ADR 0005 "대안으로 고려했던 것".)
 */
export async function fetchProgramBrief(programId) {
  if (!programId) return null;
  const { data, error } = await supabase
    .from('programs')
    .select('id, title, date, time, category')
    .eq('id', programId)
    .maybeSingle();
  if (error) {
    console.warn('[programService] 프로그램 조회 실패 — 문맥 표시 없이 진행합니다:', error);
    return null;
  }
  return data ?? null;
}

/**
 * 홈 추천 프로그램 목록.
 *
 * 정렬 규칙 (스펙 확정 E + ADR 0003 "케빈 확인 필요 1번 해소"):
 *   (1) profiles.career_interest 와 career_track 이 일치하는 것 우선
 *   (2) 그룹 내부는 최신순(created_at desc) 유지 — 인기순(popularity) 아님
 *   career_interest 가 비어 있으면(NULL) 그대로 최신순 fallback.
 *
 * 확정 D-1: 이미 신청한 프로그램은 추천에서 제외한다
 *   (안 하면 신청한 활동이 홈에 계속 "참여" 버튼으로 떠서 명백한 결함으로 보인다).
 *
 * @param {{career_interest?: string|null}|null} profile AuthContext의 본인 profile
 * @param {number} limit 렌더할 카드 수 (프로토타입 recommended(8)와 동일)
 * @returns {Promise<Array<object & {isMatched: boolean}>>} isMatched = "내 관심 계열" 배지 판단용
 */
export async function fetchRecommendedPrograms(profile, limit = 8) {
  // ADR 0004 5번: 조인 뷰/PostgREST embed 대신 병렬 2쿼리 + 클라이언트 Set 필터.
  //   (뷰는 기본이 정의자 권한이라 participations_select_own 경계를 우회해 남의 신청 내역이 샌다.)
  const [{ data, error }, appliedIds] = await Promise.all([
    supabase
      .from('programs')
      .select(CARD_FIELDS)
      // is_published 조건은 RLS(programs_select_published)와 중복이지만 의도를 코드에 명시한다 (이중 안전장치).
      .eq('is_published', true)
      // 지난 날짜 제외. todayISO()는 로컬(KST) 기준 — toISOString()을 쓰면 KST 오전 9시 이전에 하루 밀린다.
      // `date >= 오늘`이라 "오늘 이미 끝난 프로그램"은 노출된다 — 프로토타입과 동일한 의도적 동작(ADR 0003 6번).
      .gte('date', todayISO())
      .order('created_at', { ascending: false })
      .limit(50), // 안전 상한. 데모 실제 행 수는 16~20.
    fetchAppliedProgramIds(),
  ]);

  if (error) throw error;

  // [제외 기준은 program_id 존재 여부이며 status를 보지 않는다]
  //   지금은 applied 뿐이라 결과가 같지만, QR 스펙에서 entered/completed 가 생겨도 그것들 역시 추천에서
  //   빠져야 맞다(프로토타입 recommended()의 !isJoined && !isCompleted 와 같은 의미). ADR 0004 5번.
  // [필터는 slice(0, limit) 앞에서 한다] 뒤에서 하면 신청한 만큼 홈 카드가 8장 미만으로 줄어든다.
  const rows = (data ?? []).filter((row) => !appliedIds.has(row.id));
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
