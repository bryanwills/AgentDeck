package dev.agentdeck.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mirrors shared/src/__tests__/session-utils.test.ts grouping cases. */
class SessionGroupingTest {

    @Test
    fun `normalize strips path and trailing #N suffix`() {
        assertEquals("AgentDeck", normalizeProjectForGrouping("/Users/x/github/AgentDeck"))
        assertEquals("AgentDeck", normalizeProjectForGrouping("AgentDeck #2"))
        assertEquals("foo-bar", normalizeProjectForGrouping("foo-bar-"))
        assertEquals("", normalizeProjectForGrouping(null))
        assertEquals("", normalizeProjectForGrouping("  "))
    }

    @Test
    fun `exact match groups`() {
        assertEquals("AgentDeck", projectGroupKey("AgentDeck", "agentdeck"))
    }

    @Test
    fun `long multi-token stems fuse`() {
        assertEquals(
            "xteink-x3-x4-japanese-broken",
            projectGroupKey("xteink-x3-x4-japanese-broken-claude-glm", "xteink-x3-x4-japanese-broken-codex"),
        )
    }

    @Test
    fun `delimiter extension fuses`() {
        assertEquals(
            "claude-agents-md-check",
            projectGroupKey("claude-agents-md-check", "claude-agents-md-check-2"),
        )
    }

    @Test
    fun `short siblings stay separate`() {
        assertNull(projectGroupKey("agentdeck-ios", "agentdeck-android"))
        assertNull(projectGroupKey("AgentDeck", "BabelForge"))
        assertNull(projectGroupKey("verylongprojectname-a", "verylongprojectname-b"))
    }

    @Test
    fun `clusters same-stem worktrees and keeps singletons flat`() {
        val items = listOf(
            "AgentDeck",
            "xteink-x3-x4-japanese-broken-claude-glm",
            "BabelForge",
            "xteink-x3-x4-japanese-broken-codex",
            "xteink-x3-x4-japanese-broken-opencode",
        )
        val groups = groupSessionsByProject(items) { it }
        assertEquals(listOf("AgentDeck", "xteink-x3-x4-japanese-broken", "BabelForge"), groups.map { it.key })
        assertTrue(groups[1].grouped)
        assertEquals(3, groups[1].members.size)
        assertFalse(groups[0].grouped)
    }

    @Test
    fun `groups duplicate #N sessions of the same project`() {
        val items = listOf("AgentDeck #1", "BabelForge", "AgentDeck #2")
        val groups = groupSessionsByProject(items) { it }
        assertEquals(listOf("AgentDeck", "BabelForge"), groups.map { it.key })
        assertEquals(2, groups[0].members.size)
    }
}
