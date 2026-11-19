// Out of Step Studio — backend server entrypoint (Node 20.19+ / Node 24+, zero external npm runtime deps).
// All AI steps go through Google Gemini (AI Studio API key), server-side only.
// API keys live ONLY in app/data/settings.json (gitignored) and are never sent to the browser.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStudioServer } from "./server/create-server.mjs";

export { createStudioServer } from "./server/create-server.mjs";
export {
  classifyGeminiModel,
  createModelCatalogService,
  fetchGeminiModelCatalog,
  normalizeModelId,
  rankGeminiModels,
} from "./server/gemini-models.mjs";
export {
  ModelHealthRegistry,
  chooseCandidateList,
  classifyGeminiError,
  createGeminiExecutionEngine,
  geminiGenerate,
  geminiText,
  parseJsonLoose,
  retryWithBackoff,
  validateConnectionReply,
  validateScriptResponse,
  validateStillVerdict,
  validateTtsAudio,
  wavWrapPcm16,
} from "./server/gemini-transport.mjs";
export {
  MODEL_POLICIES,
  PROVIDERS,
  SELECTION_MODES,
  defaultSettings,
  keyFingerprint,
  loadSettings,
  maskKey,
  maskedSettings,
  redactSecrets,
  saveSettings,
  updateProviderSettings,
} from "./server/settings-store.mjs";

const thisFile = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile);

if (isMain) {
  const PORT = Number(process.env.PORT || 4173);
  const { server } = createStudioServer();
  server.listen(PORT, () => {
    console.log(`Out of Step Studio listening on http://localhost:${PORT}`);
  });
}
