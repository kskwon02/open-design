// AUTO-GENERATED — DO NOT EDIT BY HAND.
//
// Blended template popularity, used to order the plugin/example grid and the
// Home rail so the templates users actually reach for lead each category and
// sub-category (OPEND-449). Higher score = more popular; range [0, 1].
//
// How it is built (deterministic, creds-free transform):
//   score = 0.6 * norm(log1p(distinctUsers)) + 0.4 * norm(log1p(runs))
//   • window: trailing 28 days of `run_finished` events (by plugin_id)
//   • distinct users are the anti-gaming signal; runs add engagement depth
//   • log1p tames the head-template scale gap; min-max normalized over the
//     live-catalog template set so both metrics land in [0, 1]
//   • RETIRED plugins (absent from the live catalog) are dropped
//   • templates with no renderable preview are EXCLUDED — mode-seed entries
//     (e.g. the generic Live Artifact / HyperFrames options) live in the
//     composer mode picker, not the gallery, so usage must not float them up
//   • templates below 20 distinct users are OMITTED so thin-sample
//     tail templates keep their curated/visual fallback order
//
// Regenerate with: pnpm exec tsx scripts/refresh-plugin-popularity.ts --write
// Refreshed weekly by .github/workflows/refresh-plugin-popularity.yml.
// See pluginPopularity.RUNBOOK.md here.

export interface PluginPopularityMeta {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly weights: { readonly users: number; readonly runs: number };
  readonly minUsers: number;
  readonly count: number;
}

export const PLUGIN_POPULARITY_META: PluginPopularityMeta = {
  generatedAt: '2026-10-19',
  windowDays: 28,
  weights: { users: 0.6, runs: 0.4 },
  minUsers: 20,
  count: 57,
};

// Plugin id -> blended popularity score in [0, 1], most-popular first.
export const PLUGIN_POPULARITY: Readonly<Record<string, number>> = {
  'example-web-prototype': 1.0,
  'example-web-clone': 0.8135,
  'example-simple-deck': 0.8129,
  'example-velar-luxury-real-estate': 0.6768,
  'example-webgl-experience': 0.6326,
  'example-gamified-app': 0.6235,
  'example-open-design-landing': 0.5991,
  'example-mobile-app': 0.5435,
  'example-pricing-page': 0.5335,
  'image-template-vr-headset-exploded-view-poster': 0.5276,
  'example-hr-onboarding': 0.521,
  'example-fs-creative-voltage': 0.5059,
  'video-template-video-seedance-three-kingdoms-lyubu-yuanmen-archery': 0.4897,
  'example-fs-notebook-tabs': 0.4888,
  'example-motion-visual-lesson': 0.4877,
  'image-template-social-media-post-psg-transfer-announcement-poster': 0.4806,
  'example-video-hyperframes': 0.4752,
  'example-motion-future': 0.4737,
  'video-template-seedance-2-0-15-second-cinematic-japanese-romance-short-film': 0.4731,
  'image-template-social-media-post-vintage-sign-painter-sketch': 0.4635,
  'example-motion-frames': 0.4541,
  'image-template-profile-avatar-cyberpunk-anime-portrait-with-neon-face-text': 0.4508,
  'example-kanban-board': 0.4502,
  'example-resume-modern': 0.4482,
  'example-fs-electric-studio': 0.4445,
  'example-webgl-caustic-pool': 0.444,
  'example-motion-showreel': 0.4389,
  'example-html-ppt-zhangzara-block-frame': 0.4375,
  'example-dashboard': 0.4346,
  'example-social-carousel': 0.4293,
  'example-pm-spec': 0.4283,
  'example-motion-product-promo': 0.4235,
  'example-digital-eguide': 0.4233,
  'example-motion-ui-morph': 0.419,
  'example-guizang-ppt': 0.4165,
  'example-wireframe-mobile-flow': 0.4163,
  'example-social-media-matrix-tracker-template': 0.4073,
  'example-critique': 0.4019,
  'video-template-luxury-supercar-cinematic-narrative': 0.4011,
  'video-template-3d-animated-boy-building-lego': 0.3967,
  'example-image-poster': 0.3943,
  'image-template-anime-martial-arts-battle-illustration': 0.3917,
  'example-finance-report': 0.3888,
  'video-template-cinematic-east-asian-woman-hand-dance': 0.3778,
  'image-template-profile-avatar-monochrome-studio-portrait': 0.3765,
  'example-wireframe-sketch': 0.3722,
  'video-template-frame-bold-poster': 0.3644,
  'example-codex-interactive-capability-map': 0.3624,
  'video-template-frame-kinetic-type': 0.3578,
  'example-webgl-aurora-veil': 0.3541,
  'example-mobile-onboarding': 0.3535,
  'example-webgl-depth-gallery': 0.3528,
  'example-audio-jingle': 0.3432,
  'image-template-e-commerce-live-stream-ui-mockup': 0.3375,
  'example-blog-post': 0.3323,
  'image-template-notion-team-dashboard-live-artifact': 0.3225,
  'example-trading-analysis-dashboard-template': 0.3195,
};

// Templates with no renderable preview — suppressed from the visual gallery
// grid so they never show as an empty letter card. They still reach users
// through the composer's mode picker. Repo-derived (baked manifest + on-disk
// `od.preview` entry existence), refreshed alongside the scores above.
export const PLUGIN_NO_PREVIEW: readonly string[] = [
  'example-dcf-valuation',
  'example-design-brief',
  'example-hatch-pet',
  'example-html-ppt',
  'example-hyperframes',
  'example-last30days',
  'example-live-artifact',
  'example-pptx-html-fidelity-audit',
  'example-x-research',
];
