const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const zoomCommands = ["window:zoom-in", "window:zoom-out", "window:reset-zoom"];
const setDefaultCommand = "window-zoom:set-as-default";
const menuCommands = [...zoomCommands, setDefaultCommand];

describe("window-zoom package", () => {
  let main;
  let baseline;
  let hideWhenDefault;

  const tileFor = (presentation) => presentation.getElement().querySelector(".window-zoom");
  const percentageFor = (presentation) =>
    tileFor(presentation)?.querySelector(".window-zoom-percentage").textContent;

  beforeEach(async () => {
    jasmine.useRealClock();
    main = lumine.workspace.getMainWindow();
    baseline = lumine.config.get("core.zoomFactor");
    hideWhenDefault = lumine.config.get("window-zoom.hideWhenDefault");
    lumine.config.set("core.zoomFactor", 1);
    lumine.config.set("window-zoom.hideWhenDefault", true);
    jasmine.attachToDOM(main.getElement());
    await main.resetZoom();
    await lumine.packages.activatePackage("status-bar");
    await lumine.packages.activatePackage(packageRoot);
    await conditionPromise(() => percentageFor(main) === "100%", "the initial window zoom");
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("window-zoom");
    await lumine.workspace.discardEditorWindows();
    await main.resetZoom();
    lumine.config.set("core.zoomFactor", baseline);
    if (hideWhenDefault === undefined) lumine.config.unset("window-zoom.hideWhenDefault");
    else lumine.config.set("window-zoom.hideWhenDefault", hideWhenDefault);
    await lumine.packages.deactivatePackage("status-bar");
  });

  it("hides the default and shows the percentage after a native window zoom", async () => {
    const tile = tileFor(main);
    expect(tile.tagName.toLowerCase()).toBe("status-bar-tile");
    expect(tile.hidden).toBe(true);

    await lumine.commands.dispatch(main.getElement(), "window:zoom-in");
    await conditionPromise(() => percentageFor(main) === "105%", "the changed zoom percentage");

    expect(tile.hidden).toBe(false);
    expect(tile.getAttribute("role")).toBe("button");
    expect(tile.tabIndex).toBe(0);
    const [tooltip] = lumine.tooltips.findTooltips(tile);
    expect(tooltip.getTitle()).toContain("105%");
    expect(tooltip.getTitle()).toContain("default 100%");
    expect(tooltip.getTitle()).toContain("Click to restore");
    expect(tile.getAttribute("aria-label")).toContain("105%");

    await main.resetZoom();
    await conditionPromise(() => tile.hidden, "the tile to hide after reset");
    expect(percentageFor(main)).toBe("100%");
  });

  it("keeps the applied native default coherent until a renderer setting is applied", async () => {
    const before = tileFor(main).outerHTML;
    lumine.config.set("core.zoomFactor", 1.2);

    // Spec windows do not apply user defaults, so no new native state is acknowledged.
    expect(await main.getZoomState()).toEqual({ factor: 1, defaultFactor: 1 });
    expect(tileFor(main).hidden).toBe(true);
    expect(tileFor(main).outerHTML).toBe(before);
    expect(tileFor(main).getAttribute("aria-label")).toContain("default 100%");
  });

  it("updates every window when hiding at the default is toggled without hiding a changed zoom", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    await conditionPromise(() => percentageFor(extra) === "100%", "the second default zoom");
    expect(tileFor(main).hidden).toBe(true);
    expect(tileFor(extra).hidden).toBe(true);

    lumine.config.set("window-zoom.hideWhenDefault", false);
    for (const presentation of [main, extra]) {
      expect(tileFor(presentation).hidden).toBe(false);
      expect(percentageFor(presentation)).toBe("100%");
    }
    await lumine.commands.dispatch(main.getElement(), "window:reset-zoom");
    expect(await main.getZoomFactor()).toBeCloseTo(1, 8);
    expect(tileFor(main).hidden).toBe(false);

    await extra.zoomIn();
    await conditionPromise(() => percentageFor(extra) === "105%", "the changed second window");
    for (const hiddenAtDefault of [true, false, true]) {
      lumine.config.set("window-zoom.hideWhenDefault", hiddenAtDefault);
      expect(tileFor(main).hidden).toBe(hiddenAtDefault);
      expect(tileFor(extra).hidden).toBe(false);
      expect(percentageFor(extra)).toBe("105%");
    }
  });

  it("returns keyboard focus to the local editor when reset hides the tile", async () => {
    const editor = await lumine.workspace.open();
    await main.zoomIn();
    await conditionPromise(() => percentageFor(main) === "105%", "the zoomed tile");
    const tile = tileFor(main);
    tile.focus();
    expect(document.activeElement).toBe(tile);

    tile.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await conditionPromise(() => tile.hidden, "the tile to hide after keyboard reset");

    expect(editor.getElement().contains(document.activeElement)).toBe(true);
  });

  it("keeps window percentages independent and resets only the clicked tile's window", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    await conditionPromise(() => percentageFor(extra) === "100%", "the second window tile");
    expect(tileFor(extra)).not.toBe(tileFor(main));
    expect(tileFor(extra).ownerDocument).toBe(extra.getDocument());
    expect(tileFor(extra).hidden).toBe(true);

    await main.zoomOut();
    await extra.zoomIn();
    await conditionPromise(
      () => percentageFor(main) === "95%" && percentageFor(extra) === "105%",
      "each window's native zoom notification",
    );

    main.getElement().focus();
    tileFor(extra).click();
    await conditionPromise(() => tileFor(extra).hidden, "the clicked window to reset");
    expect(await extra.getZoomFactor()).toBeCloseTo(1, 8);
    expect(await main.getZoomFactor()).toBeCloseTo(0.95, 8);
    expect(percentageFor(main)).toBe("95%");
    expect(tileFor(main).hidden).toBe(false);
  });

  it("runs each context-menu action in its original window despite another saved focus", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    await extra.zoomIn();
    await main.zoomOut();
    await conditionPromise(() => percentageFor(extra) === "105%", "the second window zoom");
    const tile = tileFor(extra);
    expect(tile.hasAttribute("data-context-menu-boundary")).toBe(true);

    for (const [command, expected] of [
      ["window:zoom-in", "110%"],
      ["window:zoom-out", "105%"],
      ["window:reset-zoom", "100%"],
    ]) {
      const menu = lumine.contextMenu.templateForEvent(
        { target: tile },
        { focusTarget: main.getElement() },
      );
      expect(menu.filter((item) => item.command).map((item) => item.command)).toEqual(menuCommands);
      const popup = lumine.contextMenu.show(tile, menu, { focusTarget: main.getElement() });
      try {
        const item = menu.find((entry) => entry.command === command);
        const row = [...popup.element.querySelectorAll(".menu-item")].find(
          (element) => element.querySelector(".menu-item-name").textContent === item.label,
        );
        expect(row.getAttribute("aria-disabled")).not.toBe("true");
        row.click();
        await conditionPromise(() => percentageFor(extra) === expected, "the menu's zoom action");
      } finally {
        popup.close();
      }
      expect(await main.getZoomFactor()).toBeCloseTo(0.95, 8);
    }
    expect(tile.hidden).toBe(true);
  });

  it("saves the context-menu window's zoom as the default instead of the other focused window", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    await main.zoomOut();
    await extra.zoomIn();
    await extra.zoomIn();
    await conditionPromise(
      () => percentageFor(main) === "95%" && percentageFor(extra) === "110%",
      "the distinct window percentages",
    );
    const tile = tileFor(extra);
    expect(lumine.commands.canDispatch(extra.getElement(), setDefaultCommand)).toBe(true);
    const menu = lumine.contextMenu.templateForEvent(
      { target: tile },
      { focusTarget: main.getElement() },
    );
    expect(menu.filter((item) => item.command).map((item) => item.command)).toEqual(menuCommands);
    const defaultIndex = menu.findIndex((item) => item.command === setDefaultCommand);
    expect(menu[defaultIndex].label).toBe("Set as Default");
    expect(menu[defaultIndex - 1].type).toBe("separator");

    const popup = lumine.contextMenu.show(tile, menu, { focusTarget: main.getElement() });
    try {
      const row = [...popup.element.querySelectorAll(".menu-item")].find(
        (element) => element.querySelector(".menu-item-name").textContent === "Set as Default",
      );
      expect(row.getAttribute("aria-disabled")).not.toBe("true");
      row.click();
      await conditionPromise(
        () => Math.abs(lumine.config.get("core.zoomFactor") - 1.1) < 1e-9,
        "the menu window's zoom to become the configured default",
      );
    } finally {
      popup.close();
    }

    expect(await extra.getZoomFactor()).toBeCloseTo(1.1, 8);
    // Spec windows keep their applied zoom/default pair until a native acknowledgement.
    expect(await main.getZoomFactor()).toBeCloseTo(0.95, 8);
    expect(tileFor(main).hidden).toBe(false);
    expect(tileFor(main).getAttribute("aria-label")).toContain("default 100%");
  });

  it("retains the command's original window while its native zoom query is pending", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    await extra.zoomIn();
    await extra.zoomIn();
    await main.zoomOut();
    await conditionPromise(() => percentageFor(extra) === "110%", "the command window tile");
    let resolveFactor;
    const factor = new Promise((resolve) => {
      resolveFactor = resolve;
    });
    const read = spyOn(extra, "getZoomFactor").and.returnValue(factor);

    const command = lumine.commands.dispatch(tileFor(extra), setDefaultCommand);
    expect(read).toHaveBeenCalled();
    main.getElement().focus();
    resolveFactor(1.1);
    await command;

    expect(lumine.config.get("core.zoomFactor")).toBeCloseTo(1.1, 8);
    expect(await main.getZoomFactor()).toBeCloseTo(0.95, 8);
  });

  it("keeps the percentage visible after Set as Default when hiding is disabled", async () => {
    lumine.config.set("window-zoom.hideWhenDefault", false);
    await main.zoomIn();
    await conditionPromise(() => percentageFor(main) === "105%", "the changed window zoom");

    await lumine.commands.dispatch(tileFor(main), setDefaultCommand);

    expect(lumine.config.get("core.zoomFactor")).toBeCloseTo(1.05, 8);
    expect(tileFor(main).hidden).toBe(false);
    expect(percentageFor(main)).toBe("105%");
    expect(tileFor(main).getAttribute("aria-label")).toContain("default 100%");
    const [tooltip] = lumine.tooltips.findTooltips(tileFor(main));
    expect(tooltip.getTitle()).toContain("default 100%");

    lumine.config.set("window-zoom.hideWhenDefault", true);
    expect(tileFor(main).hidden).toBe(false);
  });

  it("retires provider-owned tiles and restores one instance per window after reactivation", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    await main.zoomIn();
    await extra.zoomOut();
    await conditionPromise(() => percentageFor(extra) === "95%", "the second window tile");
    const retired = [tileFor(main), tileFor(extra)];

    await lumine.packages.deactivatePackage("status-bar");
    for (const tile of retired) {
      expect(tile.isConnected).toBe(false);
      expect(lumine.tooltips.findTooltips(tile).length).toBe(0);
    }
    const dispatch = spyOn(lumine.commands, "dispatch").and.callThrough();
    retired[0].click();
    retired[1].click();
    expect(dispatch).not.toHaveBeenCalled();
    const retiredMarkup = retired.map((tile) => tile.outerHTML);
    lumine.config.set("window-zoom.hideWhenDefault", false);
    expect(retired.map((tile) => tile.outerHTML)).toEqual(retiredMarkup);

    await lumine.packages.activatePackage("status-bar");
    await conditionPromise(
      () => percentageFor(main) === "105%" && percentageFor(extra) === "95%",
      "the replacement status bar's window tiles",
    );
    for (const presentation of [main, extra]) {
      expect(presentation.getElement().querySelectorAll(".window-zoom").length).toBe(1);
      expect(lumine.tooltips.findTooltips(tileFor(presentation)).length).toBe(1);
    }
    expect(tileFor(main)).not.toBe(retired[0]);
    expect(tileFor(extra)).not.toBe(retired[1]);
    await main.resetZoom();
    await conditionPromise(() => percentageFor(main) === "100%", "the restored default zoom");
    expect(tileFor(main).hidden).toBe(false);
    lumine.config.set("window-zoom.hideWhenDefault", true);
    expect(tileFor(main).hidden).toBe(true);
    expect(tileFor(extra).hidden).toBe(false);
    expect(retired.map((tile) => tile.outerHTML)).toEqual(retiredMarkup);
  });

  it("removes click handlers, tooltips and menu contributions when unloaded", async () => {
    await main.zoomIn();
    await conditionPromise(() => percentageFor(main) === "105%", "the zoomed tile");
    const retired = tileFor(main);
    expect(lumine.commands.canDispatch(main.getElement(), setDefaultCommand)).toBe(true);

    await lumine.packages.unloadPackage("window-zoom", { serialize: false });
    expect(tileFor(main)).toBeNull();
    expect(lumine.tooltips.findTooltips(retired).length).toBe(0);
    const dispatch = spyOn(lumine.commands, "dispatch").and.callThrough();
    retired.click();
    expect(dispatch).not.toHaveBeenCalled();
    expect(
      lumine.contextMenu.templateForElement(retired).map((item) => item.command),
    ).not.toContain("window:reset-zoom");
    expect(lumine.commands.canDispatch(main.getElement(), setDefaultCommand)).toBe(false);
    for (const command of zoomCommands) {
      expect(lumine.commands.canDispatch(main.getElement(), command)).toBe(true);
    }

    const pack = await lumine.packages.activatePackage(packageRoot);
    await conditionPromise(() => percentageFor(main) === "105%", "the new package generation");
    expect(main.getElement().querySelectorAll(".window-zoom").length).toBe(1);
    expect(tileFor(main)).not.toBe(retired);
    expect(lumine.tooltips.findTooltips(tileFor(main)).length).toBe(1);
    expect(lumine.commands.canDispatch(main.getElement(), setDefaultCommand)).toBe(true);
    expect(pack.mainModule.provideBackgroundTips().packageName).toBe(pack.metadata.name);
  });
});
