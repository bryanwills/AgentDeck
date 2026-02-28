package dev.agentdeck.ui.screen

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.agentdeck.data.DisplayPreferences
import dev.agentdeck.net.AgentState
import dev.agentdeck.net.BridgeConnection
import dev.agentdeck.net.BridgeDiscovery
import dev.agentdeck.net.ConnectionStatus
import dev.agentdeck.net.DiscoveredBridge
import dev.agentdeck.state.AgentStateHolder
import dev.agentdeck.state.SessionMetrics
import dev.agentdeck.state.TimelineStore
import dev.agentdeck.ui.eink.EinkActionColumn
import dev.agentdeck.ui.eink.EinkAgentColumn
import dev.agentdeck.ui.eink.EinkEngineColumn
import dev.agentdeck.ui.eink.EinkFooterBar
import dev.agentdeck.ui.eink.EinkSettingsOverlay
import dev.agentdeck.ui.eink.EinkTimelinePanel
import dev.agentdeck.ui.eink.EinkUsageCompact
import dev.agentdeck.ui.eink.compactStateMarker
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

private const val SAVED_URL_TIMEOUT_MS = 8_000L

@Composable
fun EinkMonitorScreen(
    stateHolder: AgentStateHolder,
    connection: BridgeConnection,
    displayPrefs: DisplayPreferences,
) {
    val state by stateHolder.state.collectAsState()
    val connectionStatus by connection.status.collectAsState()
    val timelineEntries by TimelineStore.instance.entries.collectAsState()
    val metrics by SessionMetrics.instance.metrics.collectAsState()
    var showSettings by remember { mutableStateOf(false) }

    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val currentUrl by connection.url.collectAsState()

    // mDNS discovery — active while disconnected (url cleared)
    val discovery = remember { BridgeDiscovery(context) }
    var discoveredBridges by remember { mutableStateOf<List<DiscoveredBridge>>(emptyList()) }

    // Discovery + URL save — keyed on both status AND url
    // (disconnect() may clear url without changing status when already DISCONNECTED)
    LaunchedEffect(connectionStatus, currentUrl) {
        when {
            connectionStatus == ConnectionStatus.DISCONNECTED && currentUrl == null -> {
                // No active connection — run mDNS discovery
                discovery.discover().collect { bridges ->
                    discoveredBridges = bridges
                }
            }
            connectionStatus == ConnectionStatus.CONNECTED -> {
                discoveredBridges = emptyList()
                // Persist URL on successful connection
                currentUrl?.let { displayPrefs.setLastBridgeUrl(it) }
            }
            else -> {
                // CONNECTING or DISCONNECTED with url set (reconnecting)
                discoveredBridges = emptyList()
            }
        }
    }

    // Auto-connect: try saved URL on first launch with timeout fallback
    LaunchedEffect(Unit) {
        val savedUrl = displayPrefs.lastBridgeUrlFlow.first()
        if (savedUrl != null) {
            connection.autoConnect(savedUrl)
            // Give saved URL time to connect; if it fails, give up and let mDNS take over
            delay(SAVED_URL_TIMEOUT_MS)
            if (connection.status.value != ConnectionStatus.CONNECTED) {
                connection.disconnect() // clears url, stops reconnect loop
                displayPrefs.setLastBridgeUrl(null)
            }
        }
    }

    // NOTE: mDNS-discovered bridges are shown in the UI only (not auto-connected)
    // because LAN connections require an auth token. User can tap a bridge
    // in the not-connected screen or use Settings for manual URL entry.

    // Show not-connected screen when disconnected AND not actively reconnecting
    val showNotConnected = connectionStatus != ConnectionStatus.CONNECTED &&
        state.agentState == AgentState.DISCONNECTED

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        if (showNotConnected) {
            EinkNotConnectedScreen(
                connectionStatus = connectionStatus,
                discoveredBridges = discoveredBridges,
                onConnectToBridge = { bridge ->
                    connection.connect("ws://${bridge.host}:${bridge.port}")
                },
                onSettingsClick = { showSettings = true },
            )
        } else if (isLandscape) {
            // 3-column console layout
            Column(modifier = Modifier.fillMaxSize()) {
                Row(modifier = Modifier.weight(1f)) {
                    EinkAgentColumn(
                        state = state,
                        onSettingsClick = { showSettings = true },
                        modifier = Modifier
                            .weight(0.25f)
                            .fillMaxHeight(),
                    )
                    VerticalDivider(thickness = 2.dp, color = Color.Black)
                    EinkActionColumn(
                        state = state,
                        timelineEntries = timelineEntries,
                        onSelectOption = { index ->
                            connection.sendSelectOption(index)
                        },
                        modifier = Modifier
                            .weight(0.45f)
                            .fillMaxHeight(),
                    )
                    VerticalDivider(thickness = 2.dp, color = Color.Black)
                    EinkEngineColumn(
                        usage = state.usage,
                        modifier = Modifier
                            .weight(0.30f)
                            .fillMaxHeight(),
                    )
                }
                HorizontalDivider(thickness = 2.dp, color = Color.Black)
                EinkFooterBar(
                    metrics = metrics,
                    usage = state.usage,
                    isEink = true,
                )
            }
        } else {
            EinkPortraitLayout(
                state = state,
                timelineEntries = timelineEntries,
                metrics = metrics,
                onSettingsClick = { showSettings = true },
            )
        }

        if (showSettings) {
            EinkSettingsOverlay(
                connection = connection,
                displayPrefs = displayPrefs,
                discoveredBridges = discoveredBridges,
                onDismiss = { showSettings = false },
            )
        }
    }
}

@Composable
private fun EinkNotConnectedScreen(
    connectionStatus: ConnectionStatus,
    discoveredBridges: List<DiscoveredBridge>,
    onConnectToBridge: (DiscoveredBridge) -> Unit,
    onSettingsClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = when (connectionStatus) {
                ConnectionStatus.DISCONNECTED -> "\u25CB  Not Connected"
                ConnectionStatus.CONNECTING -> "\u25CC  Connecting..."
                ConnectionStatus.CONNECTED -> "\u25CF  Connected"
            },
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
        )

        Spacer(modifier = Modifier.height(24.dp))

        if (connectionStatus == ConnectionStatus.CONNECTING) {
            Text(
                text = "Trying to reach bridge...",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (connectionStatus == ConnectionStatus.DISCONNECTED) {
            Text(
                text = if (discoveredBridges.isNotEmpty()) "Found bridge on network"
                       else "Searching for AgentDeck bridge...",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(16.dp))

            if (discoveredBridges.isNotEmpty()) {
                discoveredBridges.forEach { bridge ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth(0.6f)
                            .clickable { onConnectToBridge(bridge) },
                        shape = RoundedCornerShape(4.dp),
                        border = BorderStroke(2.dp, Color.Black),
                        color = MaterialTheme.colorScheme.background,
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                text = "\u25CF ${bridge.name}",
                                style = MaterialTheme.typography.bodyLarge.copy(
                                    fontWeight = FontWeight.Bold,
                                ),
                                color = MaterialTheme.colorScheme.onSurface,
                            )
                            Text(
                                text = "${bridge.host}:${bridge.port}",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "\u2699 Settings",
            style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.clickable(onClick = onSettingsClick),
        )
    }
}

@Composable
private fun EinkPortraitLayout(
    state: dev.agentdeck.state.DashboardState,
    timelineEntries: List<dev.agentdeck.state.TimelineEntry>,
    metrics: dev.agentdeck.state.MetricsSnapshot,
    onSettingsClick: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        // Compact header: ~20% of screen
        EinkCompactHeader(
            agentState = state.agentState,
            projectName = state.projectName,
            modelName = state.modelName,
            currentTool = state.currentTool,
            toolProgress = state.toolProgress,
            usage = state.usage,
            onSettingsClick = onSettingsClick,
        )

        HorizontalDivider(thickness = 2.dp, color = Color.Black)

        // Timeline: ~75% of screen
        EinkTimelinePanel(
            entries = timelineEntries,
            modifier = Modifier.weight(1f),
        )

        // Compact footer
        HorizontalDivider(thickness = 1.dp, color = Color.Black)
        EinkFooterBar(
            metrics = metrics,
            usage = state.usage,
            isEink = true,
        )
    }
}

@Composable
private fun EinkCompactHeader(
    agentState: AgentState,
    projectName: String?,
    modelName: String?,
    currentTool: String?,
    toolProgress: String?,
    usage: dev.agentdeck.net.UsageUpdate,
    onSettingsClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        // Row 1: state marker + project + model + gear
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = compactStateMarker(agentState),
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (projectName != null) {
                Text(
                    text = projectName,
                    style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(modifier = Modifier.weight(1f))
            }
            if (modelName != null) {
                Text(
                    text = modelName,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = "\u2699",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable(onClick = onSettingsClick),
            )
        }

        // Tool info if processing
        if (currentTool != null && agentState == AgentState.PROCESSING) {
            Text(
                text = "> $currentTool" + (toolProgress?.let { " ($it)" } ?: ""),
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        // Row 2: compact usage
        EinkUsageCompact(usage = usage)
    }
}
