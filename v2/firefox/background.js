'use strict';

const DEFAULT_ENTRIES = [{
  size: [0, 100, 100, 0]
}, {
  size: [0, 50, 50, 0]
}, {
  size: [0, 100, 50, 50]
}, {
  size: [50, 50, 100, 0]
}, {
  size: [50, 100, 100, 50]
}, {
  size: [0, 100, 50, 0]
}, {
  size: [50, 100, 100, 0]
}, {
  size: [0, 50, 100, 0]
}, {
  size: [0, 100, 100, 50]
}];

// Firefox has no system.display API, and the background page's `screen` is
// always the primary monitor. Read the screen from the active tab instead, so
// shortcuts act on the monitor the window is actually on. Falls back to the
// primary monitor on pages that cannot be scripted (about:, addons.mozilla.org).
const getArea = async tabId => {
  try {
    const [area] = await browser.tabs.executeScript(tabId, {
      code: `({
        left: screen.availLeft,
        top: screen.availTop,
        width: screen.availWidth,
        height: screen.availHeight
      })`,
      runAt: 'document_start'
    });
    if (area && area.width && area.height) {
      return area;
    }
  }
  catch (e) {}
  return {
    left: screen.availLeft,
    top: screen.availTop,
    width: screen.availWidth,
    height: screen.availHeight
  };
};

const toBounds = ([top, right, bottom, left], area) => ({
  left: Math.round(area.left + Number(left) / 100 * area.width),
  top: Math.round(area.top + Number(top) / 100 * area.height),
  width: Math.round(Number(right - left) / 100 * area.width),
  height: Math.round(Number(bottom - top) / 100 * area.height)
});

// A maximized or fullscreen window ignores position and size changes,
// so always restore it to "normal" first.
const resize = (windowId, bounds) => browser.windows.update(windowId, {
  state: 'normal',
  ...bounds
}).catch(e => console.warn('Window Resizer:', e));

const getActiveTab = async () => {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
};

// keyboard shortcuts
browser.commands.onCommand.addListener(async command => {
  const prefs = await browser.storage.local.get({
    entries: DEFAULT_ENTRIES
  });
  const entry = prefs.entries[Number(command.replace('layout-', ''))];
  if (!entry) {
    return;
  }
  const tab = await getActiveTab();
  if (tab) {
    resize(tab.windowId, toBounds(entry.size, await getArea(tab.id)));
  }
});

// popup
browser.runtime.onMessage.addListener(request => {
  if (request.method !== 'resize') {
    return;
  }
  return getActiveTab().then(tab => {
    if (tab) {
      setTimeout(() => resize(tab.windowId, {
        left: request.left,
        top: request.top,
        width: request.width,
        height: request.height
      }), 100);
    }
    return true;
  });
});

// startup
{
  const getNormalWindow = () => browser.windows.getLastFocused({
    windowTypes: ['normal']
  }).catch(() => null);

  // Wait for the first browser window to exist (session restore can still be
  // running when onStartup fires), then give it a moment to settle.
  const waitForWindow = async () => {
    const win = await getNormalWindow();
    if (win && win.id !== browser.windows.WINDOW_ID_NONE) {
      return win;
    }
    return new Promise(resolve => {
      const listener = w => {
        if (w.type === 'normal') {
          browser.windows.onCreated.removeListener(listener);
          resolve(w);
        }
      };
      browser.windows.onCreated.addListener(listener);
    });
  };

  browser.runtime.onStartup.addListener(async () => {
    const prefs = await browser.storage.local.get({
      'startup-size': []
    });
    if (prefs['startup-size'].length !== 4) {
      return;
    }
    await waitForWindow();
    await new Promise(resolve => setTimeout(resolve, 1000));

    const win = await getNormalWindow();
    if (!win) {
      return;
    }
    const [tab] = await browser.tabs.query({
      active: true,
      windowId: win.id
    });
    const area = await getArea(tab ? tab.id : undefined);
    resize(win.id, toBounds(prefs['startup-size'], area));
  });
}
