// electron-builder afterPack: stamp the PortPilot icon into PortPilot.exe.
// electron-builder does this itself only when signAndEditExecutable is on, and that path needs
// symlink privilege (it fails on a plain Windows account), so local builds ran with it off and
// shipped Electron's atom icon on the taskbar, Start menu and shortcuts. Doing it here works either way.
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { rcedit } = require('rcedit');
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await rcedit(exe, { icon: path.join(context.packager.projectDir, 'public', 'icon.ico') });
  console.log(`  • icon stamped into ${path.basename(exe)}`);
};
