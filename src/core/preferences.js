/**
 * Music Preferences System
 * 
 * Stores user preferences for personalized music recommendations.
 * All data is stored in localStorage, no server involved.
 */

const STORAGE_KEY = 'dost:music:prefs';

const DEFAULT_PREFS = {
  languages: [],
  artists: [],
  genres: [],
  moods: [],
  eras: [],
  updatedAt: null,
};

export const AVAILABLE_LANGUAGES = [
  'Punjabi', 'Hindi', 'English', 'Urdu', 'Tamil', 'Telugu', 'Bengali',
  'Marathi', 'Gujarati', 'Bhojpuri', 'Kannada', 'Malayalam', 'Odia',
  'Assamese', 'Rajasthani', 'Haryanvi', 'Pakistani',
];

export const AVAILABLE_GENRES = [
  'Bollywood', 'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Classical', 'Sufi',
  'Qawwali', 'Ghazal', 'Devotional', 'Folk', 'Indie', 'Electronic',
  'Jazz', 'Blues', 'Country', 'Metal', 'Reggae',
];

export const AVAILABLE_MOODS = [
  'Happy', 'Sad', 'Romantic', 'Party', 'Chill', 'Energetic', 'Focus',
  'Workout', 'Sleep', 'Nostalgic', 'Motivational', 'Relaxing',
];

export const AVAILABLE_ERAS = [
  '2020s', '2010s', '2000s', '90s', '80s', '70s', '60s', 'Classic',
];

export function getPreferences() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(stored);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePreferences(prefs) {
  try {
    const updated = { ...prefs, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

export function updatePreferences(updates) {
  const current = getPreferences();
  const updated = { ...current, ...updates };
  return savePreferences(updated);
}

export function clearPreferences() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function hasPreferences() {
  const prefs = getPreferences();
  return prefs.languages.length > 0 || prefs.artists.length > 0 ||
         prefs.genres.length > 0 || prefs.moods.length > 0;
}

export function addArtist(artistName) {
  const prefs = getPreferences();
  const name = String(artistName || '').trim();
  if (!name) return false;
  if (prefs.artists.includes(name)) return false;
  if (prefs.artists.length >= 20) return false; // limit
  prefs.artists.push(name);
  return savePreferences(prefs);
}

export function removeArtist(artistName) {
  const prefs = getPreferences();
  prefs.artists = prefs.artists.filter(a => a !== artistName);
  return savePreferences(prefs);
}

export function toggleLanguage(lang) {
  const prefs = getPreferences();
  if (prefs.languages.includes(lang)) {
    prefs.languages = prefs.languages.filter(l => l !== lang);
  } else {
    prefs.languages.push(lang);
  }
  return savePreferences(prefs);
}

export function toggleGenre(genre) {
  const prefs = getPreferences();
  if (prefs.genres.includes(genre)) {
    prefs.genres = prefs.genres.filter(g => g !== genre);
  } else {
    prefs.genres.push(genre);
  }
  return savePreferences(prefs);
}

export function toggleMood(mood) {
  const prefs = getPreferences();
  if (prefs.moods.includes(mood)) {
    prefs.moods = prefs.moods.filter(m => m !== mood);
  } else {
    prefs.moods.push(mood);
  }
  return savePreferences(prefs);
}

export function toggleEra(era) {
  const prefs = getPreferences();
  if (prefs.eras.includes(era)) {
    prefs.eras = prefs.eras.filter(e => e !== era);
  } else {
    prefs.eras.push(era);
  }
  return savePreferences(prefs);
}

/**
 * Build a search query based on preferences
 * Used to fetch personalized recommendations
 */
export function buildPreferenceQuery(prefs = null) {
  const p = prefs || getPreferences();
  const parts = [];
  
  if (p.languages.length > 0) {
    parts.push(p.languages[Math.floor(Math.random() * p.languages.length)]);
  }
  if (p.genres.length > 0) {
    parts.push(p.genres[Math.floor(Math.random() * p.genres.length)]);
  }
  if (p.moods.length > 0) {
    parts.push(p.moods[Math.floor(Math.random() * p.moods.length)]);
  }
  
  return parts.length > 0 ? parts.join(' ') : 'trending';
}

/**
 * Get personalized artist suggestions based on preferences
 */
export function getSuggestedArtists(prefs = null) {
  const p = prefs || getPreferences();
  if (p.artists.length === 0) return [];
  
  // Return user's favorite artists + some variations
  return p.artists.slice(0, 8);
}

/**
 * Check if a track matches user preferences
 * Returns a score (higher = better match)
 */
export function scoreTrack(track, prefs = null) {
  const p = prefs || getPreferences();
  if (!hasPreferences()) return 0;
  
  let score = 0;
  const title = (track.title || '').toLowerCase();
  const artist = (track.artist || '').toLowerCase();
  
  // Language match
  for (const lang of p.languages) {
    if (title.includes(lang.toLowerCase()) || artist.includes(lang.toLowerCase())) {
      score += 10;
    }
  }
  
  // Artist match
  for (const art of p.artists) {
    if (artist.includes(art.toLowerCase())) {
      score += 20;
    }
  }
  
  // Genre match
  for (const genre of p.genres) {
    if (title.includes(genre.toLowerCase()) || (track.genre || '').toLowerCase().includes(genre.toLowerCase())) {
      score += 8;
    }
  }
  
  return score;
}
