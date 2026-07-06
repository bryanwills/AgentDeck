#pragma once
#include <stddef.h>
#include <stdint.h>

namespace Net {

/**
 * Initialize WiFi.
 * Tries saved credentials first (8s timeout).
 * If no saved WiFi, starts AP portal "AgentDeck-Setup" (non-blocking).
 * Serial JSON connection works regardless of WiFi state.
 */
void wifiInit();

/**
 * Process WiFiManager portal (call from network loop if portal active).
 */
void wifiLoop();

/**
 * Check WiFi connection status.
 */
bool wifiConnected();

/**
 * Check whether this board has saved WiFi credentials.
 */
bool wifiConfigured();

/**
 * Connect to a specific WiFi network using provided credentials.
 * Saves credentials to WiFiManager for future auto-connect.
 * Blocks up to 10 seconds waiting for connection.
 * Returns true on success.
 */
bool wifiConnectWith(const char* ssid, const char* password);

/**
 * Persist daemon-provisioned WiFi credentials without changing radio state.
 * Used by IPS10 when USB serial is primary and the hosted WiFi radio is parked.
 */
void wifiSaveProvisionedCredentials(const char* ssid, const char* password);

/**
 * Store/load a daemon bridge endpoint learned during serial WiFi provisioning.
 * On IPS10 this lets a WiFi-only boot connect directly without waiting for mDNS.
 */
void wifiSaveProvisionedBridge(const char* ip, uint16_t port, const char* token);
bool wifiLoadProvisionedBridge(char* ip, size_t ipLen, uint16_t* port, char* token, size_t tokenLen);

/**
 * True when firmware intentionally powered WiFi down because another transport
 * is primary. Distinguishes "offline by design" from connection loss.
 */
bool wifiRadioParked();

/**
 * Reset saved WiFi credentials and restart AP portal.
 */
void wifiReset();

/**
 * Get local IP address as string.
 */
const char* wifiLocalIP();

/**
 * Park (true) or restore (false) the WiFi radio. Parking powers the radio off
 * (WIFI_OFF); restoring re-enters STA and reconnects to the saved AP. Used on
 * classic ESP32 (TTGO) to eliminate WiFi RF noise coupling into the SPI display
 * while USB serial is the active transport.
 */
void wifiSetRadioParked(bool parked);

}  // namespace Net
