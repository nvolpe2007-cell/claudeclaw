import React from 'react';

export default function RankBadge({ rankName, size = 'md' }) {
  const sizeClasses = size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span
      className={`inline-block font-mono font-bold uppercase tracking-wide rounded-full border border-accent text-accent bg-accent/10 ${sizeClasses}`}
    >
      {rankName}
    </span>
  );
}
