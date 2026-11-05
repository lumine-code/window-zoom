const { Disposable, Emitter } = require("lumine");

describe("window-zoom tile", () => {
  let WindowZoomTile;
  let emitter;
  let presentation;
  let resolveInitialState;
  let tile;
  let baseline;
  let hideWhenDefault;
  let unsubscribe;

  beforeEach(() => {
    // A package lifecycle spec may have unloaded the previous module generation.
    WindowZoomTile = require("../lib/window-zoom-tile");
    baseline = lumine.config.get("core.zoomFactor");
    hideWhenDefault = lumine.config.get("window-zoom.hideWhenDefault");
    lumine.config.set("core.zoomFactor", 1);
    lumine.config.set("window-zoom.hideWhenDefault", true);
    emitter = new Emitter();
    unsubscribe = jasmine.createSpy("unsubscribe from window zoom");
    presentation = {
      getZoomState: () =>
        new Promise((resolve) => {
          resolveInitialState = resolve;
        }),
      onDidChangeZoomState: (callback) => {
        const subscription = emitter.on("zoom-state", callback);
        return new Disposable(() => {
          unsubscribe();
          subscription.dispose();
        });
      },
    };
    tile = new WindowZoomTile({ document, window: presentation });
  });

  afterEach(() => {
    tile.dispose();
    emitter.dispose();
    lumine.config.set("core.zoomFactor", baseline);
    if (hideWhenDefault === undefined) lumine.config.unset("window-zoom.hideWhenDefault");
    else lumine.config.set("window-zoom.hideWhenDefault", hideWhenDefault);
  });

  it("keeps a newer event when the initial native query resolves late", async () => {
    emitter.emit("zoom-state", { factor: 1.3, defaultFactor: 1 });
    expect(tile.label.textContent).toBe("130%");

    resolveInitialState({ factor: 1.1, defaultFactor: 1 });
    await tile.ready;

    expect(tile.label.textContent).toBe("130%");
    expect(tile.element.hidden).toBe(false);
    expect(tile.element.getAttribute("aria-label")).toContain("130%");
  });

  it("disposes subscriptions and ignores initial reads and events after teardown", async () => {
    const before = tile.element.outerHTML;
    const [tooltip] = lumine.tooltips.findTooltips(tile.element);
    expect(tooltip).toBeDefined();

    tile.dispose();
    tile.dispose();
    emitter.emit("zoom-state", { factor: 1.3, defaultFactor: 1 });
    resolveInitialState({ factor: 1.1, defaultFactor: 1 });
    await tile.ready;

    expect(unsubscribe.calls.count()).toBe(1);
    expect(tile.element.outerHTML).toBe(before);
    expect(lumine.tooltips.findTooltips(tile.element).length).toBe(0);
    const dispatch = spyOn(lumine.commands, "dispatch");
    tile.element.click();
    tile.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("hides floating point noise around the configured factor", async () => {
    resolveInitialState({ factor: 1.2000000000000002, defaultFactor: 1.2 });
    await tile.ready;
    expect(tile.element.hidden).toBe(true);

    emitter.emit("zoom-state", { factor: 1.25, defaultFactor: 1.2 });
    expect(tile.element.hidden).toBe(false);
    expect(tile.label.textContent).toBe("125%");
    expect(tile.description()).toContain("default 120%");

    emitter.emit("zoom-state", { factor: 1.25, defaultFactor: 1.25 });
    expect(tile.element.hidden).toBe(true);
  });

  it("stays hidden while the configured default is waiting for the matching native zoom", async () => {
    resolveInitialState({ factor: 1, defaultFactor: 1 });
    await tile.ready;
    expect(tile.element.hidden).toBe(true);
    const before = tile.element.outerHTML;

    lumine.config.set("core.zoomFactor", 1.2);

    expect(tile.element.hidden).toBe(true);
    expect(tile.element.outerHTML).toBe(before);
    expect(tile.description()).toContain("Window zoom: 100% (default 100%)");

    emitter.emit("zoom-state", { factor: 1.2, defaultFactor: 1.2 });

    expect(tile.element.hidden).toBe(true);
    expect(tile.label.textContent).toBe("120%");
    expect(tile.element.getAttribute("aria-label")).toContain("120% (default 120%)");
  });

  it("hides when the applied default catches up without changing the native factor", async () => {
    resolveInitialState({ factor: 1.2, defaultFactor: 1 });
    await tile.ready;
    expect(tile.element.hidden).toBe(false);
    expect(tile.label.textContent).toBe("120%");

    lumine.config.set("core.zoomFactor", 1.2);
    expect(tile.element.hidden).toBe(false);
    expect(tile.description()).toContain("default 100%");
    emitter.emit("zoom-state", { factor: 1.2, defaultFactor: 1.2 });

    expect(tile.element.hidden).toBe(true);
    expect(tile.label.textContent).toBe("120%");
    expect(tile.description()).toContain("default 120%");
  });

  it("updates a permanently visible percentage only after the native state is applied", async () => {
    lumine.config.set("window-zoom.hideWhenDefault", false);
    resolveInitialState({ factor: 1, defaultFactor: 1 });
    await tile.ready;
    expect(tile.element.hidden).toBe(false);
    const before = tile.element.outerHTML;

    lumine.config.set("core.zoomFactor", 1.2);
    expect(tile.element.hidden).toBe(false);
    expect(tile.element.outerHTML).toBe(before);
    expect(tile.description()).toContain("100% (default 100%)");

    emitter.emit("zoom-state", { factor: 1.2, defaultFactor: 1.2 });

    expect(tile.element.hidden).toBe(false);
    expect(tile.label.textContent).toBe("120%");
    const [tooltip] = lumine.tooltips.findTooltips(tile.element);
    expect(tooltip.getTitle()).toContain("120% (default 120%)");
    lumine.config.set("window-zoom.hideWhenDefault", true);
    expect(tile.element.hidden).toBe(true);
  });

  it("formats the native range and fractional percentages accurately", async () => {
    resolveInitialState({ factor: 0.25, defaultFactor: 1 });
    await tile.ready;
    expect(tile.label.textContent).toBe("25%");

    emitter.emit("zoom-state", { factor: 5, defaultFactor: 1 });
    expect(tile.label.textContent).toBe("500%");
    emitter.emit("zoom-state", { factor: 1.2345, defaultFactor: 1 });
    expect(tile.label.textContent).toBe(
      `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(123.45)}%`,
    );
  });

  it("resets with Enter or Space and leaves other keys and right clicks alone", async () => {
    resolveInitialState({ factor: 1.05, defaultFactor: 1 });
    await tile.ready;
    const dispatch = spyOn(lumine.commands, "dispatch");

    tile.element.dispatchEvent(new MouseEvent("click", { button: 2, bubbles: true }));
    tile.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dispatch).not.toHaveBeenCalled();

    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      tile.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(dispatch.calls.count()).toBe(2);
    expect(dispatch.calls.allArgs()).toEqual([
      [tile.element, "window:reset-zoom"],
      [tile.element, "window:reset-zoom"],
    ]);
  });

  it("leaves the existing focus intact when pressed", async () => {
    resolveInitialState({ factor: 1.05, defaultFactor: 1 });
    await tile.ready;
    const event = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
    tile.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
