-- Accumu v2 — 스키마 단일 소스 (backend-agent가 마이그레이션 작성 시 이 파일을 기준으로 삼는다)
-- 최종 갱신: 2026-07-16 (프로그램 선택 화면 + 참여 신청 팝업, ADR 0004)
-- 범위: 로그인 기능(ADR 0001/0002) + 학생 홈의 추천 프로그램(ADR 0003)
--       + 프로그램 선택/참여 신청(ADR 0004)에 필요한 테이블까지 포함한다.
-- CLAUDE.md 5장의 나머지 테이블(point_transactions, reviews, notifications)은
-- 해당 기능이 architect-agent를 거칠 때 이 파일에 이어서 추가한다.
-- 임의로 없는 필드를 지어내지 않는다 — 여기 없는 필드가 필요하면 먼저 ADR로 논의한다.
--
-- [마이그레이션 작성 시 주의] 이 파일은 "현재 목표 스키마 상태"를 기술한다. 실제 DB에는 이미
-- 20260709120000_init_profiles_and_mentor_students.sql 과 20260716120000_add_programs_and_career_track.sql
-- 이 적용되어 있으므로, profiles/programs 는 새로 만들어지지 않는다. 따라서 profiles.career_interest 의
-- 타입 변경(text -> career_track, ADR 0003)은 create table 이 아니라 alter table 로 반영해야 한다.
-- 아래 profiles 정의 위 주석 참고. ADR 0004의 신규분은 participations 뿐이다(기존 테이블 변경 없음).

-- =========================================================
-- 0. 확장 / 타입
-- =========================================================
create extension if not exists pgcrypto; -- gen_random_uuid() 용. Supabase 프로젝트는 보통 기본 활성화되어 있음.

do $$ begin
  create type user_role as enum ('student', 'admin');
exception
  when duplicate_object then null;
end $$;

-- 진로 계열 (ADR 0003). 활동 유형(program_category)과는 별개 축.
-- programs.career_track 과 profiles.career_interest 가 "이 하나의 타입을 공유"한다
--   = 추천 매칭(계열 일치)의 두 축이 같은 값 공간임을 DB가 구조적으로 보장한다.
--     text + CHECK 였다면 두 목록이 따로 존재해 한쪽만 바뀌는 드리프트가 가능했다.
-- 값 집합 출처: Accumu_prototype.html TRACK 5종 (docs/specs/student-home.md 확정 F).
do $$ begin
  create type career_track as enum ('sci', 'it', 'hum', 'biz', 'art');
exception
  when duplicate_object then null;
end $$;
comment on type career_track is
  '진로 계열 5종. sci=이공계·자연과학, it=IT·소프트웨어, hum=인문·사회, biz=경영·경제, art=예술·체육. '
  '표시명/색상은 DB가 아니라 프런트엔드 TRACK 맵이 소유한다 (Accumu_prototype.html 703~709줄 재사용).';

-- 활동 유형 8종 (교내 4 + 교외 4). ADR 0003.
-- 값 집합 출처: Accumu_prototype.html CAT (docs/specs/student-home.md 확정 F). 프로토타입 키를 그대로 사용한다
--   = 프런트엔드가 CAT 맵(692~701줄)을 키까지 그대로 재사용할 수 있어 DB값<->맵키 변환 계층이 생기지 않는다.
do $$ begin
  create type program_category as enum ('hbk', 'hdo', 'hdc', 'het', 'ecp', 'evo', 'edc', 'eet');
exception
  when duplicate_object then null;
end $$;
comment on type program_category is
  '활동 유형 8종. 교내: hbk=방과후, hdo=동아리, hdc=대회, het=기타 / 교외: ecp=기업·국가기관, evo=봉사활동, edc=대회, eet=기타. '
  '그룹(교내/교외)·표시명·색상·아이콘은 DB가 아니라 프런트엔드 CAT 맵이 소유한다 (교내/교외를 별도 컬럼으로 쪼개지 않는 이유: ADR 0003).';

-- 프로그램 모집/진행 상태 5종. ADR 0003.
-- 이번 스코프에서는 참여수/정원 파생이 아니라 "정적 필드"다 (확정 D — participations 테이블이 아직 없음).
do $$ begin
  create type program_status as enum ('open', 'ing', 'wait', 'full', 'over');
exception
  when duplicate_object then null;
end $$;
comment on type program_status is
  'open=참석 가능(신청 가능), ing=참석 중(진행 중), wait=대기(정원이 찼지만 대기 신청 가능), full=마감(모집 기한 종료), over=정원 초과. '
  '신청 가능 여부(join) 매핑과 표시 라벨은 프런트엔드 STATUS 맵이 소유한다 (Accumu_prototype.html 710~716줄). '
  'participations 도입 시 파생값으로 전환 검토 — ADR 0003 "향후 변경" 참고.';

-- 한 학생의 참여 진행도 3종. ADR 0004.
--
-- [program_status 와 혼동 금지 — 이름만 비슷하고 개념이 완전히 다르다]
--   programs.status (program_status)       = 프로그램의 모집 상태. 정적 필드. join 매핑은 프런트 STATUS 맵 소유.
--   participations.status (아래 타입)      = 한 학생의 참여 진행도. 상태 전이는 DB/서버만 수행한다
--                                            (QR 토큰 검증 결과로만 바뀐다 — 학생이 직접 못 쓴다. 아래 RLS 참고).
--
-- [값 3종을 지금 정의하는 근거] CLAUDE.md 6장이 QR 흐름을 이미 확정했고 상태 지점이 기계적으로 도출된다:
--   (1) 신청 -> (2) 입장 인증 시 entry_at 기록 -> (3) 퇴장 인증 시 exit_at 기록 + 포인트 지급.
--   entry_at/exit_at 컬럼을 이번에 만드는 결정과 짝을 이룬다(컬럼이 존재한다 = 그 상태가 도메인에 존재한다).
--   applied 1종만 만들면 아래 RLS 의 `status = 'applied'` 술어가 자명해 보여 삭제 유혹이 생기는데,
--   그 술어는 QR 스펙의 부정 적립을 막는 자물쇠다 (ADR 0004 1번).
--
-- [이번 스코프에서 생성되는 값은 'applied' 하나뿐이다] entered/completed 는 QR 스펙 몫.
-- cancelled/no_show 는 넣지 않는다 — 확정 G-1(신청 취소 스코프 아님)이고 CLAUDE.md 6장에도 근거가 없다.
do $$ begin
  create type participation_status as enum ('applied', 'entered', 'completed');
exception
  when duplicate_object then null;
end $$;
comment on type participation_status is
  'applied=신청함(행 생성 시점), entered=입장 인증 완료(entry_at 기록됨), completed=퇴장 인증 완료(=참여 완료, 포인트 지급 대상). '
  '[주의] programs.status(program_status)와 다른 개념이다 — 저쪽은 프로그램의 모집 상태, 이쪽은 한 학생의 참여 진행도. '
  '이번 스코프(프로그램 선택+참여 신청)에서는 applied 만 생성된다. entered/completed 로의 전이는 QR 이중 인증 스펙 몫이며 '
  '학생이 직접 쓸 수 없다 (participations_insert_own 의 with check + update 정책 0개).';

-- =========================================================
-- 1. profiles
--    auth.users 1:1 매핑. 학생/관리자 공통 계정 테이블 (CLAUDE.md 5장).
--
--    [주의] 이 테이블은 이미 생성되어 있다(20260709120000 마이그레이션). ADR 0003의 변경사항은
--    career_interest 컬럼 타입 1건뿐이며, 신규 마이그레이션에서는 아래처럼 alter 로 반영한다:
--      alter table public.profiles
--        alter column career_interest type career_track using career_interest::career_track;
--    캐스팅 안전성: seed-accounts.mjs 는 id/role/code/name 만 insert 하고 profiles 에 update 정책이
--    0개라, 현재 모든 행의 career_interest 는 NULL 이다(= 캐스팅 실패 불가). 만약 캐스팅 에러가 나면
--    예상 밖의 값이 있다는 뜻이므로 중단하고 케빈에게 보고할 것.
-- =========================================================
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  role              user_role not null,
  code              text not null unique, -- 학번('10718') 또는 관리자코드('ADM-0001'). 원본 케이싱 그대로 저장(표시용).
  name              text not null,
  points_balance    integer not null default 0, -- 현재 사용 가능 포인트 (전환 시 차감)
  points_total      integer not null default 0, -- 누적 적립 포인트 (전환과 무관하게 증가만)
  currency_balance  integer not null default 0, -- 시뮬레이션 지역화폐 누적액 (1P=1원 개념, 실결제 없음)
  career_interest   career_track,                -- ADR 0003: text -> career_track enum 으로 좁힘. 학생 전용 개념.
  created_at        timestamptz not null default now()
);

comment on table public.profiles is '학생/관리자 공통 계정 프로필. id는 auth.users.id와 1:1 매핑.';
comment on column public.profiles.code is '가상 이메일 생성 기준값: lower(trim(code)) || ''@accumu.local'' (src/lib/virtualEmail.js 참고). 컬럼 자체는 원본 케이싱 보존.';
comment on column public.profiles.career_interest is
  '학생의 관심 진로 계열. programs.career_track 과 같은 career_track 타입을 공유해 홈 추천 매칭의 값 공간이 일치함을 보장한다 (ADR 0003). '
  'NULL 허용은 의도된 도메인 상태: (1) 학생이 아직 계열을 고르지 않음 -> 홈 추천은 최신순 fallback (스펙 확정 E), '
  '(2) role=admin 은 계열 개념 자체가 없음. "admin 이면 NULL" 을 CHECK 로 강제하지 않는 이유는 mentor_students 의 role 정합성을 '
  '트리거로 강제하지 않은 판단과 동일하다 (데모 규모, 시딩 스크립트 책임 — ADR 0002).';

alter table public.profiles enable row level security;

-- 본인 행만 조회 가능. 로그인 직후 role/name 대조에 필요한 최소 권한.
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- insert/update/delete 정책 없음 = 기본 전체 거부.
--  - 계정 생성(시딩)은 service_role 키(scripts/seed-accounts.mjs)로 수행되어 RLS를 우회하므로
--    클라이언트용 insert 정책이 필요 없다 (= 앱 내 회원가입 UI 없음 원칙과 일치).
--  - "마이페이지에서 career_interest 등 본인 정보 수정" 같은 기능이 생기면 그때
--    "본인 행 UPDATE, 단 role/code/points_* 등 민감 컬럼은 제외" 정책을 별도 ADR로 추가한다.
--  - [ADR 0003 메모] update 정책이 없다는 것은 곧 "앱에서 career_interest 를 저장할 방법이 없다"는 뜻이다.
--    계열 선택 UI는 마이페이지 스펙(이번 스코프 아님)이므로, 학생 홈의 계열 매칭 시연에 필요한
--    career_interest 값은 이번엔 시딩(scripts/seed-accounts.mjs)으로만 넣는다.
--  - [ADR 0004 메모] points_balance / points_total / currency_balance 에 update 정책이 0개라는 사실이
--    "신청만으로는 포인트가 1P도 지급되지 않는다"(CLAUDE.md 2장 3번)를 트리거 없이 구조적으로 보장한다.
--    포인트 지급은 QR 퇴장 인증 시점이며(6장 3번), 그 경로는 QR 스펙에서 별도 ADR로 설계한다.

-- =========================================================
-- 2. mentor_students
--    관리자-담당학생 고정 매핑 (데모 기준 관리자 1명 : 학생 5명).
-- =========================================================
create table if not exists public.mentor_students (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references public.profiles(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (admin_id, student_id)
);

comment on table public.mentor_students is
  '관리자-담당학생 매핑. admin_id가 실제 role=admin 행인지, student_id가 실제 role=student 행인지는 '
  'DB 레벨 CHECK/트리거로 강제하지 않고 시딩 스크립트(scripts/seed-accounts.mjs) 책임으로 둔다 (프로토타입 스코프, ADR 0002 참고).';

alter table public.mentor_students enable row level security;

-- 이번 스코프(로그인 기능)에는 이 테이블을 클라이언트가 조회할 일이 없으므로 정책을 추가하지 않는다
-- = 기본적으로 전체 거부. 시딩은 service_role 키로 수행되어 RLS를 우회하므로 문제 없다.
--
-- "담당 학생 아카이브" 기능 스펙이 오면 아래와 같은 정책을 추가할 예정(지금은 미구현):
--   create policy "mentor_students_select_own_as_admin"
--     on public.mentor_students for select
--     using (auth.uid() = admin_id);
--   -- 그리고 profiles에도 "관리자는 자기 담당 학생 행을 select 가능" 정책이 함께 필요해진다.
--   -- [ADR 0004 메모] participations 의 admin select 정책(담당 학생 참여 이력)도 이 정책과 한 세트다.

-- =========================================================
-- 3. programs
--    진로·커리어 활동 프로그램 (CLAUDE.md 5장 + 스펙 확정 D의 추가 필드).
--    ADR 0003 / docs/specs/student-home.md
-- =========================================================
create table if not exists public.programs (
  id            uuid primary key default gen_random_uuid(),
  category      program_category not null,
  title         text not null,
  description   text not null,                      -- 참여 팝업에서 필수 표시(ADR 0004에서 실사용 시작). 프로토타입 전 프로그램에 설명이 있다.
  org           text not null,                      -- 주최/기관명. 확정 D. 모든 카드에 표시되므로 필수.
  date          date not null,                      -- 표시 포맷("7월 16일 (목)")은 프런트엔드가 생성한다.
  time          text not null,                      -- [주의] time 타입이 아니라 자유 텍스트다. 아래 comment 참고.
  capacity      integer,
  points        integer not null,
  career_track  career_track not null,              -- 확정 D/E. 계열 없는 프로그램은 매칭 축에서 누락되므로 필수.
  popularity    integer not null default 0,         -- 확정 D. 정적 값. [주의] 프로그램 인기 지표이지 학생 순위가 아니다.
  status        program_status not null default 'open', -- 확정 D. 정적 값(참여수/정원 파생 아님).
  is_published  boolean not null default true,      -- 게시/게시중단. 관리자 기능 "올리기/내리기"가 이 값을 토글한다.
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(), -- 추천 "최신순" 정렬의 시간 축 (확정 E). uuid PK는 생성 순서를 담지 못한다.

  constraint programs_capacity_positive check (capacity is null or capacity > 0),
  -- CLAUDE.md 7장 포인트 규칙(최소 150P, 최대 3000P, 끝자리 0)을 DB 레벨에서 강제한다.
  constraint programs_points_rule      check (points between 150 and 3000 and points % 10 = 0),
  constraint programs_popularity_range check (popularity >= 0)
);

comment on table public.programs is
  '진로·커리어 활동 프로그램. CLAUDE.md 5장 기본 필드 + 스펙 확정 D의 추가 필드(org, career_track, popularity, status). '
  '학업(자습·문제풀이) 활동은 담지 않는다 (CLAUDE.md 2장 2번).';
comment on column public.programs.time is
  '표시용 자유 텍스트다. Postgres time 타입이 아닌 이유: 프로토타입 실제 값이 "15:30–17:00" 뿐 아니라 '
  '"방과후", "점심·방과후", "온라인 접수", "무박 2일", "협의", "마감 18:00" 처럼 시각으로 표현 불가능한 값을 포함한다. '
  '프런트엔드는 이 값을 파싱하지 말고 그대로 출력할 것.';
comment on column public.programs.capacity is
  'NULL 허용 = 정원 미정/무제한. status 파생에 사용하지 않는다 (확정 D). '
  '[ADR 0004] 참여 신청이 생긴 뒤에도 정원 차단을 구현하지 않는다 — 확정 C-1: 시드 20건 전부 capacity 가 NULL 이라 '
  '정원 개념이 데모에 존재하지 않고, 따라서 "정원이 찼는데 status 는 open" 모순이 성립할 여지가 없다.';
comment on column public.programs.popularity is
  '[절대 원칙 가드] 프로그램의 인기 지표이지 학생 간 순위가 아니다. 학생 단위 집계/랭킹으로 파생시키는 설계 금지 (CLAUDE.md 2장 1번). '
  '학생 홈은 이 값을 표시하지도 정렬에 쓰지도 않는다(정렬은 계열 일치 우선 + created_at desc). '
  '사용처는 "프로그램 선택" 화면의 인기순 정렬이다(확정 B-1, ADR 0004에서 실사용 시작 — 정렬 입력으로만 쓰고 숫자를 화면에 렌더하지 않는다).';
comment on column public.programs.created_by is
  '프로그램을 등록한 관리자. on delete set null — 관리자 계정이 사라져도 프로그램 기록은 남긴다. '
  '시딩 시 데모 관리자(code=''ADM-0001'')의 id를 채운다 (scripts/seed-programs.mjs).';

alter table public.programs enable row level security;

-- [RLS 권한 경계] programs_select_published
--   대상 역할: authenticated (student, admin 공통 — role 구분 없이 동일 정책 적용)
--   허용 행: is_published = true 인 행만 select
--   불가능: 미게시(is_published = false) 행 조회 — 학생/관리자 모두 차단.
--           모든 insert/update/delete (아래 참고)
--   용도: 학생 홈의 추천 프로그램 조회 (docs/specs/student-home.md),
--         프로그램 선택 화면의 전체 목록 조회 (docs/specs/student-programs.md)
--
--   [to authenticated 를 명시하는 이유] using (is_published = true) 만 쓰고 to 절을 생략하면 기본 대상이
--   public 역할이라, 로그인하지 않은 anon 키 보유자도 전체 프로그램 목록을 읽을 수 있다. 개인정보는 아니지만
--   앱의 모든 프로그램 화면이 로그인 뒤에 있는데 데이터만 밖에 열어둘 이유가 없다.
--   (profiles_select_own 은 auth.uid() = id 조건 자체가 anon 을 걸러내 to 절 없이도 안전했다 — programs 는
--    그 방어가 없으므로 명시가 필요하다.)
create policy "programs_select_published"
  on public.programs
  for select
  to authenticated
  using (is_published = true);

-- [RLS 권한 경계] insert/update/delete 정책 없음 = 기본 전체 거부 (모든 역할, 모든 행에 대해 차단)
--  - 시딩(scripts/seed-programs.mjs)은 service_role 키로 수행되어 RLS를 우회하므로 이번 기능 동작에 지장 없다.
--  - 학생은 프로그램을 만들거나 고칠 수 없고, is_published=false 인 프로그램을 볼 수도 없다.
--
-- [관리자 정책을 이번에 넣지 않는 이유]
--   관리자 "프로그램 관리(올리기/내리기/수정)" 화면은 이번 스코프가 아니고 스펙도 아직 없다. 지금
--   "본인이 만든 행만(created_by = auth.uid())" 으로 할지 "전체 허용" 으로 할지 정하면 근거 없는 추측이 되고,
--   쓰이지 않는 쓰기 권한이 열린 채로 남는다. mentor_students 에 정책을 0개 둔 것과 같은 원칙
--   (= 이번 스코프에 필요한 최소 정책만). 프로그램 관리 스펙이 오면 별도 ADR로 아래를 함께 결정한다:
--     - admin insert/update 정책의 행 경계 (created_by 기준 vs 전체)
--     - admin 이 미게시(is_published=false) 행을 select 할 수 있게 하는 정책 (위 정책은 admin 에게도 감춘다)
--       [ADR 0004 주의] 그 정책이 생기면 아래 participations_insert_own 의 exists 서브쿼리가 admin 에게
--       미게시 행을 보여주게 된다. 그래서 그 서브쿼리는 p.is_published = true 를 명시적으로 다시 건다.

-- =========================================================
-- 4. participations
--    학생의 프로그램 신청/참여 행 (CLAUDE.md 5장). 이후 QR 인증·포인트·아카이브·만족도 평가가
--    전부 이 행 위에 쌓인다.
--    ADR 0004 / docs/specs/student-programs.md
--
--    [이 테이블이 앱 최초의 "쓰기" 경로다] 이전까지 RLS 정책은 select 2개뿐이었고 insert/update/delete 는
--    전 테이블 0개였다. 아래 participations_insert_own 이 학생이 DB에 쓰는 첫 경로이며, 이 파일에서
--    가장 조심해서 읽어야 할 블록이다.
-- =========================================================
create table if not exists public.participations (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references public.profiles(id) on delete cascade,
  program_id   uuid not null references public.programs(id) on delete cascade,
  status       participation_status not null default 'applied',

  -- [아래 4개 컬럼은 QR 이중 인증 스펙(다음) 몫이라 이번 스코프에서 값이 절대 채워지지 않는다.]
  --   그럼에도 지금 만드는 이유는 "안 쓰지만 미리 만들어두면 편해서"가 아니다:
  --   RLS with check 는 행 단위 술어라 "존재하지 않는 컬럼"을 미리 금지할 수 없다. 이 컬럼들을 QR 스펙에서
  --   추가하면 그 시점의 participations_insert_own 은 새 컬럼을 언급하지 않으므로, 학생이 entry_at 을
  --   채우거나 토큰을 심어 insert 하는 경로가 조용히 열린다(= QR 이중 인증 우회 = 부정 적립).
  --   지금 컬럼을 만들고 아래 정책에 "... is null" 을 박아두면 그 구멍이 애초에 생기지 않는다.
  --   즉 이 컬럼들은 이번 스펙의 보안 요구사항(스펙 이슈 1)을 성립시키는 전제다. ADR 0004 3번.
  entry_at     timestamptz,                          -- 입장 인증 시각. QR 스캔 성공 시에만 서버가 기록한다.
  exit_at      timestamptz,                          -- 퇴장 인증 시각. 기록 시 포인트 지급 + 만족도 평가 노출(CLAUDE.md 6장 3번).
  entry_token  text,                                 -- [주의] 형식 미정이라 text. 아래 comment 참고.
  exit_token   text,

  created_at   timestamptz not null default now(),   -- 신청 시각. ADR 0002/0003 전례(전 테이블에 존재) + 참여 이력의 기본 축.

  -- [중복 신청 차단 — 클라이언트 방어만으론 새로고침/두 탭/개발자도구에서 뚫린다]
  --   인수 조건이 "DB 제약으로도 막힌다"를 명시했다. 위반 시 23505 -> PostgREST HTTP 409.
  --   status 무관하게 (학생, 프로그램) 쌍당 1행. 확정 G-1(신청 취소 스코프 아님)이라 "취소 후 재신청" 충돌 없음.
  unique (student_id, program_id)
);

comment on table public.participations is
  '학생의 프로그램 신청/참여 행. 이번 스코프(프로그램 선택 + 참여 신청 팝업)에서는 status=applied 인 행이 생성되는 것까지만 동작한다. '
  'QR 입·퇴장 인증 / 포인트 지급 / 만족도 평가는 다음 스펙이며, 이 테이블의 정책은 그것들이 붙었을 때 뚫리지 않도록 지금 봉인해 둔 것이다 (ADR 0004). '
  '[시연 리셋] delete from public.participations;  (service_role 로 실행 — 학생/관리자 키로는 delete 정책이 0개라 불가능하다.)';
comment on column public.participations.status is
  '한 학생의 참여 진행도. [주의] programs.status 와 다른 개념이다(저쪽은 프로그램의 모집 상태). '
  '학생은 이 값을 applied 로만 insert 할 수 있고(participations_insert_own 의 with check), update 정책이 0개라 이후 변경도 불가능하다. '
  'entered/completed 로의 전이는 QR 토큰 검증을 통과한 서버 경로만 수행한다 (CLAUDE.md 2장 5번: QR은 부정 참여 방지 장치이므로 단순화하지 않는다).';
comment on column public.participations.entry_token is
  'QR 1회용 토큰. [형식 미정 -> text] career_track 등 값 집합이 확정된 것은 enum 으로 좁혔지만(ADR 0003), 토큰 형식(랜덤 문자열/base64/uuid 등)은 '
  'QR 스펙의 결정사항이라 지금 uuid 로 좁히면 추측이 된다. unique 제약도 붙이지 않는다 — 재사용 방지 메커니즘 자체가 QR 스펙 설계다. '
  '만료(발급+30분)·사용 여부를 DB 컬럼(예: entry_token_expires_at)에 둘지 QR payload 에 둘지도 그때 결정한다 (CLAUDE.md 6장).';
comment on column public.participations.created_at is
  '신청 시각. [알려진 틈 — 수용] with check 가 이 컬럼을 검사하지 않으므로 학생이 값을 위조해 insert 할 수 있다. '
  '위조 대상이 본인 행의 신청 시각뿐이고 어떤 권한/포인트 결정에도 쓰이지 않아 수용한다(ADR 0004 "알려진 틈"). '
  'created_at = now() 술어는 트랜잭션 내 now() 안정성에 기대는 비자명한 비교라, 프런트가 값을 보내는 순간 원인 불명의 RLS 에러를 낸다 '
  '(방어 이득 없이 디버깅 비용만 발생). 대신 프런트는 insert 에 student_id/program_id 외 어떤 컬럼도 보내지 않는다. '
  '이 값이 포인트/권한 판단에 쓰이게 되면 봉인 방법을 재검토한다.';

-- [인덱스를 추가로 만들지 않는 이유 — 의도적 결정, ADR 0003 "주의 4"와 동일]
--   데모 데이터가 20행 규모라 PK 외 인덱스는 순수 노이즈다. 단 위 unique (student_id, program_id) 가 만드는
--   인덱스는 제약의 부산물이라 예외이며, 선두 컬럼이 student_id 라 participations_select_own 의
--   student_id = auth.uid() 조회도 그대로 커버한다. program_id 단독 인덱스를 추가하지 말 것.

alter table public.participations enable row level security;

-- [RLS 권한 경계] participations_select_own
--   대상 역할: authenticated
--   허용 행: student_id = auth.uid() 인 행만 select ("본인이 신청한 것"만)
--   불가능: 다른 학생의 신청 내역 조회 (학생↔학생 차단). 관리자도 볼 수 없다 — admin 정책이 없다(아래 참고).
--   용도: 카드/팝업의 "신청됨" 판정, 홈 추천에서 이미 신청한 프로그램 제외 (확정 D-1)
--
--   [부수 효과 — 절대 원칙이 UI 규율이 아니라 RLS 구조로도 성립한다]
--   학생에게는 본인 행만 보이므로 count(*) 를 던져도 자기 신청 수만 나온다. 즉 "N명이 신청했어요"류의
--   신청자 수 표시나 학생 단위 집계/랭킹은 애초에 데이터를 얻을 수 없다 (CLAUDE.md 2장 1번).
create policy "participations_select_own"
  on public.participations
  for select
  to authenticated
  using (student_id = auth.uid());

-- [RLS 권한 경계] participations_insert_own  <<< 이 앱 최초의 쓰기 정책. 각 절이 실제 공격 경로를 하나씩 막는다.
--   대상 역할: authenticated
--   허용 행: 아래 with check 6절을 전부 만족하는 행만 insert
--   불가능(= 각 절이 막는 것):
--     1) student_id = auth.uid()          -> 남의 이름으로 신청 (student_id 위조).                       위반 시 42501/403
--     2) status = 'applied'               -> 스스로 "참여 완료" 상태로 insert.                            위반 시 42501/403
--     3) entry_at is null, exit_at is null-> 입·퇴장 시각을 직접 기록해 QR 인증을 건너뛰기.               위반 시 42501/403
--     4) entry_token/exit_token is null   -> 자기가 아는 토큰을 미리 심어두고 그 QR 을 생성하기.          위반 시 42501/403
--     5) exists(... is_published = true)  -> 미게시 프로그램에 신청 (uuid 를 알아냈다고 가정).            위반 시 42501/403
--     + unique (student_id, program_id)   -> 중복 신청 (제약이 담당).                                     위반 시 23505/409
--   용도: 참여 신청 팝업의 "참석 신청하기" (docs/specs/student-programs.md)
--
--   [2번과 3·4번이 지금 무의미해 보이는 것이 정확히 위험 지점이다]
--   현재는 포인트 지급 로직이 없어 완료 상태를 위조해도 아무 일이 없다. 그러나 QR 퇴장 인증이 포인트를
--   지급하는 순간(CLAUDE.md 6장 3번), 이 절들이 없으면 학생은 status:'completed' 한 줄로 QR 이중 인증을
--   통째로 건너뛴다. QR 2회 인증은 부정 참여 방지 장치인데(2장 5번) 그 옆에 뒷문을 열어두는 셈이다.
--   >>> 이 절들을 "지금 안 쓰니까"라며 지우지 말 것. 이것이 ADR 0004 의 존재 이유다.
--
--   [5번 — with check 안의 서브쿼리에 대해]
--   RLS 정책 표현식은 일반 SQL 표현식이라 서브쿼리를 쓸 수 있다. 참조되는 programs 의 RLS 도 이 안에서
--   함께 적용되므로(정책 표현식은 질의자 권한으로 평가된다 — Supabase 가 이런 경우 security definer 함수를
--   권하는 이유가 바로 이것이다) programs_select_published 가 자동으로 걸린다. 그럼에도 p.is_published = true 를
--   명시적으로 다시 쓰는 이유: 관리자 프로그램 관리 스펙이 "admin 은 미게시도 select 가능" 정책을 programs 에
--   추가하면(위 3번 절에 예고됨) 이 서브쿼리가 admin 에게 미게시 행을 보여주게 되어, participations 의 경계가
--   다른 테이블 정책 변경에 딸려 조용히 흔들린다. 명시하면 이 정책이 자기 경계를 스스로 지킨다.
--   (무한 재귀 없음: programs 정책은 participations 를 참조하지 않는다.)
--
--   [date < 오늘(H-1) 과 status(full/over/ing) 를 여기서 막지 않는 이유 — 경계선: 권한은 DB, 신청 가능 여부는 프런트]
--     - is_published 는 "관리자가 아직 공개하지 않은 데이터" = 권한 경계라 DB 가 막는다.
--     - status 의 join 매핑은 프런트 STATUS 맵이 소유한다(ADR 0003 4번). DB 에 status in ('open','wait') 를
--       박으면 같은 규칙이 두 레이어로 쪼개져 드리프트한다.
--     - 지난 날짜 신청은 부정 적립이 되지 않는다(포인트는 QR 퇴장 인증에서만 나오고, 지난 프로그램엔 스캔할
--       관리자가 없다). 게다가 정책 안의 current_date 는 세션 TimeZone(Supabase 기본 UTC) 기준이라 KST 와
--       어긋나고, 이를 피하려 (now() at time zone 'Asia/Seoul')::date 를 박으면 날짜 소스가 프런트 todayISO()
--       와 두 곳으로 갈린다(ADR 0003 6번 타임존 주의).
--     - 인수 조건도 "DB 제약으로도 막힌다"를 중복 신청 1건에만 요구한다.
--
--   [to authenticated 를 명시하는 이유] student_id = auth.uid() 는 anon 에서 auth.uid() 가 NULL 이라 자연히
--   거짓이 되지만, 이 테이블은 앱 최초의 쓰기 경로라 대상 역할을 독자의 추론에 맡기지 않는다. 특히 insert 에서
--   to 를 생략하면 대상이 public 역할이 되어 anon 차단이 술어 하나에만 걸린다.
create policy "participations_insert_own"
  on public.participations
  for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and status = 'applied'
    and entry_at is null
    and exit_at is null
    and entry_token is null
    and exit_token is null
    and exists (
      select 1
      from public.programs p
      where p.id = participations.program_id
        and p.is_published = true
    )
  );

-- [RLS 권한 경계] update/delete 정책 없음 = 기본 전체 거부 (모든 역할, 모든 행에 대해 차단)
--  - 확정 G-1: 신청 취소는 스코프가 아니다. mentor_students 에 정책을 0개 둔 원칙과 동일 — 필요할 때 연다.
--  - 정책이 0개면 RLS 가 행 자체를 보여주지 않으므로 update/delete 는 에러가 아니라 "0행 영향"으로 끝난다.
--  - 즉 학생은 신청 후 자기 행의 status 를 completed 로 바꾸거나 entry_at 을 채워 넣을 수 없다.
--  - 시연 리셋(delete from public.participations;)은 service_role 키로 수행되어 RLS 를 우회한다.
--
-- [학생이 지정 가능한 컬럼은 student_id, program_id 둘뿐이다]
--   나머지는 default 또는 위 with check 의 NULL 강제가 담당한다. 예외는 created_at(위 comment 의 "알려진 틈")과
--   id(본인 행의 PK 를 스스로 고르는 것뿐이라 무해). student_id 에 default auth.uid() 를 두지 않는 이유:
--   클라이언트가 값을 보내면 default 는 무시되므로 default 는 방어가 아니다 — 방어처럼 보이는 비방어 장치를
--   두면 나중에 읽는 사람이 "default 가 있으니 안전하다"고 오해한다. 방어는 오로지 with check 가 한다.
--
-- [관리자 정책을 이번에 넣지 않는 이유 — ADR 0003 이 programs 에서 내린 판단과 동일 + 하나 더]
--   QR 스캔 시 관리자는 남의 participations 행을 update 해야 하지만, 그 정책의 행 경계(담당 학생만 vs 전체)와
--   컬럼 경계(entry_at/status 만)는 QR 토큰 검증 설계와 한 몸이라 지금 정하면 추측이 된다.
--   >>> 추가 근거(중요): RLS 는 컬럼 단위가 아니다. for update using (관리자 조건) 같은 정책을 순진하게 열면
--       관리자가 그 행의 모든 컬럼을 바꿀 수 있다(student_id 를 다른 학생으로 옮기는 것 포함).
--       그래서 QR 스캔은 정책보다 security definer RPC(토큰을 인자로 받아 서버가 컬럼을 확정)가 유력하다.
--       QR 스펙의 별도 ADR에서 결정한다.
--   담당 학생 아카이브용 admin select 정책은 mentor_students 정책(위 2번 절)과 한 세트라 아카이브 스펙 몫이다.
--
-- [QR 스펙에서 컬럼이 추가되면 이 정책을 반드시 함께 재검토할 것]
--   with check 는 행 단위 술어라 새 컬럼을 자동으로 막지 않는다. 다만 위 4개 토큰/시각 컬럼을 지금 봉인해 둔
--   덕분에 리스크는 크게 줄어 있다 — 예컨대 entry_token_expires_at 이 추가되고 정책 개정을 잊더라도, 학생은
--   여전히 entry_token 을 심을 수 없으므로 만료 시각만 위조된 "존재하지 않는 토큰"은 쓸모가 없다.
--   컬럼 단위 insert 권한(revoke insert ...; grant insert (student_id, program_id) ...)은 이번에 기각했다
--   (근거: ADR 0004 "대안으로 고려했던 것"). 컬럼이 더 늘고 update 정책까지 열리는 QR 스펙 시점이 그 방법의 자리다.

-- =========================================================
-- 참고: 데모 데이터(계정 6개, mentor_students 5행, 프로그램 16~20건)는 이 파일에 하드코딩하지 않는다.
--  - 계정: auth.users는 Supabase Auth Admin API로만 안전하게 생성 가능하므로 scripts/seed-accounts.mjs
--    (Node, service_role 키)에서 수행한다. 계정 목록의 단일 출처는 docs/specs/auth-login.md의
--    "확정된 데모 계정" 표. 학생의 career_interest 시드 값은 ADR 0003 "시드 설계" 참고
--    (앱에 계열 선택 UI가 없어 시딩이 유일한 입력 경로다).
--  - 프로그램: scripts/seed-programs.mjs (Node, service_role 키)에서 수행한다. 마이그레이션이 아니라
--    스크립트인 이유와 시드 요구사항(미게시/지난 날짜 행 포함, 날짜는 리터럴이 아닌 "오늘 ± n일" 상대값)은
--    ADR 0003 "시드 설계" 참고.
--  - participations: 시드 없음. 신청은 앱에서 학생이 직접 만든다 — 가짜 데이터를 하드코딩하지 않는다(ADR 0004).
--  - 실행 순서: 마이그레이션 -> seed-accounts.mjs -> seed-programs.mjs
-- =========================================================
</content>
</invoke>
