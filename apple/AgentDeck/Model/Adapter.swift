// Adapter.swift — Agent type & capabilities
// Ported from shared/src/adapter.ts

import Foundation

// MARK: - Agent Type

enum AgentType: String, Codable, Sendable {
    case claudeCode = "claude-code"
    case openclaw
    case codexCli = "codex-cli"
}

// MARK: - Agent Capabilities

struct AgentCapabilities: Codable, Sendable {
    let type: String
    let displayName: String
    let hasTerminal: Bool
    let hasModeSwitching: Bool
    let hasDiffReview: Bool
    let hasOptionLists: Bool
    let hasNavigablePrompts: Bool
    let hasSuggestedPrompts: Bool
    let hasApiUsage: Bool
    var hasModelCatalog: Bool?
}

// MARK: - Capability Constants

extension AgentCapabilities {
    static let claudeCode = AgentCapabilities(
        type: "claude-code",
        displayName: "Claude Code",
        hasTerminal: true,
        hasModeSwitching: true,
        hasDiffReview: true,
        hasOptionLists: true,
        hasNavigablePrompts: true,
        hasSuggestedPrompts: true,
        hasApiUsage: true,
        hasModelCatalog: false
    )

    static let openclaw = AgentCapabilities(
        type: "openclaw",
        displayName: "OpenClaw",
        hasTerminal: false,
        hasModeSwitching: false,
        hasDiffReview: false,
        hasOptionLists: true,
        hasNavigablePrompts: false,
        hasSuggestedPrompts: false,
        hasApiUsage: false,
        hasModelCatalog: true
    )
}

// MARK: - Constants

let openclawGatewayPort = 18789
