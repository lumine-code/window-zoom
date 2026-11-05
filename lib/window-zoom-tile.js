const { CompositeDisposable, Disposable } = require("lumine");

const percent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

function formatPercent(factor) {
  return `${percent.format(factor * 100)}%`;
}

module.exports = class WindowZoomTile {
  constructor({ document, window }) {
    this.presentation = window;
    this.subscriptions = new CompositeDisposable();
    this.disposed = false;
    this.revision = 0;
    this.zoomState = null;
    this.element = document.createElement("status-bar-tile");
    this.element.className = "window-zoom";
    this.element.hidden = true;
    this.element.tabIndex = 0;
    this.element.setAttribute("role", "button");
    this.element.setAttribute("data-context-menu-boundary", "");
    const icon = document.createElement("span");
    icon.className = "icon icon-search";
    icon.setAttribute("aria-hidden", "true");
    this.label = document.createElement("span");
    this.label.className = "window-zoom-percentage";
    this.element.append(icon, this.label);

    try {
      this.initialize();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  initialize() {
    this.subscriptions.add(
      this.presentation.onDidChangeZoomState((state) => {
        if (this.disposed) return;
        this.revision++;
        this.zoomState = state;
        this.render();
      }),
      lumine.config.onDidChange("window-zoom.hideWhenDefault", () => this.render()),
      lumine.tooltips.add(this.element, {
        html: false,
        title: () => this.description(),
        keyBindingCommand: "window:reset-zoom",
        keyBindingTarget: this.element,
      }),
    );

    const click = (event) => {
      if (event.button !== 0 || (process.platform === "darwin" && event.ctrlKey)) return;
      event.preventDefault();
      this.resetZoom();
    };
    const keydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      this.resetZoom();
    };
    const mousedown = (event) => {
      if (event.button === 0) event.preventDefault();
    };
    this.element.addEventListener("click", click);
    this.element.addEventListener("keydown", keydown);
    this.element.addEventListener("mousedown", mousedown);
    this.subscriptions.add(
      new Disposable(() => {
        this.element.removeEventListener("click", click);
        this.element.removeEventListener("keydown", keydown);
        this.element.removeEventListener("mousedown", mousedown);
      }),
    );

    const revision = this.revision;
    this.ready = Promise.resolve(this.presentation.getZoomState())
      .then((state) => {
        if (this.disposed || revision !== this.revision) return;
        this.zoomState = state;
        this.render();
      })
      .catch((error) => {
        if (!this.disposed) console.warn("window-zoom: Unable to read window zoom.", error);
      });
  }

  description() {
    const { factor, defaultFactor } = this.zoomState ?? {};
    if (!Number.isFinite(factor) || !Number.isFinite(defaultFactor)) return "Window zoom.";
    const current = formatPercent(factor);
    const baseline = formatPercent(defaultFactor);
    return `Window zoom: ${current} (default ${baseline}). Click to restore the default.`;
  }

  render() {
    if (this.disposed) return;
    const { factor, defaultFactor } = this.zoomState ?? {};
    const hideWhenDefault = lumine.config.get("window-zoom.hideWhenDefault") !== false;
    const visible =
      Number.isFinite(factor) &&
      Number.isFinite(defaultFactor) &&
      (!hideWhenDefault || Math.abs(factor - defaultFactor) > 1e-9);
    if (!visible && this.element.contains(this.element.ownerDocument.activeElement)) {
      this.presentation.getEditorContainer().getActivePane()?.getElement().focus();
    }
    this.element.hidden = !visible;
    if (Number.isFinite(factor)) this.label.textContent = formatPercent(factor);
    this.element.setAttribute("aria-label", this.description());
  }

  resetZoom() {
    if (this.disposed || this.element.hidden) return;
    Promise.resolve(lumine.commands.dispatch(this.element, "window:reset-zoom")).catch((error) => {
      if (this.disposed) return;
      lumine.notifications.addError("Unable to reset window zoom.", {
        detail: error?.message ?? String(error),
        dismissable: true,
      });
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    this.subscriptions.dispose();
    this.element.remove();
  }
};
