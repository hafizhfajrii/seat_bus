import React, { Suspense, lazy, useEffect, useState } from 'react';
import { ParticipantView } from './components/ParticipantView';
import { useTheme } from './theme';

// Halaman admin dimuat hanya saat dibuka, sehingga peserta tidak mengunduh kode admin.
const AdminView = lazy(() =>
  import('./components/AdminView').then((m) => ({ default: m.AdminView }))
);

export const App: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const [route, setRoute] = useState<'participant' | 'admin'>(() =>
    window.location.pathname.startsWith('/admin') ? 'admin' : 'participant'
  );

  useEffect(() => {
    const onPopState = () => {
      setRoute(window.location.pathname.startsWith('/admin') ? 'admin' : 'participant');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (target: 'participant' | 'admin') => {
    const nextPath = target === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setRoute(target);
    window.scrollTo({ top: 0 });
  };

  if (route === 'admin') {
    return (
      <Suspense
        fallback={
          <div role="status" aria-live="polite" className="p-6 text-center text-sm opacity-70">
            Memuat halaman admin...
          </div>
        }
      >
        <AdminView
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigateParticipant={() => navigate('participant')}
        />
      </Suspense>
    );
  }

  return (
    <ParticipantView
      theme={theme}
      onToggleTheme={toggleTheme}
      onNavigateAdmin={() => navigate('admin')}
    />
  );
};

export default App;
