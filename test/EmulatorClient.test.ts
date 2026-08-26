import * as net from 'net';
import { EmulatorClient, EmulatorEvent } from '../src/EmulatorClient';

// ── Mock TCP server ───────────────────────────────────────────────────────────

class MockDebugServer {
    private server: net.Server;
    private conn: net.Socket | null = null;
    public  received: any[] = [];

    private handler: (cmd: any) => any = () => ({ status: 'ok' });

    constructor(private port: number) {
        this.server = net.createServer(sock => {
            this.conn = sock;
            let buf = '';
            sock.on('data', chunk => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop()!;
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        this.received.push(msg);
                        if (msg.type !== 'event') {
                            const resp = this.handler(msg);
                            sock.write(JSON.stringify(resp) + '\n');
                        }
                    } catch { /* skip malformed */ }
                }
            });
        });
    }

    /** Override the response for all commands. */
    respond(fn: (cmd: any) => any): void { this.handler = fn; }

    /** Send an event proactively to the connected client. */
    sendEvent(evt: object): void { this.conn?.write(JSON.stringify(evt) + '\n'); }

    listen(): Promise<void> {
        return new Promise(r => this.server.listen(this.port, '127.0.0.1', r));
    }

    close(): Promise<void> {
        return new Promise((r, j) => {
            this.conn?.destroy();
            this.server.close(err => err ? j(err) : r());
        });
    }
}

// Allocate a port per test file to avoid conflicts
let PORT = 17500;

function nextPort(): number { return PORT++; }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EmulatorClient', () => {
    let server: MockDebugServer;
    let client: EmulatorClient;
    let port: number;

    beforeEach(async () => {
        port   = nextPort();
        server = new MockDebugServer(port);
        await server.listen();
        client = new EmulatorClient();
        await client.connect(port);
    });

    afterEach(async () => {
        client.disconnect();
        await server.close();
    });

    // ── Basic send/receive ────────────────────────────────────────────────────

    test('sends JSON command and receives response', async () => {
        server.respond(() => ({ PC: 0x1234, SP: 0xC000 }));
        const resp = await client.send({ cmd: 'readRegisters' });
        expect(resp.PC).toBe(0x1234);
        expect(resp.SP).toBe(0xC000);
    });

    test('command received by server contains correct cmd field', async () => {
        await client.send({ cmd: 'halt' });
        expect(server.received).toHaveLength(1);
        expect(server.received[0].cmd).toBe('halt');
    });

    test('extra fields are forwarded to server', async () => {
        await client.send({ cmd: 'readMemory', address: 0x4000, size: 16 });
        expect(server.received[0].address).toBe(0x4000);
        expect(server.received[0].size).toBe(16);
    });

    // ── Event handling ────────────────────────────────────────────────────────

    test('async events are delivered via onEvent, not as response', async () => {
        const events: EmulatorEvent[] = [];
        client.onEvent = evt => events.push(evt);

        // Server: send event THEN response
        server.respond(cmd => {
            server.sendEvent({ type: 'event', event: 'break_', body: { pc: 0x9000 } });
            return { status: 'ok' };
        });

        const resp = await client.send({ cmd: 'step' });
        await new Promise(r => setTimeout(r, 50));  // let event propagate

        expect(resp.status).toBe('ok');
        expect(events).toHaveLength(1);
        expect(events[0].event).toBe('break_');
    });

    // ── Command queueing ──────────────────────────────────────────────────────

    test('concurrent sends are serialised (one in-flight at a time)', async () => {
        const order: number[] = [];
        server.respond(cmd => {
            order.push(cmd.seq);
            return { seq: cmd.seq };
        });

        const [r1, r2, r3] = await Promise.all([
            client.send({ cmd: 'x', seq: 1 }),
            client.send({ cmd: 'x', seq: 2 }),
            client.send({ cmd: 'x', seq: 3 }),
        ]);

        expect(r1.seq).toBe(1);
        expect(r2.seq).toBe(2);
        expect(r3.seq).toBe(3);
        expect(order).toEqual([1, 2, 3]);
    });

    // ── Error cases ───────────────────────────────────────────────────────────

    test('send rejects when socket is not connected', async () => {
        const c = new EmulatorClient();  // not connected
        await expect(c.send({ cmd: 'test' })).rejects.toThrow();
    });
});
