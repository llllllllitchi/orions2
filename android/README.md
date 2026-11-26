# Orions II · 安卓 APK

把 `orions2` 网页版包成原生 WebView 应用，**完全离线**运行，不联网也能玩（除「局域网」模式需要连同一个 LAN 服务器）。

- 成品：`../orions2-1.0.1.apk`（约 2.3 MB）
- 包名：`com.orions2.game`
- 应用名：奥里昂 2
- 版本：1.0.1（versionCode 2）
- 最低系统：Android 6.0（API 23），建议 8.0+
- 方向：锁定横屏（游戏本身的「请横屏」提示就是按横屏设计的）
- 权限：仅 `INTERNET` / `ACCESS_NETWORK_STATE` / `ACCESS_WIFI_STATE`，全部用于局域网对战
- 签名：v1 + v2 + v3，密钥 `keystore/orions2-release.jks`（别名 `orions2`，密码 `orions2pass`，有效期 10000 天）

## 安装

```bash
adb install -r orions2-1.0.1.apk
```

或把 APK 传到手机直接点击安装（需允许「安装未知来源应用」）。首次安装会提示来自未知开发者，属正常现象。

## 存档与训练入口

- 主菜单：`开始决斗` 下方「对战记录」
- 对局中：右侧战报栏标题旁的「存档」
- 结算界面：`查看战斗记录` → 「历史对战」页签

存档上限 100 局；空间不足时先压缩日志细节（保留结构行与末尾 120 行、保留全部训练决策），再按最旧优先丢弃。点「重新训练 AI」成功后历史对局清空，对战统计与训练出的权重保留。

## 数据存放

卡组、对战记录、训练出的 AI 权重都存在应用私有目录的 WebView `localStorage` 中，**卸载应用会一起清除**。升级安装（同签名、versionCode 递增）不会丢数据。

## 目录结构

```
android/
├── AndroidManifest.xml          # 包名 / 版本 / 横屏 / 权限
├── java/com/orions2/game/
│   └── MainActivity.java        # 单 Activity + WebView 容器
├── res/
│   ├── drawable/splash.xml      # 启动背景（黑底 + 金色「奥」徽记）
│   ├── drawable-nodpi/          # 启动图与自适应图标前景
│   ├── mipmap-*/ic_launcher.png # 各密度图标（48~192px）
│   └── values/                  # 应用名、主题、颜色
├── assets/www/                  # 游戏本体（index.html + css + js + assets）
├── keystore/orions2-release.jks # 签名密钥，务必保留，丢失无法覆盖升级
└── tools/build-apk.sh           # 一键构建
```

## 重新构建

```bash
export ANDROID_SDK_ROOT=/path/to/android-sdk   # 需 build-tools 34 + platforms/android-34
cd android
tools/build-apk.sh
```

脚本依次执行 aapt2 编译/链接 → javac → d8 → zipalign → apksigner，不依赖 Gradle，也不需要 Android Studio。

### 网页改动后同步进 APK

```bash
rsync -a --delete ../orions2/{index.html,css,js,assets} android/assets/www/
cd android && ANDROID_SDK_ROOT=/path/to/android-sdk tools/build-apk.sh
```

## 常用自定义

| 想改什么 | 改哪里 |
| --- | --- |
| 应用名 | `res/values/strings.xml` 的 `app_name` |
| 包名 | `AndroidManifest.xml` 的 `package`，同时移动 `java/com/orions2/game` 目录 |
| 版本号 | `AndroidManifest.xml` 的 `versionCode` / `versionName`（升级必须递增 versionCode） |
| 允许竖屏 | 删掉 `android:screenOrientation="sensorLandscape"` |
| 图标 | 替换 `res/mipmap-*/ic_launcher.png` 与 `res/drawable-nodpi/ic_launcher_foreground.png` |
| 换签名 | 用 `keytool` 生成新 keystore，改 `tools/build-apk.sh` 里的 `KS` / `KEY_ALIAS` / `KS_PASS` |

> 换签名或换包名后再安装，会与旧版本冲突，需先卸载旧版（会清空存档）。

## 已知限制

- 没有内嵌 Chromium，依赖系统 WebView（现代设备均为 100+ 版本，满足游戏的 ES6 需求）。
- 「局域网」模式在手机上需要填对服务器地址；用 `file://` 加载时该模式基本不可用，单机与双人同屏不受影响。
- 返回键：优先网页内后退，再按一次退出应用（2 秒内双击）。
