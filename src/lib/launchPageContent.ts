export interface LaunchPageContent {
  headerTagline: string;
  heroBadge: string;
  heroTitlePrimary: string;
  heroTitleAccent: string;
  heroMessage: string;
  heroSubline: string;
  heroChips: string[];
  conversionBullets: string[];
  highlightCards: Array<{ title: string; text: string }>;
  waitlistCountLabel: string;
  wavesLabel: string;
  formEyebrow: string;
  formTitle: string;
  formSubtitle: string;
  countdownLabel: string;
  countdownDaysLabel: string;
  countdownHoursLabel: string;
  countdownMinutesLabel: string;
  countdownSecondsLabel: string;
  emailLabel: string;
  emailPlaceholder: string;
  formSubmitLabel: string;
  formSubmittingLabel: string;
  trustText: string;
  socialProofText: string;
  formNote: string;
  loginTitle: string;
  loginText: string;
  loginCta: string;
  platformEyebrow: string;
  platformTitle: string;
  platformRows: Array<{ label: string; value: string }>;
  videoTitle: string;
  videoSubtitle: string;
  videoIframeTitle: string;
  processEyebrow: string;
  processSteps: Array<{ step: string; title: string; text: string }>;
  footerText: string;
}

const LAUNCH_PAGE_CONTENT_KIND = 'beatelion.launch-page-content.v1';

export const DEFAULT_LAUNCH_PAGE_CONTENT: LaunchPageContent = {
  headerTagline: 'Battles producteurs & accès privé',
  heroBadge: 'Accès privé par sélection',
  heroTitlePrimary: 'Aujourd’hui, tout le monde pense être bon.',
  heroTitleAccent: 'Mais personne n’est vraiment testé.',
  heroMessage: 'Entre dans le cercle des producteurs qui veulent vraiment connaître leur niveau.',
  heroSubline: 'Sur Beatelion, ton niveau est comparé, classé… et visible.',
  heroChips: ['Niveau réel', 'Battles privées', 'Sélection active'],
  conversionBullets: [
    '❌ Tes potes ne sont pas objectifs',
    '❌ Les likes ne veulent rien dire',
    '✅ Ici, ton niveau est comparé',
    '🔥 Classement réel. Pas d’illusion',
    '🚀 Les meilleurs prennent de l’avance',
  ],
  highlightCards: [
    {
      title: 'Classement réel',
      text: 'Des confrontations et retours qui montrent ton niveau autrement.',
    },
    {
      title: 'Battles sélectives',
      text: 'Les producteurs actifs passent devant les profils dormants.',
    },
    {
      title: 'Accès contrôlé',
      text: 'Les invitations sont ouvertes par vagues pour garder la qualité.',
    },
  ],
  waitlistCountLabel: 'producteurs déjà inscrits',
  wavesLabel: 'Accès ouverts par vagues',
  formEyebrow: 'Nouvelle demande',
  formTitle: 'Demande ton invitation',
  formSubtitle: 'Les premiers profils actifs sont traités en priorité.',
  countdownLabel: 'Lancement:',
  countdownDaysLabel: 'Jours',
  countdownHoursLabel: 'Heures',
  countdownMinutesLabel: 'Min',
  countdownSecondsLabel: 'Sec',
  emailLabel: 'Email professionnel ou principal',
  emailPlaceholder: 'ton@email.com',
  formSubmitLabel: 'Je veux connaître mon vrai niveau',
  formSubmittingLabel: 'Envoi en cours...',
  trustText: 'Accès limité — validation manuelle',
  socialProofText: '+100 producteurs déjà en attente',
  formNote: 'Tu recevras un email quand ton accès est disponible. Les profils producteurs actifs sont validés en premier.',
  loginTitle: 'Accès déjà validé ?',
  loginText: 'Connecte-toi directement avec le compte autorisé.',
  loginCta: 'Se connecter',
  platformEyebrow: 'Aperçu plateforme',
  platformTitle: "Ce que l'accès débloque",
  platformRows: [
    { label: 'Classements et signaux de niveau', value: 'avis, votes, progression' },
    { label: 'Battles entre producteurs', value: 'comparaison directe' },
    { label: 'Profil producteur sélectionné', value: 'accès par validation' },
  ],
  videoTitle: 'Regarde ce qui t’attend',
  videoSubtitle: 'Comprendre le lancement Beatelion.',
  videoIframeTitle: 'Beatelion Launch Video',
  processEyebrow: 'Process',
  processSteps: [
    { step: '01', title: 'Candidature', text: 'Tu demandes ton accès.' },
    { step: '02', title: 'Validation', text: 'Le profil producteur est vérifié.' },
    { step: '03', title: 'Entrée', text: 'Tu rejoins la plateforme.' },
  ],
  footerText: 'Plateforme réservée aux producteurs.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textOrDefault(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function textArrayOrDefault(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return [...fallback];
  return fallback.map((item, index) => textOrDefault(value[index], item));
}

function highlightCardsOrDefault(value: unknown, fallback: LaunchPageContent['highlightCards']) {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  return fallback.map((item, index) => {
    const candidate = value[index];
    if (!isRecord(candidate)) return { ...item };
    return {
      title: textOrDefault(candidate.title, item.title),
      text: textOrDefault(candidate.text, item.text),
    };
  });
}

function platformRowsOrDefault(value: unknown, fallback: LaunchPageContent['platformRows']) {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  return fallback.map((item, index) => {
    const candidate = value[index];
    if (!isRecord(candidate)) return { ...item };
    return {
      label: textOrDefault(candidate.label, item.label),
      value: textOrDefault(candidate.value, item.value),
    };
  });
}

function processStepsOrDefault(value: unknown, fallback: LaunchPageContent['processSteps']) {
  if (!Array.isArray(value)) return fallback.map((item) => ({ ...item }));
  return fallback.map((item, index) => {
    const candidate = value[index];
    if (!isRecord(candidate)) return { ...item };
    return {
      step: textOrDefault(candidate.step, item.step),
      title: textOrDefault(candidate.title, item.title),
      text: textOrDefault(candidate.text, item.text),
    };
  });
}

function mergeLaunchPageContent(value: unknown, fallback = DEFAULT_LAUNCH_PAGE_CONTENT): LaunchPageContent {
  if (!isRecord(value)) return { ...fallback };

  return {
    headerTagline: textOrDefault(value.headerTagline, fallback.headerTagline),
    heroBadge: textOrDefault(value.heroBadge, fallback.heroBadge),
    heroTitlePrimary: textOrDefault(value.heroTitlePrimary, fallback.heroTitlePrimary),
    heroTitleAccent: textOrDefault(value.heroTitleAccent, fallback.heroTitleAccent),
    heroMessage: textOrDefault(value.heroMessage, fallback.heroMessage),
    heroSubline: textOrDefault(value.heroSubline, fallback.heroSubline),
    heroChips: textArrayOrDefault(value.heroChips, fallback.heroChips),
    conversionBullets: textArrayOrDefault(value.conversionBullets, fallback.conversionBullets),
    highlightCards: highlightCardsOrDefault(value.highlightCards, fallback.highlightCards),
    waitlistCountLabel: textOrDefault(value.waitlistCountLabel, fallback.waitlistCountLabel),
    wavesLabel: textOrDefault(value.wavesLabel, fallback.wavesLabel),
    formEyebrow: textOrDefault(value.formEyebrow, fallback.formEyebrow),
    formTitle: textOrDefault(value.formTitle, fallback.formTitle),
    formSubtitle: textOrDefault(value.formSubtitle, fallback.formSubtitle),
    countdownLabel: textOrDefault(value.countdownLabel, fallback.countdownLabel),
    countdownDaysLabel: textOrDefault(value.countdownDaysLabel, fallback.countdownDaysLabel),
    countdownHoursLabel: textOrDefault(value.countdownHoursLabel, fallback.countdownHoursLabel),
    countdownMinutesLabel: textOrDefault(value.countdownMinutesLabel, fallback.countdownMinutesLabel),
    countdownSecondsLabel: textOrDefault(value.countdownSecondsLabel, fallback.countdownSecondsLabel),
    emailLabel: textOrDefault(value.emailLabel, fallback.emailLabel),
    emailPlaceholder: textOrDefault(value.emailPlaceholder, fallback.emailPlaceholder),
    formSubmitLabel: textOrDefault(value.formSubmitLabel, fallback.formSubmitLabel),
    formSubmittingLabel: textOrDefault(value.formSubmittingLabel, fallback.formSubmittingLabel),
    trustText: textOrDefault(value.trustText, fallback.trustText),
    socialProofText: textOrDefault(value.socialProofText, fallback.socialProofText),
    formNote: textOrDefault(value.formNote, fallback.formNote),
    loginTitle: textOrDefault(value.loginTitle, fallback.loginTitle),
    loginText: textOrDefault(value.loginText, fallback.loginText),
    loginCta: textOrDefault(value.loginCta, fallback.loginCta),
    platformEyebrow: textOrDefault(value.platformEyebrow, fallback.platformEyebrow),
    platformTitle: textOrDefault(value.platformTitle, fallback.platformTitle),
    platformRows: platformRowsOrDefault(value.platformRows, fallback.platformRows),
    videoTitle: textOrDefault(value.videoTitle, fallback.videoTitle),
    videoSubtitle: textOrDefault(value.videoSubtitle, fallback.videoSubtitle),
    videoIframeTitle: textOrDefault(value.videoIframeTitle, fallback.videoIframeTitle),
    processEyebrow: textOrDefault(value.processEyebrow, fallback.processEyebrow),
    processSteps: processStepsOrDefault(value.processSteps, fallback.processSteps),
    footerText: textOrDefault(value.footerText, fallback.footerText),
  };
}

export function parseLaunchPageContent(value: string | null | undefined, legacySubline?: string | null): LaunchPageContent {
  const fallback = {
    ...DEFAULT_LAUNCH_PAGE_CONTENT,
    heroSubline: legacySubline?.trim() || DEFAULT_LAUNCH_PAGE_CONTENT.heroSubline,
  };
  const raw = value?.trim();

  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && parsed.kind === LAUNCH_PAGE_CONTENT_KIND) {
      return mergeLaunchPageContent(parsed.content, fallback);
    }
    return mergeLaunchPageContent(parsed, fallback);
  } catch {
    return {
      ...fallback,
      heroMessage: raw,
    };
  }
}

export function serializeLaunchPageContent(content: LaunchPageContent) {
  return JSON.stringify({
    kind: LAUNCH_PAGE_CONTENT_KIND,
    content: mergeLaunchPageContent(content),
  });
}
