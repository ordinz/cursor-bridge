import { useCallback, useEffect, useState } from "react";
import { getModels } from "../lib/api";
import type { Model } from "../lib/types";

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

function pickInitialModel(models: Model[]) {
  const autoId = resolveAutoId(models);
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && models.some((m) => m.id === stored)) {
    return stored;
  }
  return autoId;
}

export function useModels() {
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState(() =>
    pickInitialModel(FALLBACK_MODELS),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getModels()
      .then((data) => {
        if (data.models.length > 0) {
          const sorted = sortModels(data.models);
          setModels(sorted);
          setSelectedModel(pickInitialModel(sorted));
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load models");
      })
      .finally(() => setLoading(false));
  }, []);

  const selectModel = useCallback((id: string) => {
    setSelectedModel(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return { models, selectedModel, selectModel, loading, error };
}
