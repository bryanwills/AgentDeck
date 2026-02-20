import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { BridgeEvent, PluginCommand } from './types.js';
import { debug } from './logger.js';

export class WsServer {
  private wss: WebSocketServer;
  private commandCallback: ((cmd: PluginCommand) => void) | null = null;
  private onConnectCallback: ((ws: WebSocket) => void) | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws) => {
      debug('WS', 'Plugin connected');

      // Send current state to newly connected client
      if (this.onConnectCallback) {
        this.onConnectCallback(ws);
      }

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as PluginCommand;
          debug('WS', `recv cmd: ${msg.type}`);
          if (this.commandCallback) {
            this.commandCallback(msg);
          }
        } catch (err) {
          debug('WS', `Failed to parse message: ${err}`);
        }
      });

      ws.on('close', () => {
        debug('WS', 'Plugin disconnected');
      });

      ws.on('error', (err) => {
        debug('WS', `WebSocket error: ${err}`);
      });
    });
  }

  broadcast(event: BridgeEvent): void {
    const payload = JSON.stringify(event);
    const clientCount = this.wss.clients.size;
    debug('WS', `broadcast(${event.type}) to ${clientCount} clients`);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  onCommand(callback: (cmd: PluginCommand) => void): void {
    this.commandCallback = callback;
  }

  onClientConnect(callback: (ws: WebSocket) => void): void {
    this.onConnectCallback = callback;
  }

  sendTo(ws: WebSocket, event: BridgeEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  getClientCount(): number {
    return this.wss.clients.size;
  }

  close(): void {
    for (const client of this.wss.clients) {
      client.close();
    }
    this.wss.close();
  }
}
