'use strict';

/** Virtual-key codes we understand. Names are stable settings values. */
const VK = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12,
  PAUSE: 0x13,
  CAPITAL: 0x14,
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PRIOR: 0x21,
  NEXT: 0x22,
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  SNAPSHOT: 0x2c,
  INSERT: 0x2d,
  DELETE: 0x2e,
  LWIN: 0x5b,
  RWIN: 0x5c,
  MULTIPLY: 0x6a,
  ADD: 0x6b,
  SUBTRACT: 0x6d,
  DECIMAL: 0x6e,
  DIVIDE: 0x6f,
  NUMLOCK: 0x90,
  SCROLL: 0x91,
  LSHIFT: 0xa0,
  RSHIFT: 0xa1,
  LCONTROL: 0xa2,
  RCONTROL: 0xa3,
  LMENU: 0xa4,
  RMENU: 0xa5,
  OEM_1: 0xba,
  OEM_PLUS: 0xbb,
  OEM_COMMA: 0xbc,
  OEM_MINUS: 0xbd,
  OEM_PERIOD: 0xbe,
  OEM_2: 0xbf,
  OEM_3: 0xc0,
  OEM_4: 0xdb,
  OEM_5: 0xdc,
  OEM_6: 0xdd,
  OEM_7: 0xde
};

for (let i = 0; i <= 9; i += 1) VK[String(i)] = 0x30 + i;
for (let i = 0; i < 26; i += 1) VK[String.fromCharCode(65 + i)] = 0x41 + i;
for (let i = 0; i <= 9; i += 1) VK['NUMPAD' + i] = 0x60 + i;
for (let i = 1; i <= 24; i += 1) VK['F' + i] = 0x6f + i;

const MODIFIER_NAMES = new Set([
  'SHIFT', 'CONTROL', 'MENU',
  'LSHIFT', 'RSHIFT',
  'LCONTROL', 'RCONTROL',
  'LMENU', 'RMENU',
  'LWIN', 'RWIN'
]);

const NAME_BY_VK = new Map();
for (const [name, code] of Object.entries(VK)) {
  if (!NAME_BY_VK.has(code)) NAME_BY_VK.set(code, name);
}

function vkToName(vk) {
  const code = typeof vk === 'bigint' ? Number(vk) : Number(vk);
  if (!Number.isInteger(code)) return null;
  return NAME_BY_VK.get(code) || null;
}

function isModifierName(name) {
  return MODIFIER_NAMES.has(name);
}

function isModifierVk(vk) {
  const name = vkToName(vk);
  return !!name && isModifierName(name);
}

module.exports = {
  VK,
  MODIFIER_NAMES,
  vkToName,
  isModifierName,
  isModifierVk
};
