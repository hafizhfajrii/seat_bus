import React, { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'transit_theme';

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  );

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return { theme, setTheme, toggleTheme };
}

export const ThemeToggleButton: React.FC<{
  theme: ThemeMode;
  onToggle: () => void;
  compact?: boolean;
}> = ({ theme, onToggle, compact = false }) => {
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isDark ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
      aria-label={isDark ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
      className={
        compact
          ? 'w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0'
          : 'inline-flex items-center gap-1.5 px-3 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold transition-colors shrink-0'
      }
    >
      <span className="material-symbols-outlined text-[18px]">
        {isDark ? 'light_mode' : 'dark_mode'}
      </span>
      {!compact && <span>{isDark ? 'Terang' : 'Gelap'}</span>}
    </button>
  );
};

