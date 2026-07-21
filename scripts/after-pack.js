// electron-builder afterPack 훅
// 앱을 패키징한 직후(= dmg 를 만들기 전에) 애드혹 서명을 걸어줍니다.
// 이 순서가 아니면 dmg 안에 서명 안 된 앱이 들어가서, 애플 실리콘에서 실행 즉시 죽습니다.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) {
    console.log('  • afterPack: .app 을 찾지 못해 서명을 건너뜁니다:', appPath);
    return;
  }

  const script = path.join(__dirname, 'sign-mac.sh');
  try {
    execFileSync('bash', [script, appPath], { stdio: 'inherit' });
  } catch (e) {
    console.error('  • ⚠️ 애드혹 서명 실패:', e.message);
    throw e;
  }
};
