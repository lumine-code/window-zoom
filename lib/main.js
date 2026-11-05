const { CompositeDisposable, Disposable } = require("lumine");
const WindowZoomTile = require("./window-zoom-tile");

module.exports = {
  activate() {
    this.subscriptions = new CompositeDisposable();
    const owner = this.subscriptions;
    this.subscriptions.add(
      lumine.commands.add("lumine-workspace", "window-zoom:set-as-default", {
        description: "Use this window's current scale as the default for all windows.",
        isAvailable: ({ context }) => Boolean(context?.window && !context.window.isDestroyed()),
        async didDispatch(event) {
          const presentation = event.context?.window;
          if (!presentation || presentation.isDestroyed()) return;
          try {
            const factor = await presentation.getZoomFactor();
            if (owner.disposed || presentation.isDestroyed()) return;
            if (!lumine.config.set("core.zoomFactor", factor)) {
              throw new Error("The current window zoom could not be saved.");
            }
          } catch (error) {
            if (owner.disposed || presentation.isDestroyed()) return;
            lumine.notifications.addError("Unable to save the default window zoom.", {
              detail: error?.message ?? String(error),
              dismissable: true,
            });
          }
        },
      }),
      lumine.contextMenu.add({
        ".window-zoom": {
          commandTarget: "context",
          items: [
            { type: "separator" },
            { label: "Zoom In", command: "window:zoom-in" },
            { label: "Zoom Out", command: "window:zoom-out" },
            { label: "Reset Zoom", command: "window:reset-zoom" },
            { type: "separator" },
            { label: "Set as Default", command: "window-zoom:set-as-default" },
            { type: "separator" },
          ],
        },
      }),
    );
  },

  deactivate() {
    this.subscriptions?.dispose();
    this.subscriptions = null;
  },

  consumeStatusBar(statusBar) {
    const owner = this.subscriptions;
    if (!owner || owner.disposed) return new Disposable();
    const registration = statusBar.addRightTile({
      windows: "all",
      priority: 100,
      create: (context) => new WindowZoomTile(context),
    });
    const edge = new Disposable(() => {
      owner.remove(edge);
      registration.dispose();
    });
    owner.add(edge);
    return edge;
  },

  provideBackgroundTips() {
    return {
      packageName: "window-zoom",
      tips: [
        "Click the highlighted zoom percentage to restore the default. {% if keys['window-zoom:set-as-default'] %}Use {{ 'window-zoom:set-as-default' | keystroke }} to save the current window zoom as the default.{% else %}Right-click it to save the current zoom as the default for all windows.{% endif %}",
      ],
    };
  },
};
