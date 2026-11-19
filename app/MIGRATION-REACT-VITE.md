# React + Vite Studio migration — behavior preservation record

Base: GitHub branch \`main\`, commit \`8ba41d9a6e40b985408b01158ab761efee9718aa\`.
Migration branch: \`feat/studio-react-vite-migration\`.

## Architecture boundary

- \`app/\`: frontend converted from HTML and imperative DOM JavaScript to React components bundled by Vite. The original CSS declarations remain, with only two wrapper visibility rules appended.
- \`app/server.mjs\`: unchanged application API logic; minimal static-serving switch to \`app/dist/\` when a Vite production build exists, with legacy \`app/public/\` fallback.
- \`engine/\`, \`pipeline/\`, \`SCRIPT.md\`, and original production documentation: untouched. Remotion already uses React, and is **not** a Vite app.
- Original \`app/public/\` files retained as a reference and pre-build fallback, not deleted.

## Behavioral invariants

1. Navigation: Dashboard, Script, Still Check, Settings; active section only. Hidden panels remain mounted and preserve form/result data.
2. Theme: dark by default, \`oos-theme\` localStorage key, Light/Dark mode button and preexisting CSS theme variables.
3. Settings: \`GET /api/settings\` and \`POST /api/settings\`, same provider names and fields, blank API key does not replace saved key, server response continues masking keys; form resets after successful save.
4. Connection: \`POST /api/test-connection\` with provider gemini, last-test result saved to \`oos-gemini-test\` localStorage, same dashboard pill states.
5. Script: \`POST /api/script\` with \`topic\` and numeric \`durationSec\` (30 or 60); same labels, loading text, beat timing display, word count fallback, escaped/safe output.
6. Still QA: browser FileReader/data URL, base64 + MIME type + shot note to \`POST /api/check-still\`; same PASS/FAIL convention, summary, issue list, preview and loading state.
7. TTS: remains the existing experimental backend endpoint \`POST /api/tts\`; no new frontend TTS controls, matching original Studio.
8. Gemini model defaults, request prompts, timeout, status/error handling, WAV format, settings path, render scripts: unchanged.

## Commands

Prerequisites: Node.js 20.19+ and npm.

\`\`\`bash
cd app
npm install
npm run dev        # starts Node API on :4173 and Vite on http://127.0.0.1:5173
npm test           # pure-function regression tests
npm run build      # writes app/dist/
npm start          # serves built UI and API on http://localhost:4173
\`\`\`

Vite proxies only \`/api\` to Node in development. API keys are **never** inserted into the Vite build. \`app/data/\` remains gitignored.

## Verification gates (not claims of passing tests)

- [ ] \`npm install\` and \`npm run build\` complete without errors.
- [ ] \`npm test\` passes.
- [ ] Browser regression: all four panels visible by navigation; form values/results survive switching.
- [ ] Theme persists across reload.
- [ ] Compare original vs React UI at desktop and mobile with screenshots.
- [ ] Server GET \`/api/settings\` returns provider list and masked keys.
- [ ] Save Settings: empty API key preserves existing key, model values update, full key never in API response.
- [ ] Gemini test, script, vision QA, and experimental TTS with user-supplied key (these calls are external, slow, and must never be falsely marked PASS).
- [ ] Remotion render and Python mix regression against pre-migration baseline; code in those folders unchanged.

The GitHub connector can commit code, but cannot run npm/browser/render commands. Do **not** interpret the presence of these tests as proof that all behavior has been validated.
