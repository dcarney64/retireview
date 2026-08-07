import { Navigate, Route, Routes } from 'react-router-dom';

import AdminRoute from './components/auth/AdminRoute';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import Layout from './components/layout/Layout';
import AdminDashboard from './pages/admin/AdminDashboard';
import SecurityDashboard from './pages/admin/SecurityDashboard';
import UserManagement from './pages/admin/UserManagement';
import Accounts from './pages/Accounts';
import BrokerSettings from './pages/BrokerSettings';
import Connections from './pages/Connections';
import Dashboard from './pages/Dashboard';
import Household from './pages/Household';
import Import from './pages/Import';
import Income from './pages/Income';
import NetWorth from './pages/NetWorth';
import OtherAssets from './pages/OtherAssets';
import Performance from './pages/Performance';
import RealEstate from './pages/RealEstate';
import Report from './pages/Report';
import Retirement from './pages/Retirement';
import TaxPlanning from './pages/TaxPlanning';
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
        <Route path="/broker-settings" element={<AppShell><Page><BrokerSettings /></Page></AppShell>} />
        {/* Legacy redirect — keeps old /connections bookmarks working */}
        <Route path="/connections" element={<AppShell><Page><Connections /></Page></AppShell>} />
        <Route path="/import"      element={<AppShell><Page><Import /></Page></AppShell>} />
        <Route path="/performance" element={<AppShell><Page><Performance /></Page></AppShell>} />
        <Route path="/net-worth" element={<AppShell><Page><NetWorth /></Page></AppShell>} />
        <Route path="/real-estate" element={<AppShell><Page><RealEstate /></Page></AppShell>} />
        <Route path="/household" element={<AppShell><Page><Household /></Page></AppShell>} />
        <Route path="/other-assets" element={<AppShell><Page><OtherAssets /></Page></AppShell>} />
        <Route path="/accounts" element={<AppShell><Page><Accounts /></Page></AppShell>} />
        <Route path="/retirement" element={<AppShell><Page><Retirement /></Page></AppShell>} />
        <Route path="/tax-planning" element={<AppShell><Page><TaxPlanning /></Page></AppShell>} />
        <Route path="/income" element={<AppShell><Page><Income /></Page></AppShell>} />
        <Route path="/report" element={<AppShell><Page><Report /></Page></AppShell>} />
        {/* Legacy redirect — Goal page became Retirement */}
        <Route path="/goal" element={<Navigate to="/retirement" replace />} />

        <Route path="/settings" element={<AppShell><Page><Settings /></Page></AppShell>} />

        <Route path="/admin" element={<AdminShell><Page><AdminDashboard /></Page></AdminShell>} />
        <Route path="/admin/users" element={<AdminShell><Page><UserManagement /></Page></AdminShell>} />
        <Route path="/admin/security" element={<AdminShell><Page><SecurityDashboard /></Page></AdminShell>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
