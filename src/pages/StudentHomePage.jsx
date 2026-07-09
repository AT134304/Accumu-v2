// 학생 메인 화면 골격 — 로그인 성공 확인용 최소 화면 (상세 기능은 별도 스펙에서 진행)
import { useAuth } from '../context/AuthContext';

export default function StudentHomePage() {
  const { profile, signOut } = useAuth();

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 360,
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 16,
          boxShadow: 'var(--shadow)',
          padding: '32px 32px 28px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: 'var(--brand-dk)',
            marginBottom: 10,
          }}
        >
          학생 메인 화면 (준비 중)
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.5px', marginBottom: 6 }}>
          {profile?.name} 님
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 26 }}>
          학번 {profile?.code}
        </p>
        <button
          onClick={signOut}
          style={{
            width: '100%',
            height: 44,
            borderRadius: 11,
            background: 'var(--ink)',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14.5,
          }}
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
