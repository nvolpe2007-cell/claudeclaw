import React from 'react';
import { getRankInfo } from './ranks';
import RankBadge from './RankBadge.jsx';

export default function Leaderboard({ leaderboard, currentUserId }) {
  if (leaderboard.length === 0) {
    return (
      <div className="bg-[#0f0f0f] border border-[#1f2f27] rounded-xl p-6 text-center text-gray-500 font-mono text-sm">
        No sessions tracked yet. Be the first!
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {leaderboard.map((u, idx) => {
        const totalHours = u.total_seconds / 3600;
        const { current } = getRankInfo(totalHours);
        const isMe = u.id === currentUserId;
        return (
          <div
            key={u.id}
            className={`flex items-center gap-3 rounded-xl border p-4 ${
              isMe
                ? 'border-accent bg-accent/5'
                : 'border-[#1f2f27] bg-[#0f0f0f]'
            }`}
          >
            <span className="w-8 text-center font-mono font-bold text-gray-400">
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-mono font-bold text-sm truncate">
                  {u.name}
                  {isMe && <span className="text-accent"> (you)</span>}
                </p>
                <RankBadge rankName={current.name} size="sm" />
              </div>
              <p className="text-gray-500 text-xs font-mono mt-0.5">
                {u.session_count} session{u.session_count === 1 ? '' : 's'}
              </p>
            </div>
            <p className="font-mono font-bold text-accent tabular-nums whitespace-nowrap">
              {totalHours.toFixed(1)}h
            </p>
          </div>
        );
      })}
    </div>
  );
}
