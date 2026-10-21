/**
 * dsh-copy-file browser fragment.
 *
 * This file is NOT loaded directly: `scripts/vendor-client.mjs` splices it into
 * the vendored copy of `@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js`
 * and writes `lib/client.js`. It therefore runs inside that bundle's factory and
 * may use its locals: `react`, `react_jsx_runtime`,
 * `_deepseek_ai_dsh_client_ui_primitives`.
 *
 * Everything here is additive. The split button, its menu ordering, its footer,
 * its styles, and its keyboard behavior are untouched; the delivery-card
 * adapter is the only caller that opts into `copy`, so every other control that
 * uses this package keeps identical behavior.
 */

// ── route surface (document-relative, same origin, cookie-authenticated) ─────
const COPY_ROUTE_FILE = "api/copy.file";
const COPY_ROUTE_PATH = "api/copy.path";
const COPY_ROUTE_PROBE = "api/copy.probe";
const COPY_ROUTE_RAW = "api/copy.raw";
const COPY_PRESENT_PREFIX = "api/present.open";
const COPY_SELECTED_ATTR = "data-dsh-copy-selected";
const COPY_ITEM_FILE = "copy:file";
const COPY_ITEM_ALL = "copy:all";
const COPY_ITEM_PATH = "copy:path";
const COPY_ITEM_SEPARATOR = "copy:separator";
/** Private drag payload: the coordinates of the card being dragged. */
const COPY_DRAG_MIME = "application/x-dsh-copy-file";

/**
 * Query string for the coordinates the delivery card already carries.
 * @param {string} actionUrl - the card's `api/present.open?...` URL.
 * @returns {string} `sessionId=…&seq=…&index=…`, or an empty string.
 */
function copyCoordinatesOf(actionUrl) {
  if (typeof actionUrl !== "string" || !actionUrl.startsWith(COPY_PRESENT_PREFIX)) return "";
  const query = actionUrl.slice(actionUrl.indexOf("?") + 1);
  return actionUrl.includes("?") ? query : "";
}

/**
 * Split a coordinate query into its parts.
 * @param {string} query - raw query string.
 * @returns {{sessionId: string, seq: string, index: string}|null} the parts, or null.
 */
function copyParseCoordinates(query) {
  const search = new URLSearchParams(query);
  const sessionId = search.get("sessionId");
  const seq = search.get("seq");
  const index = search.get("index");
  if (sessionId === null || seq === null || index === null) return null;
  return { sessionId, seq, index };
}

/** Attribute-driven styles: selection reuses the card's own hover fill. */
const COPY_STYLES = [
  "[" + COPY_SELECTED_ATTR + '="1"]{background:var(--deliverable-hover)!important}',
  "[data-presented-file]{-webkit-user-drag:element}",
  "[data-presented-file] button{-webkit-user-drag:element}",
  ".dsh-copy-ghost{position:fixed;z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 14px;border-radius:12px;pointer-events:none;font-family:var(--dsw-font-family,system-ui);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));box-shadow:0 6px 20px rgba(0,0,0,.18)}",
  ".dsh-copy-ghost-name{font-size:11px;line-height:14px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#111)}",
  "body[data-ds-dark-theme] .dsh-copy-ghost{background:rgba(255,255,255,.10)}",
  ".dsh-copy-ghost{background:rgba(255,255,255,.72)}",
].join("\n");

/** Inject the stylesheet once per page. */
function copyInstallStyles() {
  if (typeof document === "undefined") return;
  const id = "dsh-copy-file/styles";
  if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-copy-file";
  tag.dataset.pluginCss = id;
  tag.textContent = COPY_STYLES;
  document.head.appendChild(tag);
}

/** One shared selection: the Windows rule is "exactly one file is selected". */
let copySelectedCard = null;
let copySelectedController = null;
let copyGlobalBound = false;
let copyDropBound = false;

/**
 * Notify the selected card's controller and clear the visual selection.
 * @returns {void}
 */
function copyDeselect() {
  if (copySelectedCard !== null) copySelectedCard.removeAttribute(COPY_SELECTED_ATTR);
  copySelectedCard = null;
  copySelectedController = null;
}

/**
 * Global Escape / Ctrl+C / outside-click handling for the selected card.
 * @param {KeyboardEvent} event - document keydown.
 * @returns {void}
 */
function copyOnGlobalKey(event) {
  const card = copySelectedCard;
  if (card === null) return;
  if (event.key === "Escape") {
    copyDeselect();
    return;
  }
  const isCopy = (event.ctrlKey || event.metaKey) && (event.key === "c" || event.key === "C");
  if (!isCopy) return;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  if (typeof window.getSelection === "function" && (window.getSelection()?.toString() ?? "") !== "") return;
  event.preventDefault();
  copySelectedController?.copyFile();
}

/**
 * Clear the selection when the pointer lands outside the selected card.
 * @param {PointerEvent} event - document pointerdown.
 * @returns {void}
 */
function copyOnGlobalPointer(event) {
  if (copySelectedCard === null) return;
  if (event.target instanceof Node && copySelectedCard.contains(event.target)) return;
  copyDeselect();
}

/**
 * Select one card and bind the page-level listeners once.
 * @param {HTMLElement} card - the card root.
 * @param {{copyFile: () => void}} controller - the card's copy controller.
 * @returns {void}
 */
function copySelect(card, controller) {
  if (copySelectedCard === card) return;
  copyDeselect();
  copySelectedCard = card;
  copySelectedController = controller;
  card.setAttribute(COPY_SELECTED_ATTR, "1");
  if (copyGlobalBound) return;
  copyGlobalBound = true;
  document.addEventListener("keydown", copyOnGlobalKey, true);
  document.addEventListener("pointerdown", copyOnGlobalPointer, true);
}

/**
 * Build the drag ghost: the card's own file icon, a translucent plate, and the
 * file name below it in the DSH font at a smaller size.
 * @param {HTMLElement} card - the card root.
 * @param {string} name - file name.
 * @returns {HTMLElement} the offscreen ghost element.
 */
function copyBuildGhost(card, name) {
  const ghost = document.createElement("div");
  ghost.className = "dsh-copy-ghost";
  ghost.style.left = "-10000px";
  ghost.style.top = "-10000px";
  const icon = card.querySelector("span svg");
  if (icon !== null) {
    const clone = icon.cloneNode(true);
    clone.setAttribute("width", "40");
    clone.setAttribute("height", "40");
    clone.style.width = "40px";
    clone.style.height = "40px";
    ghost.appendChild(clone);
  }
  const label = document.createElement("span");
  label.className = "dsh-copy-ghost-name";
  label.textContent = name;
  ghost.appendChild(label);
  document.body.appendChild(ghost);
  return ghost;
}

/**
 * The file name the Host already resolved for this card.
 *
 * The delivery card's preview control carries the absolute path in `title`, so a
 * drag started before any menu probe still knows the real name — and the
 * attached file or the dropped copy keeps its name and extension instead of
 * arriving as `file`.
 * @param {HTMLElement} card - the card root.
 * @returns {string} the basename, or an empty string when the card has none.
 */
function copyNameFromCard(card) {
  const button = card.querySelector("button[title]");
  const raw = button === null ? "" : (button.getAttribute("title") ?? "");
  const parts = raw.split(/[\\/]/).filter((part) => part !== "");
  return parts.length === 0 ? "" : parts[parts.length - 1];
}

/**
 * Whether this engine honors a `DownloadURL` drag that leaves the page.
 *
 * Only Chromium implements it. Firefox and Safari ignore the payload, so the
 * drop would silently do nothing there; those browsers get no drag source at
 * all and use the menu or Ctrl+C instead.
 * @returns {boolean} true when dragging can land a real file.
 */
function copySupportsDragOut() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent ?? "");
  if (/Firefox\//.test(ua)) return false;
  return /(Chrome|Chromium|Edg|OPR|Brave)\//.test(ua);
}

/**
 * Whether a data transfer carries our card payload.
 * @param {DataTransfer|null|undefined} transfer - the drag payload.
 * @returns {boolean} true when the dragged item is one of our cards.
 */
function copyCarriesCard(transfer) {
  if (transfer === null || transfer === undefined) return false;
  const types = Array.from(transfer.types ?? []);
  return types.includes(COPY_DRAG_MIME);
}

/**
 * Poll a predicate until it holds or the budget runs out.
 * @param {() => boolean} predicate - condition to wait for.
 * @param {number} timeoutMs - budget.
 * @returns {Promise<boolean>} whether the condition held.
 */
async function copyWaitFor(predicate, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (predicate()) return true;
    } catch {
      /* keep polling */
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return false;
}

/**
 * The Session row under a drop, if any.
 * @param {number} x - viewport x.
 * @param {number} y - viewport y.
 * @returns {{row: HTMLElement, sessionId: string}|null} the row and its Session.
 */
function copySessionRowAt(x, y) {
  if (typeof document.elementFromPoint !== "function") return null;
  const element = document.elementFromPoint(x, y);
  const row = element?.closest('[role="treeitem"]');
  if (!(row instanceof HTMLElement)) return null;
  const key = row.getAttribute("data-row-key") ?? "";
  if (!key.startsWith("session:")) return null;
  const sessionId = key.slice("session:".length);
  return sessionId === "" ? null : { row, sessionId };
}

/**
 * Activate one Session row the way a pointer press does, then wait until the
 * view reports it selected.
 * @param {HTMLElement} row - the Session row.
 * @returns {Promise<boolean>} whether the switch completed.
 */
async function copySwitchSession(row) {
  if (row.getAttribute("aria-selected") === "true") return true;
  const Pointer = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    row.dispatchEvent(new Pointer(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
  }
  return copyWaitFor(() => row.getAttribute("aria-selected") === "true", 4000);
}

/**
 * Attach a dropped card to the conversation.
 *
 * The composer already listens for `drop` at the document level and reads
 * `dataTransfer.files`, so the cheapest honest implementation is to fetch the
 * verified bytes from the Host and re-dispatch a plain `drop` carrying one
 * `File`. That works in every engine (nothing leaves the page) and needs no
 * attachment service.
 *
 * A drop on a Session row in the sidebar targets *that* conversation: the row is
 * activated first (its `aria-selected` is the app's own source of truth) and the
 * attachment is dispatched only once the switch completed, so a slow switch can
 * never attach the file to the wrong conversation.
 * @param {{query: string, name?: string}} payload - the dragged card.
 * @param {HTMLElement|null} [targetRow] - Session row under the drop, if any.
 * @returns {Promise<void>} after the synthetic drop is dispatched.
 */
async function copyAttachDropped(payload, targetRow) {
  try {
    // One attach per gesture, even if a previous module revision left its own
    // drop receiver on this document (a swap can otherwise dispatch twice).
    if (!copyClaimAttach(payload.query)) return;
    if (targetRow !== null && targetRow !== undefined) {
      const switched = await copySwitchSession(targetRow);
      if (!switched) return;
      // The composer is remounted per Session; give it a frame to accept a drop.
      await copyWaitFor(() => document.querySelector("textarea, [contenteditable='true']") !== null, 2000);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const response = await fetch(COPY_ROUTE_RAW + "?" + payload.query);
    if (!response.ok) return;
    const blob = await response.blob();
    const type = blob.type === "" ? "application/octet-stream" : blob.type;
    const file = new File([blob], payload.name === undefined || payload.name === "" ? "file" : payload.name, { type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    document.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  } catch {
    /* no composer mounted, or the engine refused the synthetic transfer */
  }
}

/** Window-scoped slot holding the current receiver, so a swap can replace it. */
const COPY_DROP_SLOT = "__dshCopyFileDropReceiver";
/** Window-scoped record of the last attachment claim. */
const COPY_ATTACH_SLOT = "__dshCopyFileAttachClaim";

/**
 * Take the right to attach one gesture, at most once per 1.5 s for the same card.
 *
 * Hot-swapping the browser bundle can leave an older revision's receiver on the
 * document; both would dispatch, and the composer would attach the same file
 * twice. The claim lives on `window`, so it spans module instances.
 * @param {string} query - the dragged card's coordinates.
 * @returns {boolean} true when this call owns the gesture.
 */
function copyClaimAttach(query) {
  if (typeof window === "undefined") return true;
  const now = Date.now();
  const previous = window[COPY_ATTACH_SLOT];
  if (previous !== undefined && previous.query === query && now - previous.at < 1500) return false;
  window[COPY_ATTACH_SLOT] = { query, at: now };
  return true;
}

/**
 * One page-level receiver for card drops, installed on first card mount.
 *
 * Reinstalling replaces a receiver left behind by an earlier module revision
 * instead of stacking a second one, and it stops *immediate* propagation because
 * the composer's own listener also sits on `document` — `stopPropagation` alone
 * does not silence a sibling listener on the same node.
 * @returns {void}
 */
function copyEnsureDropReceiver() {
  if (typeof document === "undefined") return;
  const previous = window[COPY_DROP_SLOT];
  if (previous !== undefined) {
    document.removeEventListener("dragover", previous.over, true);
    document.removeEventListener("drop", previous.drop, true);
  }
  const over = (event) => {
    if (!copyCarriesCard(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event) => {
    if (!copyCarriesCard(event.dataTransfer)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    let payload;
    try {
      payload = JSON.parse(event.dataTransfer.getData(COPY_DRAG_MIME));
    } catch {
      return;
    }
    if (typeof payload?.query !== "string") return;
    const target = copySessionRowAt(event.clientX, event.clientY);
    void copyAttachDropped(payload, target === null ? null : target.row);
  };
  document.addEventListener("dragover", over, true);
  document.addEventListener("drop", drop, true);
  window[COPY_DROP_SLOT] = { over, drop };
  copyDropBound = true;
}

/**
 * Bind Windows-like interaction to one rendered delivery card.
 *
 * Single click selects (persistent hover fill), double click opens the Sidebar
 * preview, Enter/Space keep working because the native button click still
 * reaches React, Ctrl+C copies the selected file, and dragging starts a native
 * drag whose payload is a `DownloadURL` so a drop on Explorer lands a copy.
 *
 * @param {HTMLElement} anchor - a node inside the card's action cell.
 * @param {() => object} getController - reads the latest copy controller.
 * @returns {() => void} teardown.
 */
function copyInstallCardInteraction(anchor, getController) {
  const card = anchor.closest("[data-presented-file]");
  if (card === null) return () => {};
  const preview = card.querySelector(":scope > button");
  const state = { allowNext: false };
  const cleanups = [];

  /**
   * Register one listener and collect its remover.
   * @param {EventTarget} target - listener target.
   * @param {string} type - event name.
   * @param {EventListener} handler - listener.
   * @param {boolean|AddEventListenerOptions} [options] - capture or options.
   * @returns {void}
   */
  const on = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  // Single click selects; the Sidebar preview moves to double click (Windows
  // semantics). Keyboard activation (detail === 0) is left alone so Enter and
  // Space still open the preview.
  on(card, "click", (event) => {
    if (preview === null) return;
    const target = event.target;
    if (!(target instanceof Node) || !preview.contains(target)) return;
    if (event.detail === 0) return;
    if (state.allowNext) {
      state.allowNext = false;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    copySelect(card, getController());
  }, true);

  on(card, "dblclick", (event) => {
    if (preview === null) return;
    const target = event.target;
    if (!(target instanceof Node) || !preview.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    copySelect(card, getController());
    state.allowNext = true;
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  }, true);

  // Dragging is always enabled: an in-page drop attaches the file to the
  // conversation, which every engine supports. The Chromium-only `DownloadURL`
  // payload is added on top so the same gesture can land a copy on Explorer.
  card.draggable = true;
  if (preview !== null) preview.draggable = true;
  copyEnsureDropReceiver();

  on(card, "dragstart", (event) => {
    const controller = getController();
    if (controller?.enabled !== true) return;
    const drag = event;
    // The probe that supplies `name` only runs when the menu opens, so a drag
    // straight from the card falls back to the card's own preview title (the
    // absolute path the Host already resolved) instead of attaching "file".
    const name = (controller.name ?? "") !== "" ? controller.name : copyNameFromCard(card);
    const url = new URL(COPY_ROUTE_RAW + "?" + controller.query, location.href).href;
    try {
      drag.dataTransfer?.setData(COPY_DRAG_MIME, JSON.stringify({ query: controller.query, name }));
      drag.dataTransfer?.setData("text/plain", name);
      if (copySupportsDragOut()) {
        drag.dataTransfer?.setData("DownloadURL", "application/octet-stream:" + name + ":" + url);
      }
      if (drag.dataTransfer !== null) drag.dataTransfer.effectAllowed = "copy";
    } catch {
      return;
    }
    const ghost = copyBuildGhost(card, name);
    try {
      drag.dataTransfer?.setDragImage(ghost, 40, 20);
    } catch {
      /* the browser may reject a detached image; the payload still works */
    }
    card.dataset.dshCopyDragging = ghost.isConnected ? "1" : "0";
    state.ghost = ghost;
  });

  on(card, "dragend", (event) => {
    if (state.ghost instanceof HTMLElement) state.ghost.remove();
    state.ghost = undefined;
    delete card.dataset.dshCopyDragging;
    // `none` means neither the page nor the OS accepted the drop. Say how to
    // succeed instead of leaving the gesture silently doing nothing.
    if (event.dataTransfer?.dropEffect === "none") {
      const controller = getController();
      controller?.[copySupportsDragOut() ? "dragHint" : "dragUnsupported"]?.();
    }
  });

  copyInstallStyles();
  return () => {
    for (const cleanup of cleanups) cleanup();
    if (copySelectedCard === card) copyDeselect();
    if (state.ghost instanceof HTMLElement) state.ghost.remove();
    delete card.dataset.dshCopyDragging;
    card.draggable = false;
    if (preview !== null) preview.draggable = false;
  };
}

/**
 * Copy controller shared by the menu rows, Ctrl+C, and the drag payload.
 * @param {string|undefined} actionUrl - the delivery card's action URL.
 * @param {boolean} available - whether the card renders native actions at all.
 * @param {(key: string, params?: object) => string} t - localized copy.
 * @returns {object} controller with `copy`, `toast`, and lifecycle helpers.
 */
function useDeliveryCard(actionUrl, available, t) {
  const query = react.useMemo(() => copyCoordinatesOf(actionUrl), [actionUrl]);
  const enabled = query !== "" && available === true;
  const [info, setInfo] = react.useState(null);
  const [busy, setBusy] = react.useState(false);
  const [toast, setToast] = react.useState(null);
  const toastSeq = react.useRef(0);
  const alive = react.useRef(true);

  react.useEffect(() => () => { alive.current = false; }, []);

  /**
   * Announce one transient message. Success fades within 1.5s; a failure that
   * names its cause stays long enough to read.
   * @param {string} text - resolved copy.
   * @param {"success"|"warning"} tone - visual tone.
   * @returns {void}
   */
  const show = react.useCallback((text, tone) => {
    if (!alive.current) return;
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, tone });
  }, []);

  /**
   * Read how many files this delivery declares (also supplies the drag name).
   * @returns {Promise<object|null>} probe answer, or null.
   */
  const probe = react.useCallback(async () => {
    if (!enabled) return null;
    if (info !== null) return info;
    try {
      const response = await fetch(COPY_ROUTE_PROBE + "?" + query, { headers: { accept: "application/json" } });
      if (!response.ok) return null;
      const payload = await response.json();
      if (payload?.ok === true && alive.current) setInfo(payload);
      return payload?.ok === true ? payload : null;
    } catch {
      return null;
    }
  }, [enabled, info, query]);

  /**
   * Copy the absolute path as text (the documented fallback).
   * @param {string} [reason] - clipboard reason that forced the fallback.
   * @returns {Promise<boolean>} whether the text reached the clipboard.
   */
  const fallback = react.useCallback(async (reason) => {
    try {
      const response = await fetch(COPY_ROUTE_PATH + "?" + query, { headers: { accept: "application/json" } });
      const payload = await response.json();
      const target = typeof payload?.path === "string" ? payload.path : Array.isArray(payload?.paths) ? payload.paths.join("\n") : "";
      if (target === "") return false;
      const written = await _deepseek_ai_dsh_client_ui_primitives.writeClipboard(target);
      if (!written) return false;
      const reasonText = t("copy.reason." + String(reason ?? "unknown"));
      show(t("copy.degraded", { reason: reasonText }), "warning");
      return true;
    } catch {
      return false;
    }
  }, [query, show, t]);

  /**
   * Run one copy intent.
   * @param {"file"|"all"|"path"} kind - which menu row was activated.
   * @returns {Promise<void>} after the toast is published.
   */
  const run = react.useCallback(async (kind) => {
    if (!enabled || busy) return;
    setBusy(true);
    try {
      if (kind === "path") {
        const response = await fetch(COPY_ROUTE_PATH + "?" + query, { headers: { accept: "application/json" } });
        const payload = await response.json();
        const target = typeof payload?.path === "string" ? payload.path : "";
        if (target !== "" && await _deepseek_ai_dsh_client_ui_primitives.writeClipboard(target)) {
          show(t("copy.donePath"), "success");
        } else {
          show(t("copy.failed"), "warning");
        }
        return;
      }
      const scope = kind === "all" ? "&scope=all" : "";
      const response = await fetch(COPY_ROUTE_FILE + "?" + query + scope, { method: "POST", headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (payload?.ok === true) {
        show(kind === "all" ? t("copy.doneAll", { count: String(payload.count ?? info?.count ?? 1) }) : t("copy.done", { name: info?.name ?? "" }), "success");
        return;
      }
      const reason = payload?.reason ?? "host-error";
      const degraded = await fallback(reason);
      if (!degraded) show(t("copy.failed"), "warning");
    } catch {
      const degraded = await fallback("host-error");
      if (!degraded) show(t("copy.failed"), "warning");
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [busy, enabled, fallback, info, query, show, t]);

  const anchorRef = react.useRef(null);
  const toastElement = toast === null ? null : (0, react_jsx_runtime.jsx)(
    _deepseek_ai_dsh_client_ui_primitives.Toast,
    {
      text: toast.text,
      tone: toast.tone === "success" ? "success" : void 0,
      icon: toast.tone === "success" ? void 0 : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
      holdMs: toast.tone === "success" ? 1300 : 2600,
      onDone: () => { if (alive.current) setToast(null); },
    },
    toast.id,
  );
  const controller = {
    enabled,
    query,
    name: info?.name ?? "",
    count: info?.count ?? 1,
    index: info?.index ?? 0,
    busy,
    probe,
    run,
    copyFile: () => run("file"),
    copyAll: () => run("all"),
    copyPath: () => run("path"),
    // A drag that nothing accepted shows the way out: a folder window, or Ctrl+C.
    dragHint: () => show(t("copy.dragHint"), "warning"),
    dragUnsupported: () => show(t("copy.dragUnsupported"), "warning"),
    toast: toastElement,
  };

  const controllerRef = react.useRef(controller);
  controllerRef.current = controller;

  react.useEffect(() => {
    const anchor = anchorRef.current;
    if (!enabled || anchor === null) return;
    return copyInstallCardInteraction(anchor, () => controllerRef.current);
  }, [enabled, query]);

  return { anchorRef, controller, probe };
}

/**
 * Menu rows and selection handling for the delivery card's action menu.
 * @param {object|undefined} copy - the delivery controller, absent for every
 *   other user of this split button.
 * @param {(key: string, params?: object) => string} t - localized copy.
 * @returns {{items: object[], onSelect: (id: string) => boolean, toast: any}} menu contribution.
 */
function useCopyGesture(copy, t) {
  const enabled = copy?.enabled === true;
  const copyIcon = (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, {});
  const items = enabled ? [
    { id: COPY_ITEM_FILE, label: t("copy.file"), icon: copyIcon, disabled: copy.busy === true },
    ...(copy.count > 1 ? [{ id: COPY_ITEM_ALL, label: t("copy.all", { count: String(copy.count) }), icon: copyIcon, disabled: copy.busy === true }] : []),
    { id: COPY_ITEM_PATH, label: t("copy.path"), icon: copyIcon, disabled: copy.busy === true },
    { type: "separator", id: COPY_ITEM_SEPARATOR },
  ] : [];
  return {
    items,
    onSelect: (id) => {
      if (!enabled) return false;
      if (id === COPY_ITEM_FILE) { void copy.run("file"); return true; }
      if (id === COPY_ITEM_ALL) { void copy.run("all"); return true; }
      if (id === COPY_ITEM_PATH) { void copy.run("path"); return true; }
      return false;
    },
    toast: copy?.toast ?? null,
  };
}
