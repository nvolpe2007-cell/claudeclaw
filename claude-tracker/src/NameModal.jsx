import React, { useState } from 'react';

export default function NameModal({ onSubmit }) {
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 bg-bg/95 flex items-center justify-center px-4 z-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-[480px] bg-[#0f0f0f] border border-[#1f2f27] rounded-xl p-6"
      >
        <h1 className="text-accent text-xl font-mono font-bold mb-1">Claude Tracker</h1>
        <p className="text-gray-400 text-sm mb-4">Choose a display name to get started.</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. night_coder"
          maxLength={32}
          className="w-full bg-black border border-[#1f2f27] rounded-lg px-3 py-2 text-accent font-mono focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="mt-4 w-full bg-accent text-black font-mono font-bold py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition"
        >
          Start Tracking
        </button>
      </form>
    </div>
  );
}
