import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";

const IS_DEV = import.meta.env.DEV;

const TRACE_ATTRIBUTES = [
  "data-component",
  "data-testid",
  "data-section",
  "data-item",
  "data-page",
  "data-state",
  "id",
] as const;

type TraceAttr = (typeof TRACE_ATTRIBUTES)[number];

type TraceLayer = {
  attributes: Partial<Record<TraceAttr | "nodeName", string>>;
  element: Element;
};

type TraceAttributes = Partial<Record<TraceAttr | "nodeName", string>>;

function buildPrimarySelector(attributes: TraceAttributes): string {
  if (attributes["data-testid"] && attributes["data-component"]) {
    return `[data-component="${attributes["data-component"]}"][data-testid="${attributes["data-testid"]}"]`;
  }
  if (attributes["data-testid"]) {
    return `[data-testid="${attributes["data-testid"]}"]`;
  }
  if (attributes["data-component"]) {
    return `[data-component="${attributes["data-component"]}"]`;
  }
  const firstTraceAttr = Object.keys(attributes).find((k) => k !== "nodeName");
  if (firstTraceAttr) {
    return `[${firstTraceAttr}="${attributes[firstTraceAttr as TraceAttr]}"]`;
  }
  return "";
}

/**
 * Hold Option/Alt and move the mouse to inspect data-testid / data-component
 * (and related trace attrs). Click to copy the innermost selector.
 * Dev-only — matches the Matrix app TraceabilityInspector.
 */
export function TraceabilityInspector() {
  const [isActive, setIsActive] = useState(false);
  const [hoveredData, setHoveredData] = useState<TraceLayer[] | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_DEV) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight") &&
        !isActive
      ) {
        setIsActive(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.code === "AltLeft" || e.code === "AltRight") {
        setIsActive(false);
        setHoveredData(null);
      }
    };

    const handleBlur = () => {
      setIsActive(false);
      setHoveredData(null);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
      window.removeEventListener("blur", handleBlur);
    };
  }, [isActive]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isActive) return;

      setMousePos({ x: e.clientX, y: e.clientY });

      const targetElement = e.target;
      if (!(targetElement instanceof Element)) {
        setHoveredData(null);
        return;
      }

      const traceStack: TraceLayer[] = [];
      let curr: Element | null = targetElement;
      const selector = TRACE_ATTRIBUTES.map((attr) => `[${attr}]`).join(", ");

      while (curr && curr.nodeType === Node.ELEMENT_NODE) {
        const matched: Element | null = curr.closest(selector);
        if (matched) {
          const data = TRACE_ATTRIBUTES.reduce<TraceAttributes>((acc, attr) => {
            if (matched.hasAttribute(attr)) {
              acc[attr] = matched.getAttribute(attr) ?? undefined;
            }
            return acc;
          }, {});

          data.nodeName = matched.nodeName.toLowerCase();
          traceStack.push({ attributes: data, element: matched });
          curr = matched.parentElement;
        } else {
          break;
        }
      }

      setHoveredData(traceStack.length > 0 ? traceStack : null);
    },
    [isActive],
  );

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (!isActive || !hoveredData || hoveredData.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      const { attributes } = hoveredData[0];
      const primarySelector = buildPrimarySelector(attributes);
      if (!primarySelector) return;

      void navigator.clipboard.writeText(primarySelector).then(() => {
        setCopied(primarySelector);
        window.setTimeout(() => setCopied(null), 2000);
        console.info(`[TraceabilityInspector] Copied: ${primarySelector}`);
      });

      setIsActive(false);
      setHoveredData(null);
    },
    [isActive, hoveredData],
  );

  useEffect(() => {
    if (!IS_DEV) return;

    if (isActive) {
      window.addEventListener("mousemove", handleMouseMove, {
        passive: true,
        capture: true,
      });
      window.addEventListener("click", handleClick, { capture: true });

      const style = document.createElement("style");
      style.id = "traceability-inspector-styles";
      style.innerHTML = `
        body * {
          cursor: crosshair !important;
        }
        ${TRACE_ATTRIBUTES.map((attr) => `[${attr}]:hover`).join(", ")} {
          outline: 2px solid #3b82f6 !important;
          outline-offset: -2px !important;
        }
      `;
      document.head.appendChild(style);
    } else {
      window.removeEventListener("mousemove", handleMouseMove, {
        capture: true,
      });
      window.removeEventListener("click", handleClick, { capture: true });
      document.getElementById("traceability-inspector-styles")?.remove();
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove, {
        capture: true,
      });
      window.removeEventListener("click", handleClick, { capture: true });
      document.getElementById("traceability-inspector-styles")?.remove();
    };
  }, [isActive, handleMouseMove, handleClick]);

  const getTooltipPositionStyle = (): CSSProperties => {
    const style: CSSProperties = {
      top: mousePos.y + 16,
      left: mousePos.x + 16,
      pointerEvents: "none",
    };
    if (typeof window === "undefined") return style;
    if (mousePos.x > window.innerWidth - 300) {
      style.left = mousePos.x - 300;
    }
    if (mousePos.y > window.innerHeight - 300) {
      style.top = mousePos.y - 300;
    }
    return style;
  };

  if (!IS_DEV) return null;

  return (
    <>
      {copied && (
        <div
          className="fixed bottom-4 left-1/2 z-[1000000] -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-emerald-300 shadow-xl"
          data-component="TraceabilityInspectorToast"
          data-testid="traceability-inspector-toast"
        >
          Copied: {copied}
        </div>
      )}
      {isActive && (
        <div
          className="pointer-events-none fixed inset-0 z-[999999]"
          style={{ pointerEvents: "none" }}
          data-component="TraceabilityInspector"
          data-testid="traceability-inspector"
        >
          {hoveredData && hoveredData.length > 0 && (
            <div
              className="pointer-events-none fixed max-h-[80vh] w-max max-w-lg overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-700 bg-neutral-900/95 p-3 font-mono text-xs text-white shadow-2xl backdrop-blur-sm"
              style={getTooltipPositionStyle()}
            >
              <div className="flex flex-col gap-3">
                {hoveredData.map((layer, index) => (
                  <div
                    key={index}
                    className={`flex flex-col ${index > 0 ? "border-t border-neutral-800 pt-3 opacity-70" : ""}`}
                  >
                    <div className="mb-1 flex items-center justify-between px-1 font-bold text-blue-400">
                      <span>&lt;{layer.attributes.nodeName}&gt;</span>
                      {index > 0 && (
                        <span className="pl-4 text-[9px] uppercase tracking-widest text-neutral-500">
                          Parent
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {Object.entries(layer.attributes)
                        .filter(([key]) => key !== "nodeName")
                        .map(([key, value]) => (
                          <div key={key} className="flex px-1">
                            <span className="w-32 shrink-0 text-pink-300">
                              {key}=
                            </span>
                            <span className="w-full break-all text-green-300">
                              "{value}"
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-neutral-700 px-1 pt-3 text-[10px] italic text-neutral-400">
                Click to copy innermost selector · release Option to exit
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
