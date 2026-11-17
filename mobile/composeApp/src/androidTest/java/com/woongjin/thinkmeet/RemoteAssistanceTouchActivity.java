package com.woongjin.thinkmeet;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Separate test APK/UID. Uses only Android SDK classes in its standalone process. */
public final class RemoteAssistanceTouchActivity extends Activity {
    private int touches;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.WHITE);

        TextView title = new TextView(this);
        title.setText("다른 앱 위 안내 표시 검증");
        title.setTextSize(20f);
        title.setTextColor(Color.BLACK);
        layout.addView(title);

        final Button button = new Button(this);
        button.setText("터치 확인 0");
        button.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                touches++;
                button.setText("터치 확인 " + touches);
            }
        });
        layout.addView(button);
        setContentView(layout);
    }
}
