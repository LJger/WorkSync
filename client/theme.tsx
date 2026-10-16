import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemePreference = 'light' | 'dark' | 'system';
const preferenceKey = 'worksync:theme';
const ThemeContext = createContext<{
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (value: ThemePreference) => void;
}>(null!);

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(preferenceKey);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* The current page can still change theme without persistence. */ }
  return 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, updatePreference] = useState<ThemePreference>(readPreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0c1117' : '#eef1f4');
  }, [resolved]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const systemChanged = () => setSystemDark(media.matches);
    const storageChanged = (event: StorageEvent) => {
      if (event.key === preferenceKey || event.key === null) updatePreference(readPreference());
    };
    systemChanged();
    media.addEventListener('change', systemChanged);
    window.addEventListener('storage', storageChanged);
    return () => {
      media.removeEventListener('change', systemChanged);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);

  function setPreference(value: ThemePreference) {
    updatePreference(value);
    try { localStorage.setItem(preferenceKey, value); } catch { /* Best-effort persistence. */ }
  }

  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

export function ThemeControl() {
  const { preference, setPreference } = useTheme();
  const Icon = preference === 'system' ? Monitor : preference === 'dark' ? Moon : Sun;
  return <label className="theme-control" title="主题模式">
    <Icon size={17} aria-hidden="true" />
    <select aria-label="主题模式" value={preference} onChange={event => setPreference(event.target.value as ThemePreference)}>
      <option value="system">跟随系统</option><option value="light">浅色模式</option><option value="dark">深色模式</option>
    </select>
  </label>;
}
