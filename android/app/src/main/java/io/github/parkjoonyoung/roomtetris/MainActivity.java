package io.github.parkjoonyoung.roomtetris;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 룸 테트리스 웹앱(배포 주소)을 화면 가득 보여 주는 앱 껍데기.
 *
 * 웹 화면은 기기의 시스템 WebView 로 돌아가므로 브라우저 앱이 없어도 된다.
 * 브라우저에서는 되지만 WebView 에서는 직접 해 줘야 하는 것들만 여기서 처리한다:
 * 파일 고르기, 파일로 저장, 공유, 복사, 뒤로가기, 가져오기 링크로 열기, 인터넷이 없을 때 안내.
 */
public class MainActivity extends Activity {
    private static final String BASE_URL = "https://park-joonyoung.github.io/room-tetris/";
    private static final int REQUEST_PICK_FILE = 1;
    private static final int REQUEST_SAVE_FILE = 2;

    private WebView web;
    private View offline;
    private boolean loadFailed;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSaveText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.bg));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offline = buildOfflineView();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // 가구와 배치도를 저장하는 localStorage
        settings.setAllowFileAccess(false);
        settings.setUserAgentString(settings.getUserAgentString() + " RoomTetrisApp/1");

        web.addJavascriptInterface(new Bridge(), "RoomTetrisApp");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(startUrl(getIntent()));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    /** 앱이 켜져 있는 상태에서 가져오기 링크를 누른 경우. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getData() != null) web.loadUrl(startUrl(intent));
    }

    /** 휴대폰의 뒤로가기는 웹 화면 안에서 한 단계 뒤로 간다. 더 갈 곳이 없으면 앱을 닫는다. */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;

        if (requestCode == REQUEST_PICK_FILE) {
            if (fileCallback == null) return;
            fileCallback.onReceiveValue(uri == null ? null : new Uri[] {uri});
            fileCallback = null;
        } else if (requestCode == REQUEST_SAVE_FILE) {
            String text = pendingSaveText;
            pendingSaveText = null;
            if (uri == null || text == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
                toast("파일을 저장했어요.");
            } catch (Exception e) {
                toast("파일을 저장하지 못했어요.");
            }
        }
    }

    private static boolean isAppUrl(String url) {
        return url != null && (url.startsWith(BASE_URL) || url.equals(BASE_URL.substring(0, BASE_URL.length() - 1)));
    }

    /** 링크로 열렸으면 그 주소(가져오기 데이터 포함)를, 아니면 첫 화면을 연다. */
    private static String startUrl(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        return data != null && isAppUrl(data.toString()) ? data.toString() : BASE_URL;
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    /** 인터넷이 없어서 화면을 불러오지 못했을 때 보여 주는 안내. */
    private View buildOfflineView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setBackgroundColor(getColor(R.color.bg));
        box.setClickable(true);

        TextView title = new TextView(this);
        title.setText("화면을 불러오지 못했어요");
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        title.setTextColor(getColor(R.color.text));
        title.setGravity(Gravity.CENTER);

        TextView detail = new TextView(this);
        detail.setText("인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
        detail.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        detail.setTextColor(getColor(R.color.muted));
        detail.setGravity(Gravity.CENTER);
        detail.setPadding(0, dp(8), 0, dp(20));

        Button retry = new Button(this);
        retry.setText("다시 시도");
        retry.setOnClickListener(v -> web.reload());

        LinearLayout.LayoutParams wrap = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        box.addView(title, wrap);
        box.addView(detail, new LinearLayout.LayoutParams(wrap));
        box.addView(retry, new LinearLayout.LayoutParams(wrap));
        return box;
    }

    private class Client extends WebViewClient {
        /** 앱 주소만 이 안에서 열고, 다른 주소는 바깥 앱에 맡긴다. */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isAppUrl(uri.toString())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException e) {
                toast("이 링크를 열 수 있는 앱이 없어요.");
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            loadFailed = false;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            loadFailed = true;
            offline.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!loadFailed) offline.setVisibility(View.GONE);
        }
    }

    private class Chrome extends WebChromeClient {
        /** 웹 화면의 "파일 선택"을 누르면 기기의 파일 고르기 화면을 띄운다. */
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*"); // .json 은 기기마다 종류가 다르게 잡혀서 전부 보이게 한다
            try {
                startActivityForResult(Intent.createChooser(intent, "가져올 파일 선택"), REQUEST_PICK_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                callback.onReceiveValue(null);
                toast("파일을 고를 수 있는 앱이 없어요.");
            }
            return true;
        }
    }

    /**
     * 웹 화면에서 window.RoomTetrisApp 으로 부르는 기능.
     * 전부 사용자가 직접 확인하는 화면(저장 위치 고르기, 공유 대상 고르기)을 거치거나 복사만 한다.
     */
    private class Bridge {
        /** 내보내기 파일을 저장할 위치를 고르게 한 뒤 저장한다. */
        @JavascriptInterface
        public void saveFile(final String name, final String text) {
            runOnUiThread(() -> {
                String safeName = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
                if (safeName.isEmpty() || safeName.length() > 80) safeName = "room-tetris.json";
                pendingSaveText = text;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, safeName);
                try {
                    startActivityForResult(intent, REQUEST_SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingSaveText = null;
                    toast("파일을 저장할 수 있는 앱이 없어요.");
                }
            });
        }

        /** 내보내기 링크를 다른 앱(메신저 등)으로 보낸다. */
        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_TEXT, text);
                try {
                    startActivity(Intent.createChooser(intent, "링크 공유"));
                } catch (ActivityNotFoundException e) {
                    toast("공유할 수 있는 앱이 없어요.");
                }
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(() -> {
                ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("룸 테트리스", text));
            });
        }
    }
}
