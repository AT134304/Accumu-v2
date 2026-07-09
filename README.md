# Accumu × Claude Code 팀 세팅 키트 (v2 — 실제 작동 프로토타입)

React + Supabase 기반으로 "진짜 작동하는" Accumu를 만들기 위한 5개 에이전트 구성입니다. 기존 정적 HTML 프로토타입 대비 백엔드(인증·DB·QR 카메라 인증)가 새로 생기면서, 에이전트를 4개 → 5개로 확장했습니다 (backend-agent 추가).

## 설치 방법

1. 이 zip을 풀어서 나온 내용을 프로젝트 루트에 그대로 덮어씌우세요.
   - `CLAUDE.md` → 프로젝트 루트 (기존 v1 CLAUDE.md가 있다면 이 파일로 교체)
   - `.claude/agents/*.md` → 5개 에이전트 정의 (pm, architect, backend, frontend, qa)
   - `docs/specs/`, `docs/adr/`, `docs/db/` → 앞으로 쌓일 산출물용 빈 폴더
2. 기존 `Accumu_prototype.html`과 `Accumu_기획서_v2.docx`가 있다면 같은 프로젝트 루트에 함께 두세요. frontend-agent와 pm-agent가 참고합니다.
3. 터미널에서 프로젝트 폴더로 이동 후 `claude` 실행. `/agents`로 5개 에이전트 등록 확인.

## 기본 흐름

```
pm-agent (스펙 정리)
   ↓
architect-agent (데이터/RLS 설계, 필요시)
   ↓
backend-agent (Supabase 스키마·Auth·RLS·QR 토큰 로직)
   ↓
frontend-agent (React 화면 구현)
   ↓
qa-agent (원칙·권한·데이터 정합성 검증)
```

사용 예:
```
pm-agent 써서 "관리자 QR 스캔 화면" 스펙부터 정리해줘
architect-agent로 QR 토큰 테이블/검증 로직 설계하고 ADR 남겨줘
backend-agent로 방금 설계한 스키마·RLS 구현해줘
frontend-agent로 관리자 QR 스캔 화면 만들어줘
qa-agent로 방금 작업 검증해줘, 특히 권한 쪽 꼼꼼히 봐줘
```

간단한 UI 수정(색상, 문구, 여백)은 pm-agent 없이 바로 frontend-agent를 불러도 됩니다.

## 참고

- `CLAUDE.md`가 5개 에이전트 전체가 공유하는 "헌법"입니다. 원칙·데이터 모델·디자인 시스템이 바뀌면 반드시 이 파일부터 수정하세요.
- 이번 버전부터 **권한(RLS) 문제**가 QA 체크리스트에 새로 들어갔습니다 — 백엔드가 생기면서 "학생이 관리자 기능에 접근 못 하게" 막는 게 중요해졌기 때문입니다.
- 관리자 기능은 의도적으로 3가지(프로그램 관리·담당 학생 아카이브 조회·QR 스캔)로 제한해뒀습니다. 학교 단위 대시보드 등은 향후 확장 항목(기획서 11장)이라 지금 스코프가 아닙니다.
