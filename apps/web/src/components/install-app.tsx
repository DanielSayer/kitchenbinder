import { DropdownMenuItem } from "@prep-sheet/ui/components/dropdown-menu";
import { Download, Ellipsis, Plus, Share, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { OrganiseDialog } from "./recipes/organise-dialog";

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: InstallPromptEvent;
    appinstalled: Event;
  }
}

type Platform = "ios" | "android" | "other";
type InstallState =
  | { kind: "checking" }
  | { kind: "manual"; platform: Platform }
  | { kind: "ready"; platform: Platform }
  | { kind: "prompting"; platform: Platform }
  | { kind: "installed" }
  | { kind: "accepted" };

const storagePrefix = "kitchenbinder:install:";
const standaloneQuery =
  "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)";

function returningVisit() {
  try {
    let visit = sessionStorage.getItem(`${storagePrefix}visit`);
    if (!visit) {
      visit = localStorage.getItem(`${storagePrefix}seen`)
        ? "returning"
        : "first";
      sessionStorage.setItem(`${storagePrefix}visit`, visit);
      localStorage.setItem(`${storagePrefix}seen`, "yes");
    }
    const dismissedUntil = Number(
      localStorage.getItem(`${storagePrefix}dismissed-until`),
    );
    return visit === "returning" && Date.now() >= dismissedUntil;
  } catch {
    // Installation stays available from Account when storage is unavailable.
    return false;
  }
}

const InstallContext = createContext<{
  state: InstallState;
  suggested: boolean;
  install: () => void;
  dismiss: () => void;
} | null>(null);

function useInstallApp() {
  const value = useContext(InstallContext);
  if (!value) throw new Error("Install controls need InstallAppProvider");
  return value;
}

export function InstallAppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InstallState>({ kind: "checking" });
  const [suggested, setSuggested] = useState(false);
  const [guide, setGuide] = useState<Platform | null>(null);
  const [promptFailed, setPromptFailed] = useState(false);
  const prompt = useRef<InstallPromptEvent | null>(null);
  const installed = useRef(false);
  const guideReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!guide && guideReturnFocus.current) {
      guideReturnFocus.current.focus();
      guideReturnFocus.current = null;
    }
  }, [guide]);

  useEffect(() => {
    const platform: Platform =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
        ? "ios"
        : /Android/i.test(navigator.userAgent)
          ? "android"
          : "other";
    const displayMode = window.matchMedia(standaloneQuery);
    const isStandalone = () =>
      displayMode.matches ||
      ("standalone" in navigator && navigator.standalone === true);
    installed.current = isStandalone();
    setState(
      installed.current ? { kind: "installed" } : { kind: "manual", platform },
    );
    setSuggested(returningVisit());

    function onPrompt(event: InstallPromptEvent) {
      // Leave the browser's own desktop installation promotion alone.
      if (installed.current || platform === "other") return;
      event.preventDefault();
      prompt.current = event;
      setState({ kind: "ready", platform });
    }
    function onInstalled() {
      installed.current = true;
      prompt.current = null;
      setState({ kind: "installed" });
      setGuide(null);
      setSuggested(false);
    }
    function onDisplayChange() {
      if (isStandalone()) onInstalled();
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", onDisplayChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", onDisplayChange);
    };
  }, []);

  function dismiss() {
    setSuggested(false);
    try {
      localStorage.setItem(
        `${storagePrefix}dismissed-until`,
        String(Date.now() + 30 * 24 * 60 * 60 * 1000),
      );
    } catch {
      // Dismissal still applies for this page when storage is blocked.
    }
  }

  function showGuide(platform: Platform) {
    // The menu item unmounts as the dialog opens. Return to its persistent trigger.
    guideReturnFocus.current =
      document.querySelector<HTMLButtonElement>(".account-trigger");
    setGuide(platform);
  }

  async function install() {
    if (
      state.kind === "checking" ||
      state.kind === "installed" ||
      state.kind === "accepted" ||
      state.kind === "prompting"
    )
      return;
    const platform = state.platform;
    const availablePrompt = prompt.current;
    if (!availablePrompt) {
      setPromptFailed(false);
      showGuide(platform);
      dismiss();
      return;
    }
    // A browser event is single-use. Consume it before awaiting to stop double taps.
    prompt.current = null;
    setState({ kind: "prompting", platform });
    dismiss();
    try {
      const result = await availablePrompt.prompt();
      if (!installed.current) {
        setState(
          result.outcome === "accepted"
            ? { kind: "accepted" }
            : { kind: "manual", platform },
        );
      }
    } catch {
      if (!installed.current) {
        setState({ kind: "manual", platform });
        setPromptFailed(true);
        showGuide(platform);
      }
    }
  }

  return (
    <InstallContext value={{ state, suggested, install, dismiss }}>
      {children}
      {guide && (
        <InstallGuide
          platform={guide}
          promptFailed={promptFailed}
          onClose={() => setGuide(null)}
        />
      )}
    </InstallContext>
  );
}

export function InstallMenuItem() {
  const { state, install } = useInstallApp();
  if (
    state.kind === "checking" ||
    state.kind === "installed" ||
    state.kind === "accepted"
  )
    return null;
  return (
    <DropdownMenuItem
      className="collection-select-manage install-menu-item"
      onClick={install}
      disabled={state.kind === "prompting"}
    >
      <Download size={16} aria-hidden="true" /> Add to home screen
    </DropdownMenuItem>
  );
}

export function InstallSuggestion() {
  const { state, suggested, install, dismiss } = useInstallApp();
  if (
    !suggested ||
    (state.kind !== "manual" && state.kind !== "ready") ||
    state.platform === "other"
  )
    return null;
  return (
    <aside className="install-suggestion" aria-label="Home screen shortcut">
      <img src="/branding/icon-192.png" width={40} height={40} alt="" />
      <div>
        <p>Kitchenbinder, one tap away</p>
        <span>Open your recipes from your home screen.</span>
        <button
          type="button"
          className="install-suggestion-action"
          onClick={install}
        >
          Add to home screen <Download size={15} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss home screen suggestion"
        onClick={dismiss}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}

function InstallGuide({
  platform,
  promptFailed,
  onClose,
}: {
  platform: Platform;
  promptFailed: boolean;
  onClose: () => void;
}) {
  return (
    <OrganiseDialog
      title="Add to home screen"
      onClose={onClose}
      className="install-guide"
    >
      <div className="install-guide-app">
        <img src="/branding/icon-192.png" width={56} height={56} alt="" />
        <div>
          <h3>Kitchenbinder</h3>
          <p>Your recipes, ready when you are.</p>
        </div>
      </div>
      {promptFailed && (
        <p role="status">
          The install prompt couldn't open. Try the browser menu instead.
        </p>
      )}
      {platform === "ios" ? (
        <>
          <p>In Safari on your iPhone or iPad:</p>
          <ol className="install-steps">
            <li>
              <Share size={21} aria-hidden="true" />
              <div>
                Tap <strong>Share</strong>.
                <span>
                  Look for the square with an upward arrow. It may be inside the
                  More menu.
                </span>
              </div>
            </li>
            <li>
              <Plus size={21} aria-hidden="true" />
              <div>
                Choose <strong>Add to Home Screen</strong>.
                <span>Scroll down the share menu if you don't see it.</span>
              </div>
            </li>
            <li>
              <Download size={21} aria-hidden="true" />
              <div>
                Tap <strong>Add</strong>.
                <span>If shown, keep Open as Web App switched on.</span>
              </div>
            </li>
          </ol>
          <p className="install-guide-note">
            Using another browser? Look in its Share menu, or open this page in
            Safari and follow these steps.
          </p>
        </>
      ) : platform === "android" ? (
        <>
          <p>In Chrome on your Android phone:</p>
          <ol className="install-steps">
            <li>
              <Ellipsis size={21} aria-hidden="true" />
              <div>
                Open the browser <strong>menu</strong>.
                <span>Tap the three dots beside the address bar.</span>
              </div>
            </li>
            <li>
              <Plus size={21} aria-hidden="true" />
              <div>
                Tap <strong>Add to home screen</strong> or{" "}
                <strong>Install app</strong>.
              </div>
            </li>
            <li>
              <Download size={21} aria-hidden="true" />
              <div>
                Confirm <strong>Install</strong> or <strong>Add</strong>.
                <span>The wording depends on your browser.</span>
              </div>
            </li>
          </ol>
          <p className="install-guide-note">
            Can't find it? Open this page in Chrome. Browsers inside other apps
            may not support installation.
          </p>
        </>
      ) : (
        <p>
          Open your browser menu and look for Install app or Add to home screen.
          On a computer, Safari calls this Add to Dock.
        </p>
      )}
      <div className="organise-dialog-footer">
        <button
          type="button"
          className="button button-primary"
          onClick={onClose}
        >
          Got it
        </button>
      </div>
    </OrganiseDialog>
  );
}
