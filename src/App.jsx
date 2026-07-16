import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './routes/ProtectedRoute';
import RootRedirect from './routes/RootRedirect';
import StudentLayout from './routes/StudentLayout';
import LoginPage from './pages/LoginPage';
import StudentHomePage from './pages/StudentHomePage';
import StudentProgramsPage from './pages/StudentProgramsPage';
import StudentArchivePage from './pages/StudentArchivePage';
import StudentMyPage from './pages/StudentMyPage';
import AdminHomePage from './pages/AdminHomePage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />

          {/* 학생 화면 — ProtectedRoute(role="student") 안쪽에서만 공통 셸이 렌더된다.
              /student/* 전체가 한 번의 role 검사를 공유하므로 권한 경계는 그대로다. */}
          <Route
            path="/student"
            element={
              <ProtectedRoute role="student">
                <StudentLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<StudentHomePage />} />
            {/* 확정 B: 홈의 네비/CTA/카드 목적지 — 대상 화면은 아직 placeholder */}
            <Route path="programs" element={<StudentProgramsPage />} />
            <Route path="archive" element={<StudentArchivePage />} />
            <Route path="mypage" element={<StudentMyPage />} />
          </Route>

          <Route
            path="/admin"
            element={
              <ProtectedRoute role="admin">
                <AdminHomePage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
