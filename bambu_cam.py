"""
Brug voor de camera van de Bambu Lab A1 / A1 mini.

De A1 mini heeft geen RTSP maar een eigen JPEG-stroom op poort 6000. Dit script leest die stroom en biedt hem
aan als gewone MJPEG-stream, zodat een <img> op je website hem kan tonen. Alleen standaard Python nodig.

Start:   python bambu_cam.py
Stream:  http://localhost:1984/api/stream.mjpeg?src=a1mini
Foto:    http://localhost:1984/api/frame.jpeg
"""
import os, socket, ssl, struct, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ====== HIER INVULLEN ======
PRINTER_IP = os.environ.get("PRINTER_IP", "PRINTER_IP")        # bijv. "192.168.1.50"
ACCESS_CODE = os.environ.get("ACCESS_CODE", "32830799")        # de Access Code van de printer
# ===========================
PRINTER_PORT = int(os.environ.get("PRINTER_PORT", "6000"))
LISTEN_HOST = "127.0.0.1"                                       # alleen deze pc; de tunnel verbindt hiermee
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "1984"))

lock = threading.Condition()
frame = None          # laatste JPEG
frame_no = 0
viewers = 0           # alleen verbinden met de printer zolang er iemand kijkt


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def recv_n(s, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("verbinding gesloten door printer")
        buf += chunk
    return bytes(buf)


def auth_packet():
    return (struct.pack("<IIII", 0x40, 0x3000, 0, 0)
            + b"bblp".ljust(32, b"\0") + ACCESS_CODE.encode().ljust(32, b"\0"))


def reader():
    global frame, frame_no
    while True:
        with lock:
            while viewers == 0:
                lock.wait()
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            log("verbinden met printer", PRINTER_IP)
            with socket.create_connection((PRINTER_IP, PRINTER_PORT), timeout=10) as raw, ctx.wrap_socket(raw) as s:
                s.settimeout(15)
                s.sendall(auth_packet())
                log("verbonden, wachten op beeld")
                while viewers > 0:
                    size = struct.unpack("<I", recv_n(s, 16)[:4])[0]
                    if size == 0 or size > 6_000_000:
                        raise ValueError(f"onverwachte framegrootte {size} (klopt de Access Code?)")
                    img = recv_n(s, size)
                    if img[:2] == b"\xff\xd8" and img[-2:] == b"\xff\xd9":
                        with lock:
                            frame, frame_no = img, frame_no + 1
                            lock.notify_all()
            log("niemand kijkt meer, verbinding gesloten")
        except Exception as e:
            log("fout:", e, "- opnieuw proberen over 3 seconden")
            time.sleep(3)


def add_viewer(d):
    global viewers
    with lock:
        viewers += d
        lock.notify_all()


def wait_frame(last, timeout=15):
    with lock:
        lock.wait_for(lambda: frame is not None and frame_no != last, timeout)
        return (frame, frame_no) if (frame is not None and frame_no != last) else (None, last)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/stream.mjpeg":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            add_viewer(1)
            with lock:
                last = frame_no          # begin met een vers beeld, niet met een oud
            try:
                while True:
                    img, last = wait_frame(last)
                    if img is None:
                        continue
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(img))
                    self.wfile.write(img + b"\r\n")
            except (BrokenPipeError, ConnectionError, OSError):
                pass
            finally:
                add_viewer(-1)
        elif path == "/api/frame.jpeg":
            add_viewer(1)
            try:
                with lock:
                    cur = frame_no
                img, _ = wait_frame(cur, 20)
            finally:
                add_viewer(-1)
            if img is None:
                self.send_error(503, "geen beeld van de printer")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(img)
        else:
            self.send_error(404)


if __name__ == "__main__":
    if PRINTER_IP == "PRINTER_IP":
        sys.exit("Vul bovenin dit bestand eerst het IP-adres van je printer in (PRINTER_IP).")
    threading.Thread(target=reader, daemon=True).start()
    srv = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    srv.daemon_threads = True
    log(f"Camerabrug draait op http://localhost:{LISTEN_PORT}/api/stream.mjpeg?src=a1mini")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
