package dev.agentdeck.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }

        val resolver = context.contentResolver
        try {
            Settings.Global.putInt(resolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 1)
            Settings.Global.putInt(resolver, Settings.Global.ADB_ENABLED, 1)
            Log.i(TAG, "Re-enabled adb_enabled on boot ($action)")
        } catch (e: SecurityException) {
            Log.w(TAG, "Cannot write secure settings — grant WRITE_SECURE_SETTINGS via adb: ${e.message}")
        } catch (e: Throwable) {
            Log.e(TAG, "Failed to re-enable adb on boot", e)
        }
    }

    companion object {
        private const val TAG = "AgentDeckBootReceiver"
    }
}
