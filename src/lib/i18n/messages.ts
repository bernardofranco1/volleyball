// i18n message catalogue. Five locales (en, fr, de, es, pt). Keys are dotted and
// flat. `translate` falls back to English, then to the key itself, so a missing
// translation degrades gracefully rather than throwing.
//
// Scope note: this provides the i18n *infrastructure* + a translated core
// surface (shell nav, dashboard, settings). A full string sweep across every
// component is incremental work layered on top of this.

export const LOCALES = ["en", "fr", "de", "es", "pt"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
};

type Dict = Record<string, string>;

const en: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.competitions": "Competitions",
  "nav.matches": "Matches",
  "nav.scoreboard": "Scoreboard",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",
  "dashboard.title": "Dashboard",
  "dashboard.signedInAs": "Signed in as",
  "dashboard.competitions": "Create & manage competitions",
  "dashboard.matches": "Schedule and score matches",
  "dashboard.scoreboard": "Public TV display",
  "dashboard.settings": "Branding & language",
  "settings.title": "Settings",
  "settings.branding": "Branding",
  "settings.language": "Language",
  "settings.primaryColor": "Primary colour",
  "settings.secondaryColor": "Secondary colour",
  "settings.logoUrl": "Logo URL",
  "settings.fontFamily": "Font family",
  "settings.courtColors": "Court colours",
  "settings.save": "Save",
  "settings.saved": "Saved",
  "common.cancel": "Cancel",
};

const fr: Dict = {
  "nav.dashboard": "Tableau de bord",
  "nav.competitions": "Compétitions",
  "nav.matches": "Matchs",
  "nav.scoreboard": "Tableau d’affichage",
  "nav.settings": "Paramètres",
  "nav.signOut": "Se déconnecter",
  "dashboard.title": "Tableau de bord",
  "dashboard.signedInAs": "Connecté en tant que",
  "dashboard.competitions": "Créer et gérer les compétitions",
  "dashboard.matches": "Planifier et arbitrer les matchs",
  "dashboard.scoreboard": "Affichage public TV",
  "dashboard.settings": "Identité visuelle et langue",
  "settings.title": "Paramètres",
  "settings.branding": "Identité visuelle",
  "settings.language": "Langue",
  "settings.primaryColor": "Couleur principale",
  "settings.secondaryColor": "Couleur secondaire",
  "settings.logoUrl": "URL du logo",
  "settings.fontFamily": "Police",
  "settings.courtColors": "Couleurs du terrain",
  "settings.save": "Enregistrer",
  "settings.saved": "Enregistré",
  "common.cancel": "Annuler",
};

const de: Dict = {
  "nav.dashboard": "Übersicht",
  "nav.competitions": "Wettbewerbe",
  "nav.matches": "Spiele",
  "nav.scoreboard": "Anzeigetafel",
  "nav.settings": "Einstellungen",
  "nav.signOut": "Abmelden",
  "dashboard.title": "Übersicht",
  "dashboard.signedInAs": "Angemeldet als",
  "dashboard.competitions": "Wettbewerbe erstellen & verwalten",
  "dashboard.matches": "Spiele planen und werten",
  "dashboard.scoreboard": "Öffentliche TV-Anzeige",
  "dashboard.settings": "Branding & Sprache",
  "settings.title": "Einstellungen",
  "settings.branding": "Branding",
  "settings.language": "Sprache",
  "settings.primaryColor": "Primärfarbe",
  "settings.secondaryColor": "Sekundärfarbe",
  "settings.logoUrl": "Logo-URL",
  "settings.fontFamily": "Schriftart",
  "settings.courtColors": "Spielfeldfarben",
  "settings.save": "Speichern",
  "settings.saved": "Gespeichert",
  "common.cancel": "Abbrechen",
};

const es: Dict = {
  "nav.dashboard": "Panel",
  "nav.competitions": "Competiciones",
  "nav.matches": "Partidos",
  "nav.scoreboard": "Marcador",
  "nav.settings": "Ajustes",
  "nav.signOut": "Cerrar sesión",
  "dashboard.title": "Panel",
  "dashboard.signedInAs": "Sesión iniciada como",
  "dashboard.competitions": "Crear y gestionar competiciones",
  "dashboard.matches": "Programar y arbitrar partidos",
  "dashboard.scoreboard": "Pantalla pública de TV",
  "dashboard.settings": "Marca e idioma",
  "settings.title": "Ajustes",
  "settings.branding": "Marca",
  "settings.language": "Idioma",
  "settings.primaryColor": "Color principal",
  "settings.secondaryColor": "Color secundario",
  "settings.logoUrl": "URL del logotipo",
  "settings.fontFamily": "Tipografía",
  "settings.courtColors": "Colores de la pista",
  "settings.save": "Guardar",
  "settings.saved": "Guardado",
  "common.cancel": "Cancelar",
};

const pt: Dict = {
  "nav.dashboard": "Painel",
  "nav.competitions": "Competições",
  "nav.matches": "Jogos",
  "nav.scoreboard": "Placar",
  "nav.settings": "Configurações",
  "nav.signOut": "Sair",
  "dashboard.title": "Painel",
  "dashboard.signedInAs": "Conectado como",
  "dashboard.competitions": "Criar e gerir competições",
  "dashboard.matches": "Agendar e arbitrar jogos",
  "dashboard.scoreboard": "Exibição pública na TV",
  "dashboard.settings": "Marca e idioma",
  "settings.title": "Configurações",
  "settings.branding": "Marca",
  "settings.language": "Idioma",
  "settings.primaryColor": "Cor principal",
  "settings.secondaryColor": "Cor secundária",
  "settings.logoUrl": "URL do logótipo",
  "settings.fontFamily": "Fonte",
  "settings.courtColors": "Cores do campo",
  "settings.save": "Guardar",
  "settings.saved": "Guardado",
  "common.cancel": "Cancelar",
};

export const MESSAGES: Record<Locale, Dict> = { en, fr, de, es, pt };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Translate `key` for `locale`, falling back to English then the key itself. */
export function translate(locale: Locale, key: string): string {
  return MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key;
}
