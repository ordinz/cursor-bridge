import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryState } from "nuqs";
import { getModels } from "../lib/api";
import type { Model } from "../lib/types";
import { consoleUrlParsers } from "../lib/url-state";

const FALLBACK_MODELS: Model[] = [
  { id: "default", displayName: "Auto" },
  { id: "composer-2", displayName: "Composer 2" },
  { id: "composer-2.5", displayName: "Composer 2.5" },
];

const AUTO_MODEL_ID = "default";
const STORAGE_KEY = "cursor-bridge-model-v2";

function isAutoModel(model: Model) {
  return model.id === AUTO_MODEL_ID || model.displayName === "Auto";
}

function sortModels(models: Model[]) {
  return [...models].sort((a, b) => {
    if (isAutoModel(a)) return -1;
    if (isAutoModel(b)) return 1;
    return (a.displayName || a.id).localeCompare(b.displayName || b.id);
  });
}

function resolveAutoId(models: Model[]) {
  return models.find(isAutoModel)?.id ?? AUTO_MODEL_ID;
}

function pickFallbackModel(models: Model[]) {
  const autoId = resolveAutoId(models);
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && models.some((m) => m.id === stored)) {
      return stored;
    }
  } catch {
    // ignore
  }
  return autoId;
}

export function useModels() {
  const [urlModel, setUrlModel] = useQueryState(
    "model",
    consoleUrlParsers.model,
  );
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedModel = useMemo(() => {
    if (urlModel && models.some((m) => m.id === urlModel)) {
      return urlModel;
    }
    return pickFallbackModel(models);
  }, [urlModel, models]);

  useEffect(() => {
    void getModels()
      .then((data) => {
        if (data.models.length > 0) {
          setModels(sortModels(data.models));
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load models");
      })
      .finally(() => setLoading(false));
  }, []);

  // Persist effective selection; hydrate URL when missing so links stay shareable.
  useEffect(() => {
    if (loading) return;
    try {
      localStorage.setItem(STORAGE_KEY, selectedModel);
    } catch {
      // ignore
    }
    if (!urlModel && selectedModel) {
      void setUrlModel(selectedModel);
    }
  }, [loading, selectedModel, urlModel, setUrlModel]);

  const selectModel = useCallback(
    (id: string) => {
      void setUrlModel(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore
      }
    },
    [setUrlModel],
  );

  return { models, selectedModel, selectModel, loading, error };
}
