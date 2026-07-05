package dev.agentdeck.util

/**
 * Project-prefix session grouping — Kotlin mirror of
 * `shared/src/session-utils.ts` (`normalizeProjectForGrouping` /
 * `projectGroupKey` / `groupSessionsByProject`), itself a port of the IPS10
 * terrarium huddle builder (esp32/src/ui/terrarium/office.cpp
 * `normProject` / `sameProjectGroup`). Keep the three in lockstep.
 *
 * Sessions whose project names share a long delimiter-aligned prefix
 * (worktree/task folders like `xteink-x3-x4-japanese-broken-claude-glm` /
 * `…-broken-codex`) cluster into one work group; short siblings like
 * `agentdeck-ios` / `agentdeck-android` stay separate.
 */

private fun isProjectDelim(c: Char): Boolean =
    c == '-' || c == '_' || c == ' ' || c == '.'

private fun trimProjectTail(s: String): String {
    var n = s.length
    while (n > 0 && (isProjectDelim(s[n - 1]) || s[n - 1] == '#')) n--
    return s.substring(0, n)
}

private fun projectDelimCount(s: String, len: Int): Int {
    var count = 0
    for (i in 0 until minOf(len, s.length)) if (isProjectDelim(s[i])) count++
    return count
}

/** Basename + strip trailing " #N" duplicate suffix. */
fun normalizeProjectForGrouping(project: String?): String {
    val raw = project?.trim().orEmpty()
    val base = raw.split('/').lastOrNull { it.isNotEmpty() } ?: raw
    val m = Regex("""^(.*?)\s*#\d+$""").find(base)
    return trimProjectTail(m?.groupValues?.get(1) ?: base)
}

/** Shared group key (common stem) when [a] and [b] belong to the same work
 *  group, else null. Conservative: stem >= 14 chars with >= 2 delimiters on
 *  both sides, or an exact case-insensitive match. */
fun projectGroupKey(a: String, b: String): String? {
    var i = 0
    var lastDelim = -1
    val n = minOf(a.length, b.length)
    while (i < n && a[i].lowercaseChar() == b[i].lowercaseChar()) {
        if (isProjectDelim(a[i])) lastDelim = i
        i++
    }
    if (i == a.length && i == b.length) return a

    val stemLen = when {
        i == a.length && i < b.length && isProjectDelim(b[i]) -> i
        i == b.length && i < a.length && isProjectDelim(a[i]) -> i
        lastDelim > 0 -> lastDelim
        else -> -1
    }
    if (stemLen < 14 || projectDelimCount(a, stemLen) < 2 || projectDelimCount(b, stemLen) < 2) {
        return null
    }
    val key = trimProjectTail(a.substring(0, stemLen))
    return key.ifEmpty { null }
}

data class ProjectGroup<T>(
    /** Group label — shared stem, or the normalized project name for singletons. */
    val key: String,
    /** True when >= 2 members fused (render a group header); singletons render flat. */
    val grouped: Boolean,
    val members: List<T>,
)

/** Cluster an ordered list into project groups, preserving input order. */
fun <T> groupSessionsByProject(items: List<T>, projectOf: (T) -> String?): List<ProjectGroup<T>> {
    val groups = mutableListOf<ProjectGroup<T>>()
    val done = BooleanArray(items.size)
    for (a in items.indices) {
        if (done[a]) continue
        val na = normalizeProjectForGrouping(projectOf(items[a]))
        var key = na
        val members = mutableListOf(items[a])
        done[a] = true
        for (b in a + 1 until items.size) {
            if (done[b]) continue
            val nb = normalizeProjectForGrouping(projectOf(items[b]))
            val nextKey = projectGroupKey(key, nb) ?: projectGroupKey(na, nb)
            if (nextKey != null) {
                key = nextKey
                members.add(items[b])
                done[b] = true
            }
        }
        groups.add(ProjectGroup(key = key, grouped = members.size > 1, members = members))
    }
    return groups
}
