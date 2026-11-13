"""
Brug voor de camera van de Bambu Lab A1 / A1 mini.

De A1 mini heeft geen RTSP maar een eigen JPEG-stroom op poort 6000. Dit script leest die stroom en biedt hem
aan als gewone MJPEG-stream, zodat een <img> op je website hem kan tonen. Alleen standaard Python nodig.

Start:   python bambu_cam.py            (vraagt IP + Access Code)
         python bambu_cam.py --tunnel   (maakt ook zelf het publieke adres en geeft het door aan de website)
Stream:  http://localhost:1984/api/stream.mjpeg?src=a1mini
Foto:    http://localhost:1984/api/frame.jpeg
Status:  http://localhost:1984/api/status   (de website gebruikt dit om 'printer offline' te tonen)
"""
import json, os, re, socket, ssl, struct, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Instellingen worden gevraagd bij het starten (en onthouden in je gebruikersmap, NIET in deze map/GitHub).
# Je kunt ze ook vooraf zetten met de omgevingsvariabelen PRINTER_IP en ACCESS_CODE.
CONFIG_FILE = os.path.join(os.path.expanduser("~"), ".bambu_cam.json")
PRINTER_PORT = int(os.environ.get("PRINTER_PORT", "6000"))
LISTEN_HOST = "127.0.0.1"                                       # alleen deze pc; de tunnel verbindt hiermee
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "1984"))
FIREBASE_DB = "https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app"
PRINTER_IP = ""
ACCESS_CODE = ""
USE_TUNNEL = "--tunnel" in sys.argv


def ask_settings():
    """Haalt IP + Access Code uit omgeving, opgeslagen bestand of vraagt ze (zodat PowerShell ze gewoon invult)."""
    global PRINTER_IP, ACCESS_CODE
    saved = {}
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except Exception:
        pass
    ip = os.environ.get("PRINTER_IP", "").strip() or saved.get("ip", "")
    code = os.environ.get("ACCESS_CODE", "").strip() or saved.get("code", "")
    if ip and code:
        ans = input(f"Printer {ip} gebruiken? [Enter = ja, n = andere invullen]: ").strip().lower() if sys.stdin.isatty() and not os.environ.get("PRINTER_IP") else "j"
        if ans.startswith("n"):
            ip = code = ""
    while not re.fullmatch(r"\d{1,3}(\.\d{1,3}){3}", ip):
        ip = input("IP-adres van de printer (bijv. 192.168.1.50): ").strip()
    while len(code) != 8 or not code.isalnum():
        code = input("Access Code van de printer (8 tekens, staat op het printerscherm): ").strip()
    PRINTER_IP, ACCESS_CODE = ip, code
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({"ip": ip, "code": code}, f)
    except Exception:
        pass


def preflight():
    """Controleert vooraf of de printer bereikbaar is en geeft een duidelijke melding als dat niet zo is."""
    try:
        socket.create_connection((PRINTER_IP, PRINTER_PORT), timeout=6).close()
        print(f"OK: printer {PRINTER_IP} is bereikbaar op poort {PRINTER_PORT}.")
        return True
    except Exception as e:
        print(f"\nLET OP: geen verbinding met de printer ({PRINTER_IP}:{PRINTER_PORT}): {e}")
        print("  - Staat 'LAN Mode Liveview' aan op de printer? (Instellingen > WLAN/LAN)")
        print("  - Klopt het IP-adres, en zit deze pc op hetzelfde netwerk/wifi als de printer?")
        print("  - Kijkt er al een ander programma (Bambu Studio / Handy) live mee? Sluit die.\n")
        return False


def publish_url(url):
    """Zet de tunnel-URL in Firebase zodat de website hem vanzelf gebruikt (geen handmatig aanpassen meer)."""
    try:
        req = urllib.request.Request(f"{FIREBASE_DB}/settings/camera/url.json", data=json.dumps(url).encode(), method="PUT",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
        log("tunnel-adres doorgegeven aan de website:", url)
        return True
    except Exception as e:
        log("kon het adres niet naar Firebase schrijven:", e, "- zet het handmatig in beheer-config.js")
        return False


def start_tunnel():
    """Start een Cloudflare quick tunnel en publiceert de nieuwe URL (cloudflared moet geinstalleerd zijn)."""
    try:
        proc = subprocess.Popen(["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{LISTEN_PORT}"],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    except FileNotFoundError:
        log("cloudflared niet gevonden. Installeer met:  winget install Cloudflare.cloudflared  (daarna PowerShell opnieuw openen)")
        return None

    def pump():
        done = False
        for line in proc.stdout:
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if m and not done:
                done = True
                full = m.group(0) + "/api/stream.mjpeg?src=a1mini"
                log("tunnel is klaar:", full)
                publish_url(full)
    threading.Thread(target=pump, daemon=True).start()
    return proc


lock = threading.Condition()
frame = None          # laatste JPEG
frame_no = 0
last_frame_at = 0.0   # tijdstip van het laatste beeld (voor /api/status)
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
    global frame, frame_no, last_frame_at
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
                            frame, frame_no, last_frame_at = img, frame_no + 1, time.time()
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
        elif path == "/api/status":
            online = frame is not None and time.time() - last_frame_at < 10
            body = (b'{"online": true}' if online else b'{"online": false}')
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)


if __name__ == "__main__":
    ask_settings()
    preflight()
    threading.Thread(target=reader, daemon=True).start()
    srv = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    srv.daemon_threads = True
    log(f"Camerabrug draait op http://localhost:{LISTEN_PORT}/api/stream.mjpeg?src=a1mini")
    tunnel = start_tunnel() if USE_TUNNEL else None
    if not USE_TUNNEL:
        log("Tip: start met  python bambu_cam.py --tunnel  om automatisch een publiek adres te maken.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if tunnel:
            tunnel.terminate()
            try:
                urllib.request.urlopen(urllib.request.Request(f"{FIREBASE_DB}/settings/camera/url.json", data=b"null", method="PUT"), timeout=5).read()
            except Exception:
                pass
