# Notices et attributions

Cornelius s’appuie sur le travail d’autres projets. Ce fichier les cite, avec leur licence, comme leurs auteurs le demandent. Il accompagne toute copie de Cornelius, avec le fichier [`LICENSE`](LICENSE).

Cornelius lui-même est distribué sous la [PolyForm Noncommercial License 1.0.0](LICENSE) :

> Required Notice: Copyright (c) 2026 Entremakers SAS, Les Frères Poulain (https://github.com/lfpoulain/Cornelius)

Chaque projet ci-dessous garde sa propre licence : celle de Cornelius ne s’applique pas à eux.

## Inclus dans le dépôt

Ces fichiers de tiers sont copiés dans le dépôt. Leur notice doit rester à côté d’eux, dans toute copie.

| Élément | Fichiers | Auteurs | Licence | Notice |
| --- | --- | --- | --- | --- |
| Police DM Sans | `web/assets/fonts/` | Copyright 2014 The DM Sans Project Authors (<https://github.com/googlefonts/dm-fonts>) | SIL Open Font License 1.1 | `web/assets/fonts/dmsans-OFL.txt` |
| Police DM Mono | `web/assets/fonts/` | Copyright 2020 The DM Mono Project Authors (<https://www.github.com/googlefonts/dm-mono>) | SIL Open Font License 1.1 | `web/assets/fonts/dmmono-OFL.txt` |
| Police Epilogue | `web/assets/fonts/` | Copyright 2020 The Epilogue Project Authors (<https://github.com/Etcetera-Type-Co/Epilogue>) | SIL Open Font License 1.1 | `web/assets/fonts/epilogue-OFL.txt` |
| Composants shadcn/ui | `web/components/ui/` | Copyright (c) 2023 shadcn (<https://ui.shadcn.com>) | MIT | `web/components/ui/LICENSE.md` |
| Modèle du mot d’appel « Cornelius » | `models/cornelius.onnx` | Entraîné pour Cornelius avec openWakeWord (Apache 2.0, David Scripka), à partir des voix Piper Siwis (CC BY 4.0), UPMC (CC BY-SA 4.0) et Tom (AGPL v3), et des caractéristiques négatives openwakeword_features (CC BY-NC-SA 4.0, David Scripka) | CC BY-NC-SA 4.0, usage non commercial | `models/cornelius.onnx.LICENSE` |

## Principales bibliothèques

L’interface compilée (`dist/web`) contient notamment React et React DOM (MIT, Meta Platforms, Inc. et ses affiliés), Three.js (MIT, three.js authors), Radix UI (MIT, WorkOS), Lucide (ISC, Lucide Contributors), Tailwind CSS et tailwind-merge (MIT), clsx (MIT, Luke Edwards) et class-variance-authority (Apache 2.0, Joe Bell). Le serveur repose sur Fastify (MIT, The Fastify Team), la bibliothèque OpenAI pour Node.js (Apache 2.0, OpenAI), ws (MIT), Ajv (MIT) et selfsigned (MIT). Les textes complets de leurs licences sont dans `node_modules/<paquet>/` après `npm ci`.

La perception et la génération d’images utilisent ONNX Runtime (MIT, Microsoft), OpenCV (Apache 2.0), NumPy, SciPy et scikit-learn (BSD 3-Clause), Pillow (licence HPND/MIT-CMU), PyTorch (BSD 3-Clause), Diffusers, Transformers, Accelerate, Tokenizers, safetensors et huggingface_hub (Apache 2.0, Hugging Face), et openWakeWord (Apache 2.0, David Scripka). Leurs versions sont fixées dans `perception/requirements*.txt` et `image_generation/requirements.txt` ; leurs licences sont installées avec elles dans `.venv` et `.venv-image`.

## Modèles téléchargés

En dehors du mot d’appel « Cornelius » (voir plus haut), Cornelius ne contient aucun modèle : ils sont téléchargés sur l’ordinateur de l’utilisateur, chacun avec sa licence. Ils sont cités ici parce que Cornelius les utilise.

| Modèle | Auteurs | Licence |
| --- | --- | --- |
| YuNet (détection des visages) | OpenCV Zoo, Shiqi Yu et al. | MIT |
| SFace (reconnaissance des visages) | OpenCV Zoo, Yaoyao Zhong et al. | Apache 2.0 |
| Silero VAD (détection de la parole) | Silero Team | MIT |
| LFM2.5-VL 450M, 1.6B et 3B (vision locale) | Liquid AI | LFM Open License v1.0 |
| Prétraitement du mot d’appel (`melspectrogram.onnx`, `embedding_model.onnx`) | openWakeWord, David Scripka | voir [docs/reference/licences.md](docs/reference/licences.md) |
| SDXL Turbo | Stability AI | Stability AI Community License |
| SANA-Sprint 0.6B | NVIDIA, MIT Han Lab (Efficient-Large-Model) | Apache 2.0, avec les conditions de son encodeur Gemma |
| FLUX.2 Klein 4B | Black Forest Labs | Apache 2.0 |
| Z-Image Turbo | Tongyi-MAI (Alibaba) | Apache 2.0 |

Le modèle « Cornelius » a été entraîné avec [wakeword-generator](https://github.com/lfpoulain/wakeword-generator), un projet séparé qui télécharge des données et des voix de tiers (openwakeword_features en CC BY-NC-SA 4.0, voix Piper Siwis en CC BY 4.0, UPMC en CC BY-SA 4.0, Tom en AGPL v3, moteur Piper en GPL 3.0). Gardez leurs attributions si vous diffusez un modèle entraîné avec eux : voir [docs/reference/licences.md](docs/reference/licences.md).

## Services en ligne

Cornelius se connecte, si vous les configurez, à OpenAI (conversation et mémoire), Météo Concept (prévisions), PRIM d’Île-de-France Mobilités (passages en temps réel), Home Assistant et vos agents Hermes. Leur usage est soumis à leurs propres conditions, acceptées avec votre compte chez chacun.

## Toutes les bibliothèques npm

Liste générée depuis `package-lock.json` par `npm run notices`. « exécution » : utilisée par Cornelius en fonctionnement ; « outil » : compilation, tests ou lancement en TypeScript.

<!-- npm:début -->
| Paquet | Version | Licence | Rôle |
| --- | --- | --- | --- |
| @bufbuild/protobuf | 1.10.1 | (Apache-2.0 AND BSD-3-Clause) | exécution |
| @datastructures-js/deque | 1.0.8 | MIT | exécution |
| @dimforge/rapier3d-compat | 0.12.0 | Apache-2.0 | outil |
| @emnapi/core | 1.11.1 | MIT | outil |
| @emnapi/runtime | 1.11.1 | MIT | outil |
| @emnapi/wasi-threads | 1.2.2 | MIT | outil |
| @esbuild/aix-ppc64 | 0.28.2 | MIT | outil |
| @esbuild/android-arm64 | 0.28.2 | MIT | outil |
| @esbuild/android-arm | 0.28.2 | MIT | outil |
| @esbuild/android-x64 | 0.28.2 | MIT | outil |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | outil |
| @esbuild/darwin-x64 | 0.28.2 | MIT | outil |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | outil |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | outil |
| @esbuild/linux-arm64 | 0.28.2 | MIT | outil |
| @esbuild/linux-arm | 0.28.2 | MIT | outil |
| @esbuild/linux-ia32 | 0.28.2 | MIT | outil |
| @esbuild/linux-loong64 | 0.28.2 | MIT | outil |
| @esbuild/linux-mips64el | 0.28.2 | MIT | outil |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | outil |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | outil |
| @esbuild/linux-s390x | 0.28.2 | MIT | outil |
| @esbuild/linux-x64 | 0.28.2 | MIT | outil |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | outil |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | outil |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | outil |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | outil |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | outil |
| @esbuild/sunos-x64 | 0.28.2 | MIT | outil |
| @esbuild/win32-arm64 | 0.28.2 | MIT | outil |
| @esbuild/win32-ia32 | 0.28.2 | MIT | outil |
| @esbuild/win32-x64 | 0.28.2 | MIT | outil |
| @fastify/accept-negotiator | 2.1.0 | MIT | exécution |
| @fastify/ajv-compiler | 4.0.6 | MIT | exécution |
| @fastify/cookie | 11.1.2 | MIT | exécution |
| @fastify/error | 4.2.0 | MIT | exécution |
| @fastify/fast-json-stringify-compiler | 5.1.0 | MIT | exécution |
| @fastify/forwarded | 3.0.2 | MIT | exécution |
| @fastify/merge-json-schemas | 0.2.1 | MIT | exécution |
| @fastify/proxy-addr | 5.1.1 | MIT | exécution |
| @fastify/rate-limit | 11.2.0 | MIT | exécution |
| @fastify/send | 4.1.1 | MIT | exécution |
| @fastify/static | 10.1.3 | MIT | exécution |
| @fastify/websocket | 11.3.0 | MIT | exécution |
| @floating-ui/core | 1.8.0 | MIT | exécution |
| @floating-ui/dom | 1.8.0 | MIT | exécution |
| @floating-ui/react-dom | 2.1.9 | MIT | exécution |
| @floating-ui/utils | 0.2.12 | MIT | exécution |
| @hono/node-server | 2.1.5 | MIT | exécution |
| @jridgewell/gen-mapping | 0.3.13 | MIT | outil |
| @jridgewell/remapping | 2.3.5 | MIT | outil |
| @jridgewell/resolve-uri | 3.1.2 | MIT | outil |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | outil |
| @jridgewell/trace-mapping | 0.3.31 | MIT | outil |
| @leichtgewicht/ip-codec | 2.0.5 | MIT | exécution |
| @livekit/mutex | 1.1.1 | Apache-2.0 | exécution |
| @livekit/rtc-ffi-bindings-darwin-arm64 | 0.12.56 | Apache-2.0 | exécution |
| @livekit/rtc-ffi-bindings-darwin-x64 | 0.12.56 | Apache-2.0 | exécution |
| @livekit/rtc-ffi-bindings-linux-arm64-gnu | 0.12.56 | Apache-2.0 | exécution |
| @livekit/rtc-ffi-bindings-linux-x64-gnu | 0.12.56 | Apache-2.0 | exécution |
| @livekit/rtc-ffi-bindings-win32-x64-msvc | 0.12.56 | Apache-2.0 | exécution |
| @livekit/rtc-ffi-bindings | 0.12.56 | Apache-2.0 | exécution |
| @livekit/rtc-node | 0.13.28 | Apache-2.0 | exécution |
| @livekit/typed-emitter | 3.0.0 | MIT | exécution |
| @lukeed/ms | 2.0.2 | MIT | exécution |
| @mistralai/mistralai | 3.1.0 | Apache-2.0 | exécution |
| @modelcontextprotocol/sdk | 1.32.1 | MIT | exécution |
| @napi-rs/wasm-runtime | 1.1.4 | MIT | outil |
| @noble/hashes | 1.8.0 | MIT | exécution |
| @opentelemetry/semantic-conventions | 1.43.0 | Apache-2.0 | exécution |
| @oxc-project/types | 0.149.0 | MIT | outil |
| @peculiar/asn1-cms | 2.10.0 | MIT | exécution |
| @peculiar/asn1-csr | 2.10.0 | MIT | exécution |
| @peculiar/asn1-ecc | 2.10.0 | MIT | exécution |
| @peculiar/asn1-pfx | 2.10.0 | MIT | exécution |
| @peculiar/asn1-pkcs8 | 2.10.0 | MIT | exécution |
| @peculiar/asn1-pkcs9 | 2.10.0 | MIT | exécution |
| @peculiar/asn1-rsa | 2.10.0 | MIT | exécution |
| @peculiar/asn1-schema | 2.10.0 | MIT | exécution |
| @peculiar/asn1-x509-attr | 2.10.0 | MIT | exécution |
| @peculiar/asn1-x509 | 2.10.0 | MIT | exécution |
| @peculiar/utils | 2.0.3 | MIT | exécution |
| @peculiar/x509 | 1.14.3 | MIT | exécution |
| @pinojs/redact | 0.4.0 | MIT | exécution |
| @playwright/test | 1.63.0 | Apache-2.0 | outil |
| @radix-ui/number | 1.1.3 | MIT | exécution |
| @radix-ui/primitive | 1.1.7 | MIT | exécution |
| @radix-ui/react-accessible-icon | 1.1.15 | MIT | exécution |
| @radix-ui/react-accordion | 1.2.20 | MIT | exécution |
| @radix-ui/react-alert-dialog | 1.1.23 | MIT | exécution |
| @radix-ui/react-arrow | 1.1.15 | MIT | exécution |
| @radix-ui/react-aspect-ratio | 1.1.15 | MIT | exécution |
| @radix-ui/react-avatar | 1.2.6 | MIT | exécution |
| @radix-ui/react-checkbox | 1.3.11 | MIT | exécution |
| @radix-ui/react-collapsible | 1.1.20 | MIT | exécution |
| @radix-ui/react-collection | 1.1.15 | MIT | exécution |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | exécution |
| @radix-ui/react-context-menu | 2.3.7 | MIT | exécution |
| @radix-ui/react-context | 1.2.2 | MIT | exécution |
| @radix-ui/react-dialog | 1.1.23 | MIT | exécution |
| @radix-ui/react-direction | 1.1.4 | MIT | exécution |
| @radix-ui/react-dismissable-layer | 1.1.19 | MIT | exécution |
| @radix-ui/react-dropdown-menu | 2.1.24 | MIT | exécution |
| @radix-ui/react-focus-guards | 1.1.6 | MIT | exécution |
| @radix-ui/react-focus-scope | 1.1.16 | MIT | exécution |
| @radix-ui/react-form | 0.1.16 | MIT | exécution |
| @radix-ui/react-hover-card | 1.1.23 | MIT | exécution |
| @radix-ui/react-id | 1.1.4 | MIT | exécution |
| @radix-ui/react-label | 2.1.15 | MIT | exécution |
| @radix-ui/react-menu | 2.1.24 | MIT | exécution |
| @radix-ui/react-menubar | 1.1.24 | MIT | exécution |
| @radix-ui/react-navigation-menu | 1.2.22 | MIT | exécution |
| @radix-ui/react-one-time-password-field | 0.1.16 | MIT | exécution |
| @radix-ui/react-password-toggle-field | 0.1.11 | MIT | exécution |
| @radix-ui/react-popover | 1.1.23 | MIT | exécution |
| @radix-ui/react-popper | 1.3.7 | MIT | exécution |
| @radix-ui/react-portal | 1.1.17 | MIT | exécution |
| @radix-ui/react-presence | 1.1.10 | MIT | exécution |
| @radix-ui/react-primitive | 2.1.10 | MIT | exécution |
| @radix-ui/react-progress | 1.1.16 | MIT | exécution |
| @radix-ui/react-radio-group | 1.4.7 | MIT | exécution |
| @radix-ui/react-roving-focus | 1.1.19 | MIT | exécution |
| @radix-ui/react-scroll-area | 1.2.18 | MIT | exécution |
| @radix-ui/react-select | 2.3.7 | MIT | exécution |
| @radix-ui/react-separator | 1.1.15 | MIT | exécution |
| @radix-ui/react-slider | 1.4.7 | MIT | exécution |
| @radix-ui/react-slot | 1.3.3 | MIT | exécution |
| @radix-ui/react-switch | 1.3.7 | MIT | exécution |
| @radix-ui/react-tabs | 1.1.21 | MIT | exécution |
| @radix-ui/react-toast | 1.2.23 | MIT | exécution |
| @radix-ui/react-toggle-group | 1.1.19 | MIT | exécution |
| @radix-ui/react-toggle | 1.1.18 | MIT | exécution |
| @radix-ui/react-toolbar | 1.1.19 | MIT | exécution |
| @radix-ui/react-tooltip | 1.2.16 | MIT | exécution |
| @radix-ui/react-use-callback-ref | 1.1.4 | MIT | exécution |
| @radix-ui/react-use-controllable-state | 1.2.6 | MIT | exécution |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | exécution |
| @radix-ui/react-use-escape-keydown | 1.1.5 | MIT | exécution |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | exécution |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | exécution |
| @radix-ui/react-use-previous | 1.1.4 | MIT | exécution |
| @radix-ui/react-use-rect | 1.1.4 | MIT | exécution |
| @radix-ui/react-use-size | 1.1.4 | MIT | exécution |
| @radix-ui/react-visually-hidden | 1.2.11 | MIT | exécution |
| @radix-ui/rect | 1.1.3 | MIT | exécution |
| @rolldown/binding-android-arm-eabi | 1.2.8 | MIT | outil |
| @rolldown/binding-android-arm64 | 1.2.8 | MIT | outil |
| @rolldown/binding-darwin-arm64 | 1.2.8 | MIT | outil |
| @rolldown/binding-darwin-x64 | 1.2.8 | MIT | outil |
| @rolldown/binding-freebsd-x64 | 1.2.8 | MIT | outil |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.8 | MIT | outil |
| @rolldown/binding-linux-arm64-gnu | 1.2.8 | MIT | outil |
| @rolldown/binding-linux-arm64-musl | 1.2.8 | MIT | outil |
| @rolldown/binding-linux-ppc64-gnu | 1.2.8 | MIT | outil |
| @rolldown/binding-linux-s390x-gnu | 1.2.8 | MIT | outil |
| @rolldown/binding-linux-x64-gnu | 1.2.8 | MIT | outil |
| @rolldown/binding-linux-x64-musl | 1.2.8 | MIT | outil |
| @rolldown/binding-openharmony-arm64 | 1.2.8 | MIT | outil |
| @rolldown/binding-win32-arm64-msvc | 1.2.8 | MIT | outil |
| @rolldown/binding-win32-x64-msvc | 1.2.8 | MIT | outil |
| @rolldown/pluginutils | 1.0.1 | MIT | outil |
| @tailwindcss/node | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-android-arm64 | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-darwin-arm64 | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-darwin-x64 | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-freebsd-x64 | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-linux-arm-gnueabihf | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-linux-arm64-gnu | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-linux-arm64-musl | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-linux-x64-gnu | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-linux-x64-musl | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-wasm32-wasi | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-win32-arm64-msvc | 4.3.3 | MIT | outil |
| @tailwindcss/oxide-win32-x64-msvc | 4.3.3 | MIT | outil |
| @tailwindcss/oxide | 4.3.3 | MIT | outil |
| @tailwindcss/vite | 4.3.3 | MIT | outil |
| @tweenjs/tween.js | 23.1.3 | MIT | outil |
| @tybys/wasm-util | 0.10.2 | MIT | outil |
| @types/node | 24.13.5 | MIT | outil |
| @types/react-dom | 19.3.0 | MIT | exécution |
| @types/react | 19.3.0 | MIT | exécution |
| @types/stats.js | 0.17.4 | MIT | outil |
| @types/three | 0.186.0 | MIT | outil |
| @types/webxr | 0.5.24 | MIT | outil |
| @types/ws | 8.18.1 | MIT | outil |
| @typescript/typescript-aix-ppc64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-darwin-arm64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-darwin-x64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-freebsd-x64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-arm64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-arm | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-loong64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-mips64el | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-ppc64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-riscv64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-s390x | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-linux-x64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-netbsd-x64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-openbsd-x64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-sunos-x64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-win32-arm64 | 7.0.2 | Apache-2.0 | outil |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | outil |
| @vitejs/plugin-react | 6.1.1 | MIT | outil |
| abstract-logging | 2.0.1 | MIT | exécution |
| accepts | 2.0.0 | MIT | exécution |
| ajv-formats | 3.0.1 | MIT | exécution |
| ajv | 8.20.0 | MIT | exécution |
| aria-hidden | 1.2.6 | MIT | exécution |
| asn1js | 3.0.10 | BSD-3-Clause | exécution |
| atomic-sleep | 1.0.0 | MIT | exécution |
| avvio | 9.3.0 | MIT | exécution |
| balanced-match | 4.0.4 | MIT | exécution |
| body-parser | 2.3.0 | MIT | exécution |
| bonjour-service | 1.4.4 | MIT | exécution |
| brace-expansion | 5.0.12 | MIT | exécution |
| bytes | 3.1.2 | MIT | exécution |
| bytestreamjs | 2.0.1 | BSD-3-Clause | exécution |
| call-bind-apply-helpers | 1.0.2 | MIT | exécution |
| call-bound | 1.0.4 | MIT | exécution |
| class-variance-authority | 0.7.1 | Apache-2.0 | exécution |
| clsx | 2.1.1 | MIT | exécution |
| colorette | 2.0.20 | MIT | exécution |
| content-disposition | 2.0.1 | MIT | exécution |
| content-type | 1.0.5 | MIT | exécution |
| content-type | 2.1.0 | MIT | exécution |
| cookie-signature | 1.2.2 | MIT | exécution |
| cookie | 0.7.2 | MIT | exécution |
| cookie | 1.1.1 | MIT | exécution |
| cookie | 2.0.1 | MIT | exécution |
| cors | 2.8.6 | MIT | exécution |
| cross-spawn | 7.0.6 | MIT | exécution |
| csstype | 3.2.3 | MIT | exécution |
| dateformat | 4.6.3 | MIT | exécution |
| debug | 4.4.3 | MIT | exécution |
| depd | 2.0.0 | MIT | exécution |
| dequal | 2.0.3 | MIT | exécution |
| detect-libc | 2.1.2 | Apache-2.0 | outil |
| detect-node-es | 1.1.0 | MIT | exécution |
| dns-packet | 5.6.1 | MIT | exécution |
| dunder-proto | 1.0.1 | MIT | exécution |
| duplexify | 4.1.3 | MIT | exécution |
| ee-first | 1.1.1 | MIT | exécution |
| encodeurl | 2.0.0 | MIT | exécution |
| end-of-stream | 1.4.5 | MIT | exécution |
| enhanced-resolve | 5.25.1 | MIT | outil |
| es-define-property | 1.0.1 | MIT | exécution |
| es-errors | 1.3.0 | MIT | exécution |
| es-object-atoms | 1.1.2 | MIT | exécution |
| esbuild | 0.28.2 | MIT | outil |
| escape-html | 1.0.3 | MIT | exécution |
| etag | 1.8.1 | MIT | exécution |
| eventsource-parser | 3.1.1 | MIT | exécution |
| eventsource | 3.0.7 | MIT | exécution |
| express-rate-limit | 8.7.1 | MIT | exécution |
| express | 5.3.0 | MIT | exécution |
| fast-copy | 4.2.0 | MIT | exécution |
| fast-decode-uri-component | 1.0.1 | MIT | exécution |
| fast-deep-equal | 3.1.3 | MIT | exécution |
| fast-json-stringify | 7.0.1 | MIT | exécution |
| fast-querystring | 1.1.2 | MIT | exécution |
| fast-safe-stringify | 2.1.1 | MIT | exécution |
| fast-uri | 3.1.8 | BSD-3-Clause | exécution |
| fast-uri | 4.1.5 | BSD-3-Clause | exécution |
| fastify-plugin | 6.0.0 | MIT | exécution |
| fastify | 5.12.5 | MIT | exécution |
| fastq | 1.20.3 | ISC | exécution |
| fdir | 6.5.0 | MIT | outil |
| fflate | 0.8.3 | MIT | outil |
| finalhandler | 2.1.1 | MIT | exécution |
| find-my-way | 9.9.0 | MIT | exécution |
| forwarded | 0.2.0 | MIT | exécution |
| fresh | 2.0.0 | MIT | exécution |
| fsevents | 2.3.3 | MIT | outil |
| function-bind | 1.1.2 | MIT | exécution |
| get-intrinsic | 1.3.0 | MIT | exécution |
| get-nonce | 1.0.1 | MIT | exécution |
| get-proto | 1.0.1 | MIT | exécution |
| glob | 13.0.6 | BlueOak-1.0.0 | exécution |
| gopd | 1.2.0 | MIT | exécution |
| graceful-fs | 4.2.11 | ISC | outil |
| has-symbols | 1.1.0 | MIT | exécution |
| hasown | 2.0.4 | MIT | exécution |
| help-me | 5.0.0 | MIT | exécution |
| hono | 4.13.13 | MIT | exécution |
| http-errors | 2.0.1 | MIT | exécution |
| iconv-lite | 0.7.3 | MIT | exécution |
| inherits | 2.0.4 | ISC | exécution |
| ip-address | 10.7.2 | MIT | exécution |
| ipaddr.js | 1.9.1 | MIT | exécution |
| ipaddr.js | 2.5.0 | MIT | exécution |
| is-promise | 4.0.0 | MIT | exécution |
| isexe | 2.0.0 | ISC | exécution |
| jiti | 2.7.0 | MIT | outil |
| jose | 6.2.13 | MIT | exécution |
| joycon | 3.1.1 | MIT | exécution |
| json-schema-ref-resolver | 3.0.0 | MIT | exécution |
| json-schema-traverse | 1.0.0 | MIT | exécution |
| json-schema-typed | 8.0.2 | BSD-2-Clause | exécution |
| light-my-request | 6.6.0 | BSD-3-Clause | exécution |
| lightningcss-android-arm64 | 1.32.0 | MPL-2.0 | outil |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | outil |
| lightningcss-darwin-arm64 | 1.32.0 | MPL-2.0 | outil |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | outil |
| lightningcss-darwin-x64 | 1.32.0 | MPL-2.0 | outil |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | outil |
| lightningcss-freebsd-x64 | 1.32.0 | MPL-2.0 | outil |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | outil |
| lightningcss-linux-arm-gnueabihf | 1.32.0 | MPL-2.0 | outil |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | outil |
| lightningcss-linux-arm64-gnu | 1.32.0 | MPL-2.0 | outil |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | outil |
| lightningcss-linux-arm64-musl | 1.32.0 | MPL-2.0 | outil |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | outil |
| lightningcss-linux-x64-gnu | 1.32.0 | MPL-2.0 | outil |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | outil |
| lightningcss-linux-x64-musl | 1.32.0 | MPL-2.0 | outil |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | outil |
| lightningcss-win32-arm64-msvc | 1.32.0 | MPL-2.0 | outil |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | outil |
| lightningcss-win32-x64-msvc | 1.32.0 | MPL-2.0 | outil |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | outil |
| lightningcss | 1.32.0 | MPL-2.0 | outil |
| lightningcss | 1.33.0 | MPL-2.0 | outil |
| lru-cache | 11.5.2 | BlueOak-1.0.0 | exécution |
| lucide-react | 1.46.0 | ISC | exécution |
| magic-string | 0.30.21 | MIT | outil |
| math-intrinsics | 1.1.0 | MIT | exécution |
| media-typer | 1.1.1 | MIT | exécution |
| merge-descriptors | 2.0.0 | MIT | exécution |
| meshoptimizer | 1.1.1 | MIT | outil |
| mime-db | 1.54.0 | MIT | exécution |
| mime-types | 3.0.2 | MIT | exécution |
| mime | 3.0.0 | MIT | exécution |
| minimatch | 10.2.6 | BlueOak-1.0.0 | exécution |
| minimist | 1.2.8 | MIT | exécution |
| minipass | 7.1.3 | BlueOak-1.0.0 | exécution |
| ms | 2.1.3 | MIT | exécution |
| multicast-dns | 7.2.5 | MIT | exécution |
| nanoid | 3.3.19 | MIT | outil |
| negotiator | 1.1.0 | MIT | exécution |
| object-assign | 4.1.1 | MIT | exécution |
| object-inspect | 1.13.4 | MIT | exécution |
| on-exit-leak-free | 2.1.2 | MIT | exécution |
| on-finished | 2.4.1 | MIT | exécution |
| once | 1.4.0 | ISC | exécution |
| openai | 7.15.0 | Apache-2.0 | exécution |
| parseurl | 1.3.3 | MIT | exécution |
| path-key | 3.1.1 | MIT | exécution |
| path-scurry | 2.0.2 | BlueOak-1.0.0 | exécution |
| path-to-regexp | 8.4.2 | MIT | exécution |
| picocolors | 1.1.1 | ISC | outil |
| picomatch | 4.0.7 | MIT | outil |
| pino-abstract-transport | 2.0.0 | MIT | exécution |
| pino-abstract-transport | 3.0.0 | MIT | exécution |
| pino-pretty | 13.2.0 | MIT | exécution |
| pino-std-serializers | 7.1.0 | MIT | exécution |
| pino | 10.3.1 | MIT | exécution |
| pino | 9.14.0 | MIT | exécution |
| pkce-challenge | 5.0.1 | MIT | exécution |
| pkijs | 3.4.1 | BSD-3-Clause | exécution |
| playwright-core | 1.63.0 | Apache-2.0 | outil |
| playwright | 1.63.0 | Apache-2.0 | outil |
| postcss | 8.5.28 | MIT | outil |
| prettier | 3.9.7 | MIT | outil |
| process-warning | 4.0.1 | MIT | exécution |
| process-warning | 5.1.0 | MIT | exécution |
| proxy-addr | 2.0.8 | MIT | exécution |
| pump | 3.0.4 | MIT | exécution |
| pvtsutils | 1.3.6 | MIT | exécution |
| pvutils | 1.2.0 | MIT | exécution |
| qs | 6.16.1 | BSD-3-Clause | exécution |
| quick-format-unescaped | 4.0.4 | MIT | exécution |
| radix-ui | 1.6.7 | MIT | exécution |
| range-parser | 1.3.0 | MIT | exécution |
| raw-body | 3.0.2 | MIT | exécution |
| react-dom | 19.3.0 | MIT | exécution |
| react-remove-scroll-bar | 2.3.8 | MIT | exécution |
| react-remove-scroll | 2.7.2 | MIT | exécution |
| react-style-singleton | 2.2.3 | MIT | exécution |
| react | 19.3.0 | MIT | exécution |
| readable-stream | 3.6.2 | MIT | exécution |
| real-require | 0.2.0 | MIT | exécution |
| real-require | 1.0.0 | MIT | exécution |
| reflect-metadata | 0.2.2 | Apache-2.0 | exécution |
| require-from-string | 2.0.2 | MIT | exécution |
| ret | 0.5.0 | MIT | exécution |
| reusify | 1.1.0 | MIT | exécution |
| rfdc | 1.4.1 | MIT | exécution |
| rolldown | 1.2.8 | MIT | outil |
| router | 2.2.0 | MIT | exécution |
| safe-buffer | 5.2.1 | MIT | exécution |
| safe-regex2 | 5.1.1 | MIT | exécution |
| safe-stable-stringify | 2.5.0 | MIT | exécution |
| safer-buffer | 2.1.2 | MIT | exécution |
| scheduler | 0.28.0 | MIT | exécution |
| secure-json-parse | 4.1.0 | BSD-3-Clause | exécution |
| selfsigned | 5.5.0 | MIT | exécution |
| semver | 7.8.5 | ISC | exécution |
| send | 1.2.1 | MIT | exécution |
| serve-static | 2.2.1 | MIT | exécution |
| set-cookie-parser | 2.7.2 | MIT | exécution |
| setprototypeof | 1.2.0 | ISC | exécution |
| shebang-command | 2.0.0 | MIT | exécution |
| shebang-regex | 3.0.0 | MIT | exécution |
| side-channel-list | 1.0.1 | MIT | exécution |
| side-channel-map | 1.0.1 | MIT | exécution |
| side-channel-weakmap | 1.0.2 | MIT | exécution |
| side-channel | 1.1.1 | MIT | exécution |
| sonic-boom | 4.2.1 | MIT | exécution |
| sonic-boom | 5.0.2 | MIT | exécution |
| source-map-js | 1.2.1 | BSD-3-Clause | outil |
| split2 | 4.2.0 | ISC | exécution |
| statuses | 2.0.2 | MIT | exécution |
| stream-shift | 1.0.3 | MIT | exécution |
| string_decoder | 1.3.0 | MIT | exécution |
| strip-json-comments | 5.0.3 | MIT | exécution |
| tailwind-merge | 3.7.0 | MIT | exécution |
| tailwindcss | 4.3.3 | MIT | outil |
| tapable | 2.3.3 | MIT | outil |
| thread-stream | 3.2.0 | MIT | exécution |
| thread-stream | 4.2.0 | MIT | exécution |
| three | 0.186.0 | MIT | exécution |
| thunky | 1.1.0 | MIT | exécution |
| tinyglobby | 0.2.17 | MIT | outil |
| toad-cache | 3.7.4 | MIT | exécution |
| toidentifier | 1.0.1 | MIT | exécution |
| tslib | 1.14.1 | 0BSD | exécution |
| tslib | 2.8.1 | 0BSD | outil |
| tsx | 4.23.13 | MIT | outil |
| tsyringe | 4.10.0 | MIT | exécution |
| type-is | 2.1.0 | MIT | exécution |
| typescript | 7.0.2 | Apache-2.0 | outil |
| undici-types | 7.18.2 | MIT | outil |
| unpipe | 1.0.0 | MIT | exécution |
| use-callback-ref | 1.3.3 | MIT | exécution |
| use-sidecar | 1.1.3 | MIT | exécution |
| util-deprecate | 1.0.2 | MIT | exécution |
| vary | 1.1.2 | MIT | exécution |
| vite | 8.3.0 | MIT | outil |
| which | 2.0.2 | ISC | exécution |
| wrappy | 1.0.2 | ISC | exécution |
| ws | 8.21.3 | MIT | exécution |
| zod-to-json-schema | 3.25.2 | ISC | exécution |
| zod | 4.6.7 | MIT | exécution |
<!-- npm:fin -->
