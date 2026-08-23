#include "mdns_discovery.h"
#include <ESPmDNS.h>
#include "config.h"
#include <cstdio>
#include <cstring>

static Net::BridgeInfo discovered;
static bool hasNew = false;
static uint32_t lastQueryMs = 0;
constexpr uint32_t QUERY_INTERVAL_MS = 5000;

namespace Net {

void mdnsInit() {
    if (!MDNS.begin("agentdeck-display")) {
        Serial.println("[mDNS] Failed to start");
        return;
    }
    Serial.println("[mDNS] Started, browsing for _agentdeck._tcp");
    memset(&discovered, 0, sizeof(discovered));
}

/**
 * True when a dotted-quad string is an address a board could actually reach.
 *
 * Deliberately conservative: it must PARSE as four octets and must not be
 * link-local (169.254/16), loopback (127/8) or 0.0.0.0. Anything it cannot
 * confirm it rejects, so a malformed TXT value can never displace a working
 * A-record answer.
 */
static bool isRoutableIpv4Literal(const char* s) {
    if (!s || !s[0]) return false;
    int octets[4];
    char extra;
    if (sscanf(s, "%d.%d.%d.%d%c", &octets[0], &octets[1], &octets[2], &octets[3], &extra) != 4) {
        return false;
    }
    for (int i = 0; i < 4; i++) {
        if (octets[i] < 0 || octets[i] > 255) return false;
    }
    if (octets[0] == 169 && octets[1] == 254) return false;  // APIPA
    if (octets[0] == 127) return false;                      // loopback
    if (octets[0] == 0) return false;
    return true;
}

bool mdnsPoll(BridgeInfo& out) {
    uint32_t now = millis();
    if (now - lastQueryMs < QUERY_INTERVAL_MS) {
        if (hasNew) {
            out = discovered;
            hasNew = false;
            return true;
        }
        return false;
    }
    lastQueryMs = now;

    int n = MDNS.queryService("_agentdeck", "_tcp");
    if (n <= 0) return false;

    // Prefer daemon bridge for consistent state (daemon aggregates all sessions)
    int daemonIdx = -1;
    int firstIdx = -1;

    for (int i = 0; i < n; i++) {
        uint16_t port = MDNS.port(i);
        if (port == 0) continue;
        if (firstIdx < 0) firstIdx = i;

        // Check agent TXT record for daemon type
        int numKeys = MDNS.numTxt(i);
        for (int k = 0; k < numKeys; k++) {
            if (MDNS.txtKey(i, k) == "agent" && MDNS.txt(i, k) == "daemon") {
                daemonIdx = i;
                break;
            }
        }
        if (daemonIdx >= 0) break;
    }

    int selected = (daemonIdx >= 0) ? daemonIdx : firstIdx;
    if (selected < 0) return false;

    {
#include <esp_idf_version.h>
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
        IPAddress ip = MDNS.address(selected);  // ESP-IDF 5.x (pioarduino / Arduino v3)
#else
        IPAddress ip = MDNS.IP(selected);       // ESP-IDF 4.4 (Arduino v2)
#endif
        snprintf(discovered.ip, sizeof(discovered.ip),
                 "%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3]);
        discovered.port = MDNS.port(selected);
        discovered.found = true;

        // Parse TXT records
        char txtIp[sizeof(discovered.ip)] = {0};
        int numKeys = MDNS.numTxt(selected);
        for (int k = 0; k < numKeys; k++) {
            String key = MDNS.txtKey(selected, k);
            String val = MDNS.txt(selected, k);
            if (key == "token") {
                strncpy(discovered.token, val.c_str(), sizeof(discovered.token) - 1);
            } else if (key == "project") {
                strncpy(discovered.project, val.c_str(), sizeof(discovered.project) - 1);
            } else if (key == "agent") {
                strncpy(discovered.agent, val.c_str(), sizeof(discovered.agent) - 1);
            } else if (key == "ip") {
                strncpy(txtIp, val.c_str(), sizeof(txtIp) - 1);
            }
        }

        // The daemon states, in TXT `ip`, the ONE address it believes it is
        // reachable at (its default-route LAN IP). Prefer it over the resolved
        // A record.
        //
        // A host publishes an A record per interface and the resolver hands
        // back whichever it cached — including addresses the daemon never
        // meant as an endpoint. On 2026-08-22 a board here resolved
        // `169.254.124.88` from a Mac whose daemon was on 192.168.68.x, dialed
        // it at max backoff, and reached nothing; because it never reached the
        // daemon, the daemon logged nothing, so the board looked simply absent.
        // The correct address was in the same record the whole time.
        //
        // Only override with something that parses as a routable IPv4 — an
        // unparseable or link-local TXT value means "no information", not
        // "use this", and must leave the A-record answer standing.
        if (txtIp[0] != '\0' && isRoutableIpv4Literal(txtIp)) {
            strncpy(discovered.ip, txtIp, sizeof(discovered.ip) - 1);
            discovered.ip[sizeof(discovered.ip) - 1] = '\0';
        }

        Serial.printf("[mDNS] Found bridge: %s:%d agent=%s project=%s\n",
                       discovered.ip, discovered.port, discovered.agent, discovered.project);
        hasNew = true;
        out = discovered;
        return true;
    }
    return false;
}

void mdnsRefresh() {
    lastQueryMs = 0;  // Force next poll to query immediately
}

}  // namespace Net
