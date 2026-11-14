# Index des routes API — extraction statique

Fichiers `route.ts` trouvés dans le dépôt. Les noms de méthodes, contrôles et imports sont des indices textuels, pas la preuve que chaque contrôle protège toutes les branches. Les routes dynamiques, le code indirect et les autorisations SQL nécessitent une trace manuelle. Aucun endpoint externe n’a été appelé.

## `/api/alexa/qualify`

Source : `src/app/api/alexa/qualify/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`.

Imports serveur/services directs : `@/server/alexa/model-gateway`, `@/server/auth/same-origin`.

## `/api/alexa/summary`

Source : `src/app/api/alexa/summary/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`.

Imports serveur/services directs : `@/server/alexa/case-synthesis`, `@/server/alexa/clinical-context`, `@/server/alexa/db`, `@/server/alexa/patient-resolver`, `@/server/auth/same-origin`.

## `/api/alexa/turn`

Source : `src/app/api/alexa/turn/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`.

Imports serveur/services directs : `@/server/alexa/agent-continuation`, `@/server/alexa/agent-loop`, `@/server/alexa/conversation-state`, `@/server/alexa/db`, `@/server/alexa/orchestrator`, `@/server/auth/same-origin`, `@/server/jarvis/client-sql`.

## `/api/auth/etat-installation`

Source : `src/app/api/auth/etat-installation/route.ts`. Méthodes déclarées détectées : `GET`.

Indices présents : aucun indice recherché repéré.

Imports serveur/services directs : `@/server/auth/provisioning`.

## `/api/auth/provisionner`

Source : `src/app/api/auth/provisionner/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`, `safeParse(`.

Imports serveur/services directs : `@/server/auth/provisioning`.

## `/api/auth/session`

Source : `src/app/api/auth/session/route.ts`. Méthodes déclarées détectées : `GET`.

Indices présents : `cookies(`.

Imports serveur/services directs : `@/server/auth/session`.

## `/api/auth/sign-in`

Source : `src/app/api/auth/sign-in/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `safeParse(`, `cookies(`.

Imports serveur/services directs : `@/server/auth/limite-debit`, `@/server/auth/session`.

## `/api/auth/sign-out`

Source : `src/app/api/auth/sign-out/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `cookies(`.

Imports serveur/services directs : `@/server/auth/session`, `@/server/voice/runtime`, `@/server/voice/session`.

## `/api/cabinet/appareils/revoquer`

Source : `src/app/api/cabinet/appareils/revoquer/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`.

Imports serveur/services directs : `@/server/cabinet/appareils`, `@/server/cabinet/porte`.

## `/api/cabinet/appareils`

Source : `src/app/api/cabinet/appareils/route.ts`. Méthodes déclarées détectées : `GET`.

Indices présents : `preparer(`.

Imports serveur/services directs : `@/server/cabinet/appareils`, `@/server/cabinet/porte`.

## `/api/cabinet/evenements`

Source : `src/app/api/cabinet/evenements/route.ts`. Méthodes déclarées détectées : `GET`.

Indices présents : `preparer(`, `withCaller(`.

Imports serveur/services directs : `@/server/db/pgPort`, `@/server/db/withCaller`, `@/services/log`.

## `/api/cabinet/invitation`

Source : `src/app/api/cabinet/invitation/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`.

Imports serveur/services directs : `@/server/cabinet/invitation`, `@/server/cabinet/porte`.

## `/api/communication/automations/evaluer`

Source : `src/app/api/communication/automations/evaluer/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`, `withCaller(`, `safeParse(`.

Imports serveur/services directs : `@/server/communication/automation`, `@/server/communication/schemas`, `@/server/db/withCaller`.

## `/api/communication/connexions/tester`

Source : `src/app/api/communication/connexions/tester/route.ts`. Méthodes déclarées détectées : `GET`.

Indices présents : `preparer(`, `safeParse(`.

Imports serveur/services directs : `@/server/communication/connexions-test`, `@/server/communication/schemas`.

## `/api/communication/envoyer`

Source : `src/app/api/communication/envoyer/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`, `withCaller(`, `safeParse(`.

Imports serveur/services directs : `@/server/communication/adaptateurs`, `@/server/communication/registre-outils`, `@/server/communication/schemas`, `@/server/db/pgPort`, `@/server/db/withCaller`.

## `/api/communication/statut`

Source : `src/app/api/communication/statut/route.ts`. Méthodes déclarées détectées : `GET`.

Indices présents : `preparer(`, `withCaller(`, `safeParse(`.

Imports serveur/services directs : `@/server/communication/schemas`, `@/server/db/pgPort`, `@/server/db/withCaller`.

## `/api/communication/webhook`

Source : `src/app/api/communication/webhook/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`, `withCaller(`, `safeParse(`.

Imports serveur/services directs : `@/server/communication/schemas`, `@/server/communication/signature`, `@/server/db/pgPort`, `@/server/db/withCaller`, `@/server/env`.

## `/api/db/rpc`

Source : `src/app/api/db/rpc/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`, `withCaller(`, `safeParse(`.

Imports serveur/services directs : `@/server/db/boundary-diagnostic`, `@/server/db/frontiere`, `@/server/db/pgPort`, `@/server/db/withCaller`.

## `/api/db/select`

Source : `src/app/api/db/select/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `preparer(`, `withCaller(`, `safeParse(`.

Imports serveur/services directs : `@/server/db/frontiere`, `@/server/db/pgPort`, `@/server/db/withCaller`.

## `/api/health`

Source : `src/app/api/health/route.ts`. Méthodes déclarées détectées : `GET`.

Indices présents : aucun indice recherché repéré.

Imports serveur/services directs : aucun repéré.

## `/api/jarvis/jarvis-analyze-session`

Source : `src/app/api/jarvis/jarvis-analyze-session/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`.

Imports serveur/services directs : `@/server/alexa/db`, `@/server/alexa/session-summary`, `@/server/auth/same-origin`.

## `/api/jarvis/jarvis-chat`

Source : `src/app/api/jarvis/jarvis-chat/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `identite(`, `refusIaClinique(`, `Authorization`, `verify`.

Imports serveur/services directs : `@/server/egress/classification`, `@/server/egress/external-call`, `@/server/env`, `@/server/jarvis/classifieur-intentions`, `@/server/jarvis/classifieur-jev`, `@/server/jarvis/client-sql`, `@/server/jarvis/intention-chainee`, `@/server/jarvis/preuves-recherche`, `@/server/jarvis/proposition`, `@/server/jarvis/pseudonymize`, `@/server/knowledge/citations`.

## `/api/jarvis/jarvis-live`

Source : `src/app/api/jarvis/jarvis-live/route.ts`. Méthodes déclarées détectées : `GET`, `POST`.

Indices présents : `identite(`, `refusIaClinique(`, `safeParse(`, `cookies(`.

Imports serveur/services directs : `@/server/auth/session`, `@/server/egress/external-call`, `@/server/jarvis/client-sql`, `@/server/voice/corps`, `@/server/voice/live-tools`.

## `/api/jarvis/jarvis-resume-cas`

Source : `src/app/api/jarvis/jarvis-resume-cas/route.ts`. Méthodes déclarées détectées : aucune.

Indices présents : aucun indice recherché repéré.

Imports serveur/services directs : aucun repéré.

## `/api/jarvis/jarvis-voice-in`

Source : `src/app/api/jarvis/jarvis-voice-in/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`, `cookies(`.

Imports serveur/services directs : `@/server/auth/same-origin`, `@/server/auth/session`, `@/server/env`, `@/server/voice/corps`, `@/server/voice/runtime`, `@/server/voice/session`.

## `/api/jarvis/jarvis-voice-out`

Source : `src/app/api/jarvis/jarvis-voice-out/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`.

Imports serveur/services directs : `@/server/auth/same-origin`, `@/server/env`, `@/server/voice/corps`, `@/server/voice/runtime`, `@/server/voice/session`.

## `/api/jarvis/jarvis-voice-session`

Source : `src/app/api/jarvis/jarvis-voice-session/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`.

Imports serveur/services directs : `@/server/auth/same-origin`, `@/server/env`, `@/server/voice/corps`, `@/server/voice/runtime`, `@/server/voice/session`.

## `/api/jarvis/jarvis-wake`

Source : `src/app/api/jarvis/jarvis-wake/route.ts`. Méthodes déclarées détectées : `POST`.

Indices présents : `isSameOriginRequest`, `identite(`, `refusIaClinique(`, `safeParse(`.

Imports serveur/services directs : `@/server/auth/same-origin`, `@/server/env`, `@/server/voice/corps`, `@/server/voice/session`, `@/server/voice/wake-runtime`.
