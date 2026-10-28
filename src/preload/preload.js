'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const ON = new Set([
  'widget-state',
  'toast',
  'tray-state',
  'settings-data',
  'hotkey-captured',
  'capture-cancel'
]);

contextBridge.exposeInMainWorld('baobao', {
  bootstrap() {
    return ipcRenderer.invoke('bootstrap');
  },
  saveSettings(draft) {
    return ipcRenderer.invoke('settings-save', draft);
  },
  closeSettings() {
    return ipcRenderer.invoke('settings-close');
  },
  beginCapture(which) {
    return ipcRenderer.invoke('capture-begin', which);
  },
  cancelCapture() {
    return ipcRenderer.invoke('capture-cancel');
  },
  minimize() {
    return ipcRenderer.invoke('window-minimize');
  },
  trayAction(action) {
    return ipcRenderer.invoke('tray-action', action);
  },
  widgetDrag(delta) {
    if (!delta || typeof delta !== 'object') return;
    ipcRenderer.send('widget-drag', { dx: delta.dx, dy: delta.dy });
  },
  widgetDragEnd() {
    ipcRenderer.send('widget-drag-end');
  },
  hideTrayMenu() {
    ipcRenderer.send('tray-menu-hide');
  },
  on(channel, callback) {
    if (!ON.has(channel) || typeof callback !== 'function') return function () {};
    const listener = function (_event, payload) { callback(payload); };
    ipcRenderer.on(channel, listener);
    return function () { ipcRenderer.removeListener(channel, listener); };
  }
});
