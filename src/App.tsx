import React, { useEffect, useState } from 'react';
import { ParticipantView } from './components/ParticipantView';
import { AdminView } from './components/AdminView';

export const App: React.FC = () => {
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
    return <AdminView onNavigateParticipant={() => navigate('participant')} />;
  }

  return <ParticipantView onNavigateAdmin={() => navigate('admin')} />;
};

export default App;

