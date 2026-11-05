module.exports = {
  version: 1,
  dependencies: [],
  viewport: { width: 1100, height: 720 },
  async prepare({ open, lumine, waitFor }) {
    await open("zoom.js");
    const presentation = lumine.workspace.getMainWindow();
    const document = presentation.getDocument();
    const tile = document.querySelector(".window-zoom");
    const atDefault = async (factor) => {
      const state = await presentation.getZoomState();
      return (
        state.factor === factor &&
        state.defaultFactor === factor &&
        tile.hidden &&
        tile.textContent.includes(`${factor * 100}%`)
      );
    };
    await waitFor(() => atDefault(1), "the initial default zoom");
    const flashes = [];
    const observer = new MutationObserver(() => {
      if (!tile.hidden) flashes.push(tile.textContent);
    });
    observer.observe(tile, { attributes: true, childList: true, subtree: true });
    try {
      lumine.config.set("core.zoomFactor", 1.2);
      await waitFor(() => atDefault(1.2), "the new default zoom without an indicator flash");
      if (flashes.length) throw new Error(`The default zoom indicator flashed: ${flashes}`);
    } finally {
      observer.disconnect();
      lumine.config.set("core.zoomFactor", 1);
      await waitFor(() => atDefault(1), "the original default zoom");
    }
  },
  scenes: [
    {
      id: "window-zoom",
      file: "demo.png",
      caption: "The highlighted zoom percentage shows a temporary window scale.",
      async run({ lumine, command }) {
        const target = lumine.workspace.getMainWindow().getElement();
        await command("window:zoom-in", target);
        await command("window:zoom-in", target);
        await command("window:zoom-in", target);
      },
      ready({ lumine }) {
        const tile = lumine.workspace.getMainWindow().getDocument().querySelector(".window-zoom");
        return Boolean(tile && !tile.hidden && tile.textContent.includes("115%"));
      },
    },
    {
      id: "zoom-actions",
      file: "demo-menu.png",
      caption: "Use the context menu to control zoom or save the current scale as the default.",
      async run({ lumine }) {
        const document = lumine.workspace.getMainWindow().getDocument();
        const tile = document.querySelector(".window-zoom");
        const bounds = tile.getBoundingClientRect();
        tile.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            button: 2,
            clientX: bounds.x + bounds.width / 2,
            clientY: bounds.y + bounds.height / 2,
          }),
        );
      },
      ready({ lumine }) {
        const document = lumine.workspace.getMainWindow().getDocument();
        return Boolean(
          document.querySelector(".context-menu-popup")?.textContent.includes("Set as Default"),
        );
      },
    },
  ],
  async cleanup({ lumine, waitFor }) {
    const document = lumine.workspace.getMainWindow().getDocument();
    const action = [...document.querySelectorAll(".context-menu-popup .menu-item")].find(
      (element) => element.querySelector(".menu-item-name")?.textContent === "Set as Default",
    );
    if (!action) return;
    action.click();
    await waitFor(
      () =>
        lumine.config.get("core.zoomFactor") === 1.15 &&
        document.querySelector(".window-zoom")?.hidden,
      "the current window zoom to become the saved default",
    );
  },
};
