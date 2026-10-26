package com.ottnavigator.tv;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

/**
 * Embedded local HTTP proxy for Android.
 * Runs completely on the Android device (127.0.0.1:8085) with zero external servers.
 * Handles OTT Navigator User-Agent spoofing, manifest rewriting, and asset serving.
 */
public class LocalTvProxy {
    private final Context context;
    private final int port;
    private ServerSocket serverSocket;
    private final ExecutorService threadPool = Executors.newCachedThreadPool();
    private volatile boolean isRunning = false;

    private static final String DEFAULT_UA = "OTT Navigator/1.7.0.2";

    public LocalTvProxy(Context context, int port) {
        this.context = context;
        this.port = port;
    }

    public synchronized void start() throws IOException {
        if (isRunning) return;
        serverSocket = new ServerSocket(port, 50, InetAddress.getByName("127.0.0.1"));
        isRunning = true;

        threadPool.execute(() -> {
            while (isRunning && !serverSocket.isClosed()) {
                try {
                    Socket clientSocket = serverSocket.accept();
                    threadPool.execute(() -> handleClient(clientSocket));
                } catch (IOException e) {
                    if (!isRunning) break;
                }
            }
        });
    }

    public synchronized void stop() {
        isRunning = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {}
        threadPool.shutdownNow();
    }

    private void handleClient(Socket socket) {
        try {
            socket.setSoTimeout(30000);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            BufferedReader reader = new BufferedReader(new InputStreamReader(in));
            String reqLine = reader.readLine();
            if (reqLine == null || reqLine.isEmpty()) {
                socket.close();
                return;
            }

            String[] reqParts = reqLine.split(" ");
            if (reqParts.length < 2) {
                socket.close();
                return;
            }

            String method = reqParts[0];
            String fullPath = reqParts[1];

            // Read headers
            Map<String, String> clientHeaders = new HashMap<>();
            String line;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                int col = line.indexOf(':');
                if (col != -1) {
                    clientHeaders.put(line.substring(0, col).trim().toLowerCase(), line.substring(col + 1).trim());
                }
            }

            if ("OPTIONS".equalsIgnoreCase(method)) {
                sendCorsHeaders(out, 200, "text/plain");
                out.flush();
                socket.close();
                return;
            }

            if (fullPath.startsWith("/proxy")) {
                handleProxyRequest(fullPath, clientHeaders, out);
            } else {
                handleStaticAsset(fullPath, clientHeaders, out);
            }
        } catch (Exception e) {
            // Socket error or disconnect
        } finally {
            try {
                socket.close();
            } catch (IOException ignored) {}
        }
    }

    private void handleStaticAsset(String fullPath, Map<String, String> clientHeaders, OutputStream out) throws IOException {
        String path = fullPath;
        int qIdx = path.indexOf('?');
        if (qIdx != -1) path = path.substring(0, qIdx);
        if (path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.startsWith("/")) path = path.substring(1);

        AssetManager am = context.getAssets();
        InputStream assetIn = null;
        try {
            assetIn = am.open(path);
        } catch (IOException e) {
            sendNotFound(out, "File not found: " + path);
            return;
        }

        String mime = getMimeType(path);
        byte[] buffer = new byte[8192];
        ByteArrayOutputStream byteBuffer = new ByteArrayOutputStream();
        int read;
        while ((read = assetIn.read(buffer)) != -1) {
            byteBuffer.write(buffer, 0, read);
        }
        assetIn.close();

        byte[] body = byteBuffer.toByteArray();
        PrintWriter pw = new PrintWriter(new OutputStreamWriter(out, "UTF-8"));
        pw.print("HTTP/1.1 200 OK\r\n");
        pw.print("Content-Type: " + mime + "\r\n");
        pw.print("Content-Length: " + body.length + "\r\n");
        pw.print("Access-Control-Allow-Origin: *\r\n");
        pw.print("Connection: close\r\n\r\n");
        pw.flush();

        out.write(body);
        out.flush();
    }

    private void handleProxyRequest(String fullPath, Map<String, String> clientHeaders, OutputStream out) throws IOException {
        Map<String, String> params = parseQueryParams(fullPath);
        String targetUrl = params.get("url");
        String customUa = params.get("ua");
        String customRef = params.get("ref");

        if (targetUrl == null || targetUrl.isEmpty()) {
            sendBadRequest(out, "Missing url parameter");
            return;
        }

        // Clean pipe delimiters if present
        if (targetUrl.contains("|")) {
            String[] parts = targetUrl.split("\\|");
            targetUrl = parts[0].trim();
            for (int i = 1; i < parts.length; i++) {
                String p = parts[i].trim();
                if (p.toLowerCase().startsWith("referer=")) customRef = p.substring(8).trim();
                else if (p.toLowerCase().startsWith("user-agent=")) customUa = p.substring(11).trim();
            }
        }

        if (customUa == null || customUa.isEmpty()) customUa = DEFAULT_UA;

        // Auto-fix domain specific headers
        if (targetUrl.contains("fancode")) {
            if (customRef == null) customRef = "https://fancode.com/";
            if (targetUrl.contains("sportsfancode.mpd") || targetUrl.contains("sportsfancode2.mpd")) {
                targetUrl = "https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket";
            }
        } else if (targetUrl.contains("slivcdn.com") || targetUrl.contains("suluv") || targetUrl.contains("sliv-")) {
            if (customRef == null) customRef = "https://la.drmlive.net/";
            customUa = "OTT Navigator/1.7.0.2";
        }

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(targetUrl).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(25000);
            conn.setReadTimeout(25000);
            conn.setRequestProperty("User-Agent", customUa);
            conn.setRequestProperty("Accept", "*/*");
            if (customRef != null && !customRef.isEmpty()) {
                conn.setRequestProperty("Referer", customRef);
            }
            if (clientHeaders.containsKey("range")) {
                conn.setRequestProperty("Range", clientHeaders.get("range"));
            }

            int status = conn.getResponseCode();
            // Handle redirects manually if needed
            if (status == HttpURLConnection.HTTP_MOVED_TEMP || status == HttpURLConnection.HTTP_MOVED_PERM) {
                String newUrl = conn.getHeaderField("Location");
                if (newUrl != null) {
                    conn.disconnect();
                    conn = (HttpURLConnection) new URL(newUrl).openConnection();
                    conn.setRequestProperty("User-Agent", customUa);
                    if (customRef != null) conn.setRequestProperty("Referer", customRef);
                    status = conn.getResponseCode();
                }
            }

            InputStream respIn = (status >= 400) ? conn.getErrorStream() : conn.getInputStream();
            if (respIn == null) respIn = new ByteArrayInputStream(new byte[0]);

            byte[] data = readFully(respIn);
            String finalUrl = conn.getURL().toString();
            String contentType = conn.getContentType();
            if (contentType == null) contentType = "application/octet-stream";

            // 1. Rewrite DASH MPD BaseURL
            if (contentType.contains("dash+xml") || new String(data, 0, Math.min(data.length, 100)).contains("<MPD")) {
                String mpdStr = new String(data, "UTF-8");
                String baseUrl = finalUrl.substring(0, finalUrl.lastIndexOf('/') + 1);
                if (!mpdStr.contains("<BaseURL>")) {
                    mpdStr = mpdStr.replaceFirst("(<MPD[^>]*>)", "$1\n  <BaseURL>" + baseUrl + "</BaseURL>");
                } else if (mpdStr.contains("<BaseURL>dash/</BaseURL>")) {
                    mpdStr = mpdStr.replace("<BaseURL>dash/</BaseURL>", "<BaseURL>" + baseUrl + "dash/</BaseURL>");
                }
                data = mpdStr.getBytes("UTF-8");
                contentType = "application/dash+xml";
            }
            // 2. Rewrite HLS M3U8 variant playlists
            else if (contentType.contains("mpegurl") || (data.length > 7 && new String(data, 0, 7).startsWith("#EXTM3U"))) {
                String m3u8Str = new String(data, "UTF-8");
                if (!m3u8Str.contains("#EXTINF:-1") && !m3u8Str.contains("group-title=")) {
                    data = rewriteM3u8Content(m3u8Str, finalUrl, customUa, customRef).getBytes("UTF-8");
                    contentType = "application/vnd.apple.mpegurl; charset=utf-8";
                }
            }

            PrintWriter pw = new PrintWriter(new OutputStreamWriter(out, "UTF-8"));
            pw.print("HTTP/1.1 " + status + " " + conn.getResponseMessage() + "\r\n");
            pw.print("Content-Type: " + contentType + "\r\n");
            pw.print("Content-Length: " + data.length + "\r\n");
            pw.print("Access-Control-Allow-Origin: *\r\n");
            pw.print("Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS\r\n");
            pw.print("Access-Control-Allow-Headers: *\r\n");
            pw.print("Accept-Ranges: bytes\r\n");
            if (conn.getHeaderField("Content-Range") != null) {
                pw.print("Content-Range: " + conn.getHeaderField("Content-Range") + "\r\n");
            }
            pw.print("Connection: close\r\n\r\n");
            pw.flush();

            out.write(data);
            out.flush();
        } catch (Exception e) {
            sendError(out, 502, "Proxy Error: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String rewriteM3u8Content(String content, String baseUrl, String ua, String ref) {
        StringBuilder sb = new StringBuilder();
        String[] lines = content.split("\r?\n");
        String baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);

        for (String l : lines) {
            String trimmed = l.trim();
            if (trimmed.isEmpty()) continue;
            if (trimmed.startsWith("#")) {
                if (trimmed.contains("URI=\"")) {
                    Pattern p = Pattern.compile("URI=\"([^\"]+)\"");
                    Matcher m = p.matcher(trimmed);
                    StringBuffer res = new StringBuffer();
                    while (m.find()) {
                        String raw = m.group(1);
                        String resolved = resolveUrl(baseDir, raw);
                        String proxied = "/proxy?url=" + URLEncoder.encode(resolved) + "&ua=" + URLEncoder.encode(ua);
                        if (ref != null) proxied += "&ref=" + URLEncoder.encode(ref);
                        m.appendReplacement(res, "URI=\"" + Matcher.quoteReplacement(proxied) + "\"");
                    }
                    m.appendTail(res);
                    sb.append(res.toString()).append("\n");
                } else {
                    sb.append(trimmed).append("\n");
                }
            } else {
                String resolved = resolveUrl(baseDir, trimmed);
                String proxied = "/proxy?url=" + URLEncoder.encode(resolved) + "&ua=" + URLEncoder.encode(ua);
                if (ref != null) proxied += "&ref=" + URLEncoder.encode(ref);
                sb.append(proxied).append("\n");
            }
        }
        return sb.toString();
    }

    private String resolveUrl(String base, String rel) {
        try {
            return new URL(new URL(base), rel).toString();
        } catch (Exception e) {
            return rel;
        }
    }

    private byte[] readFully(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) != -1) {
            bos.write(buf, 0, r);
        }
        return bos.toByteArray();
    }

    private Map<String, String> parseQueryParams(String path) {
        Map<String, String> map = new HashMap<>();
        int q = path.indexOf('?');
        if (q == -1) return map;
        String query = path.substring(q + 1);
        String[] pairs = query.split("&");
        for (String p : pairs) {
            int eq = p.indexOf('=');
            if (eq != -1) {
                try {
                    String k = URLDecoder.decode(p.substring(0, eq), "UTF-8");
                    String v = URLDecoder.decode(p.substring(eq + 1), "UTF-8");
                    map.put(k, v);
                } catch (Exception ignored) {}
            }
        }
        return map;
    }

    private void sendCorsHeaders(OutputStream out, int status, String type) throws IOException {
        PrintWriter pw = new PrintWriter(new OutputStreamWriter(out, "UTF-8"));
        pw.print("HTTP/1.1 " + status + " OK\r\n");
        pw.print("Content-Type: " + type + "\r\n");
        pw.print("Access-Control-Allow-Origin: *\r\n");
        pw.print("Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS\r\n");
        pw.print("Access-Control-Allow-Headers: *\r\n");
        pw.print("Content-Length: 0\r\n");
        pw.print("Connection: close\r\n\r\n");
        pw.flush();
    }

    private void sendError(OutputStream out, int code, String msg) throws IOException {
        byte[] body = msg.getBytes("UTF-8");
        PrintWriter pw = new PrintWriter(new OutputStreamWriter(out, "UTF-8"));
        pw.print("HTTP/1.1 " + code + " Error\r\n");
        pw.print("Content-Type: text/plain; charset=utf-8\r\n");
        pw.print("Content-Length: " + body.length + "\r\n");
        pw.print("Access-Control-Allow-Origin: *\r\n");
        pw.print("Connection: close\r\n\r\n");
        pw.flush();
        out.write(body);
        out.flush();
    }

    private void sendNotFound(OutputStream out, String msg) throws IOException {
        sendError(out, 404, msg);
    }

    private void sendBadRequest(OutputStream out, String msg) throws IOException {
        sendError(out, 400, msg);
    }

    private String getMimeType(String path) {
        if (path.endsWith(".html")) return "text/html; charset=utf-8";
        if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (path.endsWith(".css")) return "text/css; charset=utf-8";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".m3u") || path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
        if (path.endsWith(".mpd")) return "application/dash+xml";
        return "application/octet-stream";
    }
}
