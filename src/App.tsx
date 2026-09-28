import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import { ResultProvider } from './context/ResultContext';
import { RealHistoryProvider } from './context/RealHistoryContext';
import { Shell } from './components/layout/Shell';

import { Dashboard } from './pages/Dashboard';
import { ResultSimulator } from './pages/ResultSimulator';
import { GameHistory } from './pages/GameHistory';
import { ApiConsolePage } from './pages/ApiConsolePage';
import { ApiLogsPage } from './pages/ApiLogsPage';
import { Configuration } from './pages/Configuration';
import { GameClientView } from './pages/GameClientView';
import { MockApiPage } from './pages/MockApiPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ResultProvider>
          <RealHistoryProvider>
            <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/simulator" element={<ResultSimulator />} />
              <Route path="/history" element={<GameHistory />} />
              <Route path="/game-client" element={<GameClientView />} />
              <Route path="/api-console" element={<ApiConsolePage />} />
              <Route path="/mock-api" element={<MockApiPage />} />
              <Route path="/api-logs" element={<ApiLogsPage />} />
              <Route path="/config" element={<Configuration />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </RealHistoryProvider>
        </ResultProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
