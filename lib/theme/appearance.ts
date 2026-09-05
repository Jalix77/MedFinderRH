// Preference purement visuelle : aucune preference serveur, aucun cookie d'auth.
export const APPEARANCE_STORAGE_KEY = 'mf-appearance'
export const LEGACY_APPEARANCE_STORAGE_KEY = 'mf-preview-appearance'
export const APPEARANCES = [
  { id: 'light', label: 'Clair' },
  { id: 'dark', label: 'Sombre' },
  { id: 'system', label: 'Système' },
] as const
export type AppearanceId = (typeof APPEARANCES)[number]['id']
export const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

export function isAppearance(value: unknown): value is AppearanceId {
  return value === 'light' || value === 'dark' || value === 'system'
}

// Meme amorcage synchrone que le prototype, avant le contenu de la page.
// La cle historique conserve le choix du prototype si aucun choix applicatif n'existe.
export const THEME_BOOTSTRAP_SCRIPT = `(function(){var p='light';try{
var s=localStorage.getItem('${APPEARANCE_STORAGE_KEY}')||localStorage.getItem('${LEGACY_APPEARANCE_STORAGE_KEY}');
if(s==='light'||s==='dark'||s==='system')p=s;
}catch(e){}var d=p==='dark'||(p==='system'&&window.matchMedia('${DARK_MODE_QUERY}').matches);
document.documentElement.setAttribute('data-mf-theme',d?'dark':'light');})();`
