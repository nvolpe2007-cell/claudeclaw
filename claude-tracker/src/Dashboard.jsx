import React, { useEffect, useRef, useState } from 'react';
import { postSession } from './api';
import { getRankInfo } from './ranks';
import RankBadge from './RankBadge.jsx';

function formatHms(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export default function Dashboard({ user, leaderboard, onSessionSaved }) {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  const intervalRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => clearInterval(intervalRef.current);
  }, []);

  const handleStart = () => {
    startRef.current = Date.now();
    setElapsed(0);
    setIsRunning(true);
    intervalRef.current = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 250);
  };

  const handleStop = async () => {
    clearInterval(intervalRef.current);
    setIsRunning(false);
    const durationSeconds = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
    setSaving(true);
    setError('');
    try {
      await postSession(user.id, durationSeconds);
      setElapsed(0);
      await onSessionSaved();
    } catch (err) {
      setError(err.message || 'Failed to save session');
    } finally {
      setSaving(false);
    }
  };

  const stats = leaderboard.find((u) => u.id === user.id);
  const totalSeconds = stats?.total_seconds ?? 0;
  const sessionCount = stats?.session_count ?? 0;
  const totalHours = totalSeconds / 3600;
  const avgSeconds = sessionCount > 0 ? totalSeconds / sessionCount : 0;
  const rank = leaderboard.findIndex((u) => u.id === user.id);
  const rankPosition = rank >= 0 ? rank + 1 : '-';

  const { current, next, progress } = getRankInfo(totalHours);

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-[#0f0f0f] border border-[#1f2f27] rounded-xl p-6 text-center">
        <p className="text-gray-500 text-xs font-mono uppercase tracking-widest mb-2">
          {isRunning ? 'Session in progress' : 'Ready to track'}
        </p>
        <p className="text-accent font-mono text-4xl font-bold tabular-nums">
          {formatHms(elapsed)}
        </p>
        <button
          onClick={isRunning ? handleStop : handleStart}
          disabled={saving}
          className={`mt-5 w-full py-3 rounded-lg font-mono font-bold transition disabled:opacity-40 ${
            isRunning
              ? 'bg-red-500/10 border border-red-500 text-red-400 hover:bg-red-500/20'
              : 'bg-accent text-black hover:opacity-90'
          }`}
        >
          {saving ? 'Saving...' : isRunning ? 'Stop Session' : 'Start Session'}
        </button>
        {error && <p className="mt-2 text-red-400 text-xs font-mono">{error}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Hours" value={totalHours.toFixed(1)} />
        <StatCard label="Sessions" value={sessionCount} />
        <StatCard label="Avg Session" value={formatHms(avgSeconds)} />
        <StatCard label="Global Rank" value={`#${rankPosition}`} />
      </div>

      <div className="bg-[#0f0f0f] border border-[#1f2f27] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <RankBadge rankName={current.name} />
          {next ? (
            <span className="text-gray-500 text-xs font-mono">
              {next.name} at {next.hours}h
            </span>
          ) : (
            <span className="text-gray-500 text-xs font-mono">Max rank</span>
          )}
        </div>
        <div className="w-full h-3 rounded-full bg-black border border-[#1f2f27] overflow-hidden">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="mt-2 text-gray-500 text-xs font-mono text-right">
          {(progress * 100).toFixed(0)}% to next rank
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="bg-[#0f0f0f] border border-[#1f2f27] rounded-xl p-4">
      <p className="text-gray-500 text-[10px] font-mono uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-accent font-mono text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
