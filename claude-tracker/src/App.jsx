import React, { useEffect, useState, useCallback } from 'react';
import NameModal from './NameModal.jsx';
import Dashboard from './Dashboard.jsx';
import Leaderboard from './Leaderboard.jsx';
import { createOrUpdateUser, getLeaderboard } from './api';

const USER_ID_KEY = 'claude_tracker_user_id';
const USER_NAME_KEY = 'claude_tracker_user_name';

function generateUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [leaderboard, setLeaderboard] = useState([]);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const id = localStorage.getItem(USER_ID_KEY);
    const name = localStorage.getItem(USER_NAME_KEY);
    if (id && name) {
      setUser({ id, name });
    }
  }, []);

  const refreshLeaderboard = useCallback(async () => {
    try {
      const data = await getLeaderboard();
      setLeaderboard(data);
      setLoadError('');
    } catch (err) {
      setLoadError(err.message || 'Failed to reach the server');
    }
  }, []);

  useEffect(() => {
    if (user) refreshLeaderboard();
  }, [user, refreshLeaderboard]);

  const handleNameSubmit = async (name) => {
    const id = generateUuid();
    try {
      await createOrUpdateUser(id, name);
      localStorage.setItem(USER_ID_KEY, id);
      localStorage.setItem(USER_NAME_KEY, name);
      setUser({ id, name });
    } catch (err) {
      setLoadError(err.message || 'Failed to create user');
    }
  };

  if (!user) {
    return <NameModal onSubmit={handleNameSubmit} />;
  }

  return (
    <div className="min-h-screen bg-bg text-white">
      <div className="max-w-[480px] mx-auto px-4 py-6">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-mono font-bold text-lg text-accent">Claude Tracker</h1>
            <p className="text-gray-500 text-xs font-mono">{user.name}</p>
          </div>
        </header>

        <nav className="grid grid-cols-2 gap-2 mb-6">
          <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
            Dashboard
          </TabButton>
          <TabButton active={tab === 'leaderboard'} onClick={() => setTab('leaderboard')}>
            Leaderboard
          </TabButton>
        </nav>

        {loadError && (
          <p className="mb-4 text-red-400 text-xs font-mono text-center">{loadError}</p>
        )}

        {tab === 'dashboard' ? (
          <Dashboard user={user} leaderboard={leaderboard} onSessionSaved={refreshLeaderboard} />
        ) : (
          <Leaderboard leaderboard={leaderboard} currentUserId={user.id} />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`py-2.5 rounded-lg font-mono font-bold text-sm transition border ${
        active
          ? 'bg-accent text-black border-accent'
          : 'bg-[#0f0f0f] text-gray-400 border-[#1f2f27] hover:text-accent'
      }`}
    >
      {children}
    </button>
  );
}
