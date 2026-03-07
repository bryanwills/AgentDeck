package dev.agentdeck

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import dev.agentdeck.data.DisplayPreferences
import dev.agentdeck.net.BridgeConnection
import dev.agentdeck.net.ConnectionStatus
import dev.agentdeck.state.AgentStateHolder
import dev.agentdeck.ui.monitor.MonitorScreen
import dev.agentdeck.ui.screen.DeckScreen
import dev.agentdeck.ui.screen.EinkMonitorScreen
import dev.agentdeck.ui.screen.SettingsScreen
import dev.agentdeck.ui.theme.AgentDeckTheme
import dev.agentdeck.util.EinkDetector
import android.content.Intent
import android.util.Log
import android.view.WindowManager
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import dev.agentdeck.net.BridgeDiscovery
import dev.agentdeck.service.MonitorService
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed class Screen(val route: String, val label: String, val icon: ImageVector) {
    data object Dashboard : Screen("dashboard", "Dashboard", Icons.Default.Dashboard)
    data object Deck : Screen("deck", "Deck", Icons.Default.GridView)
    data object Settings : Screen("settings", "Settings", Icons.Default.Settings)
}

class MainActivity : ComponentActivity() {

    private var isEinkDevice = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        isEinkDevice = EinkDetector.isEinkDevice()

        // E-ink: immersive fullscreen — hide status bar and navigation bar
        if (isEinkDevice) {
            hideSystemBars()
        }

        val stateHolder = AgentStateHolder.instance
        val connection = BridgeConnection.instance
        val displayPrefs = DisplayPreferences(this, isEink = isEinkDevice)

        // Apply saved orientation preference
        lifecycleScope.launch {
            displayPrefs.orientationFlow.collect { orientation ->
                requestedOrientation = orientation
            }
        }

        // Keep screen on while dashboard is active
        lifecycleScope.launch {
            displayPrefs.keepAwakeFlow.collect { keepAwake ->
                if (keepAwake) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
        }

        // Start/stop MonitorService based on keepAwake preference
        lifecycleScope.launch {
            displayPrefs.keepAwakeFlow.collect { keepAwake ->
                val serviceIntent = Intent(this@MainActivity, MonitorService::class.java)
                if (keepAwake) {
                    ContextCompat.startForegroundService(this@MainActivity, serviceIntent)
                } else {
                    stopService(serviceIntent)
                }
            }
        }

        setContent {
            AgentDeckTheme(isEink = isEinkDevice) {
                if (isEinkDevice) {
                    EinkMonitorScreen(stateHolder, connection, displayPrefs)
                } else {
                    MainNavigation(stateHolder, connection, displayPrefs)
                }
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Re-hide system bars after Dialog dismissal (Dialog creates a new window
        // which resets immersive mode flags on the main window)
        if (hasFocus && isEinkDevice) {
            hideSystemBars()
        }
    }

    private fun hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}

private const val TAG = "MainActivity"

@Composable
fun MainNavigation(
    stateHolder: AgentStateHolder,
    connection: BridgeConnection,
    displayPrefs: DisplayPreferences,
) {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentDestination = navBackStackEntry?.destination

    val bottomNavScreens = listOf(Screen.Dashboard, Screen.Deck, Screen.Settings)

    val connectionStatus by connection.status.collectAsState()
    val currentUrl by connection.url.collectAsState()
    val context = LocalContext.current

    // Auto-connect: saved URL first, then mDNS fallback
    LaunchedEffect(Unit) {
        val savedUrl = displayPrefs.lastBridgeUrlFlow.first()
        Log.i(TAG, "Auto-connect: savedUrl=$savedUrl")
        if (savedUrl != null) {
            connection.autoConnect(savedUrl)
            // Wait for connection or timeout
            delay(5000)
        }
        // If still disconnected, try mDNS discovery
        if (connection.status.value != ConnectionStatus.CONNECTED) {
            Log.i(TAG, "Saved URL failed, trying mDNS discovery...")
            val discovery = BridgeDiscovery(context)
            discovery.discover().collect { bridges ->
                if (bridges.isNotEmpty() && connection.status.value != ConnectionStatus.CONNECTED) {
                    val bridge = bridges.first()
                    Log.i(TAG, "mDNS auto-connect: ${bridge.name} at ${bridge.wsUrl()}")
                    connection.connect(bridge.wsUrl())
                }
            }
        }
    }

    // Persist URL on successful connection
    LaunchedEffect(connectionStatus) {
        if (connectionStatus == ConnectionStatus.CONNECTED) {
            val url = currentUrl
            if (url != null) displayPrefs.setLastBridgeUrl(url)
        }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        bottomBar = {
            NavigationBar {
                    bottomNavScreens.forEach { screen ->
                        NavigationBarItem(
                            icon = { Icon(screen.icon, contentDescription = screen.label) },
                            label = { Text(screen.label) },
                            selected = currentDestination?.hierarchy?.any { it.route == screen.route } == true,
                            onClick = {
                                navController.navigate(screen.route) {
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            }
                        )
                    }
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Screen.Dashboard.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Screen.Dashboard.route) {
                MonitorScreen(
                    stateHolder = stateHolder,
                    connection = connection,
                    displayPrefs = displayPrefs,
                )
            }
            composable(Screen.Deck.route) {
                DeckScreen(
                    stateHolder = stateHolder,
                    connection = connection,
                )
            }
            composable(Screen.Settings.route) {
                SettingsScreen(
                    connection = connection,
                    displayPrefs = displayPrefs,
                    isEink = false,
                )
            }
        }
    }
}
