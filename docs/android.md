# 安卓离线版

当前仅包含《合成大GPT》，沿用同一套 Matter.js 游戏逻辑；尚未增加游戏大厅。应用 ID 固定为 `io.github.n1ghtawe.pocketgames`，未来增加小游戏时可继续沿用安装与签名。

1.0.1 使用第 2 级白发龙娘作为桌面图标与启动图案，保留原始角色 PNG，由安卓资源布局适配圆形与圆角方形图标。构建检查会从安卓应用列表中的图标启动游戏，并保存桌面截图。

## 本地开发

需要 Node.js 22.12+、Java 21 和 Android SDK 36。安装依赖后：

```powershell
npm test
npm run android:sync
cd android
.\gradlew.bat assembleDebug
```

调试 APK 输出到 `android/app/build/outputs/apk/debug/`。调试签名不能覆盖正式版本。

`npm run build` 仍生成普通网页版；`npm run android:sync` 生成精简资源的离线包，并同步进 Android 工程。未配置远程 `server.url`，App 不依赖 GitHub Pages 或开发服务器。

## 发布与签名

GitHub Actions 的 `Android offline APK` 工作流运行测试、打包签名 APK，再用 Android 模拟器断网验证首次启动、投放、退出进程与恢复。构建产物 `android-release` 包含 APK、SHA-256 校验值和签名证书摘要；`android-offline-check` 包含截图与结果。

正式签名密码存放于仓库 Actions secret `ANDROID_SIGNING_PASSWORD`，私钥经 GPG 加密后以 Base64 格式存放于另一个 Actions secret `ANDROID_KEYSTORE_GPG_BASE64`。源码只保存公开证书的 SHA-256 指纹，构建时验证签名一致。不要重新生成或覆盖签名凭据，应妥善保管本机 `.private/` 下的密码与加密备份，否则无法发布可覆盖安装的更新。

工作流以 `1000 + GITHUB_RUN_NUMBER` 作为递增版本号。通过检查后，将 APK 发布到 GitHub Releases；签名私钥不作为公开下载附件发布。

## 文件结构

```text
src/physics.ts       物理、合成、整球越线判负、存档恢复
src/save.ts          存档格式与完整性校验
src/game.ts          绘制、交互、定期保存
src/main.ts          HUD、弹窗、安卓后台与返回键处理
build/android-assets.ts  只打包当前 11 张角色素材
capacitor.config.ts 离线 App 配置
android/            Android 原生壳、图标、启动页、签名构建
tests/              物理与存档回归测试
scripts/android-smoke.py  真实 APK 的模拟器离线检查
```

进度每秒保存一次，暂停、退到后台时立即保存；重新打开后保持暂停。清空数据、卸载或系统存储不可用时无法保留进度。没有登录、云端存档、广告或额外游戏。
