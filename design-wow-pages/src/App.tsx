import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { CustomerShell } from './components/CustomerShell';
import { DesignerShell } from './components/DesignerShell';
import { LoginPage } from './pages/LoginPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { CustomerRequestDetailPage } from './pages/CustomerRequestDetailPage';
import { NewRequestPage } from './pages/NewRequestPage';
import { AccountPage } from './pages/AccountPage';
import { QueuePage } from './pages/QueuePage';
import { CustomerListPage } from './pages/CustomerListPage';
import { DesignerHistoryPage } from './pages/DesignerHistoryPage';
import { ProfilePage } from './pages/ProfilePage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { DeliverPage } from './pages/DeliverPage';
import { PublicDesignerPage } from './pages/PublicDesignerPage';
import { HomePage } from './pages/HomePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/d/:id" element={<PublicDesignerPage />} />

        <Route element={<RequireAuth />}>
          <Route element={<CustomerShell />}>
            <Route path="/dashboard" element={<MyRequestsPage />} />
            <Route path="/new" element={<NewRequestPage />} />
            <Route path="/requests/:id" element={<CustomerRequestDetailPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>

          <Route element={<DesignerShell />}>
            <Route path="/designer" element={<QueuePage />} />
            <Route path="/designer/customers" element={<CustomerListPage />} />
            <Route path="/designer/history" element={<DesignerHistoryPage />} />
            <Route path="/designer/profile" element={<ProfilePage />} />
            <Route path="/designer/requests/:id" element={<RequestDetailPage />} />
            <Route path="/designer/requests/:id/deliver" element={<DeliverPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
