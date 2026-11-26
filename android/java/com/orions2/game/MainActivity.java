package com.orions2.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 单 Activity 的 WebView 容器。
 *
 * 游戏本体是离线 HTML5，全部资源放在 assets/www 下，用 file:///android_asset 加载；
 * localStorage 因此可以直接保存卡组、对战记录与训练出的 AI 权重。
 *
 * 另外提供两件浏览器能做、WebView 默认做不了的事：
 *   1. blob: 下载 —— 注入 Orions2Bridge.saveFile()，把导出的 JSON 写进「下载/Orions2」。
 *   2. <input type=file> —— 实现 onShowFileChooser，导入对局记录时需要。
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final int BG = Color.rgb(12, 10, 8);
    private static final int REQ_PICK_FILE = 1001;
    private static final int REQ_STORAGE = 1002;

    private WebView web;
    private long lastBackPress = 0L;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Android 9 及以下往公共下载目录写文件需要这个权限；10 起走 MediaStore，无需申请。
        // Android 5.0/5.1 没有运行时权限模型，checkSelfPermission 会 NoSuchMethodError，必须挡住。
        if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT < 29
                && checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            try {
                requestPermissions(new String[]{android.Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            } catch (Exception ignored) {
            }
        }

        web = new WebView(this);
        web.setBackgroundColor(BG);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(v -> true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        // 音效需要在没有用户手势时也能播放（战斗日志连播）。
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // 固定 100%，避免系统字体放大把版面撑坏。
        s.setTextZoom(100);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        web.addJavascriptInterface(new Bridge(), "Orions2Bridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternally(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternally(request.getUrl() == null ? null : request.getUrl().toString());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择对局记录 (.json)"), REQ_PICK_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(START_URL);
        }
        hideSystemBars();
    }

    /* ------------------------------------------------------------ 文件导出 */

    /**
     * 网页里点击「导出」时调用的原生通道。WebView 不会处理 blob: 下载，
     * 所以由 JS 把 JSON 文本直接传进来落盘。
     */
    private class Bridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String saveFile(String name, String content) {
            String safe = String.valueOf(name == null ? "orions2.json" : name)
                    .replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
            return writeDownload(safe, content == null ? "" : content);
        }
    }

    private String writeDownload(String name, String content) {
        byte[] bytes;
        try {
            bytes = content.getBytes("UTF-8");
        } catch (Exception e) {
            bytes = content.getBytes();
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                v.put(MediaStore.Downloads.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/Orions2");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return "ERROR:无法创建下载文件";
                OutputStream os = getContentResolver().openOutputStream(uri);
                if (os == null) return "ERROR:无法写入下载文件";
                os.write(bytes);
                os.close();
                return "Download/Orions2/" + name;
            }
            File dir = new File(Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS), "Orions2");
            if (!dir.exists() && !dir.mkdirs()) return "ERROR:无法创建目录";
            File out = new File(dir, name);
            FileOutputStream fos = new FileOutputStream(out);
            fos.write(bytes);
            fos.close();
            return out.getAbsolutePath();
        } catch (SecurityException e) {
            return "ERROR:缺少存储权限，请在系统设置中允许";
        } catch (Exception e) {
            return "ERROR:" + e.getClass().getSimpleName();
        }
    }

    /* ------------------------------------------------------------ 文件导入 */

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_PICK_FILE) {
            ValueCallback<Uri[]> cb = fileCallback;
            fileCallback = null;
            if (cb == null) return;
            if (resultCode != RESULT_OK || data == null) {
                cb.onReceiveValue(null);
                return;
            }
            List<Uri> picked = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) picked.add(u);
                }
            } else if (data.getData() != null) {
                picked.add(data.getData());
            }
            // WebView 从 content:// 读文件时偶尔拿不到数据，先复制一份到缓存目录再交回去。
            List<Uri> out = new ArrayList<>();
            for (Uri u : picked) {
                Uri local = copyToCache(u);
                if (local != null) out.add(local);
            }
            cb.onReceiveValue(out.isEmpty() ? null : out.toArray(new Uri[0]));
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private Uri copyToCache(Uri src) {
        String name = "import.json";
        Cursor c = null;
        try {
            c = getContentResolver().query(src, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String v = c.getString(idx);
                    if (v != null && v.length() > 0) name = v;
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        name = name.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
        if (!name.toLowerCase().endsWith(".json")) name = name + ".json";

        File dir = new File(getCacheDir(), "import");
        if (!dir.exists()) dir.mkdirs();
        File dst = new File(dir, System.currentTimeMillis() + "-" + name);
        try {
            InputStream in = getContentResolver().openInputStream(src);
            if (in == null) return null;
            FileOutputStream fos = new FileOutputStream(dst);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            fos.close();
            in.close();
            return Uri.fromFile(dst);
        } catch (Exception e) {
            return null;
        }
    }

    /* ------------------------------------------------------------------ 杂项 */

    /** 站内 file:// 导航照常，外链交给浏览器。 */
    private boolean openExternally(String url) {
        if (url == null) return false;
        if (url.startsWith("file://") || url.startsWith("about:")
                || url.startsWith("data:") || url.startsWith("javascript:")
                || url.startsWith("blob:")) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
        return true;
    }

    private void hideSystemBars() {
        View decor = getWindow().getDecorView();
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
        decor.setSystemUiVisibility(flags);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPress < 2000) {
            super.onBackPressed();
            return;
        }
        lastBackPress = now;
        Toast.makeText(this, "再按一次返回键退出", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideSystemBars();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setVisibility(View.GONE);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
