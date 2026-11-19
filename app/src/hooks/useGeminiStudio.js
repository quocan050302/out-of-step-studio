import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  connectionStatus,
  readLastGeminiTest,
  streamTestConnection,
} from "../lib/studio.mjs";

export function useElapsedSeconds(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return undefined;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

export function useGeminiStudio() {
  const [providers, setProviders] = useState(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [settingsEpoch, setSettingsEpoch] = useState(0);

  const [catalog, setCatalog] = useState({
    models: [],
    ranked: { text: [], vision: [], tts: [] },
    syncedAt: null,
    totalDiscovered: 0,
    loading: false,
    error: "",
  });

  const [lastTest, setLastTest] = useState(readLastGeminiTest);
  const [testing, setTesting] = useState(false);
  const [testProgress, setTestProgress] = useState([]);
  const [testResult, setTestResult] = useState(null);

  const testAbortRef = useRef(null);
  const discoverAbortRef = useRef(null);

  const loadCatalog = useCallback(async ({ force = false, signal } = {}) => {
    setCatalog((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const out = force
        ? await api("/api/gemini/discover", {}, { signal })
        : await api("/api/gemini/models", undefined, { signal });
      if (!out.ok) {
        setCatalog((prev) => ({
          ...prev,
          loading: false,
          error: out.error || "Unable to discover Gemini models.",
        }));
        return out;
      }
      setCatalog({
        models: out.models || [],
        ranked: out.ranked || { text: [], vision: [], tts: [] },
        syncedAt: out.syncedAt || null,
        totalDiscovered: out.totalDiscovered ?? (out.models ? out.models.length : 0),
        loading: false,
        error: "",
      });
      if (out.health) {
        setProviders((prev) =>
          prev
            ? {
                ...prev,
                gemini: { ...prev.gemini, health: out.health },
              }
            : prev,
        );
      }
      return out;
    } catch (err) {
      if (err?.name === "AbortError") return null;
      setCatalog((prev) => ({
        ...prev,
        loading: false,
        error: String(err?.message || err),
      }));
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingSettings(true);
    api("/api/settings", undefined, { signal: controller.signal })
      .then((out) => {
        if (controller.signal.aborted) return;
        if (out.ok) {
          setProviders(out.providers);
          setSettingsError("");
          if (out.providers?.gemini?.hasKey) {
            loadCatalog({ force: false, signal: controller.signal });
          }
        } else {
          setSettingsError(out.error || "Unable to load settings.");
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setSettingsError(String(err?.message || err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSettings(false);
      });

    return () => controller.abort();
  }, [loadCatalog]);

  useEffect(() => {
    return () => {
      testAbortRef.current?.abort();
      discoverAbortRef.current?.abort();
    };
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const out = await api("/api/gemini/status");
      if (out.ok && out.health) {
        setProviders((prev) =>
          prev
            ? {
                ...prev,
                gemini: { ...prev.gemini, health: out.health },
              }
            : prev,
        );
      }
    } catch {
      // ignore background status refresh error
    }
  }, []);

  const saveProvider = useCallback(
    async (provider, fields) => {
      const prevMaskedKey = providers?.gemini?.apiKey || "";
      const out = await api("/api/settings", { provider, fields });
      if (out.ok) {
        setProviders(out.providers);
        setSettingsEpoch((n) => n + 1);
        if (provider === "gemini") {
          const newMaskedKey = out.providers?.gemini?.apiKey || "";
          if (fields.apiKey && newMaskedKey !== prevMaskedKey) {
            localStorage.removeItem("oos-gemini-test");
            setLastTest(null);
            setTestResult(null);
            setTestProgress([]);
          }
          if (out.providers?.gemini?.hasKey) {
            loadCatalog({ force: Boolean(fields.apiKey) });
          }
        }
      }
      return out;
    },
    [providers, loadCatalog],
  );

  const discoverModels = useCallback(async () => {
    discoverAbortRef.current?.abort();
    const controller = new AbortController();
    discoverAbortRef.current = controller;
    return loadCatalog({ force: true, signal: controller.signal });
  }, [loadCatalog]);

  const cancelConnectionTest = useCallback(() => {
    testAbortRef.current?.abort();
  }, []);

  const runConnectionTest = useCallback(async () => {
    if (testing) return null;
    testAbortRef.current?.abort();
    const controller = new AbortController();
    testAbortRef.current = controller;

    setTesting(true);
    setTestResult(null);
    setTestProgress([
      {
        stage: "starting",
        timestamp: Date.now(),
        message: "Starting Gemini connection & capability verification…",
      },
    ]);

    try {
      const out = await streamTestConnection({
        provider: "gemini",
        signal: controller.signal,
        onProgress: (evt) => {
          setTestProgress((prev) => [...prev, evt]);
        },
      });

      setTestResult(out);
      if (out.health) {
        setProviders((prev) =>
          prev
            ? {
                ...prev,
                gemini: { ...prev.gemini, health: out.health },
              }
            : prev,
        );
      }

      if (out.reasonCategory !== "aborted") {
        const persisted = {
          ok: Boolean(out.ok),
          at: Date.now(),
          model: out.effectiveModel || out.model || null,
          preferredModel: out.preferredModel || null,
          downgraded: Boolean(out.downgraded),
          reasonCategory: out.reasonCategory || (out.ok ? "ok" : "failed"),
        };
        localStorage.setItem("oos-gemini-test", JSON.stringify(persisted));
        setLastTest(persisted);
      }
      if (out.ok && catalog.models.length === 0) {
        loadCatalog({ force: false });
      }
      return out;
    } catch (err) {
      if (err?.name === "AbortError") {
        const cancelled = {
          ok: false,
          aborted: true,
          reasonCategory: "aborted",
          error: "Connection test cancelled.",
        };
        setTestResult(cancelled);
        setTestProgress((prev) => [
          ...prev,
          { stage: "aborted", timestamp: Date.now(), message: "Connection test cancelled by user." },
        ]);
        return cancelled;
      }
      const failed = {
        ok: false,
        reasonCategory: "network",
        error: String(err?.message || err),
        attemptedModels: [],
      };
      setTestResult(failed);
      const persisted = { ok: false, at: Date.now(), reasonCategory: "network" };
      localStorage.setItem("oos-gemini-test", JSON.stringify(persisted));
      setLastTest(persisted);
      return failed;
    } finally {
      setTesting(false);
    }
  }, [testing, catalog.models.length, loadCatalog]);

  const connection = connectionStatus(providers, lastTest, { testing });

  return {
    providers,
    loadingSettings,
    settingsError,
    settingsEpoch,
    catalog,
    connection,
    lastTest,
    testing,
    testProgress,
    testResult,
    saveProvider,
    discoverModels,
    runConnectionTest,
    cancelConnectionTest,
    refreshHealth,
  };
}
