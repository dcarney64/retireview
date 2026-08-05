import { Navigate, Route, Routes } from 'react-router-dom';

import AdminRoute from './components/auth/AdminRoute';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import Layout from './components/layout/Layout';
import AdminDashboard from './pages/admin/AdminDashboard';
import SecurityDashboard from './pages/admin/SecurityDashboard';
import UserManagement from './pages/admin/UserManagement';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Settings from './pages/Settings';
import Signup from './pages/Signup';

function AppShell({ children }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

function AdminShell({ children }) {
  return (
    <AdminRoute>
      <Layout>{children}</Layout>
    </AdminRoute>
  );
}

function Page({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Page><Login /></Page>} />
        <Route path="/signup" element={<Page><Signup /></Page>} />

        <Route path="/" element={<AppShell><Page><Dashboard /></Page></AppShell>} />
        {/* ADD YOUR APP ROUTES BELOW THIS LINE */}

        <Route path="/settings" element={<AppShell><Page><Settings /></Page></AppShell>} />

        <Route path="/admin" element={<AdminShell><Page><AdminDashboard /></Page></AdminShell>} />
        <Route path="/admin/users" element={<AdminShell><Page><UserManagement /></Page></AdminShell>} />
        <Route path="/admin/security" element={<AdminShell><Page><SecurityDashboard /></Page></AdminShell>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
