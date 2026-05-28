# Typecheck Baseline

Date: 2026-05-26

Command:

```bash
npm run typecheck
```

Result: fails with 29 pre-existing TypeScript errors.

Regression check for the Storyteller share sprint: no error is reported in files touched by this sprint (`src/pages/BattleFeedback.tsx`, `src/lib/battles/loserShare.ts`, `src/lib/i18n/translations/*.ts`, `src/lib/supabase/database.types.ts`, `api/_shared/battle-og.ts`, `api/og/battle.ts`, `api/og/battle-image.ts`, `tests/unit/loserShare.test.ts`).

CI note: `.github/workflows/ci.yml` currently documents the same 29 pre-existing typecheck errors and runs typecheck with `continue-on-error: true` until the baseline is cleaned.

## Current Errors

1. `src/components/layout/Layout.tsx:11` - TS6133: `'hidePlayer' is declared but its value is never read.`
2. `src/components/producers/FoundingTrialExpiredPaywall.tsx:24` - TS2353: Object literal may only specify known properties, and `'tier'` does not exist in type `InvokeProtectedEdgeFunctionOptions`.
3. `src/components/producers/FoundingTrialExpiredPaywall.tsx:29` - TS2345: Argument of type `"errors.checkoutFailed"` is not assignable to the typed translation key union.
4. `src/components/producers/FoundingTrialExpiredPaywall.tsx:36` - TS2345: Argument of type `"founding.trialStillActive"` is not assignable to the typed translation key union.
5. `src/components/producers/FoundingTrialExpiredPaywall.tsx:38` - TS2345: Argument of type `"errors.checkoutFailed"` is not assignable to the typed translation key union.
6. `src/components/producers/FoundingTrialExpiredPaywall.tsx:53` - TS2345: Argument of type `"founding.trialExpiredTitle"` is not assignable to the typed translation key union.
7. `src/components/producers/FoundingTrialExpiredPaywall.tsx:56` - TS2345: Argument of type `"founding.trialExpiredSubtitle"` is not assignable to the typed translation key union.
8. `src/components/producers/FoundingTrialExpiredPaywall.tsx:62` - TS2345: Argument of type `"founding.continueWith"` is not assignable to the typed translation key union.
9. `src/components/producers/FoundingTrialExpiredPaywall.tsx:74` - TS2345: Argument of type `"founding.subscribeCta"` is not assignable to the typed translation key union.
10. `src/components/producers/FoundingTrialExpiredPaywall.tsx:80` - TS2345: Argument of type `"founding.readAccessRemains"` is not assignable to the typed translation key union.
11. `src/lib/pricing.ts:140` - TS2352: Conversion of type `GenericStringError[]` to type `ProductLicenseRow[]` may be a mistake because neither type sufficiently overlaps with the other.
12. `src/lib/supabase/invokeWithAuth.ts:60` - TS2322: Type `EdgeFunctionBody | undefined` is not assignable to the Supabase invoke body type because `null` is not assignable.
13. `src/pages/admin/AdminMessageDetail.tsx:285` - TS2304: Cannot find name `invokeWithAuth`.
14. `src/pages/admin/AdminNews.tsx:72` - TS2589: Type instantiation is excessively deep and possibly infinite.
15. `src/pages/admin/AdminPayouts.tsx:63` - TS2345: Fallback payout rows are not assignable to `FallbackPayout[]` because `purchase_id` can be `null`.
16. `src/pages/Pricing.tsx:596` - TS2769: No overload matches the Supabase relation call because the relation argument is typed as `string`.
17. `src/pages/ProducerBattles.tsx:516` - TS2345: Matchmaking opponent rows are not assignable to `MatchmakingOpponent[]` because `source` is typed as `string`.
18. `src/pages/ProducerBattles.tsx:603` - TS2322: Type `string | null` is not assignable to type `string | undefined`.
19. `src/pages/ProducerBattles.tsx:604` - TS2322: Type `string | null` is not assignable to type `string | undefined`.
20. `src/pages/ProducerBattles.tsx:870` - TS2322: Type `number | undefined` is not assignable to type `string | number`.
21. `src/pages/ProducerBattles.tsx:871` - TS18047: `quotaStatus` is possibly `null`.
22. `src/pages/ProducerBattles.tsx:872` - TS18047: `quotaStatus` is possibly `null`.
23. `src/pages/ProducerBattles.tsx:872` - TS18047: `quotaStatus` is possibly `null`.
24. `src/pages/ProducerBattles.tsx:876` - TS18047: `quotaStatus` is possibly `null`.
25. `src/pages/ProducerDashboard.tsx:847` - TS2345: Argument of type `"common.active"` is not assignable to the typed translation key union.
26. `src/pages/ProducerEarnings.tsx:118` - TS2322: Type `LucideIcon` is not assignable to type `ComponentType<{ className: string; }>`.
27. `src/pages/ProducerEarnings.tsx:123` - TS2322: Type `LucideIcon` is not assignable to type `ComponentType<{ className: string; }>`.
28. `src/pages/ProducerEarnings.tsx:128` - TS2322: Type `LucideIcon` is not assignable to type `ComponentType<{ className: string; }>`.
29. `src/pages/Settings.tsx:383` - TS2322: Type `string | null` is not assignable to type `string | undefined`.
