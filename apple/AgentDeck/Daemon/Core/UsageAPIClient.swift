#if os(macOS)
// UsageAPIClient.swift — OAuth token management + API usage fetch
// Ported from bridge/src/usage-api.ts

import Foundation

struct ApiUsageData: Sendable {
    var fiveHourPercent: Double?
    var fiveHourResetsAt: String?
    var sevenDayPercent: Double?
    var sevenDayResetsAt: String?
    var extraUsageEnabled: Bool = false
    var extraUsageMonthlyLimit: Double?
    var extraUsageUsedCredits: Double?
    var extraUsageUtilization: Double?
    var inferredBillingType: String?  // "subscription" | "api" | nil
}

struct CodexAuthStatus: Sendable {
    var authMode: String?
    var webAuthConnected: Bool = false
    var planType: String?
    var accountId: String?
    var subscriptionActiveUntil: String?
    var lastRefreshAt: String?
}

enum TokenStatus: String, Sendable {
    case valid, expired, missing, unknown
}

/// Fetches API usage from Anthropic OAuth endpoint, with caching and backoff.
final class UsageAPIClient: Sendable {
    static let shared = UsageAPIClient()

    private static let usageAPIURL = "https://api.anthropic.com/api/oauth/usage"
    private static let keychainService = "Claude Code-credentials"
    private static let cacheFile = AuthManager.agentDeckDir.appendingPathComponent("usage-cache.json")
    private static let fileCacheTTL: TimeInterval = 120  // seconds
    private static let tokenExpiryMargin: TimeInterval = 600  // 10 minutes

    nonisolated(unsafe) private var consecutiveFailures = 0
    nonisolated(unsafe) private var lastTokenStatus: TokenStatus = .unknown
    nonisolated(unsafe) private var lastBackoffStart: Date = .distantPast

    var tokenStatus: TokenStatus { lastTokenStatus }
    var codexAuthStatus: CodexAuthStatus? { readCodexAuthStatus() }

    // MARK: - Fetch

    func fetchUsage() async -> ApiUsageData? {
        // Check file cache first
        if let cached = readFileCache() {
            let age = Date().timeIntervalSince1970 - cached.fetchedAt
            if age < Self.fileCacheTTL {
                DaemonLogger.shared.debug("UsageAPI", "File cache hit (age \(Int(age))s)")
                return cached.data
            }
            DaemonLogger.shared.debug("UsageAPI", "File cache stale (age \(Int(age))s)")
        }

        // Check backoff
        if consecutiveFailures > 0 {
            let backoff = getBackoffSeconds()
            if backoff > 0 {
                DaemonLogger.shared.debug("UsageAPI", "Backoff active (\(consecutiveFailures) failures, \(Int(backoff))s remaining)")
                return nil
            }
        }

        // Get OAuth token from Keychain
        guard let token = getOAuthToken() else {
            lastTokenStatus = .missing
            DaemonLogger.shared.debug("UsageAPI", "OAuth token missing (keychain lookup failed)")
            return nil
        }

        // Check token expiry
        if let creds = getOAuthCredentials(), let expiresAt = creds.expiresAt {
            if Date().timeIntervalSince1970 > (Double(expiresAt) / 1000.0 - Self.tokenExpiryMargin) {
                lastTokenStatus = .expired
                DaemonLogger.shared.debug("UsageAPI", "OAuth token expired")
                return nil
            }
        }

        // Fetch from API
        guard let apiURL = URL(string: Self.usageAPIURL) else { return nil }
        var request = URLRequest(url: apiURL)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("oauth-2025-04-20", forHTTPHeaderField: "anthropic-beta")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 10

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return nil }

            if http.statusCode == 200,
               let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                lastTokenStatus = .valid
                consecutiveFailures = 0

                let usage = parseUsageResponse(json)
                writeFileCache(usage)
                DaemonLogger.shared.debug("UsageAPI", "API fetch OK: 5h=\(usage.fiveHourPercent ?? -1)% 7d=\(usage.sevenDayPercent ?? -1)%")
                return usage
            } else if http.statusCode == 429 {
                // Rate limited — respect Retry-After header
                consecutiveFailures += 1
                lastBackoffStart = Date()
                if let retryAfter = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After"),
                   let retrySec = Int(retryAfter), retrySec > 0 {
                    // Push file cache fetchedAt forward so TTL covers Retry-After
                    if let cached = readFileCache() {
                        let syntheticCache = CacheFile(
                            data: CacheFile.CodableUsage(
                                fiveHourPercent: cached.data.fiveHourPercent,
                                fiveHourResetsAt: cached.data.fiveHourResetsAt,
                                sevenDayPercent: cached.data.sevenDayPercent,
                                sevenDayResetsAt: cached.data.sevenDayResetsAt,
                                extraUsageEnabled: cached.data.extraUsageEnabled,
                                extraUsageMonthlyLimit: cached.data.extraUsageMonthlyLimit,
                                extraUsageUsedCredits: cached.data.extraUsageUsedCredits,
                                extraUsageUtilization: cached.data.extraUsageUtilization
                            ),
                            fetchedAt: Date().timeIntervalSince1970 + Double(retrySec) - Self.fileCacheTTL
                        )
                        if let cacheData = try? JSONEncoder().encode(syntheticCache) {
                            try? cacheData.write(to: Self.cacheFile)
                        }
                    }
                    DaemonLogger.shared.debug("UsageAPI", "Rate limited (429), Retry-After: \(retrySec)s")
                }
                return nil
            } else {
                consecutiveFailures += 1
                lastBackoffStart = Date()
                if http.statusCode == 401 || http.statusCode == 403 { lastTokenStatus = .expired }
                DaemonLogger.shared.debug("UsageAPI", "API fetch failed: HTTP \(http.statusCode)")
                return nil
            }
        } catch {
            consecutiveFailures += 1
            lastBackoffStart = Date()
            DaemonLogger.shared.debug("UsageAPI", "API fetch error: \(error.localizedDescription)")
            return nil
        }
    }

    func hasOAuthToken() -> Bool {
        getOAuthToken() != nil
    }

    // MARK: - Keychain

    private struct OAuthCredentials {
        let accessToken: String
        var expiresAt: Int?
    }

    private func getOAuthCredentials() -> OAuthCredentials? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/security")
        process.arguments = ["find-generic-password", "-s", Self.keychainService, "-w"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { return nil }
            let raw = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard let data = raw.data(using: .utf8),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let oauth = json["claudeAiOauth"] as? [String: Any],
                  let token = oauth["accessToken"] as? String else { return nil }
            return OAuthCredentials(accessToken: token, expiresAt: oauth["expiresAt"] as? Int)
        } catch {
            return nil
        }
    }

    private func getOAuthToken() -> String? {
        getOAuthCredentials()?.accessToken
    }

    // MARK: - Codex Web Auth

    private func readCodexAuthStatus() -> CodexAuthStatus? {
        let realHome = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        let authFile = URL(fileURLWithPath: realHome).appendingPathComponent(".codex/auth.json")
        guard let data = try? Data(contentsOf: authFile),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        let tokens = json["tokens"] as? [String: Any]
        let accessPayload = decodeJWT(string(tokens, key: "access_token"))
        let idPayload = decodeJWT(string(tokens, key: "id_token"))
        let authMode = string(json, key: "auth_mode")

        return CodexAuthStatus(
            authMode: authMode,
            webAuthConnected: authMode == "chatgpt" && string(tokens, key: "access_token") != nil,
            planType: firstString([
                string(json, key: "chatgpt_plan_type"),
                string(accessPayload, key: "chatgpt_plan_type"),
                string(idPayload, key: "chatgpt_plan_type"),
                string(accessPayload, key: "plan_type"),
                string(idPayload, key: "plan_type"),
            ]),
            accountId: firstString([
                string(json, key: "chatgpt_account_id"),
                string(accessPayload, key: "chatgpt_account_id"),
                string(idPayload, key: "chatgpt_account_id"),
                string(accessPayload, key: "account_id"),
                string(idPayload, key: "account_id"),
                string(json, key: "account_id"),
            ]),
            subscriptionActiveUntil: firstString([
                string(json, key: "chatgpt_subscription_active_until"),
                string(accessPayload, key: "chatgpt_subscription_active_until"),
                string(idPayload, key: "chatgpt_subscription_active_until"),
                string(accessPayload, key: "subscription_active_until"),
                string(idPayload, key: "subscription_active_until"),
            ]),
            lastRefreshAt: string(json, key: "last_refresh")
        )
    }

    private func decodeJWT(_ token: String?) -> [String: Any]? {
        guard let token else { return nil }
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var payload = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = payload.count % 4
        if remainder > 0 {
            payload += String(repeating: "=", count: 4 - remainder)
        }
        guard let data = Data(base64Encoded: payload),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return json
    }

    private func string(_ dict: [String: Any]?, key: String) -> String? {
        guard let raw = dict?[key] as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func firstString(_ values: [String?]) -> String? {
        values.first(where: { $0?.isEmpty == false }) ?? nil
    }

    // MARK: - File Cache

    private struct CacheFile: Codable {
        let data: CodableUsage
        let fetchedAt: Double

        struct CodableUsage: Codable {
            var fiveHourPercent: Double?
            var fiveHourResetsAt: String?
            var sevenDayPercent: Double?
            var sevenDayResetsAt: String?
            var extraUsageEnabled: Bool?
            var extraUsageMonthlyLimit: Double?
            var extraUsageUsedCredits: Double?
            var extraUsageUtilization: Double?
        }
    }

    private func readFileCache() -> (data: ApiUsageData, fetchedAt: Double)? {
        guard let data = try? Data(contentsOf: Self.cacheFile),
              let cache = try? JSONDecoder().decode(CacheFile.self, from: data) else { return nil }
        // Auto-detect ms vs s: Node.js bridge writes Date.now() (ms), Swift writes timeIntervalSince1970 (s)
        let fetchedAt = cache.fetchedAt > 1e12 ? cache.fetchedAt / 1000.0 : cache.fetchedAt
        let usage = ApiUsageData(
            fiveHourPercent: cache.data.fiveHourPercent,
            fiveHourResetsAt: cache.data.fiveHourResetsAt,
            sevenDayPercent: cache.data.sevenDayPercent,
            sevenDayResetsAt: cache.data.sevenDayResetsAt,
            extraUsageEnabled: cache.data.extraUsageEnabled ?? false,
            extraUsageMonthlyLimit: cache.data.extraUsageMonthlyLimit,
            extraUsageUsedCredits: cache.data.extraUsageUsedCredits,
            extraUsageUtilization: cache.data.extraUsageUtilization
        )
        return (usage, fetchedAt)
    }

    private func writeFileCache(_ usage: ApiUsageData) {
        let cache = CacheFile(
            data: CacheFile.CodableUsage(
                fiveHourPercent: usage.fiveHourPercent,
                fiveHourResetsAt: usage.fiveHourResetsAt,
                sevenDayPercent: usage.sevenDayPercent,
                sevenDayResetsAt: usage.sevenDayResetsAt,
                extraUsageEnabled: usage.extraUsageEnabled,
                extraUsageMonthlyLimit: usage.extraUsageMonthlyLimit,
                extraUsageUsedCredits: usage.extraUsageUsedCredits,
                extraUsageUtilization: usage.extraUsageUtilization
            ),
            fetchedAt: Date().timeIntervalSince1970
        )
        if let data = try? JSONEncoder().encode(cache) {
            try? data.write(to: Self.cacheFile)
        }
    }

    // MARK: - Parse Response

    private func parseUsageResponse(_ json: [String: Any]) -> ApiUsageData {
        var usage = ApiUsageData()

        func getDouble(_ val: Any?) -> Double? {
            if let d = val as? Double { return d }
            if let i = val as? Int { return Double(i) }
            return nil
        }

        func getUtilization(_ obj: Any?) -> Double? {
            if let val = getDouble(obj) { return val }
            guard let dict = obj as? [String: Any] else { return nil }
            return getDouble(dict["utilization"]) ?? getDouble(dict["percentUsed"]) ?? getDouble(dict["percentage"]) ?? getDouble(dict["percent"]) ?? getDouble(dict["usage"])
        }

        func getResetsAt(_ obj: Any?) -> String? {
            guard let dict = obj as? [String: Any] else { return nil }
            return (dict["resets_at"] as? String) ?? (dict["resetsAt"] as? String) ?? (dict["reset_at"] as? String) ?? (dict["expires_at"] as? String)
        }

        // 1. Five Hour
        let fiveHour = json["five_hour"] ?? json["fiveHour"] ?? (json["rateLimits"] as? [String: Any])?["fiveHour"]
        usage.fiveHourPercent = getUtilization(fiveHour)
        usage.fiveHourResetsAt = getResetsAt(fiveHour)

        // 2. Seven Day
        let sevenDay = json["seven_day"] ?? json["sevenDay"] ?? (json["rateLimits"] as? [String: Any])?["sevenDay"]
        usage.sevenDayPercent = getUtilization(sevenDay)
        usage.sevenDayResetsAt = getResetsAt(sevenDay)

        // 3. Extra Usage
        let extra = json["extra_usage"] ?? json["extraUsage"]
        if let extraDict = extra as? [String: Any] {
            usage.extraUsageEnabled = (extraDict["is_enabled"] as? Bool) ?? (extraDict["enabled"] as? Bool) ?? false
            usage.extraUsageMonthlyLimit = getDouble(extraDict["monthly_limit"]) ?? getDouble(extraDict["monthlyLimit"])
            usage.extraUsageUsedCredits = getDouble(extraDict["used_credits"]) ?? getDouble(extraDict["usedCredits"])
            usage.extraUsageUtilization = getUtilization(extra)
        }

        usage.inferredBillingType = usage.fiveHourPercent != nil ? "subscription" : "api"
        return usage
    }

    // MARK: - Backoff

    private func getBackoffSeconds() -> TimeInterval {
        guard consecutiveFailures > 0 else { return 0 }
        let intervals: [TimeInterval] = [45, 90, 180, 300]
        let backoff = intervals[min(consecutiveFailures - 1, intervals.count - 1)]
        let elapsed = Date().timeIntervalSince(lastBackoffStart)
        return max(0, backoff - elapsed)
    }
}
#endif
