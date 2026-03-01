package dev.agentdeck.ui.monitor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.agentdeck.data.DisplayPreferences
import dev.agentdeck.net.AgentState
import dev.agentdeck.net.BridgeConnection
import dev.agentdeck.net.BridgeDiscovery
import dev.agentdeck.net.ConnectionStatus
import dev.agentdeck.net.DiscoveredBridge
import dev.agentdeck.state.AgentStateHolder
import dev.agentdeck.state.DashboardState
import dev.agentdeck.state.SessionMetrics
import dev.agentdeck.state.TimelineStore
import dev.agentdeck.terrarium.TerrariumColors
import dev.agentdeck.terrarium.TerrariumState
import dev.agentdeck.terrarium.creature.BubbleSystem
import dev.agentdeck.terrarium.creature.CrayfishCreature
import dev.agentdeck.terrarium.creature.DataParticleSystem
import dev.agentdeck.terrarium.creature.OctopusCreature
import dev.agentdeck.terrarium.environment.KelpField
import dev.agentdeck.terrarium.environment.RockFormation
import dev.agentdeck.terrarium.environment.WaterEffect
import dev.agentdeck.terrarium.layoutOctopuses
import dev.agentdeck.terrarium.layoutWorkerCrayfish
import dev.agentdeck.terrarium.renderer.ColorTerrariumCanvas
import dev.agentdeck.terrarium.toTerrariumState
import dev.agentdeck.ui.theme.AgentDeckColors

/**
 * Unified Dashboard screen — terrarium fills the background,
 * semi-transparent HUD panels overlay with agent info.
 * When disconnected, shows a connection overlay with USB + mDNS options.
 */
@Composable
fun MonitorScreen(
    stateHolder: AgentStateHolder,
    connection: BridgeConnection,
    displayPrefs: DisplayPreferences,
) {
    val dashState by stateHolder.state.collectAsState()
    val terrariumState = dashState.toTerrariumState()
    val timelineEntries by TimelineStore.instance.entries.collectAsState()
    val metrics by SessionMetrics.instance.metrics.collectAsState()

    val connectionStatus by connection.status.collectAsState()
    val currentUrl by connection.url.collectAsState()
    val lastError by connection.lastError.collectAsState()

    // mDNS discovery — active while disconnected
    val context = LocalContext.current
    val discovery = remember { BridgeDiscovery(context) }
    var discoveredBridges by remember { mutableStateOf<List<DiscoveredBridge>>(emptyList()) }

    LaunchedEffect(connectionStatus, currentUrl) {
        when {
            connectionStatus == ConnectionStatus.DISCONNECTED && currentUrl == null -> {
                discovery.discover().collect { bridges ->
                    discoveredBridges = bridges
                }
            }
            connectionStatus == ConnectionStatus.CONNECTED -> {
                discoveredBridges = emptyList()
            }
            else -> {
                discoveredBridges = emptyList()
            }
        }
    }

    val showDisconnected = connectionStatus != ConnectionStatus.CONNECTED &&
        dashState.agentState == AgentState.DISCONNECTED

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(TerrariumColors.DeepSea),
    ) {
        // Layer 1: Terrarium background (always renders)
        ColorTerrariumBackground(terrariumState)

        if (showDisconnected) {
            // Layer 2: Connection overlay when disconnected
            ConnectionOverlay(
                connectionStatus = connectionStatus,
                discoveredBridges = discoveredBridges,
                lastError = lastError,
                onConnectToBridge = { bridge ->
                    connection.connect(bridge.wsUrl())
                },
                onConnectLocalhost = {
                    connection.connect("ws://127.0.0.1:9120")
                },
            )
        } else {
            // Layer 2: HUD overlay panels
            MonitorHUD(
                dashState = dashState,
                timelineEntries = timelineEntries,
                metrics = metrics,
            )
        }
    }
}

/**
 * Semi-transparent connection overlay shown over the terrarium when disconnected.
 */
@Composable
private fun ConnectionOverlay(
    connectionStatus: ConnectionStatus,
    discoveredBridges: List<DiscoveredBridge>,
    lastError: String?,
    onConnectToBridge: (DiscoveredBridge) -> Unit,
    onConnectLocalhost: () -> Unit,
) {
    // Semi-transparent dark scrim
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xCC0F172A)),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 360.dp)
                .background(
                    color = Color(0xE61E293B),
                    shape = RoundedCornerShape(16.dp),
                )
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = when (connectionStatus) {
                    ConnectionStatus.DISCONNECTED -> "Not Connected"
                    ConnectionStatus.CONNECTING -> "Connecting..."
                    ConnectionStatus.CONNECTED -> "Connected"
                },
                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                color = AgentDeckColors.WhiteText,
                textAlign = TextAlign.Center,
            )

            Text(
                text = "Connect to an AgentDeck bridge to start monitoring",
                style = MaterialTheme.typography.bodyMedium,
                color = AgentDeckColors.SlateText,
                textAlign = TextAlign.Center,
            )

            // Error message
            if (lastError != null && connectionStatus == ConnectionStatus.DISCONNECTED) {
                Text(
                    text = lastError,
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = AgentDeckColors.Red,
                    textAlign = TextAlign.Center,
                )
            }

            if (connectionStatus == ConnectionStatus.CONNECTING) {
                Text(
                    text = "Trying to reach bridge...",
                    style = MaterialTheme.typography.bodyMedium,
                    color = AgentDeckColors.Amber,
                )
            }

            if (connectionStatus == ConnectionStatus.DISCONNECTED) {
                Spacer(modifier = Modifier.height(4.dp))

                // USB quick-connect
                Button(
                    onClick = onConnectLocalhost,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = AgentDeckColors.Blue),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(vertical = 4.dp),
                    ) {
                        Text(
                            text = "USB Connect",
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        )
                        Text(
                            text = "127.0.0.1:9120",
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            color = Color.White.copy(alpha = 0.7f),
                        )
                    }
                }

                // mDNS discovered bridges
                if (discoveredBridges.isNotEmpty()) {
                    Text(
                        text = "Discovered",
                        style = MaterialTheme.typography.labelMedium,
                        color = AgentDeckColors.SlateText,
                    )
                    discoveredBridges.forEach { bridge ->
                        OutlinedButton(
                            onClick = { onConnectToBridge(bridge) },
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(8.dp),
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(text = bridge.name, color = AgentDeckColors.WhiteText)
                                Text(
                                    text = "${bridge.host}:${bridge.port}",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                    color = AgentDeckColors.SlateText,
                                )
                            }
                        }
                    }
                } else {
                    Text(
                        text = "Searching for bridges on network...",
                        style = MaterialTheme.typography.bodySmall,
                        color = AgentDeckColors.SlateText,
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = "Manual URL entry available in Settings tab",
                style = MaterialTheme.typography.bodySmall,
                color = AgentDeckColors.SlateText.copy(alpha = 0.7f),
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * Full-screen terrarium rendering — extracted from TerrariumScreen.
 * 60fps animation loop with all creatures and environment.
 */
@Composable
private fun ColorTerrariumBackground(state: TerrariumState) {
    // Create environment instances
    val waterEffect = remember { WaterEffect() }
    val rockFormation = remember { RockFormation() }
    val kelpField = remember { KelpField() }
    val dataParticles = remember { DataParticleSystem() }
    val bubbleSystem = remember { BubbleSystem() }

    // Multi-octopus: create/remove creatures when agent count changes
    val octopusSlots = layoutOctopuses(state.agents.size.coerceAtLeast(1))
    val octopuses = remember { mutableStateListOf<OctopusCreature>() }

    LaunchedEffect(state.agents.size) {
        val targetCount = state.agents.size.coerceAtLeast(1)
        while (octopuses.size < targetCount) {
            val slot = octopusSlots.getOrElse(octopuses.size) { octopusSlots.last() }
            octopuses.add(OctopusCreature(slot.centerXFraction, slot.centerYFraction, slot.scaleFactor))
        }
        while (octopuses.size > targetCount) {
            octopuses.removeAt(octopuses.lastIndex)
        }
        for (i in octopuses.indices) {
            val slot = octopusSlots.getOrElse(i) { octopusSlots.last() }
            octopuses[i] = OctopusCreature(slot.centerXFraction, slot.centerYFraction, slot.scaleFactor).also {
                if (i < state.agents.size) {
                    it.setState(state.agents[i].visualState)
                    it.setMark(state.agents[i].mark)
                }
            }
        }
    }

    // Main crayfish
    val mainCrayfish = remember { CrayfishCreature() }

    // Worker crayfish for multi-agent OpenClaw
    val workerSlots = layoutWorkerCrayfish(state.workerCrayfishCount)
    val workerCrayfish = remember { mutableStateListOf<CrayfishCreature>() }

    LaunchedEffect(state.workerCrayfishCount) {
        while (workerCrayfish.size < state.workerCrayfishCount) {
            val slot = workerSlots.getOrElse(workerCrayfish.size) { workerSlots.last() }
            workerCrayfish.add(CrayfishCreature(slot.centerXFraction, slot.centerYFraction, slot.scaleFactor))
        }
        while (workerCrayfish.size > state.workerCrayfishCount) {
            workerCrayfish.removeAt(workerCrayfish.lastIndex)
        }
    }

    // Update visual states when terrarium state changes
    LaunchedEffect(state.octopus, state.agents) {
        if (octopuses.isNotEmpty()) {
            octopuses[0].setState(state.octopus)
            if (state.agents.isNotEmpty()) {
                octopuses[0].setMark(state.agents[0].mark)
            }
            for (i in 1 until octopuses.size) {
                if (i < state.agents.size) {
                    octopuses[i].setState(state.agents[i].visualState)
                    octopuses[i].setMark(state.agents[i].mark)
                }
            }
        }
    }
    LaunchedEffect(state.crayfish) { mainCrayfish.setState(state.crayfish) }
    LaunchedEffect(state.tetra) { dataParticles.setState(state.tetra) }
    LaunchedEffect(state.agents, octopusSlots) {
        dataParticles.setAgentPositions(octopusSlots, state.agents)
    }
    LaunchedEffect(state.environment) {
        waterEffect.setState(state.environment)
        bubbleSystem.setState(state.environment)
        rockFormation.setState(state.environment)
    }

    // 60fps animation loop
    var lastFrameTime by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        while (true) {
            withFrameMillis { frameTimeMs ->
                val dt = if (lastFrameTime == 0L) 0f
                else (frameTimeMs - lastFrameTime) / 1000f
                lastFrameTime = frameTimeMs

                val clampedDt = dt.coerceAtMost(0.1f)

                waterEffect.update(clampedDt)
                rockFormation.update(clampedDt)
                kelpField.update(clampedDt)
                mainCrayfish.update(clampedDt)
                for (wc in workerCrayfish) wc.update(clampedDt)
                dataParticles.update(clampedDt)
                for (oct in octopuses) oct.update(clampedDt)
                bubbleSystem.update(clampedDt)
            }
        }
    }

    ColorTerrariumCanvas(
        state = state,
        waterEffect = waterEffect,
        rockFormation = rockFormation,
        kelpField = kelpField,
        mainCrayfish = mainCrayfish,
        workerCrayfish = workerCrayfish,
        dataParticles = dataParticles,
        octopuses = octopuses,
        bubbleSystem = bubbleSystem,
        modifier = Modifier.fillMaxSize(),
    )
}

/**
 * HUD overlay — semi-transparent panels positioned over the terrarium.
 */
@Composable
private fun MonitorHUD(
    dashState: DashboardState,
    timelineEntries: List<dev.agentdeck.state.TimelineEntry>,
    metrics: dev.agentdeck.state.MetricsSnapshot,
) {
    Box(modifier = Modifier.fillMaxSize()) {
        // Top bar: project, state, mode / model, agent type
        MonitorTopBar(
            agentState = dashState.agentState,
            projectName = dashState.projectName,
            modelName = dashState.modelName,
            agentType = dashState.agentType,
            permissionMode = dashState.permissionMode,
            modifier = Modifier.align(Alignment.TopCenter),
        )

        // Left side panels
        Column(
            modifier = Modifier
                .align(Alignment.CenterStart)
                .padding(start = 12.dp, top = 60.dp, bottom = 12.dp)
                .widthIn(max = 220.dp),
        ) {
            // Activity panel
            ActivityPanel(
                agentState = dashState.agentState,
                currentTool = dashState.currentTool,
                toolInput = dashState.toolInput,
                toolProgress = dashState.toolProgress,
                question = dashState.question,
                suggestedPrompt = dashState.suggestedPrompt,
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Multi-agent panel (conditional)
            MultiAgentPanel(
                siblingSessions = dashState.siblingSessions,
                workerSessionCount = dashState.workerSessionCount,
                sessionStatus = dashState.sessionStatus,
            )
        }

        // Right: Engine panel
        EnginePanel(
            usage = dashState.usage,
            metrics = metrics,
            oauthConnected = dashState.oauthConnected,
            ollamaStatus = dashState.ollamaStatus,
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .padding(end = 12.dp, top = 60.dp)
                .widthIn(max = 160.dp),
        )

        // Bottom: Timeline strip (~18% height)
        TimelineStrip(
            entries = timelineEntries,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .fillMaxHeight(0.22f)
                .padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}
