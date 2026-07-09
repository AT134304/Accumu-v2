#!/usr/bin/env node
/**
 * scripts/seed-accounts.mjs
 *
 * Accumu v2 — 데모 계정 시딩 스크립트
 * (ADR 0002 "데모 계정 시딩" 절차 그대로 구현, docs/adr/0002-profiles-schema-and-login-verification.md 참고)
 *
 * 목적: docs/specs/auth-login.md의 "확정된 데모 계정" 표(학생 5 + 관리자 1)를
 *   1) Supabase Auth 계정으로 생성 (가상 이메일 {code}@accumu.local, 비밀번호 accumu2026)
 *   2) public.profiles 행으로 함께 생성
 *   3) 관리자 1명(ADM-0001)이 학생 5명 전원을 담당하도록 public.mentor_students에 매핑
 * 하는 1회성 스크립트.
 *
 * 전제 조건
 *   - supabase/migrations/*.sql 이 대상 Supabase 프로젝트에 이미 적용되어 있어야 함
 *     (user_role enum, public.profiles, public.mentor_students 테이블 존재)
 *   - .env.seed 파일에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 값이 채워져 있어야 함
 *     (.env.seed.example 참고). SUPABASE_SERVICE_ROLE_KEY는 RLS를 우회하는 매우 민감한 키이므로
 *     절대 커밋하거나 프런트엔드 코드/번들에 노출하지 않는다.
 *
 * 실행 방법 (Supabase 프로젝트 URL/service_role key를 받은 뒤에만 실행)
 *   1. cp .env.seed.example .env.seed  # 값 채우기
 *   2. cd scripts && npm install
 *   3. node seed-accounts.mjs
 *
 * 재실행 안전성(idempotency)은 이번 스코프 요구사항이 아니다 (ADR 0002 "데모 계정 시딩" 4번).
 * 신규 Supabase 프로젝트에 1회 실행하는 것을 전제로 하며, 이미 계정이 존재하는 상태에서
 * 재실행하면 이메일 중복 에러로 스크립트가 즉시 중단되는 것이 기본 동작이다. (의도된 동작)
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------
// .env.seed 로더
// 외부 dotenv 의존성 없이 최소 구현 (주석 #, 빈 줄, 앞뒤 따옴표만 처리하는 단순 파서).
// 이미 process.env에 값이 있으면(예: CI에서 export) 덮어쓰지 않는다.
// ---------------------------------------------------------------------------
function loadEnvSeedFile() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(scriptDir, '..', '.env.seed');

  if (!existsSync(envPath)) {
    console.warn(
      `[경고] ${envPath} 파일을 찾을 수 없습니다. 셸에 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY를 ` +
        '이미 export 했다면 무시해도 됩니다. 그렇지 않다면 .env.seed.example을 복사해 채워주세요.'
    );
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);

    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvSeedFile();

// ---------------------------------------------------------------------------
// 가상 이메일 변환 규칙 (ADR 0002)
//   buildVirtualEmail(code) = code.trim().toLowerCase() + '@accumu.local'
//
// 주의(드리프트 방지): 이 로직의 단일 소스는 원래 src/lib/virtualEmail.js로 지정되어 있으나
// (ADR 0001 폴더 구조, ADR 0002), 이 스크립트를 작성하는 시점에는 아직 프런트엔드
// 프로젝트(Vite)가 스캐폴딩되지 않아 그 파일이 존재하지 않는다. 그래서 우선 로컬에 동일 로직을
// 복제해둔다. frontend-agent가 src/lib/virtualEmail.js를 만들고 나면, 이 함수를
// `import { buildVirtualEmail } from '../src/lib/virtualEmail.js'`로 교체해 이중 구현을 없앨 것.
// ---------------------------------------------------------------------------
function buildVirtualEmail(code) {
  return `${code.trim().toLowerCase()}@accumu.local`;
}

// ---------------------------------------------------------------------------
// 확정된 데모 계정
// 단일 출처: docs/specs/auth-login.md의 "확정된 데모 계정" 표.
// 표가 바뀌면 이 배열도 함께 수정한다.
// ---------------------------------------------------------------------------
const DEMO_PASSWORD = 'accumu2026';

const DEMO_ACCOUNTS = [
  { role: 'student', code: '10718', name: '신지훈' },
  { role: 'student', code: '10719', name: '김도윤' },
  { role: 'student', code: '10720', name: '이서연' },
  { role: 'student', code: '10721', name: '박민준' },
  { role: 'student', code: '10722', name: '최하은' },
  { role: 'admin', code: 'ADM-0001', name: '정하윤' },
];

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      '[오류] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다. ' +
        '.env.seed.example을 복사해 .env.seed를 만들고 값을 채워주세요.'
    );
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const studentIds = [];
  let adminId = null;

  for (const account of DEMO_ACCOUNTS) {
    const email = buildVirtualEmail(account.code);

    console.log(`[생성] ${account.role} ${account.code} (${account.name}) -> ${email}`);

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });

    if (createError) {
      console.error(`[중단] auth 계정 생성 실패 (${account.code}): ${createError.message}`);
      process.exit(1);
    }

    const userId = created.user.id;

    const { error: profileError } = await supabase.from('profiles').insert({
      id: userId,
      role: account.role,
      code: account.code,
      name: account.name,
    });

    if (profileError) {
      console.error(`[중단] profiles insert 실패 (${account.code}): ${profileError.message}`);
      process.exit(1);
    }

    if (account.role === 'student') {
      studentIds.push(userId);
    } else {
      adminId = userId;
    }
  }

  if (!adminId) {
    console.error('[중단] 관리자 계정이 생성되지 않았습니다. DEMO_ACCOUNTS 구성을 확인해주세요.');
    process.exit(1);
  }

  const mentorRows = studentIds.map((studentId) => ({
    admin_id: adminId,
    student_id: studentId,
  }));

  console.log(
    `[생성] mentor_students 매핑 ${mentorRows.length}건 (관리자 1명 -> 학생 ${mentorRows.length}명)`
  );

  const { error: mentorError } = await supabase.from('mentor_students').insert(mentorRows);

  if (mentorError) {
    console.error(`[중단] mentor_students insert 실패: ${mentorError.message}`);
    process.exit(1);
  }

  console.log('완료: 데모 계정 6개(학생 5 + 관리자 1) 및 mentor_students 매핑 생성됨.');
  console.log('로그인 확인: 학번/관리자코드 + 비밀번호 accumu2026 (docs/specs/auth-login.md 표 참고)');
}

main().catch((err) => {
  console.error('[예외 발생]', err);
  process.exit(1);
});
