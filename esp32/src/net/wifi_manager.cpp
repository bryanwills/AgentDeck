#include "wifi_manager.h"
#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include "config.h"

static WiFiManager wm;
static char ipBuf[16] = {0};
static bool portalActive = false;
static bool wifiWasConnected = false;

#if defined(BOARD_IPS10)
namespace {
constexpr const char* IPS10_WIFI_PREFS_NS = "adwifi";
constexpr const char* IPS10_WIFI_PREFS_SSID = "ssid";
constexpr const char* IPS10_WIFI_PREFS_PASSWORD = "password";
constexpr const char* IPS10_WIFI_PREFS_BRIDGE_IP = "bridge_ip";
constexpr const char* IPS10_WIFI_PREFS_BRIDGE_PORT = "bridge_port";
constexpr const char* IPS10_WIFI_PREFS_BRIDGE_TOKEN = "bridge_token";
constexpr size_t IPS10_SSID_MAX = 64;
constexpr size_t IPS10_PASSWORD_MAX = 128;

bool loadIps10ProvisionedWifi(char* ssid, size_t ssidLen, char* password, size_t passwordLen) {
    if (!ssid || !password || ssidLen == 0 || passwordLen == 0) return false;
    ssid[0] = '\0';
    password[0] = '\0';

    Preferences prefs;
    if (!prefs.begin(IPS10_WIFI_PREFS_NS, true)) return false;
    size_t ssidBytes = prefs.getString(IPS10_WIFI_PREFS_SSID, ssid, ssidLen);
    size_t passwordBytes = prefs.getString(IPS10_WIFI_PREFS_PASSWORD, password, passwordLen);
    prefs.end();

    ssid[ssidLen - 1] = '\0';
    password[passwordLen - 1] = '\0';
    return ssidBytes > 0 && passwordBytes > 0 && ssid[0] != '\0' && password[0] != '\0';
}

void saveIps10ProvisionedWifi(const char* ssid, const char* password) {
    if (!ssid || !password || ssid[0] == '\0' || password[0] == '\0') return;

    Preferences prefs;
    if (!prefs.begin(IPS10_WIFI_PREFS_NS, false)) {
        Serial.println("[WiFi] IPS10 credential save failed: Preferences open failed");
        return;
    }
    prefs.putString(IPS10_WIFI_PREFS_SSID, ssid);
    prefs.putString(IPS10_WIFI_PREFS_PASSWORD, password);
    prefs.end();
}
}  // namespace
#endif

namespace Net {

void wifiInit() {
    WiFi.mode(WIFI_STA);
    // Disable modem power-save: with PS on, classic ESP32 WiFi stalls periodically
    // (TCP connect timeouts, resets, WS drops within seconds of connecting).
    WiFi.setSleep(false);

    // Non-blocking portal mode: if no saved credentials, starts AP
    // but returns immediately so serial can still work
    wm.setConfigPortalBlocking(false);
    wm.setConnectTimeout(8);
    wm.setConfigPortalTimeout(0);  // Portal stays open until configured
    wm.setTitle("AgentDeck");

#if defined(BOARD_IPS10)
    // IPS10 (ESP32-P4 + ESP32-C6 via ESP-Hosted) is serial-attached. A continuously
    // broadcasting SoftAP config portal adds power draw + co-processor WiFi activity
    // that can cause intermittent resets (no panic — looks like a brownout). So never
    // start the portal here: connect to saved creds if present, otherwise turn the
    // radio OFF. WiFi can still be provisioned later via the daemon (wifiConnectWith).
    wm.setEnableConfigPortal(false);   // never start the SoftAP portal on IPS10
    // Cold-path stack buffers: bounded to WiFi SSID/password limits and discarded
    // before the render loop. Avoid Arduino String heap churn on IPS10 boot.
    char savedSsid[IPS10_SSID_MAX] = {0};
    char savedPassword[IPS10_PASSWORD_MAX] = {0};
    if (loadIps10ProvisionedWifi(savedSsid, sizeof(savedSsid), savedPassword, sizeof(savedPassword))) {
        Serial.printf("[WiFi] IPS10 saved daemon credentials found: SSID=%s\n", savedSsid);
        if (wifiConnectWith(savedSsid, savedPassword)) {
            return;
        }
        Serial.println("[WiFi] IPS10 saved daemon credentials failed; trying WiFiManager storage");
    }
    if (wm.autoConnect()) {            // tries saved creds only; false if none/unreachable
        IPAddress ip = WiFi.localIP();
        snprintf(ipBuf, sizeof(ipBuf), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
        Serial.printf("[WiFi] Connected: %s\n", ipBuf);
        configTzTime("UTC", "pool.ntp.org", "time.google.com");
        Serial.println("[WiFi] NTP sync started (UTC)");
        wifiWasConnected = true;
        portalActive = false;
    } else {
        Serial.println("[WiFi] No saved creds — radio OFF (no AP portal; provision via daemon)");
        portalActive = false;
        WiFi.mode(WIFI_OFF);
    }
    return;
#endif

    // Try auto-connect with saved credentials
    if (wm.autoConnect(AP_SSID)) {
        IPAddress ip = WiFi.localIP();
        snprintf(ipBuf, sizeof(ipBuf), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
        Serial.printf("[WiFi] Connected: %s\n", ipBuf);
        // Sync NTP so time(nullptr) works for reset time parsing
        configTzTime("UTC", "pool.ntp.org", "time.google.com");
        Serial.println("[WiFi] NTP sync started (UTC)");
        wifiWasConnected = true;
        portalActive = false;
    } else {
        Serial.printf("[WiFi] No saved credentials — AP portal active: %s\n", AP_SSID);
        Serial.println("[WiFi] Connect to AP and visit 192.168.4.1 to configure");
        portalActive = true;
    }
}

void wifiLoop() {
    if (portalActive) {
        wm.process();

        // Check if user configured WiFi via portal
        if (WiFi.isConnected() && !wifiWasConnected) {
            IPAddress ip = WiFi.localIP();
            snprintf(ipBuf, sizeof(ipBuf), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
            Serial.printf("[WiFi] Connected via portal: %s\n", ipBuf);
            configTzTime("UTC", "pool.ntp.org", "time.google.com");
            Serial.println("[WiFi] NTP sync started (UTC)");
            wifiWasConnected = true;
            portalActive = false;
        }
    }
}

bool wifiConnected() {
    return WiFi.isConnected();
}

bool wifiConfigured() {
    if (WiFi.SSID().length() > 0) return true;
#if defined(BOARD_IPS10)
    char savedSsid[IPS10_SSID_MAX] = {0};
    char savedPassword[IPS10_PASSWORD_MAX] = {0};
    return loadIps10ProvisionedWifi(savedSsid, sizeof(savedSsid), savedPassword, sizeof(savedPassword));
#else
    return false;
#endif
}

void wifiSetRadioParked(bool parked) {
    if (parked) {
        WiFi.mode(WIFI_OFF);
    } else {
        WiFi.mode(WIFI_STA);
        WiFi.setSleep(false);
        WiFi.reconnect();
    }
}

bool wifiConnectWith(const char* ssid, const char* password) {
    Serial.printf("[WiFi] Connecting to %s...\n", ssid);

    // IPS10 may have turned the hosted C6 radio fully off when no saved creds
    // existed at boot. Re-enter STA mode explicitly before a daemon provision.
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);

    // Disconnect from current network (if any)
    WiFi.disconnect(false);
    delay(100);

    // Daemon provisioning must survive restart/OTA; WiFi.begin only writes
    // credentials to flash when persistent mode is enabled.
    WiFi.persistent(true);
    WiFi.begin(ssid, password);

    // Wait up to 10 seconds for connection
    uint32_t start = millis();
    while (!WiFi.isConnected() && (millis() - start < 10000)) {
        delay(250);
    }

    if (WiFi.isConnected()) {
        IPAddress ip = WiFi.localIP();
        snprintf(ipBuf, sizeof(ipBuf), "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
        Serial.printf("[WiFi] Connected via provision: %s\n", ipBuf);
        // Start NTP
        configTzTime("UTC", "pool.ntp.org", "time.google.com");
        Serial.println("[WiFi] NTP sync started (UTC)");
        wifiWasConnected = true;
        portalActive = false;
#if defined(BOARD_IPS10)
        saveIps10ProvisionedWifi(ssid, password);
#endif
        return true;
    }

    Serial.printf("[WiFi] Failed to connect to %s\n", ssid);
    return false;
}

void wifiSaveProvisionedBridge(const char* ip, uint16_t port, const char* token) {
#if defined(BOARD_IPS10)
    if (!ip || ip[0] == '\0' || port == 0) return;

    Preferences prefs;
    if (!prefs.begin(IPS10_WIFI_PREFS_NS, false)) {
        Serial.println("[WiFi] IPS10 bridge endpoint save failed: Preferences open failed");
        return;
    }
    prefs.putString(IPS10_WIFI_PREFS_BRIDGE_IP, ip);
    prefs.putUShort(IPS10_WIFI_PREFS_BRIDGE_PORT, port);
    prefs.putString(IPS10_WIFI_PREFS_BRIDGE_TOKEN, token ? token : "");
    prefs.end();
#else
    (void)ip;
    (void)port;
    (void)token;
#endif
}

bool wifiLoadProvisionedBridge(char* ip, size_t ipLen, uint16_t* port, char* token, size_t tokenLen) {
    if (!ip || !port || !token || ipLen == 0 || tokenLen == 0) return false;
    ip[0] = '\0';
    token[0] = '\0';
    *port = 0;

#if defined(BOARD_IPS10)
    Preferences prefs;
    if (!prefs.begin(IPS10_WIFI_PREFS_NS, true)) return false;
    size_t ipBytes = prefs.getString(IPS10_WIFI_PREFS_BRIDGE_IP, ip, ipLen);
    uint16_t savedPort = prefs.getUShort(IPS10_WIFI_PREFS_BRIDGE_PORT, 0);
    prefs.getString(IPS10_WIFI_PREFS_BRIDGE_TOKEN, token, tokenLen);
    prefs.end();

    ip[ipLen - 1] = '\0';
    token[tokenLen - 1] = '\0';
    *port = savedPort;
    return ipBytes > 0 && ip[0] != '\0' && savedPort != 0;
#else
    return false;
#endif
}

void wifiReset() {
    wm.resetSettings();
    ESP.restart();
}

const char* wifiLocalIP() {
    return ipBuf;
}

}  // namespace Net
