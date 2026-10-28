'use strict';

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico');

const root = path.join(__dirname, '..');
const lockedSvg = fs.readFileSync(path.join(root, 'src/assets/icon-locked.svg'));
const unlockedSvg = fs.readFileSync(path.join(root, 'src/assets/icon-unlocked.svg'));

function render(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)'
  });
  return resvg.render().asPng();
}

function writePng(file, svg, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(svg, size));
}

async function main() {
  const assets = path.join(root, 'src/assets');
  const build = path.join(root, 'build');
  writePng(path.join(assets, 'tray-locked.png'), lockedSvg, 32);
  writePng(path.join(assets, 'tray-locked-16.png'), lockedSvg, 16);
  writePng(path.join(assets, 'tray-unlocked.png'), unlockedSvg, 32);
  writePng(path.join(assets, 'tray-unlocked-16.png'), unlockedSvg, 16);
  writePng(path.join(assets, 'icon.png'), lockedSvg, 256);
  const png16 = render(lockedSvg, 16);
  const png32 = render(lockedSvg, 32);
  const png48 = render(lockedSvg, 48);
  const png256 = render(lockedSvg, 256);
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(build, 'icon.png'), png256);
  const ico = await pngToIco([png16, png32, png48, png256]);
  fs.writeFileSync(path.join(build, 'icon.ico'), ico);
  console.log('icons written');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
