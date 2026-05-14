import Foundation
import Network

/// A tiny dependency-free HTTP server built on Network.framework.
///
/// It serves the PWA static files, exposes the current image at `/current`,
/// and pushes change notifications to connected viewers over Server-Sent
/// Events at `/events`. SSE is used instead of WebSockets because it needs no
/// handshake or frame parsing — it is just a long-lived HTTP response.
final class HTTPServer {
    /// Ports tried in order. `0` asks the OS to pick any free port as a last resort.
    private let portCandidates: [UInt16]
    private let queue = DispatchQueue(label: "ImageMirror.HTTPServer")
    private let webRoot: URL?

    private var listener: NWListener?
    private var sseConnections: [NWConnection] = []
    private var heartbeat: DispatchSourceTimer?

    /// Thread-safe snapshot of the image currently being served. Only touched on `queue`.
    private var snapshot: (data: Data, contentType: String, version: Int)?

    /// Called on the main queue once the listener is bound, with the chosen port.
    var onReady: ((UInt16) -> Void)?
    /// Called on the main queue whenever the number of connected viewers changes.
    var onClientCountChange: ((Int) -> Void)?

    private(set) var port: UInt16 = 0

    init(webRoot: URL?, portCandidates: [UInt16] = [8723, 8724, 8725, 8730, 8777, 0]) {
        self.webRoot = webRoot
        self.portCandidates = portCandidates
    }

    // MARK: - Lifecycle

    func start() {
        queue.async { [weak self] in
            self?.bind(remaining: self?.portCandidates ?? [])
        }
    }

    private func bind(remaining: [UInt16]) {
        guard let candidate = remaining.first else {
            NSLog("ImageMirror: could not bind to any port")
            return
        }
        let rest = Array(remaining.dropFirst())

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        let endpointPort: NWEndpoint.Port = candidate == 0 ? .any : (NWEndpoint.Port(rawValue: candidate) ?? .any)

        guard let listener = try? NWListener(using: params, on: endpointPort) else {
            bind(remaining: rest)
            return
        }

        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                let bound = listener.port?.rawValue ?? candidate
                self.port = bound
                self.startHeartbeat()
                DispatchQueue.main.async { self.onReady?(bound) }
            case .failed, .cancelled:
                listener.cancel()
                if self.listener === listener {
                    self.listener = nil
                    self.bind(remaining: rest)
                }
            default:
                break
            }
        }

        self.listener = listener
        listener.start(queue: queue)
    }

    // MARK: - Publishing images

    /// Replace the current image and notify every connected viewer.
    func publish(data: Data, contentType: String, version: Int) {
        queue.async { [weak self] in
            guard let self else { return }
            self.snapshot = (data, contentType, version)
            self.broadcast("data: \(version)\n\n")
        }
    }

    /// Drop the current image; viewers will fall back to their placeholder.
    func clear(version: Int) {
        queue.async { [weak self] in
            guard let self else { return }
            self.snapshot = nil
            self.broadcast("data: \(version)\n\n")
        }
    }

    // MARK: - Connection handling

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(connection, buffer: Data())
    }

    /// Accumulate bytes until the end of the HTTP request headers, then route.
    private func receiveRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] chunk, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let chunk { buffer.append(chunk) }

            if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
                self.route(connection, headerData: headerData)
                return
            }
            if isComplete || error != nil || buffer.count > 256 * 1024 {
                connection.cancel()
                return
            }
            self.receiveRequest(connection, buffer: buffer)
        }
    }

    private func route(_ connection: NWConnection, headerData: Data) {
        guard
            let header = String(data: headerData, encoding: .utf8),
            let requestLine = header.split(whereSeparator: { $0 == "\r" || $0 == "\n" }).first
        else {
            connection.cancel()
            return
        }

        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" else {
            send(connection, status: "405 Method Not Allowed", body: Data("Method Not Allowed".utf8))
            return
        }

        var path = String(parts[1])
        if let queryStart = path.firstIndex(of: "?") {
            path = String(path[..<queryStart])
        }

        switch path {
        case "/", "/index.html":
            serveFile(connection, name: "index.html", contentType: "text/html; charset=utf-8")
        case "/app.js":
            serveFile(connection, name: "app.js", contentType: "application/javascript; charset=utf-8")
        case "/sw.js":
            serveFile(connection, name: "sw.js", contentType: "application/javascript; charset=utf-8")
        case "/manifest.json":
            serveFile(connection, name: "manifest.json", contentType: "application/manifest+json")
        case "/icon-192.png":
            serveFile(connection, name: "icon-192.png", contentType: "image/png")
        case "/icon-512.png":
            serveFile(connection, name: "icon-512.png", contentType: "image/png")
        case "/current":
            serveCurrentImage(connection)
        case "/events":
            startEventStream(connection)
        default:
            send(connection, status: "404 Not Found", body: Data("Not Found".utf8))
        }
    }

    // MARK: - Routes

    private func serveFile(_ connection: NWConnection, name: String, contentType: String) {
        guard
            let webRoot,
            let data = try? Data(contentsOf: webRoot.appendingPathComponent(name))
        else {
            send(connection, status: "500 Internal Server Error", body: Data("Missing bundled resource: \(name)".utf8))
            return
        }
        send(connection, status: "200 OK", headers: ["Content-Type": contentType], body: data)
    }

    private func serveCurrentImage(_ connection: NWConnection) {
        guard let snapshot else {
            send(connection, status: "204 No Content", body: Data())
            return
        }
        send(connection, status: "200 OK", headers: [
            "Content-Type": snapshot.contentType,
            "Cache-Control": "no-store",
            "X-Image-Version": String(snapshot.version),
        ], body: snapshot.data)
    }

    private func startEventStream(_ connection: NWConnection) {
        let head = [
            "HTTP/1.1 200 OK",
            "Content-Type: text/event-stream",
            "Cache-Control: no-store",
            "Connection: keep-alive",
            "Access-Control-Allow-Origin: *",
            "", "",
        ].joined(separator: "\r\n")
        connection.send(content: Data(head.utf8), completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            if error != nil {
                connection.cancel()
                return
            }
            self.sseConnections.append(connection)
            self.notifyClientCount()
            self.writeSSE(connection, "retry: 2000\n\n")
            self.writeSSE(connection, "data: \(self.snapshot?.version ?? 0)\n\n")
            self.watchForClose(connection)
        })
    }

    /// SSE connections only ever send a request body once; any further read
    /// activity means the client closed the tab, so drop the connection.
    private func watchForClose(_ connection: NWConnection) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] _, _, isComplete, error in
            guard let self else { return }
            if isComplete || error != nil {
                self.dropSSE(connection)
            } else {
                self.watchForClose(connection)
            }
        }
    }

    // MARK: - SSE plumbing

    private func broadcast(_ message: String) {
        for connection in sseConnections {
            writeSSE(connection, message)
        }
    }

    private func writeSSE(_ connection: NWConnection, _ text: String) {
        connection.send(content: Data(text.utf8), completion: .contentProcessed { [weak self] error in
            if error != nil {
                self?.dropSSE(connection)
            }
        })
    }

    private func dropSSE(_ connection: NWConnection) {
        // Always re-enter the serial queue: this is called from send/receive
        // completion handlers which already run there, but also keeps the
        // mutation of `sseConnections` strictly serialized.
        queue.async { [weak self] in
            guard let self else { return }
            let before = self.sseConnections.count
            self.sseConnections.removeAll { $0 === connection }
            connection.cancel()
            if self.sseConnections.count != before {
                self.notifyClientCount()
            }
        }
    }

    private func notifyClientCount() {
        let count = sseConnections.count
        DispatchQueue.main.async { [weak self] in
            self?.onClientCountChange?(count)
        }
    }

    private func startHeartbeat() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 20, repeating: 20)
        timer.setEventHandler { [weak self] in
            self?.broadcast(": ping\n\n")
        }
        timer.resume()
        heartbeat = timer
    }

    // MARK: - Response writing

    private func send(_ connection: NWConnection, status: String, headers: [String: String] = [:], body: Data) {
        var headers = headers
        headers["Content-Length"] = String(body.count)
        headers["Connection"] = "close"
        headers["Access-Control-Allow-Origin"] = "*"

        var head = "HTTP/1.1 \(status)\r\n"
        for (key, value) in headers {
            head += "\(key): \(value)\r\n"
        }
        head += "\r\n"

        var response = Data(head.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
