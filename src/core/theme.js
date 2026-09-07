/**
 * Theme Manager - Settings Page Feature
 * Supports multiple themes + Make Your Own Theme
 * Stores in localStorage, applies via CSS variables
 */

const THEME_KEY = 'dost:theme';
const CUSTOM_THEME_KEY = 'dost:custom-theme';

export const THEMES = {
  dark: {
    id: 'dark',
    name: 'DOST Dark (Default)',
    nameHi: 'डॉस्ट डार्क',
    description: 'AMOLED black + green + cyan - Battery saving',
    colors: {
      '--bg': '#0B0F17',
      '--s1': '#111A2B',
      '--s2': '#182236',
      '--s3': '#1F2C44',
      '--line': '#253349',
      '--line2': '#32445F',
      '--green': '#FFB020',
      '--green-dim': '#D9950D',
      '--cyan': '#4CC9FF',
      '--cyan-dim': '#2F9EDB',
      '--fg': '#F2F6FF',
      '--fg2': '#A8B4CC',
      '--fg3': '#5D6B85',
      '--warn': '#FFD166',
      '--bad': '#FF5C7A',
    },
    isDark: true,
  },
  light: {
    id: 'light',
    name: 'Light',
    nameHi: 'लाइट',
    description: 'Warm paper + amber - Day mode',
    colors: {
      '--bg': '#FFFDF7',
      '--s1': '#FAF3E7',
      '--s2': '#F0E4CF',
      '--s3': '#E6D5B8',
      '--line': '#CDBB9C',
      '--line2': '#A08C6B',
      '--green': '#C77E0A',
      '--green-dim': '#A46408',
      '--cyan': '#0369A1',
      '--cyan-dim': '#075985',
      '--fg': '#241503',
      '--fg2': '#5F4E2E',
      '--fg3': '#85703F',
      '--warn': '#B8860B',
      '--bad': '#D32F2F',
    },
    isDark: false,
  },
  amoled: {
    id: 'amoled',
    name: 'AMOLED Pure Black',
    nameHi: 'एमोलेड प्योर ब्लैक',
    description: 'Pure black #000000 - Maximum battery saving',
    colors: {
      '--bg': '#000000',
      '--s1': '#000000',
      '--s2': '#0A0A0A',
      '--s3': '#141414',
      '--line': '#1A1A1A',
      '--line2': '#2A2A2A',
      '--green': '#00FF88',
      '--green-dim': '#00CC6A',
      '--cyan': '#00D4FF',
      '--cyan-dim': '#00A8CC',
      '--fg': '#FFFFFF',
      '--fg2': '#A0A0A0',
      '--fg3': '#606060',
      '--warn': '#FFCC00',
      '--bad': '#FF3366',
    },
    isDark: true,
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean Blue',
    nameHi: 'ओशन ब्लू',
    description: 'Deep blue + cyan - Calm and cool',
    colors: {
      '--bg': '#001122',
      '--s1': '#001A33',
      '--s2': '#002244',
      '--s3': '#002A55',
      '--line': '#003366',
      '--line2': '#004477',
      '--green': '#00FFCC',
      '--green-dim': '#00CCAA',
      '--cyan': '#00CCFF',
      '--cyan-dim': '#0099CC',
      '--fg': '#CCEEFF',
      '--fg2': '#88BBDD',
      '--fg3': '#557799',
      '--warn': '#FFAA00',
      '--bad': '#FF5566',
    },
    isDark: true,
  },
  forest: {
    id: 'forest',
    name: 'Forest Green',
    nameHi: 'फॉरेस्ट ग्रीन',
    description: 'Deep green + earth - Natural',
    colors: {
      '--bg': '#0A1A0A',
      '--s1': '#102010',
      '--s2': '#152A15',
      '--s3': '#1A331A',
      '--line': '#204020',
      '--line2': '#2A552A',
      '--green': '#66FF66',
      '--green-dim': '#44CC44',
      '--cyan': '#88FF88',
      '--cyan-dim': '#66CC66',
      '--fg': '#CCFFCC',
      '--fg2': '#88AA88',
      '--fg3': '#557755',
      '--warn': '#FFCC66',
      '--bad': '#FF7777',
    },
    isDark: true,
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset Orange',
    nameHi: 'सनसेट ऑरेंज',
    description: 'Warm orange + purple - Energetic',
    colors: {
      '--bg': '#1A0A00',
      '--s1': '#261500',
      '--s2': '#331E00',
      '--s3': '#402600',
      '--line': '#553300',
      '--line2': '#774400',
      '--green': '#FFAA00',
      '--green-dim': '#CC8800',
      '--cyan': '#FF6600',
      '--cyan-dim': '#CC5200',
      '--fg': '#FFEECC',
      '--fg2': '#CCAA88',
      '--fg3': '#997755',
      '--warn': '#FFCC00',
      '--bad': '#FF4444',
    },
    isDark: true,
  },
  midnight: {
    id: 'midnight',
    name: 'Midnight Purple',
    nameHi: 'मिडनाइट पर्पल',
    description: 'Deep purple + pink - Mysterious',
    colors: {
      '--bg': '#0F0A1A',
      '--s1': '#1A1030',
      '--s2': '#251540',
      '--s3': '#301A50',
      '--line': '#402060',
      '--line2': '#552A80',
      '--green': '#AA66FF',
      '--green-dim': '#8844CC',
      '--cyan': '#FF66CC',
      '--cyan-dim': '#CC44AA',
      '--fg': '#EEDDFF',
      '--fg2': '#AA88CC',
      '--fg3': '#775599',
      '--warn': '#FFCC66',
      '--bad': '#FF6666',
    },
    isDark: true,
  },
};

export function getCurrentThemeId() {
  try {
    return localStorage.getItem(THEME_KEY) || 'dark';
  } catch {
    return 'dark';
  }
}

export function getCustomTheme() {
  try {
    const custom = localStorage.getItem(CUSTOM_THEME_KEY);
    return custom ? JSON.parse(custom) : null;
  } catch {
    return null;
  }
}

export function saveCustomTheme(theme) {
  try {
    localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(theme));
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(themeId) {
  const custom = getCustomTheme();
  
  let theme;
  if (themeId === 'custom' && custom) {
    theme = custom;
  } else {
    theme = THEMES[themeId] || THEMES.dark;
  }

  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }

  // Set color-scheme for browser widgets
  root.style.setProperty('color-scheme', theme.isDark ? 'dark' : 'light');

  // Update theme-color meta
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.content = theme.colors['--bg'] || '#000000';
  }

  // Save
  try {
    localStorage.setItem(THEME_KEY, themeId);
  } catch {}

  return theme;
}

export function initTheme() {
  const themeId = getCurrentThemeId();
  return applyTheme(themeId);
}

// For settings page - list all themes including custom if exists
export function getAllThemes() {
  const custom = getCustomTheme();
  const all = { ...THEMES };
  if (custom) {
    all.custom = custom;
  }
  return all;
}
