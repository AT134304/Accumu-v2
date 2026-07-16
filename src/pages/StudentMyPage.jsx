// Accumu v2 — 마이페이지 (placeholder — 확정 B)
// 포인트 전환/지역화폐, 관심 계열 선택 UI, QR 확인은 별도 스펙. 프로토타입 screen-mypage(630~666줄) 참고.
//
// [로그아웃] 기존 StudentHomePage 골격의 유일한 기능이던 로그아웃 경로를 여기로 옮겨 유지한다.
//   홈이 실제 화면으로 바뀌면서 갈 곳이 없어졌는데, 케빈이 학생/관리자 계정을 오가며 시연하려면
//   반드시 필요한 경로다. 프로토타입 나브에는 로그아웃이 없고 스펙 A의 나브 구성에도 없으므로
//   (아바타는 "정적" 이니셜로 명시됨) 계정 정보를 다루는 마이페이지에 둔다.
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PlaceholderScreen from '../components/student/PlaceholderScreen';

export default function StudentMyPage() {
  const { profile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlaceholderScreen eyebrow="My page" title="마이페이지" sub="나의 정보와 모은 포인트를 확인하세요">
      <div className="ph-meta">
        {profile?.name} · 학번 {profile?.code}
      </div>
      <button type="button" className="ph-logout" onClick={handleSignOut} disabled={busy}>
        {busy ? '로그아웃 중…' : '로그아웃'}
      </button>
    </PlaceholderScreen>
  );
}
