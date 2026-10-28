'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen, nativeImage, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

const { createHook } = require('./hook');
const { createLockController, EMERGENCY_MS } = require('../shared/lock-controller');
const { createSettingsStore, validateSettingsDraft } = require('../shared/settings-store');
const { resolveWidgetPosition } = require('../shared/position');
const { parts, formatCompact, formatHold } = require('../shared/format');
const { hookFailureMessage, trayStatus, trayTooltip, canPresentLocked } = require('../shared/messages');

const WIDGET_SIZE = { width: 224, height: 268 };
const TOAST_SIZE = { width: 320, height: 120 };
const SETTINGS_SIZE = { width: 412, height: 708 };
const MENU_SIZE = { width: 268, height: 320 };
const TOAST_MS = 1800;
const PROBE_MS = 15000;

const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(__dirname, '..', 'assets');

app.setName('BaobaoLock');
app.setAppUserModelId('app.baobaolock');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const gotInstance = app.requestSingleInstanceLock();
if (!gotInstance) {
  app.quit();
}

let store = null;
let controller = null;
let hook = null;
let tray = null;
let widgetWin = null;
let toastWin = null;
let settingsWin = null;
let menuWin = null;
let toastTimer = null;
let toastVisible = false;
let dialogOpen = false;
let emergencyTimer = null;
let probeTimer = null;
let proofTimer = null;
let proofHint = false;
let quitting = false;
const PROOF_WAIT_MS = 30000;

function logLine(line) {
  try {
    const file = path.join(app.getPath('userData'), 'baobao.log');
    fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n');
  } catch (err) {
    /* logging must not break the hook */
  }
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function webPrefs() {
  return {
    preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    spellcheck: false,
    webSecurity: true,
    backgroundThrottling: false
  };
}

function harden(win) {
  win.webContents.setWindowOpenHandler(function () { return { action: 'deny' }; });
  win.webContents.on('will-navigate', function (event) { event.preventDefault(); });
}

function loadRenderer(win, file) {
  return win.loadFile(path.join(RENDERER, file));
}

function trayIcon(kind) {
  const locked = kind === 'locked';
  const base = locked ? 'tray-locked' : 'tray-unlocked';
  const file32 = path.join(ASSETS, base + '.png');
  const file16 = path.join(ASSETS, base + '-16.png');
  const image = nativeImage.createFromPath(file32);
  if (fs.existsSync(file16)) {
    image.addRepresentation({
      scaleFactor: 1,
      width: 16,
      height: 16,
      buffer: fs.readFileSync(file16)
    });
  }
  return image;
}

function state() {
  return controller.getState();
}

function widgetPayload(extra) {
  const s = state();
  const view = extra && extra.type === 'emergency'
    ? { elapsed: extra.elapsed, progress: extra.progress }
    : controller.emergencyView(Date.now());
  const emergency = !!(s.locked && view);
  return {
    mode: emergency ? 'emergency' : 'locked',
    progress: emergency ? view.progress : 0,
    holdText: emergency ? formatHold(view.elapsed, EMERGENCY_MS) : formatHold(0, EMERGENCY_MS),
    unlockParts: parts(s.settings.unlockHotkey)
  };
}

function settingsPayload() {
  const s = state();
  return {
    lockHotkey: s.settings.lockHotkey,
    unlockHotkey: s.settings.unlockHotkey,
    tipSound: s.settings.tipSound,
    alwaysOnTop: s.settings.alwaysOnTop,
    hookActive: s.hookActive,
    hookAwaiting: !!(hook && hook.isAwaitingProof && hook.isAwaitingProof()),
    locked: canPresentLocked(s)
  };
}

function menuPayload() {
  const s = state();
  const status = trayStatus({
    hookActive: s.hookActive,
    locked: s.locked,
    hookAwaiting: !!(hook && hook.isAwaitingProof && hook.isAwaitingProof())
  });
  return {
    locked: canPresentLocked(s),
    hookActive: s.hookActive,
    statusText: status.text,
    statusKind: status.kind,
    lockText: formatCompact(s.settings.lockHotkey),
    unlockText: formatCompact(s.settings.unlockHotkey)
  };
}

function send(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isLoading()) return;
  win.webContents.send(channel, payload);
}

function applyAlwaysOnTop() {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  if (store.get().alwaysOnTop !== false) widgetWin.setAlwaysOnTop(true, 'screen-saver');
  else widgetWin.setAlwaysOnTop(false);
}

function displaysForPosition() {
  return screen.getAllDisplays().map(function (display) {
    return { bounds: display.bounds, workArea: display.workArea };
  });
}

function placeWidget() {
  const primary = screen.getPrimaryDisplay().workArea;
  const saved = store.get().widgetPosition;
  const pos = resolveWidgetPosition(saved, displaysForPosition(), primary, WIDGET_SIZE);
  widgetWin.setPosition(pos.x, pos.y);
}

function ensureWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) return widgetWin;
  widgetWin = new BrowserWindow({
    width: WIDGET_SIZE.width,
    height: WIDGET_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: webPrefs()
  });
  harden(widgetWin);
  widgetWin.setMenuBarVisibility(false);
  widgetWin.on('closed', function () { widgetWin = null; });
  widgetWin.webContents.on('did-finish-load', function () {
    send(widgetWin, 'widget-state', widgetPayload());
  });
  loadRenderer(widgetWin, 'widget.html');
  return widgetWin;
}

function presentLockedUi() {
  const s = state();
  if (!canPresentLocked(s)) return;
  ensureWidget();
  applyAlwaysOnTop();
  placeWidget();
  if (!widgetWin.isVisible()) widgetWin.showInactive();
  send(widgetWin, 'widget-state', widgetPayload());
  updateTray();
}

function hideLockedUi() {
  toastVisible = false;
  proofHint = false;
  if (toastTimer) clearTimeout(toastTimer);
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
  stopEmergencyTimer();
  updateTray();
}

function ensureToast() {
  if (toastWin && !toastWin.isDestroyed()) return toastWin;
  toastWin = new BrowserWindow({
    width: TOAST_SIZE.width,
    height: TOAST_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: webPrefs()
  });
  harden(toastWin);
  toastWin.setAlwaysOnTop(true, 'screen-saver');
  toastWin.on('closed', function () { toastWin = null; });
  loadRenderer(toastWin, 'toast.html');
  return toastWin;
}

function placeToast() {
  const area = screen.getPrimaryDisplay().workArea;
  let x = area.x + area.width - TOAST_SIZE.width - 24;
  let y = area.y + area.height - TOAST_SIZE.height - WIDGET_SIZE.height - 16;
  if (widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible()) {
    const b = widgetWin.getBounds();
    x = b.x + b.width - TOAST_SIZE.width;
    y = b.y - TOAST_SIZE.height + 8;
  }
  x = Math.max(area.x + 4, Math.min(x, area.x + area.width - TOAST_SIZE.width - 4));
  y = Math.max(area.y + 4, Math.min(y, area.y + area.height - TOAST_SIZE.height - 4));
  toastWin.setPosition(Math.round(x), Math.round(y));
}

function showToast(payload) {
  if (!canPresentLocked(state())) return;
  ensureToast();
  const playSound = !toastVisible && !!payload.sound;
  toastVisible = true;
  const deliver = function () {
    send(toastWin, 'toast', {
      title: '哎呀，还锁着哦',
      sub: payload.sub,
      sound: !!payload.sound,
      playSound: playSound
    });
    placeToast();
    toastWin.showInactive();
    toastWin.moveTop();
  };
  if (toastWin.webContents.isLoading()) toastWin.webContents.once('did-finish-load', deliver);
  else deliver();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toastVisible = false;
    if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
  }, TOAST_MS);
}

function ensureSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin;
  settingsWin = new BrowserWindow({
    width: SETTINGS_SIZE.width,
    height: SETTINGS_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    title: '宝宝锁',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: webPrefs()
  });
  harden(settingsWin);
  settingsWin.setMenuBarVisibility(false);
  settingsWin.on('closed', function () {
    settingsWin = null;
    if (controller) controller.setCapture(null);
  });
  settingsWin.on('blur', function () {
    if (!controller || !controller.getState().capture) return;
    controller.setCapture(null);
    send(settingsWin, 'capture-cancel', {});
  });
  settingsWin.webContents.on('did-finish-load', function () {
    send(settingsWin, 'settings-data', settingsPayload());
  });
  loadRenderer(settingsWin, 'settings.html');
  return settingsWin;
}

function showSettings() {
  ensureSettings();
  settingsWin.setAlwaysOnTop(true, 'screen-saver');
  const area = screen.getPrimaryDisplay().workArea;
  const x = Math.round(area.x + (area.width - SETTINGS_SIZE.width) / 2);
  const y = Math.round(area.y + (area.height - SETTINGS_SIZE.height) / 2);
  if (!settingsWin.isVisible()) settingsWin.setPosition(x, y);
  send(settingsWin, 'settings-data', settingsPayload());
  settingsWin.show();
  settingsWin.moveTop();
  settingsWin.focus();
}

function ensureMenu() {
  if (menuWin && !menuWin.isDestroyed()) return menuWin;
  menuWin = new BrowserWindow({
    width: MENU_SIZE.width,
    height: MENU_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: webPrefs()
  });
  harden(menuWin);
  menuWin.setAlwaysOnTop(true, 'screen-saver');
  menuWin.on('blur', function () {
    setTimeout(function () {
      if (menuWin && !menuWin.isDestroyed()) menuWin.hide();
    }, 140);
  });
  menuWin.on('closed', function () { menuWin = null; });
  menuWin.webContents.on('did-finish-load', function () {
    send(menuWin, 'tray-state', menuPayload());
  });
  loadRenderer(menuWin, 'tray-menu.html');
  return menuWin;
}

function placeMenu() {
  const b = menuWin.getBounds();
  const trayBounds = tray && typeof tray.getBounds === 'function' ? tray.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
  const anchor = {
    x: trayBounds.width ? trayBounds.x : screen.getPrimaryDisplay().workArea.x + screen.getPrimaryDisplay().workArea.width - 40,
    y: trayBounds.height ? trayBounds.y : screen.getPrimaryDisplay().workArea.y + screen.getPrimaryDisplay().workArea.height - 8
  };
  const display = screen.getDisplayNearestPoint(anchor);
  const area = display.workArea;
  let x = Math.round(anchor.x + (trayBounds.width || 0) / 2 - b.width / 2);
  let y = Math.round(anchor.y - b.height - 8);
  if (!trayBounds.height || trayBounds.y <= area.y + 8) {
    y = Math.round(anchor.y + (trayBounds.height || 0) + 8);
  }
  x = Math.max(area.x + 4, Math.min(x, area.x + area.width - b.width - 4));
  y = Math.max(area.y + 4, Math.min(y, area.y + area.height - b.height - 4));
  menuWin.setPosition(x, y);
}

function toggleMenu() {
  ensureMenu();
  if (menuWin.isVisible()) {
    menuWin.hide();
    return;
  }
  send(menuWin, 'tray-state', menuPayload());
  placeMenu();
  menuWin.show();
  menuWin.focus();
}

function updateTray() {
  if (!tray) return;
  const s = state();
  const status = trayStatus(s);
  tray.setImage(trayIcon(status.kind));
  tray.setToolTip(trayTooltip(s));
  send(menuWin, 'tray-state', menuPayload());
}

function createTray() {
  const { Tray } = require('electron');
  tray = new Tray(trayIcon('unlocked'));
  tray.setToolTip(trayTooltip(state()));
  tray.on('click', toggleMenu);
  tray.on('right-click', toggleMenu);
  updateTray();
}

async function explainHook(result) {
  if (quitting || process.env.BABAO_SMOKE === '1') return;
  if (dialogOpen) return;
  dialogOpen = true;
  const copy = hookFailureMessage(result);
  logLine('hook-failure ' + (result && result.code ? result.code : '') + ' ' + (result && result.detail ? result.detail : ''));
  try {
    await dialog.showMessageBox({
      type: 'warning',
      title: copy.title,
      message: copy.message,
      detail: copy.detail,
      buttons: ['知道了'],
      noLink: true
    });
  } finally {
    dialogOpen = false;
  }
}

function flush(actions) {
  (actions || []).forEach(function (action) {
    if (action.type === 'locked') {
      presentLockedUi();
      return;
    }
    if (action.type === 'unlocked' || action.type === 'force-unlocked') {
      hideLockedUi();
      if (action.type === 'force-unlocked') {
        explainHook({
          code: 'hook-lost',
          detail: '键盘钩子已失效，锁定已取消。键盘没有处于上锁状态。'
        });
      }
      return;
    }
    if (action.type === 'emergency') {
      startEmergencyTimer();
      send(widgetWin, 'widget-state', widgetPayload(action));
      return;
    }
    if (action.type === 'emergency-cancel') {
      stopEmergencyTimer();
      send(widgetWin, 'widget-state', widgetPayload());
      return;
    }
    if (action.type === 'wrong-attempt') {
      const s = state();
      if (!canPresentLocked(s)) return;
      showToast({
        sub: '请按 ' + formatCompact(s.settings.unlockHotkey) + ' 解锁',
        sound: !!s.settings.tipSound
      });
      return;
    }
    if (action.type === 'hook-missing') {
      explainHook({ code: 'hook-missing', detail: '键盘钩子未在运行。' });
      return;
    }
    if (action.type === 'capture') {
      const check = validateHotkeySafe(action.hotkey);
      send(settingsWin, 'hotkey-captured', {
        target: action.target,
        hotkey: check.hotkey || null,
        error: check.ok ? null : check.error
      });
      return;
    }
    if (action.type === 'capture-cancel') {
      send(settingsWin, 'capture-cancel', {});
      return;
    }
    if (action.type === 'proof-done') {
      hideProofHint();
      stopProofTimer();
      updateTray();
      send(settingsWin, 'settings-data', settingsPayload());
    }
  });
  if (hook && hook.setLocked) hook.setLocked(!!state().locked);
}

function validateHotkeySafe(hotkey) {
  const { validateHotkey } = require('../shared/hotkey');
  return validateHotkey(hotkey);
}

function schedule(actions) {
  if (!actions || !actions.length) return;
  setImmediate(function () { flush(actions); });
}

function stopProbeWatch() {
  if (!probeTimer) return;
  clearInterval(probeTimer);
  probeTimer = null;
}

async function ensureHook() {
  const result = await hook.install();
  if (result && result.ok && hook.isActive()) {
    flush(controller.setHookActive(true));
    if (hook.setLocked) hook.setLocked(false);
    logLine('hook installed');
    startProbeWatch();
    return result;
  }
  if (result && result.ok && result.awaitingRealKey) {
    flush(controller.setHookActive(false));
    logLine('hook installed awaiting real key');
    startProbeWatch();
    updateTray();
    send(settingsWin, 'settings-data', settingsPayload());
    return result;
  }
  flush(controller.setHookActive(false));
  stopProbeWatch();
  logLine('install failed ' + (result && result.code ? result.code : '') + ' ' + (result && result.detail ? result.detail : ''));
  return result || { ok: false, code: 'hook-exception', detail: '安装没有返回结果。' };
}

function stopProofTimer() {
  if (!proofTimer) return;
  clearTimeout(proofTimer);
  proofTimer = null;
}

function showProofHint() {
  ensureToast();
  const deliver = function () {
    send(toastWin, 'toast', {
      title: '还没锁住',
      sub: '请按任意键，拦住后才会上锁',
      sound: false,
      playSound: false
    });
    placeToast();
    toastWin.showInactive();
    toastWin.moveTop();
  };
  if (toastWin.webContents.isLoading()) toastWin.webContents.once('did-finish-load', deliver);
  else deliver();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  proofHint = true;
}

function hideProofHint() {
  if (!proofHint) return;
  proofHint = false;
  toastVisible = false;
  if (toastWin && !toastWin.isDestroyed()) toastWin.hide();
}

function beginKeyProof() {
  hook.armLock();
  showProofHint();
  stopProofTimer();
  proofTimer = setTimeout(function () {
    proofTimer = null;
    if (hook.isActive()) {
      hideProofHint();
      updateTray();
      return;
    }
    const failed = hook.giveUp();
    hideProofHint();
    flush(controller.setHookActive(false));
    updateTray();
    send(settingsWin, 'settings-data', settingsPayload());
    explainHook(failed);
  }, PROOF_WAIT_MS);
  updateTray();
  send(settingsWin, 'settings-data', settingsPayload());
}

async function doLock() {
  if (!hook.isInstalled() || !hook.isAlive()) {
    const result = await ensureHook();
    if (!result || !result.ok) {
      hideLockedUi();
      await explainHook(result || { detail: '键盘钩子没有装上。' });
      return;
    }
  }
  if (hook.isActive()) {
    const res = controller.requestLock();
    flush(res.actions);
    return;
  }
  beginKeyProof();
}

function doUnlock() {
  const res = controller.requestUnlock();
  flush(res.actions);
}

function startEmergencyTimer() {
  if (emergencyTimer) return;
  emergencyTimer = setInterval(function () {
    const action = controller.tick(Date.now());
    if (!action) return;
    flush([action]);
  }, 50);
}

function stopEmergencyTimer() {
  if (!emergencyTimer) return;
  clearInterval(emergencyTimer);
  emergencyTimer = null;
}

function startProbeWatch() {
  stopProbeWatch();
  probeTimer = setInterval(function () {
    if (!hook.isInstalled()) return;
    if (hook.isAlive()) return;
    hook.uninstall();
    const actions = controller.setHookActive(false);
    flush(actions);
    hideProofHint();
    stopProofTimer();
  }, PROBE_MS);
}

function rememberPosition() {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  const b = widgetWin.getBounds();
  store.merge({ widgetPosition: { x: b.x, y: b.y } });
  controller.updateSettings(store.get());
}

function asDelta(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 600) return 0;
  return Math.round(n);
}

function wireIpc() {
  ipcMain.handle('bootstrap', function (event) {
    const url = event.sender.getURL();
    if (url.includes('settings')) return settingsPayload();
    if (url.includes('tray-menu')) return menuPayload();
    if (url.includes('toast')) {
      return { title: '哎呀，还锁着哦', sub: '', sound: false, playSound: false };
    }
    return widgetPayload();
  });

  ipcMain.handle('settings-save', function (_event, draft) {
    const check = validateSettingsDraft(draft);
    if (!check.ok) return check;
    const saved = store.merge(check.settings);
    controller.updateSettings(saved);
    applyAlwaysOnTop();
    updateTray();
    send(widgetWin, 'widget-state', widgetPayload());
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    return { ok: true };
  });

  ipcMain.handle('settings-close', function () {
    controller.setCapture(null);
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
    return { ok: true };
  });

  ipcMain.handle('capture-begin', function (_event, which) {
    if (which !== 'lock' && which !== 'unlock') return { ok: false };
    controller.setCapture(which);
    return { ok: true };
  });

  ipcMain.handle('capture-cancel', function () {
    controller.setCapture(null);
    return { ok: true };
  });

  ipcMain.handle('window-minimize', function (event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.minimize();
    return { ok: true };
  });

  ipcMain.handle('tray-action', async function (_event, action) {
    if (menuWin && !menuWin.isDestroyed()) menuWin.hide();
    if (action === 'lock') await doLock();
    else if (action === 'unlock') doUnlock();
    else if (action === 'settings') showSettings();
    else if (action === 'exit') quitApp();
    return { ok: true };
  });

  ipcMain.on('widget-drag', function (_event, delta) {
    if (!widgetWin || widgetWin.isDestroyed() || !widgetWin.isVisible()) return;
    const b = widgetWin.getBounds();
    widgetWin.setPosition(b.x + asDelta(delta && delta.dx), b.y + asDelta(delta && delta.dy));
  });

  ipcMain.on('widget-drag-end', function () {
    rememberPosition();
  });

  ipcMain.on('tray-menu-hide', function () {
    if (menuWin && !menuWin.isDestroyed()) menuWin.hide();
  });
}

function quitApp() {
  quitting = true;
  if (hook) hook.uninstall();
  app.quit();
}

async function boot() {
  store = createSettingsStore(settingsPath());
  controller = createLockController({ settings: store.get() });
  logLine('boot v' + require('../../package.json').version);
  hook = createHook({
    decide(event) {
      const result = controller.event(event);
      schedule(result.actions);
      return result;
    },
    onError(err) {
      logLine('hook callback error ' + (err && err.message ? err.message : String(err)));
    },
    onDiagnostic(line) {
      logLine('hook-diag ' + line);
    },
    onProven() {
      controller.setHookActive(true);
      schedule([{ type: 'proof-done' }]);
    },
    onLockFromProof() {
      controller.setHookActive(true);
      const res = controller.requestLock();
      if (hook.setLocked) hook.setLocked(true);
      schedule((res.actions || []).concat([{ type: 'proof-done' }]));
    },
    isLocked() {
      return !!(controller && controller.getState().locked);
    }
  });
  Menu.setApplicationMenu(null);
  const result = await ensureHook();
  if (process.env.BABAO_SMOKE === '1') {
    const s = state();
    process.stdout.write(JSON.stringify({
      smoke: true,
      platform: process.platform,
      hookOk: !!result.ok,
      hookCode: result.ok ? null : result.code,
      locked: s.locked,
      hookActive: s.hookActive,
      canPresentLocked: canPresentLocked(s)
    }) + '\n');
    quitApp();
    return;
  }
  createTray();
  wireIpc();
  if (!result.ok) explainHook(result);
  screen.on('display-removed', function () {
    if (!widgetWin || widgetWin.isDestroyed() || !widgetWin.isVisible()) return;
    placeWidget();
    rememberPosition();
  });
}

if (gotInstance) {
  app.on('second-instance', function () {
    if (controller) showSettings();
  });
  app.on('before-quit', function () {
    quitting = true;
    if (hook) hook.uninstall();
    if (probeTimer) clearInterval(probeTimer);
    if (proofTimer) clearTimeout(proofTimer);
    stopEmergencyTimer();
  });
  app.on('window-all-closed', function () {
    /* tray app: keep running with no windows */
  });
  app.whenReady().then(boot).catch(function (err) {
    logLine('boot failed ' + err.message);
    dialog.showErrorBox('宝宝锁没能启动', err && err.message ? err.message : String(err));
    app.exit(1);
  });
}

module.exports = { canPresentLocked };
