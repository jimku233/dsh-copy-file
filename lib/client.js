/**
 * dsh-copy-file, browser half.
 *
 * Registers one action of its own into the delivery card's action slot
 * (`deliverables.file.actions`, declared `kind: list`) instead of replacing the
 * shipped `ui-open-in-app` module. That slot renders every occupant, so copying
 * lands beside "Open in" without touching the upstream package — which means an
 * upgrade cannot silently downgrade it, and there is no generated bundle to
 * re-vendor.
 *
 * Two presentations, chosen by `config.presentation` (see cordis.patch.yml):
 *
 * - `icon` (default): one icon button. Click copies the file; right-click opens
 *   "copy all / copy path".
 * - `menu`: the same icon plus a chevron that opens the same menu.
 *
 * Card gestures (click to select, double-click to preview, drag out, Ctrl+C) are
 * bound to the card element found above this action's anchor, so they behave the
 * same in both presentations.
 *
 * The browser artifact registers a lazy factory whose id is the package name.
 */

window.__ModuleLoader__.load({
  id: 'dsh-copy-file',
  factory(require) {
    const react = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    /**
     * `createElement` behind the `jsx(type, props, key)` call shape the ported
     * UI code uses, so a third argument is still a React key.
     * @param {any} type - element type.
     * @param {object|null} props - element props.
     * @param {any} [key] - React key.
     * @returns {any} the element.
     */
    const jsx = (type, props, key) => react.createElement(
      type,
      key === undefined ? props : Object.assign({}, props, { key }),
    );

    /** Locale namespace owned by this plugin. */
    const NS = 'copy-file';
    /**
     * The look this package ships. The sibling package `dsh-copy-file-icon` is
     * the same file with `'icon'` here; keep the two in sync (a test asserts it).
     */
    const DEFAULT_PRESENTATION = 'menu';

    // ── route surface (document-relative, same origin, cookie-authenticated) ──
    const COPY_ROUTE_FILE = 'api/copy.file';
    const COPY_ROUTE_PATH = 'api/copy.path';
    const COPY_ROUTE_PROBE = 'api/copy.probe';
    const COPY_ROUTE_RAW = 'api/copy.raw';
    const COPY_PRESENT_PREFIX = 'api/present.open';
    const COPY_SELECTED_ATTR = 'data-dsh-copy-selected';
    const COPY_ITEM_ALL = 'copy:all';
    const COPY_ITEM_PATH = 'copy:path';
    /** Private drag payload: the coordinates of the card being dragged. */
    const COPY_DRAG_MIME = 'application/x-dsh-copy-file';

    /**
     * Query string for the coordinates the delivery card already carries.
     * @param {string} actionUrl - the card's `api/present.open?...` URL.
     * @returns {string} `sessionId=…&seq=…&index=…`, or an empty string.
     */
    function copyCoordinatesOf(actionUrl) {
      if (typeof actionUrl !== 'string' || !actionUrl.startsWith(COPY_PRESENT_PREFIX)) return '';
      return actionUrl.includes('?') ? actionUrl.slice(actionUrl.indexOf('?') + 1) : '';
    }

    const COPY_STYLES = [
      '[' + COPY_SELECTED_ATTR + '="1"]{background:var(--deliverable-hover)!important}',
      '[data-presented-file]{-webkit-user-drag:element}',
      '[data-presented-file] button{-webkit-user-drag:element}',
      '.dsh-copyfile-slot{display:contents}',
      '.dsh-copyfile-group{display:inline-flex;align-items:stretch;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);height:24px;overflow:hidden;margin-inline-start:8px}',
      '.dsh-copyfile-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:0;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;padding:3px 5px;font-family:var(--dsw-font-family);font-size:11px;line-height:16px}',
      '.dsh-copyfile-btn:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
      '@media (hover:hover){.dsh-copyfile-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}',
      '.dsh-copyfile-btn:disabled{cursor:default;opacity:.55}',
      '.dsh-copyfile-chevron{border-left:.5px solid var(--dsw-alias-border-l4);padding:3px 4px 3px 3px;color:var(--dsw-alias-label-secondary)}',
      '.dsh-copy-ghost{position:fixed;z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 14px;border-radius:12px;pointer-events:none;font-family:var(--dsw-font-family,system-ui);border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));box-shadow:0 6px 20px rgba(0,0,0,.18)}',
      '.dsh-copy-ghost-name{font-size:11px;line-height:14px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#111)}',
      '.dsh-copy-ghost{background:rgba(255,255,255,.72)}',
      'body[data-ds-dark-theme] .dsh-copy-ghost{background:rgba(255,255,255,.10)}',
    ].join('\n');

    /** Inject the stylesheet once per page. */
    function copyInstallStyles() {
      if (typeof document === 'undefined') return () => {};
      const id = 'dsh-copy-file/styles';
      if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-copy-file';
      tag.dataset.pluginCss = id;
      tag.textContent = COPY_STYLES;
      document.head.appendChild(tag);
      return () => { tag.remove(); };
    }

    /** One shared selection: the Windows rule is "exactly one file is selected". */
    let copySelectedCard = null;
    let copySelectedController = null;
    let copyGlobalBound = false;
    let copyDropBound = false;

    /** Clear the selection and the persistent fill. */
    function copyDeselect() {
      if (copySelectedCard !== null) copySelectedCard.removeAttribute(COPY_SELECTED_ATTR);
      copySelectedCard = null;
      copySelectedController = null;
    }

    /**
     * Global Escape / Ctrl+C handling for the selected card.
     * @param {KeyboardEvent} event - document keydown.
     */
    function copyOnGlobalKey(event) {
      const card = copySelectedCard;
      if (card === null) return;
      if (event.key === 'Escape') {
        copyDeselect();
        return;
      }
      const isCopy = (event.ctrlKey || event.metaKey) && (event.key === 'c' || event.key === 'C');
      if (!isCopy) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (typeof window.getSelection === 'function' && (window.getSelection()?.toString() ?? '') !== '') return;
      event.preventDefault();
      copySelectedController?.copyFile();
    }

    /**
     * Clear the selection when the pointer lands outside the selected card.
     * @param {PointerEvent} event - document pointerdown.
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
     */
    function copySelect(card, controller) {
      if (copySelectedCard === card) return;
      copyDeselect();
      copySelectedCard = card;
      copySelectedController = controller;
      card.setAttribute(COPY_SELECTED_ATTR, '1');
      if (copyGlobalBound) return;
      copyGlobalBound = true;
      document.addEventListener('keydown', copyOnGlobalKey, true);
      document.addEventListener('pointerdown', copyOnGlobalPointer, true);
    }

    /**
     * Build the drag ghost: the card's own file icon, a translucent plate, and
     * the file name below it.
     * @param {HTMLElement} card - the card root.
     * @param {string} name - file name.
     * @returns {HTMLElement} the offscreen ghost element.
     */
    function copyBuildGhost(card, name) {
      const ghost = document.createElement('div');
      ghost.className = 'dsh-copy-ghost';
      ghost.style.left = '-10000px';
      ghost.style.top = '-10000px';
      const icon = card.querySelector('span svg');
      if (icon !== null) {
        const clone = icon.cloneNode(true);
        clone.setAttribute('width', '40');
        clone.setAttribute('height', '40');
        clone.style.width = '40px';
        clone.style.height = '40px';
        ghost.appendChild(clone);
      }
      const label = document.createElement('span');
      label.className = 'dsh-copy-ghost-name';
      label.textContent = name;
      ghost.appendChild(label);
      document.body.appendChild(ghost);
      return ghost;
    }

    /**
     * The file name the Host already resolved for this card, read from the
     * preview control's `title`.
     * @param {HTMLElement} card - the card root.
     * @returns {string} the basename, or an empty string.
     */
    function copyNameFromCard(card) {
      const button = card.querySelector('button[title]');
      const raw = button === null ? '' : (button.getAttribute('title') ?? '');
      const parts = raw.split(/[\\/]/).filter((part) => part !== '');
      return parts.length === 0 ? '' : parts[parts.length - 1];
    }

    /**
     * Whether this engine honors a `DownloadURL` drag that leaves the page.
     * @returns {boolean} true when dragging can land a real file.
     */
    function copySupportsDragOut() {
      if (typeof navigator === 'undefined') return false;
      const ua = String(navigator.userAgent ?? '');
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
      return Array.from(transfer.types ?? []).includes(COPY_DRAG_MIME);
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
      if (typeof document.elementFromPoint !== 'function') return null;
      const element = document.elementFromPoint(x, y);
      const row = element?.closest('[role="treeitem"]');
      if (!(row instanceof HTMLElement)) return null;
      const key = row.getAttribute('data-row-key') ?? '';
      if (!key.startsWith('session:')) return null;
      const sessionId = key.slice('session:'.length);
      return sessionId === '' ? null : { row, sessionId };
    }

    /**
     * Activate one Session row the way a pointer press does, then wait until the
     * view reports it selected.
     * @param {HTMLElement} row - the Session row.
     * @returns {Promise<boolean>} whether the switch completed.
     */
    async function copySwitchSession(row) {
      if (row.getAttribute('aria-selected') === 'true') return true;
      const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        row.dispatchEvent(new Pointer(type, { bubbles: true, cancelable: true, view: window, button: 0 }));
      }
      return copyWaitFor(() => row.getAttribute('aria-selected') === 'true', 4000);
    }

    /**
     * Attach a dropped card to the conversation by re-dispatching a plain `drop`
     * carrying one `File` the Host verified.
     * @param {{query: string, name?: string}} payload - the dragged card.
     * @param {HTMLElement|null} [targetRow] - Session row under the drop, if any.
     * @returns {Promise<void>} after the synthetic drop is dispatched.
     */
    async function copyAttachDropped(payload, targetRow) {
      try {
        if (!copyClaimAttach(payload.query)) return;
        if (targetRow !== null && targetRow !== undefined) {
          const switched = await copySwitchSession(targetRow);
          if (!switched) return;
          await copyWaitFor(() => document.querySelector('textarea, [contenteditable="true"]') !== null, 2000);
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        const response = await fetch(COPY_ROUTE_RAW + '?' + payload.query);
        if (!response.ok) return;
        const blob = await response.blob();
        const type = blob.type === '' ? 'application/octet-stream' : blob.type;
        const file = new File([blob], payload.name === undefined || payload.name === '' ? 'file' : payload.name, { type });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      } catch {
        /* no composer mounted, or the engine refused the synthetic transfer */
      }
    }

    /** Window-scoped slot holding the current receiver, so a swap can replace it. */
    const COPY_DROP_SLOT = '__dshCopyFileDropReceiver';
    /** Window-scoped record of the last attachment claim. */
    const COPY_ATTACH_SLOT = '__dshCopyFileAttachClaim';

    /**
     * Take the right to attach one gesture, at most once per 1.5 s for the same
     * card, so a hot swap cannot attach the same file twice.
     * @param {string} query - the dragged card's coordinates.
     * @returns {boolean} true when this call owns the gesture.
     */
    function copyClaimAttach(query) {
      if (typeof window === 'undefined') return true;
      const now = Date.now();
      const previous = window[COPY_ATTACH_SLOT];
      if (previous !== undefined && previous.query === query && now - previous.at < 1500) return false;
      window[COPY_ATTACH_SLOT] = { query, at: now };
      return true;
    }

    /**
     * One page-level receiver for card drops, installed on first card mount.
     * @returns {void}
     */
    function copyEnsureDropReceiver() {
      if (typeof document === 'undefined') return;
      const previous = window[COPY_DROP_SLOT];
      if (previous !== undefined) {
        document.removeEventListener('dragover', previous.over, true);
        document.removeEventListener('drop', previous.drop, true);
      }
      const over = (event) => {
        if (!copyCarriesCard(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
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
        if (typeof payload?.query !== 'string') return;
        const target = copySessionRowAt(event.clientX, event.clientY);
        void copyAttachDropped(payload, target === null ? null : target.row);
      };
      document.addEventListener('dragover', over, true);
      document.addEventListener('drop', drop, true);
      window[COPY_DROP_SLOT] = { over, drop };
      copyDropBound = true;
    }

    /**
     * Bind Windows-like interaction to the delivery card this anchor lives in:
     * single click selects, double click opens the preview, Ctrl+C copies the
     * selected card, and dragging carries the file.
     * @param {HTMLElement} anchor - a node inside the card's action cell.
     * @param {() => object} getController - reads the latest copy controller.
     * @returns {() => void} teardown.
     */
    function copyInstallCardInteraction(anchor, getController) {
      const card = anchor.closest('[data-presented-file]');
      if (card === null) return () => {};
      const preview = card.querySelector(':scope > button');
      const state = { allowNext: false };
      const cleanups = [];

      const on = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        cleanups.push(() => target.removeEventListener(type, handler, options));
      };

      on(card, 'click', (event) => {
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

      on(card, 'dblclick', (event) => {
        if (preview === null) return;
        const target = event.target;
        if (!(target instanceof Node) || !preview.contains(target)) return;
        event.preventDefault();
        event.stopPropagation();
        copySelect(card, getController());
        state.allowNext = true;
        preview.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
      }, true);

      card.draggable = true;
      if (preview !== null) preview.draggable = true;
      copyEnsureDropReceiver();

      on(card, 'dragstart', (event) => {
        const controller = getController();
        if (controller?.enabled !== true) return;
        const drag = event;
        const name = (controller.name ?? '') !== '' ? controller.name : copyNameFromCard(card);
        const url = new URL(COPY_ROUTE_RAW + '?' + controller.query, location.href).href;
        try {
          drag.dataTransfer?.setData(COPY_DRAG_MIME, JSON.stringify({ query: controller.query, name }));
          drag.dataTransfer?.setData('text/plain', name);
          if (copySupportsDragOut()) {
            drag.dataTransfer?.setData('DownloadURL', 'application/octet-stream:' + name + ':' + url);
          }
          if (drag.dataTransfer !== null) drag.dataTransfer.effectAllowed = 'copy';
        } catch {
          return;
        }
        const ghost = copyBuildGhost(card, name);
        try {
          drag.dataTransfer?.setDragImage(ghost, 40, 20);
        } catch {
          /* the browser may reject a detached image; the payload still works */
        }
        card.dataset.dshCopyDragging = ghost.isConnected ? '1' : '0';
        state.ghost = ghost;
      });

      on(card, 'dragend', (event) => {
        if (state.ghost instanceof HTMLElement) state.ghost.remove();
        state.ghost = undefined;
        delete card.dataset.dshCopyDragging;
        if (event.dataTransfer?.dropEffect === 'none') {
          const controller = getController();
          controller?.[copySupportsDragOut() ? 'dragHint' : 'dragUnsupported']?.();
        }
      });

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
     * Copy controller for one delivery card: probes the count, copies, and owns
     * the toast.
     * @param {string|undefined} actionUrl - the card's action URL.
     * @param {boolean} available - whether the card renders native actions at all.
     * @param {(key: string, params?: object) => string} t - localized copy.
     * @returns {object} controller with `copy`, `toast`, and lifecycle helpers.
     */
    function useDeliveryCard(actionUrl, available, t) {
      const query = react.useMemo(() => copyCoordinatesOf(actionUrl), [actionUrl]);
      const enabled = query !== '' && available === true;
      const [info, setInfo] = react.useState(null);
      const [busy, setBusy] = react.useState(false);
      const [toast, setToast] = react.useState(null);
      const toastSeq = react.useRef(0);
      const alive = react.useRef(true);

      react.useEffect(() => () => { alive.current = false; }, []);

      const show = react.useCallback((text, tone) => {
        if (!alive.current) return;
        toastSeq.current += 1;
        setToast({ id: toastSeq.current, text, tone });
      }, []);

      const probe = react.useCallback(async () => {
        if (!enabled) return null;
        if (info !== null) return info;
        try {
          const response = await fetch(COPY_ROUTE_PROBE + '?' + query, { headers: { accept: 'application/json' } });
          if (!response.ok) return null;
          const payload = await response.json();
          if (payload?.ok === true && alive.current) setInfo(payload);
          return payload?.ok === true ? payload : null;
        } catch {
          return null;
        }
      }, [enabled, info, query]);

      const fallback = react.useCallback(async (reason) => {
        try {
          const response = await fetch(COPY_ROUTE_PATH + '?' + query, { headers: { accept: 'application/json' } });
          const payload = await response.json();
          const target = typeof payload?.path === 'string' ? payload.path : Array.isArray(payload?.paths) ? payload.paths.join('\n') : '';
          if (target === '') return false;
          const written = await primitives.writeClipboard(target);
          if (!written) return false;
          show(t('copy.degraded', { reason: t('copy.reason.' + String(reason ?? 'unknown')) }), 'warning');
          return true;
        } catch {
          return false;
        }
      }, [query, show, t]);

      const run = react.useCallback(async (kind) => {
        if (!enabled || busy) return;
        setBusy(true);
        try {
          if (kind === 'path') {
            const response = await fetch(COPY_ROUTE_PATH + '?' + query, { headers: { accept: 'application/json' } });
            const payload = await response.json();
            const target = typeof payload?.path === 'string' ? payload.path : '';
            if (target !== '' && await primitives.writeClipboard(target)) {
              show(t('copy.donePath'), 'success');
            } else {
              show(t('copy.failed'), 'warning');
            }
            return;
          }
          const scope = kind === 'all' ? '&scope=all' : '';
          const response = await fetch(COPY_ROUTE_FILE + '?' + query + scope, { method: 'POST', headers: { accept: 'application/json' } });
          const payload = await response.json().catch(() => null);
          if (payload?.ok === true) {
            show(kind === 'all'
              ? t('copy.doneAll', { count: String(payload.count ?? info?.count ?? 1) })
              : t('copy.done', { name: info?.name ?? '' }), 'success');
            return;
          }
          const degraded = await fallback(payload?.reason ?? 'host-error');
          if (!degraded) show(t('copy.failed'), 'warning');
        } catch {
          const degraded = await fallback('host-error');
          if (!degraded) show(t('copy.failed'), 'warning');
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [busy, enabled, fallback, info, query, show, t]);

      const anchorRef = react.useRef(null);
      const toastElement = toast === null ? null : jsx(
        primitives.Toast,
        {
          text: toast.text,
          tone: toast.tone === 'success' ? 'success' : void 0,
          icon: toast.tone === 'success' ? void 0 : jsx(primitives.IconWarningOutlineRegular, {}),
          holdMs: toast.tone === 'success' ? 1300 : 2600,
          onDone: () => { if (alive.current) setToast(null); },
        },
        toast.id,
      );
      const controller = {
        enabled,
        query,
        name: info?.name ?? '',
        count: info?.count ?? 1,
        busy,
        probe,
        run,
        copyFile: () => run('file'),
        copyAll: () => run('all'),
        copyPath: () => run('path'),
        dragHint: () => show(t('copy.dragHint'), 'warning'),
        dragUnsupported: () => show(t('copy.dragUnsupported'), 'warning'),
        toast: toastElement,
      };

      const controllerRef = react.useRef(controller);
      controllerRef.current = controller;

      react.useEffect(() => {
        const anchor = anchorRef.current;
        if (!enabled || anchor === null) return;
        return copyInstallCardInteraction(anchor, () => controllerRef.current);
      }, [enabled, query]);

      return { anchorRef, controller };
    }

    /**
     * The two copy intents that do not fit on the button itself.
     * @param {object} copy - the card controller.
     * @param {(key: string, params?: object) => string} t - localized copy.
     * @returns {object[]} menu items.
     */
    function copyMenuItems(copy, t) {
      const icon = jsx(primitives.IconCopyOutlineRegular, {});
      const items = [];
      if (copy.count > 1) {
        items.push({ id: COPY_ITEM_ALL, label: t('copy.all', { count: String(copy.count) }), icon, disabled: copy.busy });
      }
      items.push({ id: COPY_ITEM_PATH, label: t('copy.path'), icon, disabled: copy.busy });
      return items;
    }

    /**
     * One delivery-card action: a copy button plus, depending on the chosen
     * presentation, a chevron (or a right-click) for the remaining intents.
     * @param {object} props - slot props plus `t` and `presentation`.
     * @returns {any} the rendered action, or null when the card has no copy target.
     */
    function CopyAction(props) {
      const t = props.t;
      const presentation = props.presentation === 'icon' ? 'icon' : 'menu';
      const copy = useDeliveryCard(props.actionUrl, props.available === true, t);
      const [menuOpen, setMenuOpen] = react.useState(false);
      if (props.available !== true || copy.query === '') return null;

      const controller = copy.controller;
      const busy = controller.busy || props.pending === true;
      const openMenu = () => {
        void controller.probe();
        setMenuOpen(true);
      };
      const label = t('copy.button');
      const onSelect = (id) => {
        setMenuOpen(false);
        if (id === COPY_ITEM_ALL) void controller.run('all');
        if (id === COPY_ITEM_PATH) void controller.run('path');
      };

      const anchor = jsx('div', {
        className: 'dsh-copyfile-group',
        children: [
          jsx(primitives.Tooltip, {
            portal: true,
            label,
            side: 'bottom',
            delayMs: 500,
            children: jsx('button', {
              type: 'button',
              className: 'dsh-copyfile-btn',
              disabled: busy,
              'aria-label': label,
              'data-copy-file': '',
              onClick: () => void controller.copyFile(),
              onContextMenu: (event) => {
                event.preventDefault();
                openMenu();
              },
              children: jsx(primitives.IconCopyOutlineRegular, {}),
            }),
          }),
          presentation === 'menu'
            ? jsx('button', {
              type: 'button',
              className: 'dsh-copyfile-btn dsh-copyfile-chevron',
              disabled: busy,
              'aria-haspopup': 'menu',
              'aria-expanded': menuOpen && !busy,
              'aria-label': t('copy.more'),
              onClick: () => { if (menuOpen) setMenuOpen(false); else openMenu(); },
              children: jsx(primitives.IconChevronDownOutlineRegular, { size: 10 }),
            })
            : null,
        ].filter((node) => node !== null),
      });

      const menu = jsx(primitives.Menu, {
        open: menuOpen && !busy,
        autoFocus: true,
        portal: true,
        dense: true,
        align: 'end',
        onClose: () => setMenuOpen(false),
        items: copyMenuItems(controller, t),
        onSelect,
        anchor,
      });

      return jsx('div', {
        className: 'dsh-copyfile-slot',
        ref: copy.anchorRef,
        children: [menu, controller.toast],
      });
    }

    /**
     * Pick the presentation: the row config if it names one, else this package's
     * look. There is no runtime switch — the two looks are separate packages.
     * @param {object|undefined} config - the row config.
     * @param {object} ctx - client root context (some hosts expose it as ctx.config).
     * @returns {"icon"|"menu"} the presentation.
     */
    function resolvePresentation(config, ctx) {
      const chosen = config?.presentation ?? ctx?.config?.presentation;
      if (chosen === 'menu' || chosen === 'icon') return chosen;
      return DEFAULT_PRESENTATION;
    }

    const zh = {
      'copy.button': '复制文件',
      'copy.more': '更多复制方式',
      'copy.file': '复制文件',
      'copy.all': '复制全部 {count} 个文件',
      'copy.path': '复制文件路径',
      'copy.done': '已复制「{name}」，可直接粘贴',
      'copy.doneAll': '已复制 {count} 个文件',
      'copy.donePath': '已复制文件路径',
      'copy.degraded': '无法复制文件（{reason}），已改为复制路径',
      'copy.failed': '复制失败，请重试',
      'copy.reason.unknown': '未知原因',
      'copy.reason.empty': '没有可复制的文件',
      'copy.reason.too-many-files': '文件过多',
      'copy.reason.file-missing': '文件已不存在',
      'copy.reason.not-a-file': '目标不是文件',
      'copy.reason.clipboard-busy': '系统剪贴板被占用',
      'copy.reason.verify-failed': '系统未接受文件列表',
      'copy.reason.clipboard-error': '系统剪贴板调用失败',
      'copy.reason.timeout': '本地助手超时',
      'copy.reason.unsupported-platform': '当前系统暂不支持',
      'copy.reason.tool-missing': '缺少系统工具',
      'copy.reason.no-such-file': '会话中找不到该文件',
      'copy.reason.file-unavailable': '文件已不可用',
      'copy.reason.unmapped-path': '路径不属于本机可访问范围',
      'copy.reason.not-a-delivery': '不是交付文件',
      'copy.reason.bad-coordinates': '卡片坐标无效',
      'copy.reason.host-error': '本地宿主出错',
      'copy.dragHint': '拖到文件夹窗口才能复制；也可以选中后按 Ctrl+C',
      'copy.dragUnsupported': '此浏览器不支持把文件拖出，请用 Ctrl+C 或右键菜单里的「复制文件」',
    };

    const en = {
      'copy.button': 'Copy file',
      'copy.more': 'More copy options',
      'copy.file': 'Copy file',
      'copy.all': 'Copy all {count} files',
      'copy.path': 'Copy file path',
      'copy.done': 'Copied "{name}" — ready to paste',
      'copy.doneAll': 'Copied {count} files',
      'copy.donePath': 'File path copied',
      'copy.degraded': 'Could not copy the file ({reason}); copied its path instead',
      'copy.failed': 'Copy failed. Try again.',
      'copy.reason.unknown': 'unknown reason',
      'copy.reason.empty': 'no files to copy',
      'copy.reason.too-many-files': 'too many files',
      'copy.reason.file-missing': 'file is gone',
      'copy.reason.not-a-file': 'not a regular file',
      'copy.reason.clipboard-busy': 'clipboard is busy',
      'copy.reason.verify-failed': 'the system rejected the file list',
      'copy.reason.clipboard-error': 'clipboard call failed',
      'copy.reason.timeout': 'helper timed out',
      'copy.reason.unsupported-platform': 'not supported on this system',
      'copy.reason.tool-missing': 'a system tool is missing',
      'copy.reason.no-such-file': 'not found in this Session',
      'copy.reason.file-unavailable': 'file is no longer available',
      'copy.reason.unmapped-path': 'path is outside the Host filesystem',
      'copy.reason.not-a-delivery': 'not a delivery declaration',
      'copy.reason.bad-coordinates': 'invalid card coordinates',
      'copy.reason.host-error': 'Host error',
      'copy.dragHint': 'Drop on a folder window to copy, or select the card and press Ctrl+C',
      'copy.dragUnsupported': 'This browser cannot drag files out; use Ctrl+C or the right-click Copy file',
    };

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the dictionaries and one action occupant in each delivery slot.
       * @param {object} ctx - client root context.
       * @param {object} [config] - the bundle row config.
       */
      apply(ctx, config) {
        const presentation = resolvePresentation(config, ctx);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-copy-file: dictionaries');
        ctx.effect(() => copyInstallStyles(), 'dsh-copy-file: styles');
        for (const slot of ['deliverables.file.actions', 'deliverables.review.file.actions']) {
          ctx.slots.inject(slot, () => ctx.slots.register({
            name: slot,
            id: 'copy-file',
            locale: NS,
            inject: () => ({ presentation }),
          }, CopyAction));
        }
      },
    };
  },
});
